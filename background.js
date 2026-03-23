importScripts('ExtPay.js');

const extpay = ExtPay('coinwatch');
extpay.startBackground();

const DEFAULT_SETTINGS = {
  refreshSeconds: 45,
  items: [
    {
      id: crypto.randomUUID(),
      label: 'BTC',
      type: 'binance',
      binanceSymbol: 'BTCUSDT'
    },
    {
      id: crypto.randomUUID(),
      label: 'ETH',
      type: 'binance',
      binanceSymbol: 'ETHUSDT'
    },
    {
      id: crypto.randomUUID(),
      label: 'SOL',
      type: 'binance',
      binanceSymbol: 'SOLUSDT'
    }
  ]
};

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(['refreshSeconds', 'items']);
  if (!existing.items) {
    await chrome.storage.local.set(DEFAULT_SETTINGS);
  }
  chrome.alarms.create('coinwatch-refresh', { periodInMinutes: 1 });
  setupContextMenu();
});

// Also create context menu on service worker startup (survives reload)
setupContextMenu();

function setupContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'coinwatch-add',
      title: 'Add to CoinWatch',
      contexts: ['selection']
    });
    console.log('[CoinWatch BG] Context menu created');
  });
}

// Inject a small in-tab toast for context menu feedback
async function injectContextToast(tabId, message, type = 'info') {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (msg, msgType) => {
        const CONTAINER_ID = 'coinwatch-ctx-toast';
        let existing = document.getElementById(CONTAINER_ID);
        if (existing) existing.remove();

        const host = document.createElement('div');
        host.id = CONTAINER_ID;
        host.style.cssText = 'position:fixed;top:20px;right:20px;z-index:2147483647;pointer-events:none;';
        const shadow = host.attachShadow({ mode: 'open' });
        const colors = { success: '#118a4f', error: '#c03f2f', info: '#1f1f1c', warn: '#e8a817' };
        const bgColor = colors[msgType] || colors.info;
        const style = document.createElement('style');
        style.textContent = `
            .ctx-toast {
              pointer-events:auto;
              padding:10px 16px; border-radius:10px;
              background:${bgColor}; color:#fff;
              font:600 13px/1.4 Inter,system-ui,sans-serif;
              box-shadow:0 4px 20px rgba(0,0,0,0.25);
              animation:cw-ctx-in 250ms ease forwards;
              max-width:340px;
            }
            @keyframes cw-ctx-in {
              from { opacity:0; transform:translateY(-12px); }
              to { opacity:1; transform:translateY(0); }
            }
        `;
        shadow.appendChild(style);
        const toast = document.createElement('div');
        toast.className = 'ctx-toast';
        toast.textContent = msg;
        shadow.appendChild(toast);
        document.documentElement.appendChild(host);
        setTimeout(() => {
          host.style.transition = 'opacity 300ms';
          host.style.opacity = '0';
          setTimeout(() => host.remove(), 300);
        }, 3000);
      },
      args: [message, type]
    });
  } catch (e) {
    console.log('[CoinWatch BG] Context toast injection failed:', e.message);
  }
}

// Context menu click handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'coinwatch-add') return;
  const selectedText = (info.selectionText || '').trim();
  console.log('[CoinWatch BG] Context menu clicked, selected:', selectedText);
  if (!selectedText) return;
  const tabId = tab?.id;

  const address = extractAddress(selectedText);
  console.log('[CoinWatch BG] Extracted address:', address);
  if (!address) {
    if (tabId) await injectContextToast(tabId, 'No contract address found in selected text.', 'warn');
    return;
  }

  try {
    const result = await handleAddToWatchlist({ address, chain: null });
    console.log('[CoinWatch BG] Context menu add result:', result);
    if (!tabId) return;
    if (result.success) {
      await injectContextToast(tabId, `Added ${result.label} to CoinWatch`, 'success');
    } else if (result.duplicate) {
      await injectContextToast(tabId, 'Already in your watchlist', 'info');
    } else {
      await injectContextToast(tabId, result.error || 'Failed to add token', 'error');
    }
  } catch (err) {
    console.error('[CoinWatch BG] Context menu error:', err);
    if (tabId) await injectContextToast(tabId, `Error: ${err.message}`, 'error');
  }
});

function extractAddress(text) {
  // EVM address (0x + 40 hex chars)
  const evmMatch = text.match(/0x[a-fA-F0-9]{40}/);
  if (evmMatch) return evmMatch[0];
  // Solana address (base58, 32-44 chars)
  const solMatch = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
  if (solMatch) return solMatch[0];
  return null;
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'coinwatch-refresh') return;
  const { items = [], alerts = [] } = await chrome.storage.local.get(['items', 'alerts']);
  await chrome.storage.local.set({ lastRefreshPing: Date.now(), cachedItemCount: items.length });

  if (!items.length) {
    updateBadge(0);
    return;
  }

  // Fetch data for all items (used by both alerts and toasts)
  const dataByItemId = {};
  for (const item of items) {
    try {
      if (item.type === 'binance') {
        const symbol = item.binanceSymbol || item.query;
        const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`);
        if (res.ok) {
          const d = await res.json();
          dataByItemId[item.id] = { price: Number(d.lastPrice), change24h: Number(d.priceChangePercent), marketCap: null };
        }
      } else {
        let pair = null;
        if (item.pairAddress && item.chainId) {
          pair = await fetchPair(item.chainId, item.pairAddress);
        }
        if (!pair) pair = await searchToken(item.address || item.query);
        if (pair) {
          dataByItemId[item.id] = {
            price: Number(pair.priceUsd) || null,
            change24h: pair.priceChange?.h24 ?? null,
            marketCap: pair.marketCap || pair.fdv || null
          };
        }
      }
    } catch { /* skip failed fetches */ }
  }

  // --- Evaluate alerts ---
  const enabledAlerts = alerts.filter((a) => a.enabled && !a.triggered);
  let triggeredCount = 0;
  const { alertHistory = [] } = await chrome.storage.local.get(['alertHistory']);

  for (const alert of enabledAlerts) {
    const data = dataByItemId[alert.itemId];
    if (!data) continue;

    const current = data[alert.metric];
    if (current == null || !Number.isFinite(current)) continue;

    const crossed = alert.condition === 'above' ? current >= alert.value : current <= alert.value;
    if (!crossed) continue;

    const item = items.find((i) => i.id === alert.itemId);
    const label = item?.label || 'Token';
    const metricLabel = alert.metric === 'price' ? 'Price' : alert.metric === 'marketCap' ? 'Market cap' : '24h change';
    const dir = alert.condition === 'above' ? 'above' : 'below';
    const formatted = alert.metric === 'change24h' ? `${current.toFixed(2)}%` : `$${Number(current).toLocaleString()}`;

    chrome.notifications.create(`coinwatch-alert-${alert.id}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `${label} Alert`,
      message: `${metricLabel} is now ${formatted} (${dir} ${alert.metric === 'change24h' ? alert.value + '%' : '$' + alert.value.toLocaleString()})`,
      priority: 2
    });

    alertHistory.unshift({
      id: crypto.randomUUID(),
      alertId: alert.id,
      itemId: alert.itemId,
      label,
      metric: alert.metric,
      condition: alert.condition,
      targetValue: alert.value,
      actualValue: current,
      triggeredAt: Date.now()
    });

    if (!alert.repeating) {
      alert.triggered = true;
    }
    triggeredCount++;
  }

  if (triggeredCount) {
    if (alertHistory.length > 50) alertHistory.length = 50;
    await chrome.storage.local.set({ alerts, alertHistory });
  }

  const activeCount = alerts.filter((a) => a.enabled && !a.triggered).length;
  updateBadge(activeCount);

});

function updateBadge(count) {
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#1f1f1c' });
}

console.log('[CoinWatch BG] Service worker loaded');

// Handle messages from content script (Add to Watchlist from chart pages)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[CoinWatch BG] Message received:', message.type, message.payload);
  if (message.type === 'CREATE_ALERT') {
    (async () => {
      console.log('[CoinWatch BG] Creating alert:', message.payload);
      const { alerts = [] } = await chrome.storage.local.get(['alerts']);
      const existingForItem = alerts.filter((a) => a.itemId === message.payload.itemId);
      if (existingForItem.length >= 3) {
        sendResponse({ success: false, error: 'Max 3 alerts per token.' });
        return;
      }
      const newAlert = {
        id: crypto.randomUUID(),
        itemId: message.payload.itemId,
        metric: message.payload.metric,
        condition: message.payload.condition,
        value: Number(message.payload.value),
        enabled: true,
        triggered: false,
        repeating: false,
        createdAt: Date.now()
      };
      alerts.push(newAlert);
      await chrome.storage.local.set({ alerts });
      const activeCount = alerts.filter((a) => a.enabled && !a.triggered).length;
      updateBadge(activeCount);
      console.log('[CoinWatch BG] Alert created, total:', alerts.length);
      sendResponse({ success: true, alert: newAlert });
    })().catch((err) => {
      console.error('[CoinWatch BG] CREATE_ALERT error:', err);
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (message.type === 'DELETE_ALERT') {
    (async () => {
      let { alerts = [] } = await chrome.storage.local.get(['alerts']);
      alerts = alerts.filter((a) => a.id !== message.payload.alertId);
      await chrome.storage.local.set({ alerts });
      const activeCount = alerts.filter((a) => a.enabled && !a.triggered).length;
      updateBadge(activeCount);
      sendResponse({ success: true });
    })().catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'GET_ALERTS') {
    (async () => {
      const { alerts = [] } = await chrome.storage.local.get(['alerts']);
      console.log('[CoinWatch BG] GET_ALERTS returning:', alerts.length);
      sendResponse({ alerts });
    })().catch((err) => {
      console.error('[CoinWatch BG] GET_ALERTS error:', err);
      sendResponse({ alerts: [] });
    });
    return true;
  }

  if (message.type === 'CLEANUP_ALERTS') {
    (async () => {
      const { alerts = [], items = [] } = await chrome.storage.local.get(['alerts', 'items']);
      const itemIds = new Set(items.map((i) => i.id));
      const cleaned = alerts.filter((a) => itemIds.has(a.itemId));
      await chrome.storage.local.set({ alerts: cleaned });
      const activeCount = cleaned.filter((a) => a.enabled && !a.triggered).length;
      updateBadge(activeCount);
      sendResponse({ success: true });
    })().catch(() => sendResponse({ success: false }));
    return true;
  }

  if (message.type === 'GET_ALERT_HISTORY') {
    (async () => {
      const { alertHistory = [] } = await chrome.storage.local.get(['alertHistory']);
      sendResponse({ history: alertHistory });
    })().catch(() => sendResponse({ history: [] }));
    return true;
  }

  if (message.type === 'ADD_TO_WATCHLIST') {
    handleAddToWatchlist(message.payload)
      .then((result) => {
        console.log('[CoinWatch BG] Result:', result);
        sendResponse(result);
      })
      .catch((err) => {
        console.error('[CoinWatch BG] Error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // keep channel open for async response
  }
});

async function handleAddToWatchlist(token) {
  try {
    const { items = [] } = await chrome.storage.local.get(['items']);
    let isPro = false;
    try { const user = await extpay.getUser(); isPro = !!user.paid; } catch {}
    if (!isPro && items.length >= 5) {
      return { success: false, error: 'Free tier limit reached (5 tokens). Upgrade to CoinWatch Pro for unlimited tracking.' };
    }
    if (isPro && items.length >= 30) {
      return { success: false, error: 'Pro watchlist limit reached (30 tokens).' };
    }

    // Resolve the token via DexScreener to get full data
    let pair = null;
    if (token.pairAddress && token.chain) {
      pair = await fetchPair(token.chain, token.pairAddress);
    }
    if (!pair && token.address) {
      pair = await searchToken(token.address);
    }
    if (!pair && token.pairAddress) {
      pair = await searchToken(token.pairAddress);
    }

    const address = pair?.baseToken?.address || token.address || token.pairAddress;
    const chainId = pair?.chainId || token.chain || 'unknown';

    if (!address) {
      return { success: false, error: 'Could not resolve token' };
    }

    // Check for duplicates
    const normalizedAddr = address.toLowerCase();
    const isDuplicate = items.some(
      (item) => item.type === 'dex' && String(item.address || '').toLowerCase() === normalizedAddr
    );
    if (isDuplicate) {
      return { success: false, duplicate: true };
    }

    const label = pair?.baseToken?.symbol || pair?.baseToken?.name || shortenAddr(address);
    const newItem = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      favorite: false,
      type: 'dex',
      query: token.address || token.pairAddress,
      address,
      chainId,
      pairAddress: pair?.pairAddress || token.pairAddress || null,
      resolvedSymbol: pair?.baseToken?.symbol || null,
      resolvedName: pair?.baseToken?.name || null,
      label
    };

    items.unshift(newItem);
    await chrome.storage.local.set({ items });

    return { success: true, label };
  } catch (err) {
    return { success: false, error: err.message || 'Unknown error' };
  }
}

async function fetchPair(chainId, pairAddress) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${encodeURIComponent(chainId)}/${encodeURIComponent(pairAddress)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.pairs?.[0] || data?.pair || null;
  } catch { return null; }
}

async function searchToken(query) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const pairs = data?.pairs || [];
    if (!pairs.length) return null;
    pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
    const normalized = query.trim().toLowerCase();
    return pairs.find((p) => p.baseToken?.address?.toLowerCase() === normalized || p.pairAddress?.toLowerCase() === normalized) || pairs[0];
  } catch { return null; }
}

function shortenAddr(value) {
  const str = String(value || '');
  if (str.length <= 12) return str;
  return `${str.slice(0, 4)}…${str.slice(-4)}`;
}
