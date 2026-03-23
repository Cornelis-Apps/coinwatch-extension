/**
 * CoinWatch Content Script
 * Detects token/pair pages on chart sites and offers one-click watchlist add.
 */

const DEBUG = true;
const log = (...args) => DEBUG && console.log('%c[CoinWatch]', 'color: #118a4f; font-weight: bold', ...args);
const logErr = (...args) => DEBUG && console.error('%c[CoinWatch]', 'color: #c03f2f; font-weight: bold', ...args);

const SITE_EXTRACTORS = {
  'dexscreener.com': extractDexScreener,
  'birdeye.so': extractBirdeye,
  'www.geckoterminal.com': extractGeckoTerminal,
  'geckoterminal.com': extractGeckoTerminal,
  'www.dextools.io': extractDexTools,
  'dextools.io': extractDexTools,
  'defined.fi': extractDefined,
  'gmgn.ai': extractGmgn
};

const CHAIN_MAP = {
  // DexScreener chain slugs
  solana: 'solana', sol: 'solana',
  ethereum: 'ethereum', eth: 'ethereum',
  bsc: 'bsc', bnb: 'bsc',
  base: 'base',
  arbitrum: 'arbitrum', arb: 'arbitrum',
  polygon: 'polygon', polygon_pos: 'polygon',
  avalanche: 'avalanche', avax: 'avalanche',
  optimism: 'optimism', op: 'optimism',
  fantom: 'fantom', ftm: 'fantom',
  sui: 'sui',
  ton: 'ton',
  tron: 'tron',
  pulsechain: 'pulsechain',
  cronos: 'cronos'
};

let currentToken = null;
let buttonEl = null;
let lastUrl = location.href;
let detectTimer = null;

function run() {
  log('Content script loaded on', location.hostname, location.pathname);
  const extractor = getExtractor();
  if (!extractor) {
    log('No extractor found for this site');
    return;
  }
  log('Using extractor for', location.hostname);

  detect();

  // Watch for SPA navigation (these sites are all SPAs) — debounced
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      clearTimeout(detectTimer);
      detectTimer = setTimeout(detect, 300);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function getExtractor() {
  const host = location.hostname.replace(/^www\./, '');
  return SITE_EXTRACTORS[host] || SITE_EXTRACTORS['www.' + host] || null;
}

function detect() {
  const extractor = getExtractor();
  if (!extractor) return;

  const token = extractor();
  log('Extracted token:', token);
  if (token && (token.address || token.pairAddress)) {
    currentToken = token;
    showButton(token);
  } else {
    log('No token detected on this page');
    currentToken = null;
    hideButton();
  }
}

// --- Site Extractors ---
// Most chart sites put the CA/mint right in the URL: /{chain}/{address}
// We extract that directly — it's the most reliable approach.

// https://dexscreener.com/solana/CFB4Ff7W87uN9Gf2DSj63L7prZycJvzQeg1MbGxwBcqC
function extractDexScreener() {
  const match = location.pathname.match(/^\/([a-z_]+)\/(0x[a-fA-F0-9]{40}|[a-zA-Z0-9]{20,})/);
  if (!match) return null;
  const chain = normalizeChain(match[1]);
  const address = match[2];
  if (!chain) return null;
  return { chain, address, pairAddress: null, source: 'dexscreener' };
}

// https://birdeye.so/token/ADDRESS?chain=solana
function extractBirdeye() {
  const match = location.pathname.match(/\/token\/(0x[a-fA-F0-9]{40}|[a-zA-Z0-9]{20,})/);
  if (!match) return null;
  const address = match[1];
  const params = new URLSearchParams(location.search);
  const chain = normalizeChain(params.get('chain') || 'solana');
  return { chain, address, pairAddress: null, source: 'birdeye' };
}

// https://www.geckoterminal.com/solana/pools/ADDRESS
function extractGeckoTerminal() {
  const match = location.pathname.match(/^\/([a-z_-]+)\/pools\/(0x[a-fA-F0-9]{40}|[a-zA-Z0-9]{20,})/);
  if (!match) return null;
  const chain = normalizeChain(match[1]);
  const address = match[2];
  if (!chain) return null;
  return { chain, address, pairAddress: address, source: 'geckoterminal' };
}

// https://www.dextools.io/app/en/solana/pair-explorer/ADDRESS
function extractDexTools() {
  const match = location.pathname.match(/\/app\/[a-z]{2}\/([a-z_-]+)\/pair-explorer\/(0x[a-fA-F0-9]{40}|[a-zA-Z0-9]{20,})/);
  if (!match) return null;
  const chain = normalizeChain(match[1]);
  const address = match[2];
  if (!chain) return null;
  return { chain, address, pairAddress: null, source: 'dextools' };
}

// https://gmgn.ai/sol/token/ADDRESS
function extractGmgn() {
  const match = location.pathname.match(/\/([a-z]+)\/token\/(0x[a-fA-F0-9]{40}|[a-zA-Z0-9]{20,})/);
  if (!match) return null;
  const chain = normalizeChain(match[1]);
  const address = match[2];
  if (!chain) return null;
  log('GMGN extracted:', { chain, address });
  return { chain, address, pairAddress: null, source: 'gmgn' };
}

// https://defined.fi/sol/ADDRESS
function extractDefined() {
  const match = location.pathname.match(/^\/([a-z]+)\/(0x[a-fA-F0-9]{40}|[a-zA-Z0-9]{20,})/);
  if (!match) return null;
  const chain = normalizeChain(match[1]);
  const address = match[2];
  if (!chain) return null;
  return { chain, address, pairAddress: null, source: 'defined' };
}

function normalizeChain(raw) {
  if (!raw) return null;
  return CHAIN_MAP[raw.toLowerCase().replace(/-/g, '_')] || raw.toLowerCase();
}

// --- Floating Button UI ---

function showButton(token) {
  if (buttonEl) {
    updateButtonState('idle');
    return;
  }

  buttonEl = document.createElement('div');
  buttonEl.id = 'coinwatch-fab';
  buttonEl.innerHTML = `
    <button id="coinwatch-add-btn">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/>
        <path d="M8 4.5v7M4.5 8h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <span>Add to CoinWatch</span>
    </button>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #coinwatch-fab {
      position: fixed;
      bottom: 72px;
      right: 20px;
      z-index: 2147483647;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
    }
    #coinwatch-add-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      background: rgba(20, 20, 18, 0.88);
      color: rgba(255, 255, 255, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 2px 16px rgba(0,0,0,0.3);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      transition: background 150ms ease, transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease;
      -webkit-font-smoothing: antialiased;
    }
    #coinwatch-add-btn:hover {
      background: rgba(40, 40, 36, 0.95);
      border-color: rgba(255, 255, 255, 0.15);
      transform: translateY(-1px);
      box-shadow: 0 4px 20px rgba(0,0,0,0.35);
    }
    #coinwatch-add-btn:active {
      transform: translateY(0);
    }
    #coinwatch-add-btn.added {
      background: rgba(17, 138, 79, 0.92);
      border-color: rgba(46, 204, 113, 0.25);
      pointer-events: none;
    }
    #coinwatch-add-btn.duplicate {
      background: rgba(80, 76, 68, 0.88);
      border-color: rgba(255, 255, 255, 0.06);
      pointer-events: none;
    }
    #coinwatch-add-btn.error {
      background: rgba(192, 63, 47, 0.92);
      border-color: rgba(231, 76, 60, 0.3);
    }
    #coinwatch-add-btn svg {
      flex-shrink: 0;
    }
  `;

  document.documentElement.appendChild(style);
  document.documentElement.appendChild(buttonEl);

  document.getElementById('coinwatch-add-btn').addEventListener('click', handleAdd);
}

function hideButton() {
  if (buttonEl) {
    buttonEl.remove();
    buttonEl = null;
  }
}

function updateButtonState(state, label) {
  const btn = document.getElementById('coinwatch-add-btn');
  if (!btn) return;
  btn.className = '';
  const span = btn.querySelector('span');

  switch (state) {
    case 'idle':
      span.textContent = 'Add to CoinWatch';
      btn.style.pointerEvents = '';
      break;
    case 'adding':
      span.textContent = 'Adding…';
      btn.style.pointerEvents = 'none';
      break;
    case 'added':
      btn.classList.add('added');
      span.textContent = label || 'Added!';
      setTimeout(() => updateButtonState('idle'), 2500);
      break;
    case 'duplicate':
      btn.classList.add('duplicate');
      span.textContent = 'Already in watchlist';
      setTimeout(() => updateButtonState('idle'), 2500);
      break;
    case 'error':
      btn.classList.add('error');
      span.textContent = label || 'Failed to add';
      setTimeout(() => updateButtonState('idle'), 2500);
      break;
  }
}

async function handleAdd() {
  if (!currentToken) return;
  updateButtonState('adding');

  log('Sending ADD_TO_WATCHLIST message:', currentToken);
  if (!chrome.runtime?.id) {
    updateButtonState('error', 'CoinWatch was updated — please refresh this page');
    return;
  }
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ADD_TO_WATCHLIST',
      payload: currentToken
    });

    log('Response from background:', response);

    if (chrome.runtime.lastError) {
      logErr('runtime.lastError:', chrome.runtime.lastError.message);
      updateButtonState('error', chrome.runtime.lastError.message);
      return;
    }

    if (response?.success) {
      updateButtonState('added', `Added ${response.label}!`);
    } else if (response?.duplicate) {
      updateButtonState('duplicate');
    } else {
      logErr('Add failed:', response);
      updateButtonState('error', response?.error || 'Failed to add');
    }
  } catch (err) {
    logErr('sendMessage threw:', err);
    updateButtonState('error', err.message || 'Extension error');
  }
}

// --- Init ---
run();
