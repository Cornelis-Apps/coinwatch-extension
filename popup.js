const extpay = ExtPay('coinwatch');

const DEFAULT_REFRESH_MS = 45_000;
const FREE_TIER_LIMIT = 5;
const PRO_TIER_LIMIT = 30;
const PRO_CACHE_TTL = 60_000; // 60s cache for ExtPay status

async function checkPro() {
  if (Date.now() - state.proCheckedAt < PRO_CACHE_TTL) return state.proCached;
  try {
    const user = await extpay.getUser();
    state.proCached = !!user.paid;
    state.proCheckedAt = Date.now();
  } catch {
    // ExtPay down — trust last known status, don't downgrade paying users
    if (state.proCheckedAt === 0) state.proCached = false;
  }
  state.isPro = state.proCached;
  return state.proCached;
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BINANCE_PAIR_REGEX = /(USDT|USDC|BUSD|FDUSD|BTC|ETH)$/i;
const KNOWN_MAJORS = new Set(['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'DOT', 'AVAX', 'MATIC', 'LINK', 'UNI', 'ATOM', 'LTC', 'NEAR', 'APT', 'SUI', 'ARB', 'OP', 'FIL', 'INJ', 'TIA', 'SEI', 'RENDER', 'FET', 'TAO', 'JUP', 'POL', 'AAVE', 'MKR', 'CRV', 'PEPE', 'SHIB', 'WIF', 'BONK', 'FLOKI']);

const CHAIN_LABELS = {
  bitcoin: 'BTC',
  solana: 'Solana',
  ethereum: 'ETH',
  bsc: 'BSC',
  base: 'Base',
  arbitrum: 'ARB',
  polygon: 'Polygon',
  avalanche: 'AVAX',
  optimism: 'OP',
  fantom: 'FTM',
  cronos: 'CRO',
  pulsechain: 'PLS',
  sui: 'SUI',
  ton: 'TON',
  tron: 'TRON',
  cardano: 'ADA',
  dogecoin: 'DOGE',
  polkadot: 'DOT',
  cosmos: 'ATOM',
  litecoin: 'LTC',
  near: 'NEAR',
  aptos: 'APT',
  filecoin: 'FIL',
  xrp: 'XRP',
  sei: 'SEI',
  injective: 'INJ',
  celestia: 'TIA',
  bittensor: 'TAO'
};

const state = {
  activeFilter: 'all',
  sortMode: 'marketCap_desc',
  items: [],
  refreshHandle: null,
  relativeTimeHandle: null,
  isRefreshing: false,
  previewAsset: null,
  previewReqId: 0,
  latestResults: [],
  alerts: [],
  col4Mode: 'mcap',  // 'mcap' | 'liq' | 'vol'
  lastRefreshTime: null,
  searchQuery: '',
  sparkData: {},
  isPro: false,
  proCheckedAt: 0,
  proCached: false,
  activeChainFilter: 'all'
};

const els = {
  filterTabs: document.getElementById('filterTabs'),
  chainFilterRow: document.getElementById('chainFilterRow'),
  addForm: document.getElementById('addForm'),
  labelInput: document.getElementById('labelInput'),
  queryInput: document.getElementById('queryInput'),
  coinList: document.getElementById('coinList'),
  refreshBtn: document.getElementById('refreshBtn'),
  lastUpdated: document.getElementById('lastUpdated'),
  statusBadge: document.getElementById('statusBadge'),
  assetCount: document.getElementById('assetCount'),
  resolvedPreview: document.getElementById('resolvedPreview'),
  formFeedback: document.getElementById('formFeedback'),
  sortSelect: document.getElementById('sortSelect'),
  composerToggle: document.getElementById('composerToggle'),
  composerSection: document.getElementById('composerSection'),
  settingsBtn: document.getElementById('settingsBtn'),
  tierBadge: document.getElementById('tierBadge'),
  colToggle: document.getElementById('colToggle'),
  themeToggle: document.getElementById('themeToggle'),
  searchInput: document.getElementById('searchInput'),
  historyToggle: document.getElementById('historyToggle'),
  historyPanel: document.getElementById('historyPanel'),
  historyClose: document.getElementById('historyClose'),
  historyList: document.getElementById('historyList'),
  tpl: document.getElementById('coinRowTemplate')
};

init().catch(handleFatal);

async function init() {
  const stored = await chrome.storage.local.get(['items', 'refreshSeconds', 'sortMode', 'theme', 'sparkData']);
  state.items = migrateItems(stored.items || []);
  state.sortMode = (stored.sortMode && stored.sortMode !== 'manual') ? stored.sortMode : 'marketCap_desc';
  await checkPro();
  els.sortSelect.value = state.sortMode;
  state.sparkData = stored.sparkData || {};
  applyTheme(stored.theme || 'light');
  updateTierBadge();
  wireUi();
  renderListSkeleton();
  updateCount();
  await refreshAll();
  scheduleRefresh((stored.refreshSeconds || 45) * 1000);
}

// Migrate old 'solana' type items to 'dex'
function migrateItems(items) {
  return items.map((item, idx) => {
    const migrated = { favorite: false, createdAt: idx, ...item };
    if (migrated.type === 'solana') {
      migrated.type = 'dex';
      migrated.chainId = 'solana';
      migrated.address = migrated.mint || migrated.query;
    }
    return migrated;
  });
}

function wireUi() {
  els.composerToggle.addEventListener('click', () => {
    const wasHidden = els.composerSection.classList.contains('hidden');
    els.composerSection.classList.toggle('hidden');
    els.composerToggle.textContent = wasHidden ? '−' : '+';
    if (wasHidden) els.queryInput.focus();
  });

  if (!state.items.length) {
    els.composerSection.classList.remove('hidden');
    els.composerToggle.textContent = '−';
  }

  els.filterTabs.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-filter]');
    if (!btn) return;
    state.activeFilter = btn.dataset.filter;
    state.activeChainFilter = 'all'; // reset chain filter on view mode change
    for (const tab of els.filterTabs.querySelectorAll('.filter-chip')) tab.classList.toggle('active', tab === btn);
    renderResults(state.latestResults);
  });

  els.chainFilterRow.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-chain]');
    if (!btn) return;
    state.activeChainFilter = btn.dataset.chain;
    for (const chip of els.chainFilterRow.querySelectorAll('.chain-chip')) chip.classList.toggle('active', chip === btn);
    renderResults(state.latestResults);
  });

  els.sortSelect.addEventListener('change', async () => {
    state.sortMode = els.sortSelect.value;
    await chrome.storage.local.set({ sortMode: state.sortMode });
    renderResults(state.latestResults);
  });

  const COL4_MODES = ['mcap', 'liq', 'vol'];
  const COL4_LABELS = { mcap: 'Mcap (USD)', liq: 'Liq (USD)', vol: 'Vol (USD)' };
  els.colToggle.addEventListener('click', () => {
    const idx = COL4_MODES.indexOf(state.col4Mode);
    state.col4Mode = COL4_MODES[(idx + 1) % COL4_MODES.length];
    els.colToggle.textContent = COL4_LABELS[state.col4Mode];
    renderResults(state.latestResults);
  });

  els.settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

  els.historyToggle.addEventListener('click', async () => {
    const showing = !els.historyPanel.classList.contains('hidden');
    if (showing) {
      els.historyPanel.classList.add('hidden');
      els.coinList.closest('.list-shell').classList.remove('hidden');
    } else {
      await renderAlertHistory();
      els.coinList.closest('.list-shell').classList.add('hidden');
      els.historyPanel.classList.remove('hidden');
    }
  });
  els.historyClose.addEventListener('click', () => {
    els.historyPanel.classList.add('hidden');
    els.coinList.closest('.list-shell').classList.remove('hidden');
  });

  els.searchInput.addEventListener('input', () => {
    state.searchQuery = els.searchInput.value.trim().toLowerCase();
    renderResults(state.latestResults);
  });

  els.themeToggle.addEventListener('click', async () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    await chrome.storage.local.set({ theme: next });
  });

  els.queryInput.addEventListener('input', debounce(handleQueryPreview, 350));

  els.addForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFeedback();

    // Tier limit checks
    await checkPro();
    if (!state.isPro && state.items.length >= FREE_TIER_LIMIT) {
      showUpgradePrompt();
      return;
    }
    if (state.isPro && state.items.length >= PRO_TIER_LIMIT) {
      showFeedback(`Pro watchlist limit reached (${PRO_TIER_LIMIT} tokens).`, true);
      return;
    }

    const rawQuery = els.queryInput.value.trim();
    const customLabel = els.labelInput.value.trim();
    if (!rawQuery) return;

    const detectedType = detectInputType(rawQuery);
    let item;

    if (detectedType === 'binance') {
      const resolvedSymbol = resolveBinancePair(rawQuery);
      if (isDuplicate('binance', resolvedSymbol)) return showFeedback('That pair is already in your watchlist.', true);
      item = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        favorite: false,
        type: 'binance',
        query: resolvedSymbol,
        binanceSymbol: resolvedSymbol,
        label: customLabel || normalizeBinanceLabel(resolvedSymbol)
      };
    } else {
      // DEX token — resolve via DexScreener (any chain)
      let preview = state.previewAsset;
      if (!preview || !matchesPreview(preview, rawQuery)) {
        try {
          preview = await searchDexScreener(rawQuery);
        } catch {
          preview = null;
        }
      }

      const address = preview?.baseToken?.address || rawQuery;
      const chainId = preview?.chainId || 'unknown';
      if (isDuplicate('dex', address)) return showFeedback('That token is already in your watchlist.', true);

      item = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        favorite: false,
        type: 'dex',
        query: rawQuery,
        address,
        chainId,
        pairAddress: preview?.pairAddress || null,
        resolvedSymbol: preview?.baseToken?.symbol || null,
        resolvedName: preview?.baseToken?.name || null,
        label: customLabel || preview?.baseToken?.symbol || preview?.baseToken?.name || shortenAddress(rawQuery)
      };
    }

    state.items.unshift(item);
    await persistItems();
    els.addForm.reset();
    clearResolvedPreview();
    updateCount();
    showFeedback(`Added ${item.label} to your watchlist.`);
    await refreshAll();
  });

  els.refreshBtn.addEventListener('click', () => {
    if (Date.now() - (state.lastManualRefresh || 0) < 5000) return;
    state.lastManualRefresh = Date.now();
    refreshAll();
  });

  // Keyboard shortcuts
  let focusedRowIndex = -1;
  function clearRowFocus() {
    for (const r of els.coinList.querySelectorAll('.coin-row.kb-focus')) r.classList.remove('kb-focus');
  }
  function focusRow(idx) {
    const rows = els.coinList.querySelectorAll('.coin-row');
    if (!rows.length) return;
    focusedRowIndex = Math.max(0, Math.min(idx, rows.length - 1));
    clearRowFocus();
    rows[focusedRowIndex].classList.add('kb-focus');
    rows[focusedRowIndex].scrollIntoView({ block: 'nearest' });
  }

  document.addEventListener('keydown', (e) => {
    const inInput = e.target.matches('input, select, textarea');

    if (e.key === 'Escape') {
      if (inInput && els.searchInput === e.target && state.searchQuery) {
        els.searchInput.value = '';
        state.searchQuery = '';
        els.searchInput.blur();
        renderResults(state.latestResults);
      } else {
        // Close alert composer or add form
        const openComposer = els.coinList.querySelector('.alert-composer:not(.hidden)');
        if (openComposer) { openComposer.classList.add('hidden'); }
        else if (!els.composerSection.classList.contains('hidden')) {
          els.composerSection.classList.add('hidden');
          els.composerToggle.textContent = '+';
        }
      }
      return;
    }

    if (inInput) return;

    if (e.key === '/') {
      e.preventDefault();
      els.searchInput.focus();
      return;
    }
    if (e.key === 'r' || e.key === 'R') { refreshAll(); return; }

    const rows = els.coinList.querySelectorAll('.coin-row');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusRow(focusedRowIndex + 1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusRow(focusedRowIndex - 1);
      return;
    }

    if (focusedRowIndex >= 0 && focusedRowIndex < rows.length) {
      const row = rows[focusedRowIndex];
      if (e.key === 'Enter') {
        e.preventDefault();
        const link = row.querySelector('.chart-link');
        if (link?.href) window.open(link.href, '_blank');
        return;
      }
      if (e.key === 's' || e.key === 'S') {
        row.querySelector('.star-btn')?.click();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        row.querySelector('.remove-btn')?.click();
        return;
      }
    }
  });

  els.coinList.addEventListener('click', async (event) => {
    const removeBtn = event.target.closest('.remove-btn');
    const starBtn = event.target.closest('.star-btn');
    const copyBtn = event.target.closest('.copy-btn');

    if (removeBtn) {
      const id = removeBtn.dataset.id;
      const idx = state.items.findIndex((item) => item.id === id);
      if (idx < 0) return;
      const [removed] = state.items.splice(idx, 1);
      const removedResult = state.latestResults.find((r) => r.item.id === id);
      state.latestResults = state.latestResults.filter((r) => r.item.id !== id);
      await persistItems();
      chrome.runtime.sendMessage({ type: 'CLEANUP_ALERTS' });
      updateCount();
      renderResults(state.latestResults);
      showUndoToast(removed.label, async () => {
        state.items.splice(idx, 0, removed);
        if (removedResult) state.latestResults.push(removedResult);
        await persistItems();
        updateCount();
        await refreshAll();
      });
      return;
    }

    if (starBtn) {
      const id = starBtn.dataset.id;
      const item = state.items.find((row) => row.id === id);
      if (!item) return;
      item.favorite = !item.favorite;
      await persistItems();
      renderResults(state.latestResults);
      return;
    }

    if (copyBtn) {
      const value = copyBtn.dataset.copy || '';
      try {
        await navigator.clipboard.writeText(value);
        showFeedback('Identifier copied.');
      } catch {
        showFeedback('Copy failed in this browser context.', true);
      }
      return;
    }

    // Alert button — toggle composer and pre-fill current value
    const alertBtn = event.target.closest('.alert-btn');
    if (alertBtn) {
      const row = alertBtn.closest('.coin-row');
      const composer = row.querySelector('.alert-composer');
      const wasHidden = composer.classList.contains('hidden');
      composer.classList.toggle('hidden');

      if (wasHidden) {
        // Pre-fill with current value based on selected metric
        const itemId = row.dataset.itemId;
        const result = state.latestResults.find((r) => r.item.id === itemId);
        if (result?.ok) {
          prefillAlertValue(row, result);
          // Listen for metric change to update pre-fill
          const metricSelect = row.querySelector('.alert-metric');
          metricSelect._prefillHandler = () => prefillAlertValue(row, result);
          metricSelect.addEventListener('change', metricSelect._prefillHandler);
        }
      }
      return;
    }

    // Alert save
    const saveBtn = event.target.closest('.alert-save-btn');
    if (saveBtn) {
      const row = saveBtn.closest('.coin-row');
      const itemId = row.dataset.itemId;
      const metric = row.querySelector('.alert-metric').value;
      const condition = row.querySelector('.alert-condition').value;
      const rawValue = row.querySelector('.alert-value').value;
      const value = parseShorthand(rawValue);
      if (!rawValue || isNaN(value) || !Number.isFinite(value)) return showFeedback('Enter a valid number (e.g. 70K, 1.5M, 2B).', true);

      const existingForItem = state.alerts.filter((a) => a.itemId === itemId);
      if (existingForItem.length >= 3) return showFeedback('Max 3 alerts per token.', true);

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'CREATE_ALERT',
          payload: { itemId, metric, condition, value }
        });
        console.log('[CoinWatch] CREATE_ALERT response:', response);
        if (response?.success) {
          row.querySelector('.alert-composer').classList.add('hidden');
          row.querySelector('.alert-value').value = '';
          await loadAndRenderAlerts();
          // Flash the bell green briefly
          const bell = row.querySelector('.alert-btn');
          bell.style.color = 'var(--positive)';
          setTimeout(() => { bell.style.color = ''; }, 1500);
        } else {
          showFeedback(response?.error || 'Failed to create alert.', true);
        }
      } catch (err) {
        console.error('[CoinWatch] CREATE_ALERT error:', err);
        showFeedback('Failed to create alert.', true);
      }
      return;
    }

    // Alert cancel
    const cancelBtn = event.target.closest('.alert-cancel-btn');
    if (cancelBtn) {
      const composer = cancelBtn.closest('.alert-composer');
      composer.classList.add('hidden');
      return;
    }

    // Alert pill remove
    const pillRemove = event.target.closest('.alert-pill-remove');
    if (pillRemove) {
      const alertId = pillRemove.dataset.alertId;
      await chrome.runtime.sendMessage({ type: 'DELETE_ALERT', payload: { alertId } });
      showFeedback('Alert removed.');
      await loadAndRenderAlerts();
      return;
    }

    // Quick multiplier buttons
    const quickBtn = event.target.closest('.alert-quick');
    if (quickBtn) {
      const row = quickBtn.closest('.coin-row');
      const currentVal = row._alertCurrentValue;
      if (currentVal != null && Number.isFinite(currentVal)) {
        const mult = Number(quickBtn.dataset.mult);
        const target = currentVal * mult;
        const input = row.querySelector('.alert-value');
        input.value = formatShorthand(target);
        // Auto-set condition based on multiplier
        const conditionSelect = row.querySelector('.alert-condition');
        conditionSelect.value = mult >= 1 ? 'above' : 'below';
      }
      return;
    }

    // Row expand/collapse — only if clicking the row area, not a button or input
    const row = event.target.closest('.coin-row');
    if (row && !event.target.closest('button, input, select, a, .alert-pill-remove')) {
      row.classList.toggle('expanded');
      return;
    }
  });
}

async function loadAndRenderAlerts() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_ALERTS' });
  state.alerts = response?.alerts || [];
  console.log('[CoinWatch] Loaded alerts:', state.alerts.length, state.alerts);
  // Render pills into each row
  for (const row of els.coinList.querySelectorAll('.coin-row')) {
    const itemId = row.dataset.itemId;
    const pillsContainer = row.querySelector('.alert-pills');
    const alertBtn = row.querySelector('.alert-btn');
    if (!pillsContainer) continue;

    const itemAlerts = state.alerts.filter((a) => a.itemId === itemId);
    pillsContainer.innerHTML = '';

    for (const alert of itemAlerts) {
      const pill = document.createElement('span');
      pill.className = `alert-pill${alert.triggered ? ' triggered' : ''}`;
      const metricLabel = alert.metric === 'price' ? '$' : alert.metric === 'marketCap' ? 'Mcap ' : '24h ';
      const dir = alert.condition === 'above' ? '>' : '<';
      const val = alert.metric === 'change24h' ? `${alert.value}%` : `$${Number(alert.value).toLocaleString()}`;
      pill.innerHTML = `${metricLabel}${dir} ${val} <span class="alert-pill-remove" data-alert-id="${esc(alert.id)}">✕</span>`;
      pillsContainer.appendChild(pill);
    }

    if (alertBtn) alertBtn.classList.toggle('has-alerts', itemAlerts.length > 0);
  }
  updateAlertTabBadge();
}

function updateAlertTabBadge() {
  const activeCount = state.alerts.filter((a) => a.enabled && !a.triggered).length;
  const tab = els.filterTabs.querySelector('[data-filter="alerts"]');
  if (tab) tab.textContent = activeCount > 0 ? `Alerts (${activeCount})` : 'Alerts';
}

function prefillAlertValue(row, result) {
  const metric = row.querySelector('.alert-metric').value;
  let currentValue = null;
  if (metric === 'price') currentValue = result.price;
  else if (metric === 'marketCap') currentValue = result.marketCap;
  else if (metric === 'change24h') currentValue = result.change24h;

  const input = row.querySelector('.alert-value');
  const hint = row.querySelector('.alert-current-hint');
  const quickRow = row.querySelector('.alert-quick-row');
  input.value = '';

  if (currentValue != null && Number.isFinite(currentValue)) {
    const prefix = metric === 'change24h' ? '' : '$';
    const suffix = metric === 'change24h' ? '%' : '';
    const display = `${prefix}${formatShorthand(currentValue)}${suffix}`;
    input.placeholder = `Currently ${display}`;
    row._alertCurrentValue = currentValue;
    if (hint) hint.textContent = `Now: ${display}`;
    if (quickRow) quickRow.style.display = metric === 'change24h' ? 'none' : '';
  } else {
    input.placeholder = 'e.g. 1M, 70K';
    row._alertCurrentValue = null;
    if (hint) hint.textContent = '';
    if (quickRow) quickRow.style.display = metric === 'change24h' ? 'none' : '';
  }
}

function parseShorthand(value) {
  if (typeof value === 'number') return value;
  const str = String(value).trim().toUpperCase();
  const match = str.match(/^([+-]?\d*\.?\d+)\s*([KMBT]?)$/);
  if (!match) return Number(value);
  const num = Number(match[1]);
  const suffix = match[2];
  const multipliers = { '': 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
  return num * (multipliers[suffix] || 1);
}

function formatShorthand(value) {
  if (!Number.isFinite(value)) return '0.00';
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return String(value);
}

function detectInputType(query) {
  const upper = query.trim().toUpperCase();
  if (BINANCE_PAIR_REGEX.test(upper)) return 'binance';
  if (KNOWN_MAJORS.has(upper)) return 'binance';
  return 'dex';
}

async function handleQueryPreview() {
  const query = els.queryInput.value.trim();
  clearResolvedPreview();
  clearFeedback();
  if (!query) return;

  const detectedType = detectInputType(query);
  if (detectedType === 'binance') {
    const pair = resolveBinancePair(query);
    showResolvedPreview(`Binance pair: ${pair}`);
    return;
  }

  const shouldResolve = query.length >= 3 || EVM_ADDRESS_REGEX.test(query) || SOLANA_ADDRESS_REGEX.test(query);
  if (!shouldResolve) return;

  const requestId = ++state.previewReqId;
  showResolvedPreview('Resolving token…');

  try {
    const pair = await searchDexScreener(query);
    if (requestId !== state.previewReqId) return;
    state.previewAsset = pair;
    const chain = CHAIN_LABELS[pair.chainId] || pair.chainId;
    const symbol = pair.baseToken?.symbol || 'Unknown';
    const name = pair.baseToken?.name || '';
    showResolvedPreview(`${name} (${symbol}) · ${chain} · ${shortenAddress(pair.baseToken?.address || query)}`);
    if (!els.labelInput.value.trim()) els.labelInput.placeholder = symbol || 'Optional';
  } catch {
    if (requestId !== state.previewReqId) return;
    state.previewAsset = null;
    showResolvedPreview('No token found. You can still save it manually.', true);
  }
}

function isDuplicate(type, identifier) {
  const normalized = String(identifier || '').toLowerCase();
  if (type === 'binance') {
    return state.items.some((item) => item.type === 'binance' && String(item.binanceSymbol || item.query || '').toLowerCase() === normalized);
  }
  return state.items.some((item) => item.type === 'dex' && String(item.address || item.query || '').toLowerCase() === normalized);
}

async function persistItems() {
  await chrome.storage.local.set({ items: state.items });
}

function scheduleRefresh(ms) {
  clearInterval(state.refreshHandle);
  state.refreshHandle = setInterval(() => refreshAll(), ms || DEFAULT_REFRESH_MS);
}

// DexScreener chainId → DexPaprika network ID
const DEXPAPRIKA_NETWORK_MAP = {
  ethereum: 'ethereum', solana: 'solana', bsc: 'bsc', base: 'base',
  arbitrum: 'arbitrum', polygon: 'polygon', avalanche: 'avalanche',
  optimism: 'optimism', fantom: 'fantom', cronos: 'cronos', ton: 'ton',
  sui: 'sui'
};

async function refreshAll() {
  if (state.isRefreshing) return;
  state.isRefreshing = true;
  try {
    await _refreshAllInner();
  } finally {
    state.isRefreshing = false;
  }
}

async function _refreshAllInner() {
  setStatus('Refreshing');

  // Enforce tier limits — prevents bypass via manual storage edits
  await checkPro();
  const limit = state.isPro ? PRO_TIER_LIMIT : FREE_TIER_LIMIT;
  if (state.items.length > limit) {
    state.items = state.items.slice(0, limit);
    await chrome.storage.local.set({ items: state.items });
  }

  if (!state.items.length) {
    state.latestResults = [];
    renderEmpty();
    setStatus('Idle');
    return;
  }

  // Split items into batchable DEX (have address) vs individual (Binance / no address)
  const dexBatchable = state.items.filter(i => i.type === 'dex' && i.address);
  const binanceItems = state.items.filter(i => i.type === 'binance');
  const individual = state.items.filter(i => i.type === 'binance' || (i.type === 'dex' && !i.address));

  // Pre-fetch all Binance market caps in one CoinGecko batch call
  let geckoMcaps = {};
  if (binanceItems.length) {
    const ids = [...new Set(binanceItems.map(i => coingeckoId(binanceBaseSymbol(resolveBinancePair(i.binanceSymbol || i.query)))))];
    try {
      const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_market_cap=true`);
      if (res.ok) geckoMcaps = await res.json();
    } catch {}
  }

  // Batch fetch DEX items via DexScreener /tokens/ + fetch individual items in parallel
  const [batchPairs, ...individualResults] = await Promise.all([
    dexBatchable.length ? fetchDexScreenerBatch(dexBatchable.map(i => i.address)) : Promise.resolve([]),
    ...individual.map(item => loadItemData(item, geckoMcaps))
  ]);

  // Match batch results back to items
  const batchResults = await Promise.all(dexBatchable.map(item => buildDexResultFromBatch(item, batchPairs)));

  // DexPaprika fallback for any failed DEX items
  const failedItems = batchResults.filter(r => !r.ok).map(r => r.item);
  if (failedItems.length) {
    const fallbackResults = await fetchDexPaprikaFallback(failedItems);
    for (const fr of fallbackResults) {
      const idx = batchResults.findIndex(r => r.item.id === fr.item.id);
      if (idx !== -1) batchResults[idx] = fr;
    }
  }

  // Merge results in original item order
  const resultMap = new Map();
  for (const r of [...batchResults, ...individualResults]) resultMap.set(r.item.id, r);
  const results = state.items.map(item => resultMap.get(item.id) || { item, ok: false, error: 'Missing' });

  state.latestResults = results;
  renderResults(results);
  await storePriceSnapshots(results);
  state.lastRefreshTime = Date.now();
  els.lastUpdated.textContent = 'just now';
  setStatus('Live');
}

async function fetchDexScreenerBatch(addresses) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${addresses.map(encodeURIComponent).join(',')}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data?.pairs || [];
  } catch { return []; }
}

async function buildDexResultFromBatch(item, allPairs) {
  try {
    const addr = item.address.toLowerCase();
    const itemPairs = allPairs.filter(p => p.baseToken?.address?.toLowerCase() === addr);
    let pair = null;
    if (item.pairAddress) {
      pair = itemPairs.find(p => p.pairAddress?.toLowerCase() === item.pairAddress.toLowerCase());
    }
    if (!pair) {
      itemPairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
      pair = itemPairs[0];
    }

    if (!pair) return { item, ok: false, error: 'Not in batch' };

    if (pair.pairAddress && pair.pairAddress !== item.pairAddress) {
      item.pairAddress = pair.pairAddress;
      item.chainId = pair.chainId;
      persistItems();
    }

    const price = Number(pair.priceUsd) || null;
    const marketCap = firstNumber([pair.marketCap, pair.fdv]);
    const liquidity = pair.liquidity?.usd || null;
    const volume = pair.volume?.h24 || null;
    const change24h = pair.priceChange?.h24 ?? null;

    let jupiterData = null;
    if (pair.chainId === 'solana' && item.address) {
      try { jupiterData = await searchJupiterAsset(item.address); } catch {}
    }

    return {
      item,
      ok: true,
      source: 'DexScreener',
      symbol: pair.baseToken?.symbol || item.resolvedSymbol || shortenAddress(item.address || item.query),
      chainId: pair.chainId,
      price: price || jupiterData?.usdPrice || null,
      marketCap: marketCap || jupiterData?.mcap || jupiterData?.fdv || null,
      liquidity: liquidity || jupiterData?.liquidity || null,
      volume: volume || null,
      change24h: change24h ?? jupiterData?.stats24h?.priceChange ?? null,
      iconUrl: pair.info?.imageUrl || jupiterData?.logoURI || jupiterData?.icon
        || `https://assets.coincap.io/assets/icons/${(pair.baseToken?.symbol || '').toLowerCase()}@2x.png`,
      footer: buildFooter(pair, jupiterData),
      identifier: pair.baseToken?.address || item.address || item.query,
      dexUrl: pair.url || null
    };
  } catch (error) {
    return { item, ok: false, error: error.message || 'Failed to load' };
  }
}

// DexPaprika fallback — groups failed items by chain, fetches individually per token
// Uses /networks/{network}/tokens/{address} for full data (price, fdv, liquidity, 24h change)
async function fetchDexPaprikaFallback(items) {
  const results = [];
  await Promise.all(items.map(async (item) => {
    const chain = item.chainId || 'unknown';
    const network = DEXPAPRIKA_NETWORK_MAP[chain];
    if (!network) {
      results.push({ item, ok: false, error: 'Chain not supported by fallback' });
      return;
    }
    try {
      const res = await fetch(`https://api.dexpaprika.com/networks/${network}/tokens/${encodeURIComponent(item.address)}`);
      if (!res.ok) {
        results.push({ item, ok: false, error: `DexPaprika ${res.status}` });
        return;
      }
      const data = await res.json();
      const summary = data.summary || {};
      const h24 = summary['24h'] || {};
      results.push({
        item,
        ok: true,
        source: 'DexPaprika',
        symbol: data.symbol || item.resolvedSymbol || shortenAddress(item.address),
        chainId: item.chainId,
        price: Number(summary.price_usd) || null,
        marketCap: Number(summary.fdv) || null,
        liquidity: Number(summary.liquidity_usd) || null,
        volume: Number(h24.volume_usd) || null,
        change24h: h24.last_price_usd_change ?? null,
        iconUrl: data.has_image ? `https://api.dexpaprika.com/networks/${network}/tokens/${encodeURIComponent(item.address)}/image` : `https://assets.coincap.io/assets/icons/${(data.symbol || '').toLowerCase()}@2x.png`,
        footer: 'DexPaprika (fallback)',
        identifier: data.id || item.address,
        dexUrl: null
      });
    } catch {
      results.push({ item, ok: false, error: 'DexPaprika fetch failed' });
    }
  }));
  return results;
}

async function loadItemData(item, geckoMcaps = {}) {
  try {
    if (item.type === 'binance') return { item, ...(await fetchBinanceItem(item, geckoMcaps)) };
    return { item, ...(await fetchDexItem(item)) };
  } catch (error) {
    return { item, ok: false, error: error.message || 'Failed to load' };
  }
}

// Map Binance pair to base symbol for icon lookup
const COINGECKO_ID_MAP = {
  btc: 'bitcoin', eth: 'ethereum', sol: 'solana', bnb: 'binancecoin',
  xrp: 'ripple', ada: 'cardano', doge: 'dogecoin', dot: 'polkadot',
  avax: 'avalanche-2', matic: 'matic-network', link: 'chainlink', uni: 'uniswap',
  atom: 'cosmos', ltc: 'litecoin', near: 'near', apt: 'aptos',
  sui: 'sui', arb: 'arbitrum', op: 'optimism', fil: 'filecoin',
  inj: 'injective-protocol', sei: 'sei-network', fet: 'fetch-ai',
  tao: 'bittensor', jup: 'jupiter-exchange-solana', aave: 'aave', mkr: 'maker',
  crv: 'curve-dao-token', pepe: 'pepe', shib: 'shiba-inu', wif: 'dogwifcoin',
  bonk: 'bonk', floki: 'floki', pol: 'matic-network', render: 'render-token',
  tia: 'celestia'
};

function binanceBaseSymbol(pair) {
  const quotes = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'BTC', 'ETH'];
  const upper = pair.toUpperCase();
  for (const q of quotes) {
    if (upper.endsWith(q)) return upper.slice(0, -q.length).toLowerCase();
  }
  return upper.toLowerCase();
}

function coingeckoId(symbol) {
  return COINGECKO_ID_MAP[symbol] || symbol;
}

async function fetchBinanceItem(item, geckoMcaps = {}) {
  const symbol = resolveBinancePair(item.binanceSymbol || item.query);
  const base = binanceBaseSymbol(symbol);

  const binanceRes = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`);
  if (!binanceRes.ok) throw new Error(`Binance error ${binanceRes.status}`);
  const data = await binanceRes.json();

  const geckoId = coingeckoId(base);
  const marketCap = Number(geckoMcaps?.[geckoId]?.usd_market_cap) || null;

  return {
    ok: true,
    source: 'Binance',
    symbol,
    chainId: null,
    price: Number(data.lastPrice),
    change24h: Number(data.priceChangePercent),
    marketCap,
    liquidity: null,
    volume: Number(data.quoteVolume) || null,
    iconUrl: `https://assets.coincap.io/assets/icons/${base}@2x.png`,
    footer: 'Binance'
  };
}

async function fetchDexItem(item) {
  // Try to refresh by pair address first (fastest, most reliable)
  let pair = null;
  if (item.pairAddress && item.chainId) {
    pair = await fetchDexScreenerPair(item.chainId, item.pairAddress);
  }

  // Fallback: search by address/query
  if (!pair) {
    pair = await searchDexScreener(item.address || item.query);
  }

  if (!pair) throw new Error('No pair data found');

  // Update stored pair info if it changed
  if (pair.pairAddress && pair.pairAddress !== item.pairAddress) {
    item.pairAddress = pair.pairAddress;
    item.chainId = pair.chainId;
    persistItems();
  }

  const price = Number(pair.priceUsd) || null;
  const marketCap = firstNumber([pair.marketCap, pair.fdv]);
  const liquidity = pair.liquidity?.usd || null;
  const volume = pair.volume?.h24 || null;
  const change24h = pair.priceChange?.h24 ?? null;
  const chain = CHAIN_LABELS[pair.chainId] || pair.chainId;

  // Try to get richer data from Jupiter for Solana tokens
  let jupiterData = null;
  if (pair.chainId === 'solana' && item.address) {
    try {
      jupiterData = await searchJupiterAsset(item.address);
    } catch { /* Jupiter is optional */ }
  }

  return {
    ok: true,
    source: 'DexScreener',
    symbol: pair.baseToken?.symbol || item.resolvedSymbol || shortenAddress(item.address || item.query),
    chainId: pair.chainId,
    price: price || jupiterData?.usdPrice || null,
    marketCap: marketCap || jupiterData?.mcap || jupiterData?.fdv || null,
    liquidity: liquidity || jupiterData?.liquidity || null,
    volume: volume || null,
    change24h: change24h ?? jupiterData?.stats24h?.priceChange ?? null,
    iconUrl: pair.info?.imageUrl || jupiterData?.logoURI || jupiterData?.icon
      || `https://assets.coincap.io/assets/icons/${(pair.baseToken?.symbol || '').toLowerCase()}@2x.png`,
    footer: buildFooter(pair, jupiterData),
    identifier: pair.baseToken?.address || item.address || item.query,
    dexUrl: pair.url || null
  };
}

async function searchDexScreener(query) {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`DexScreener search error ${res.status}`);
  const data = await res.json();
  const pairs = data?.pairs || [];
  if (!pairs.length) throw new Error('No token found on any chain');

  // Sort by liquidity descending to get the best/most liquid pair
  pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));

  // If query is an exact address match, prefer that
  const normalized = query.trim().toLowerCase();
  const exactMatch = pairs.find((p) =>
    p.baseToken?.address?.toLowerCase() === normalized ||
    p.pairAddress?.toLowerCase() === normalized
  );

  return exactMatch || pairs[0];
}

async function fetchDexScreenerPair(chainId, pairAddress) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${encodeURIComponent(chainId)}/${encodeURIComponent(pairAddress)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.pairs?.length) return data.pairs[0];
    if (data?.pair) return data.pair;
  } catch { /* fallback to search */ }
  return null;
}

async function searchJupiterAsset(query) {
  const res = await fetch(`https://datapi.jup.ag/v1/assets/search?query=${encodeURIComponent(query)}`);
  if (!res.ok) return null;
  const data = await res.json();
  const rows = Array.isArray(data) ? data : data?.results || data?.data || [];
  const list = Array.isArray(rows) ? rows : [rows].filter(Boolean);
  if (!list.length) return null;

  const normalized = String(query).trim().toLowerCase();
  const exact = list.find((asset) => {
    const address = String(asset?.address || asset?.id || '').toLowerCase();
    const symbol = String(asset?.symbol || '').toLowerCase();
    return address === normalized || symbol === normalized;
  });
  return exact || list[0];
}

function buildFooter(pair, jupiterData) {
  const parts = [];
  if (pair.baseToken?.name) parts.push(pair.baseToken.name);
  if (pair.dexId) parts.push(String(pair.dexId).toUpperCase());
  if (jupiterData?.holderCount) parts.push(`${formatCompact(jupiterData.holderCount)} holders`);
  if (jupiterData?.audit?.mintAuthorityDisabled) parts.push('Mint locked');
  return parts.join(' · ') || 'DEX market data';
}

function firstNumber(values, allowNegative = false) {
  for (const value of values) {
    const num = Number(value);
    if (!Number.isFinite(num)) continue;
    if (allowNegative) return num;
    if (num > 0) return num;
  }
  return null;
}

function renderListSkeleton() {
  els.coinList.innerHTML = '<div class="empty-state">Loading your watchlist…</div>';
}

function renderEmpty() {
  els.coinList.innerHTML = `<div class="empty-state onboarding">
    <div class="onboarding-title">Welcome to CoinWatch</div>
    <div class="onboarding-steps">
      <div class="onboarding-step"><span class="step-num">1</span> Tap <strong>+</strong> above and paste a token address, symbol, or pair</div>
      <div class="onboarding-step"><span class="step-num">2</span> Visit any chart site and click <strong>Add to CoinWatch</strong></div>
      <div class="onboarding-step"><span class="step-num">3</span> Set alerts, favorite tokens, and track across any chain</div>
    </div>
    <div class="onboarding-hint">Supports Solana, ETH, BSC, Base, Arbitrum, and 20+ chains</div>
  </div>`;
}

function renderResults(results) {
  const filtered = sortResults(applyFilter(results));
  els.coinList.innerHTML = '';
  if (!filtered.length) {
    const emptyMessages = {
      favorites: 'No favourites yet. Tap ☆ on any token to pin it here.',
      alerts: 'No alerts set. Tap 🔔 on any token to create one.'
    };
    let msg;
    if (state.searchQuery) msg = 'No tokens match your search.';
    else if (state.activeChainFilter !== 'all') msg = `No ${getChainLabel(state.activeChainFilter)} tokens in this view.`;
    else msg = emptyMessages[state.activeFilter] || 'Nothing matches this filter.';
    els.coinList.innerHTML = `<div class="empty-state">${msg}</div>`;
    updateCount(0, results.length);
    return;
  }

  for (const result of filtered) {
    const fragment = els.tpl.content.cloneNode(true);
    const row = fragment.querySelector('.coin-row');
    const removeBtn = fragment.querySelector('.remove-btn');
    const starBtn = fragment.querySelector('.star-btn');
    const copyBtn = fragment.querySelector('.copy-btn');
    const iconEl = fragment.querySelector('.coin-icon');

    row.dataset.itemId = result.item.id;



    const alertBtn = fragment.querySelector('.alert-btn');
    alertBtn.dataset.id = result.item.id;

    const labelEl = fragment.querySelector('.coin-label');
    labelEl.textContent = result.item.label;
    if (result.item.favorite) {
      const star = document.createElement('span');
      star.className = 'fav-star';
      star.textContent = '★';
      const titleLine = fragment.querySelector('.asset-title-line');
      titleLine.insertBefore(star, titleLine.firstChild);
    }
    fragment.querySelector('.coin-symbol').textContent = result.symbol || '';

    const chainLabel = CHAIN_LABELS[result.chainId || result.item.chainId] || result.chainId || result.item.chainId || '';
    fragment.querySelector('.source-badge').textContent = chainLabel || (result.item.type === 'binance' ? 'Binance' : '');
    fragment.querySelector('.coin-source').textContent = result.ok ? result.source : 'Error';
    fragment.querySelector('.coin-id').textContent = shortenAddress(result.identifier || result.item.address || result.item.binanceSymbol || result.item.query || '');

    if (result.iconUrl) {
      iconEl.src = result.iconUrl;
      iconEl.alt = result.item.label;
      iconEl.onerror = () => { iconEl.style.display = 'none'; };
    } else {
      iconEl.style.display = 'none';
    }

    removeBtn.dataset.id = result.item.id;
    starBtn.dataset.id = result.item.id;
    starBtn.textContent = result.item.favorite ? '★' : '☆';
    starBtn.classList.toggle('active', !!result.item.favorite);
    copyBtn.dataset.copy = result.identifier || result.item.address || result.item.binanceSymbol || result.item.query || '';

    // Chart link
    const chartLink = fragment.querySelector('.chart-link');
    const chartUrl = result.dexUrl || buildChartUrl(result);
    if (chartUrl) {
      chartLink.href = chartUrl;
      chartLink.classList.remove('hidden');
    }

    const priceEl = fragment.querySelector('.metric-price');
    const mcapEl = fragment.querySelector('.metric-mcap');
    const changeEl = fragment.querySelector('.metric-change');
    const liqEl = fragment.querySelector('.metric-liq');
    const footerEl = fragment.querySelector('.coin-footer');

    // 4th column value based on mode
    const col4Value = state.col4Mode === 'mcap' ? result.marketCap
      : state.col4Mode === 'liq' ? result.liquidity
      : result.volume;

    if (result.ok) {
      priceEl.textContent = formatPrice(result.price);
      // Sparkline
      const sparkPoints = state.sparkData?.[result.item.id];
      if (sparkPoints && sparkPoints.length >= 2) {
        priceEl.insertAdjacentHTML('beforeend', renderSparkline(sparkPoints));
      }
      mcapEl.textContent = formatMoney(col4Value);
      liqEl.textContent = formatMoney(result.liquidity);
      changeEl.textContent = formatPercent(result.change24h);
      changeEl.classList.toggle('positive', Number(result.change24h) >= 0);
      changeEl.classList.toggle('negative', Number(result.change24h) < 0);
      footerEl.textContent = result.footer || '';
    } else {
      row.style.borderColor = 'rgba(251, 113, 133, 0.28)';
      priceEl.textContent = '—';
      mcapEl.textContent = '—';
      liqEl.textContent = '—';
      changeEl.textContent = '—';
      footerEl.textContent = result.error;
      footerEl.classList.add('negative');
    }

    els.coinList.appendChild(fragment);
  }

  updateCount(filtered.length, results.length);
  loadAndRenderAlerts();
}

const BINANCE_CHAIN_MAP = {
  btc: 'bitcoin', eth: 'ethereum', sol: 'solana', bnb: 'bsc',
  xrp: 'xrp', ada: 'cardano', doge: 'dogecoin', dot: 'polkadot',
  avax: 'avalanche', matic: 'polygon', link: 'ethereum', uni: 'ethereum',
  atom: 'cosmos', ltc: 'litecoin', near: 'near', apt: 'aptos',
  sui: 'sui', arb: 'arbitrum', op: 'optimism', fil: 'filecoin',
  inj: 'injective', sei: 'sei', fet: 'ethereum', tao: 'bittensor',
  jup: 'solana', aave: 'ethereum', mkr: 'ethereum', crv: 'ethereum',
  pepe: 'ethereum', shib: 'ethereum', wif: 'solana', bonk: 'solana',
  floki: 'ethereum', pol: 'polygon', render: 'solana', tia: 'celestia'
};

function getChainKey(row) {
  if (row.item.type === 'binance') {
    const base = (row.item.binanceSymbol || row.item.query || '').replace(/(USDT|USDC|BUSD|FDUSD|BTC|ETH)$/i, '').toLowerCase();
    return BINANCE_CHAIN_MAP[base] || 'unknown';
  }
  return row.chainId || row.item.chainId || 'unknown';
}

function getChainLabel(key) {
  if (key === 'binance') return 'Binance';
  if (key === 'all') return 'All chains';
  return CHAIN_LABELS[key] || key;
}

function rebuildChainFilters(viewFiltered) {
  const counts = {};
  for (const row of viewFiltered) {
    const key = getChainKey(row);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  const chains = Object.keys(counts);

  if (chains.length <= 1) {
    els.chainFilterRow.classList.add('hidden');
    state.activeChainFilter = 'all';
    return;
  }

  // Sort by count descending
  chains.sort((a, b) => counts[b] - counts[a]);

  els.chainFilterRow.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.className = `chain-chip${state.activeChainFilter === 'all' ? ' active' : ''}`;
  allBtn.dataset.chain = 'all';
  allBtn.textContent = 'All chains';
  els.chainFilterRow.appendChild(allBtn);

  for (const key of chains) {
    const btn = document.createElement('button');
    btn.className = `chain-chip${state.activeChainFilter === key ? ' active' : ''}`;
    btn.dataset.chain = key;
    btn.textContent = getChainLabel(key);
    els.chainFilterRow.appendChild(btn);
  }

  // Reset if current selection no longer exists
  if (state.activeChainFilter !== 'all' && !chains.includes(state.activeChainFilter)) {
    state.activeChainFilter = 'all';
    allBtn.classList.add('active');
  }

  els.chainFilterRow.classList.remove('hidden');
}

function applyFilter(results) {
  let filtered;
  if (state.activeFilter === 'all') filtered = [...results];
  else if (state.activeFilter === 'favorites') filtered = results.filter((row) => row.item.favorite);
  else if (state.activeFilter === 'alerts') {
    const alertItemIds = new Set(state.alerts.filter((a) => a.enabled).map((a) => a.itemId));
    filtered = results.filter((row) => alertItemIds.has(row.item.id));
  } else {
    filtered = [...results];
  }

  // Apply search
  if (state.searchQuery) {
    const q = state.searchQuery;
    filtered = filtered.filter((row) => {
      const label = (row.item.label || '').toLowerCase();
      const symbol = (row.symbol || row.item.resolvedSymbol || '').toLowerCase();
      const addr = (row.identifier || row.item.address || row.item.binanceSymbol || '').toLowerCase();
      return label.includes(q) || symbol.includes(q) || addr.includes(q);
    });
  }

  // Rebuild chain chips from view+search filtered results, then apply chain filter
  rebuildChainFilters(filtered);
  if (state.activeChainFilter !== 'all') {
    filtered = filtered.filter((row) => getChainKey(row) === state.activeChainFilter);
  }

  return filtered;
}


function sortResults(results) {
  const rows = [...results];
  switch (state.sortMode) {
    case 'change24h_desc':
      return rows.sort((a, b) => (Number(b.change24h) || -Infinity) - (Number(a.change24h) || -Infinity));
    case 'change24h_abs':
      return rows.sort((a, b) => (Math.abs(Number(b.change24h)) || 0) - (Math.abs(Number(a.change24h)) || 0));
    case 'recent':
      return rows.sort((a, b) => (b.item.createdAt || 0) - (a.item.createdAt || 0));
    case 'marketCap_desc':
      return rows.sort((a, b) => (Number(b.marketCap) || -Infinity) - (Number(a.marketCap) || -Infinity));
    case 'label_asc':
      return rows.sort((a, b) => String(a.item.label).localeCompare(String(b.item.label)));
    case 'manual':
    default:
      return rows.sort((a, b) => Number(!!b.item.favorite) - Number(!!a.item.favorite) || (b.item.createdAt || 0) - (a.item.createdAt || 0));
  }
}

function setStatus(text) {
  els.statusBadge.textContent = text;
  els.coinList.classList.toggle('refreshing', text === 'Refreshing');
}

function updateCount(visible = state.items.length, total = state.items.length) {
  if (state.isPro) {
    els.assetCount.textContent = visible === total ? `${total}/${PRO_TIER_LIMIT}` : `${visible}/${total}`;
  } else {
    els.assetCount.textContent = `${total}/${FREE_TIER_LIMIT} assets`;
  }
}

function updateTierBadge() {
  if (state.isPro) {
    els.tierBadge.textContent = 'Pro';
    els.tierBadge.classList.add('pro');
    els.tierBadge.style.cursor = '';
    els.tierBadge.title = 'CoinWatch Pro';
    els.tierBadge.onclick = null;
  } else {
    els.tierBadge.textContent = 'Free';
    els.tierBadge.classList.remove('pro');
    els.tierBadge.style.cursor = 'pointer';
    els.tierBadge.title = 'Upgrade to Pro — $1.99/mo';
    els.tierBadge.onclick = () => extpay.openPaymentPage();
  }
}

function showResolvedPreview(text, isError = false) {
  els.resolvedPreview.textContent = text;
  els.resolvedPreview.classList.remove('hidden');
  els.resolvedPreview.classList.toggle('negative', isError);
}

function clearResolvedPreview() {
  state.previewAsset = null;
  els.resolvedPreview.textContent = '';
  els.resolvedPreview.classList.add('hidden');
  els.resolvedPreview.classList.remove('negative');
}

function showFeedback(text, isError = false) {
  els.formFeedback.textContent = text;
  els.formFeedback.classList.remove('hidden');
  els.formFeedback.classList.toggle('error', isError);
}

function clearFeedback() {
  els.formFeedback.textContent = '';
  els.formFeedback.classList.add('hidden');
  els.formFeedback.classList.remove('error');
}

let undoTimer = null;
function showUndoToast(label, onUndo) {
  // Remove any existing toast
  document.querySelector('.undo-toast')?.remove();
  clearTimeout(undoTimer);

  const toast = document.createElement('div');
  toast.className = 'undo-toast';
  toast.innerHTML = `<span>${esc(label)} removed</span>`;
  const btn = document.createElement('button');
  btn.textContent = 'Undo';
  btn.addEventListener('click', () => {
    clearTimeout(undoTimer);
    toast.remove();
    onUndo();
  });
  toast.appendChild(btn);
  document.body.appendChild(toast);

  undoTimer = setTimeout(() => toast.remove(), 4000);
}

function matchesPreview(pair, query) {
  const normalized = String(query).trim().toLowerCase();
  return [pair?.baseToken?.address, pair?.pairAddress, pair?.baseToken?.symbol]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase())
    .includes(normalized);
}

function resolveBinancePair(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return raw;
  return BINANCE_PAIR_REGEX.test(raw) ? raw : `${raw}USDT`;
}

function normalizeBinanceLabel(symbol) {
  return symbol.replace(BINANCE_PAIR_REGEX, '');
}

function shortenAddress(value) {
  const str = String(value || '');
  if (str.length <= 12) return str;
  return `${str.slice(0, 4)}…${str.slice(-4)}`;
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return `$${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(value)}`;
  if (value >= 1000) return `$${value.toLocaleString('en', { maximumFractionDigits: 2 })}`;
  if (value >= 1) return `$${value.toLocaleString('en', { maximumFractionDigits: 4 })}`;
  if (value >= 0.0001) return `$${value.toLocaleString('en', { maximumFractionDigits: 6 })}`;
  return `$${value.toLocaleString('en', { maximumFractionDigits: 10 })}`;
}

function formatMoney(value) {
  if (!Number.isFinite(value)) return '—';
  const compact = new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 2
  }).format(value);
  return `$${compact}`;
}

function formatCompact(value) {
  if (!Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value));
}

function formatPercent(value) {
  if (!Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function debounce(fn, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}

async function storePriceSnapshots(results) {
  const { sparkData = {} } = await chrome.storage.local.get(['sparkData']);
  const now = Date.now();
  for (const r of results) {
    if (!r.ok || !r.item?.id || !Number.isFinite(r.price)) continue;
    const id = r.item.id;
    if (!sparkData[id]) sparkData[id] = [];
    sparkData[id].push({ t: now, p: r.price });
    // Keep last 24 data points (~ 24 refreshes = ~18 min at 45s intervals)
    if (sparkData[id].length > 24) sparkData[id] = sparkData[id].slice(-24);
  }
  // Clean up removed items
  const activeIds = new Set(results.map((r) => r.item?.id).filter(Boolean));
  for (const id of Object.keys(sparkData)) {
    if (!activeIds.has(id)) delete sparkData[id];
  }
  await chrome.storage.local.set({ sparkData });
  state.sparkData = sparkData;
}

function renderSparkline(points) {
  if (!points || points.length < 2) return '';
  const prices = points.map((p) => p.p);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const w = 48;
  const h = 16;
  const step = w / (prices.length - 1);
  const coords = prices.map((p, i) => `${(i * step).toFixed(1)},${(h - ((p - min) / range) * h).toFixed(1)}`);
  const color = prices[prices.length - 1] >= prices[0] ? 'var(--positive)' : 'var(--negative)';
  return `<svg class="sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${coords.join(' ')}" fill="none" stroke="${color}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function showUpgradePrompt() {
  els.coinList.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'empty-state upgrade-prompt';
  div.innerHTML = `
    <div class="onboarding-title">Watchlist full</div>
    <p>Free tier supports up to <strong>${FREE_TIER_LIMIT} tokens</strong>. Upgrade to CoinWatch Pro to track up to ${PRO_TIER_LIMIT} tokens.</p>
    <button class="primary-btn upgrade-btn" style="margin-top:10px">Upgrade — $1.99/mo</button>
    <div class="onboarding-hint" style="margin-top:8px">Cancel anytime. Supports development of CoinWatch.</div>
  `;
  div.querySelector('.upgrade-btn').addEventListener('click', () => {
    extpay.openPaymentPage();
  });
  // Show it as a feedback instead of replacing the list
  showFeedback(`Free tier limit (${FREE_TIER_LIMIT} tokens). Upgrade to track up to ${PRO_TIER_LIMIT}.`, true);
}

async function renderAlertHistory() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_ALERT_HISTORY' });
  const history = response?.history || [];
  if (!history.length) {
    els.historyList.innerHTML = '<div class="empty-state">No alerts have triggered yet.</div>';
    return;
  }
  els.historyList.innerHTML = '';
  for (const entry of history) {
    const div = document.createElement('div');
    div.className = 'history-entry';
    const metricLabel = entry.metric === 'price' ? 'Price' : entry.metric === 'marketCap' ? 'Mcap' : '24h';
    const dir = entry.condition === 'above' ? 'above' : 'below';
    const target = entry.metric === 'change24h' ? `${entry.targetValue}%` : `$${Number(entry.targetValue).toLocaleString()}`;
    const actual = entry.metric === 'change24h' ? `${Number(entry.actualValue).toFixed(2)}%` : `$${Number(entry.actualValue).toLocaleString()}`;
    const time = new Date(entry.triggeredAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `
      <div class="history-entry-title">${esc(entry.label)}</div>
      <div class="history-entry-detail">${esc(metricLabel)} went ${dir} ${esc(target)} — was ${esc(actual)}</div>
      <div class="history-entry-time">${esc(time)}</div>`;
    els.historyList.appendChild(div);
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  els.themeToggle.textContent = theme === 'dark' ? '☀' : '◑';
}

function buildChartUrl(result) {
  if (result.item.type === 'binance') {
    const symbol = result.item.binanceSymbol || result.item.query || '';
    return `https://www.binance.com/en/trade/${symbol.replace(/USDT$/, '_USDT')}`;
  }
  const chain = result.chainId || result.item.chainId;
  const addr = result.item.pairAddress || result.identifier || result.item.address;
  if (chain && addr) return `https://dexscreener.com/${chain}/${addr}`;
  return null;
}

function updateRelativeTime() {
  if (!state.lastRefreshTime) return;
  const diff = Math.floor((Date.now() - state.lastRefreshTime) / 1000);
  if (diff < 5) els.lastUpdated.textContent = 'just now';
  else if (diff < 60) els.lastUpdated.textContent = `${diff}s ago`;
  else els.lastUpdated.textContent = `${Math.floor(diff / 60)}m ago`;
}

state.relativeTimeHandle = setInterval(updateRelativeTime, 5000);
window.addEventListener('unload', () => {
  if (state.relativeTimeHandle) clearInterval(state.relativeTimeHandle);
});

function handleFatal(error) {
  console.error(error);
  els.coinList.innerHTML = `<div class="empty-state">Startup error: ${esc(String(error.message || error))}</div>`;
  setStatus('Error');
}
