const extpay = ExtPay('coinwatch');

const els = {
  refreshSeconds: document.getElementById('refreshSeconds'),
  themeSelect: document.getElementById('themeSelect'),
  defaultSort: document.getElementById('defaultSort'),
  planBadge: document.getElementById('planBadge'),
  upgradeBtn: document.getElementById('upgradeBtn'),
  manageBtn: document.getElementById('manageBtn'),
  exportBtn: document.getElementById('exportBtn'),
  importBtn: document.getElementById('importBtn'),
  importFile: document.getElementById('importFile'),
  clearHistory: document.getElementById('clearHistory'),
  resetAll: document.getElementById('resetAll'),
  saveBtn: document.getElementById('saveBtn'),
  savedMsg: document.getElementById('savedMsg')
};

async function load() {
  const stored = await chrome.storage.local.get(['refreshSeconds', 'theme', 'sortMode']);
  els.refreshSeconds.value = stored.refreshSeconds || 45;
  els.themeSelect.value = stored.theme || 'light';
  els.defaultSort.value = stored.sortMode || 'marketCap_desc';

  try {
    const user = await extpay.getUser();
    if (user.paid) {
      els.planBadge.textContent = 'Pro';
      els.planBadge.className = 'pro-badge pro';
      els.upgradeBtn.style.display = 'none';
      els.manageBtn.style.display = '';
    }
  } catch {}

  document.documentElement.dataset.theme = stored.theme || 'light';
}

els.saveBtn.addEventListener('click', async () => {
  const refreshSeconds = Math.max(15, Math.min(300, Number(els.refreshSeconds.value) || 45));
  const theme = els.themeSelect.value;
  const sortMode = els.defaultSort.value;

  await chrome.storage.local.set({ refreshSeconds, theme, sortMode });
  document.documentElement.dataset.theme = theme;

  els.savedMsg.classList.add('show');
  setTimeout(() => els.savedMsg.classList.remove('show'), 2000);
});

els.exportBtn.addEventListener('click', async () => {
  const { items = [] } = await chrome.storage.local.get(['items']);
  const data = { items, exportedAt: Date.now(), version: 1 };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `coinwatch-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  els.exportBtn.textContent = 'Exported!';
  setTimeout(() => { els.exportBtn.textContent = 'Export'; }, 1500);
});

els.importBtn.addEventListener('click', () => els.importFile.click());
els.importFile.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 512_000) {
    els.importBtn.textContent = 'File too large';
    setTimeout(() => { els.importBtn.textContent = 'Import'; }, 2000);
    els.importFile.value = '';
    return;
  }
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const imported = Array.isArray(data) ? data : data.items;
    if (!Array.isArray(imported)) throw new Error('Invalid format');

    const { items = [] } = await chrome.storage.local.get(['items']);
    let isPro = false;
    try { const user = await extpay.getUser(); isPro = !!user.paid; } catch {}
    let added = 0;
    for (const item of imported) {
      if (!item.id) item.id = crypto.randomUUID();
      const exists = items.some((existing) =>
        (item.type === 'binance' && existing.type === 'binance' && existing.binanceSymbol === item.binanceSymbol) ||
        (item.type === 'dex' && existing.type === 'dex' && (existing.address || '').toLowerCase() === (item.address || '').toLowerCase())
      );
      if (!exists) {
        if (!isPro && items.length >= 10) break;
        if (isPro && items.length >= 30) break;
        items.push(item);
        added++;
      }
    }
    await chrome.storage.local.set({ items });
    els.importBtn.textContent = `${added} added!`;
    setTimeout(() => { els.importBtn.textContent = 'Import'; }, 2000);
  } catch {
    els.importBtn.textContent = 'Invalid file';
    setTimeout(() => { els.importBtn.textContent = 'Import'; }, 2000);
  }
  els.importFile.value = '';
});

els.clearHistory.addEventListener('click', async () => {
  if (confirm('Clear all alert history?')) {
    await chrome.storage.local.set({ alertHistory: [] });
    els.clearHistory.textContent = 'Cleared';
    setTimeout(() => { els.clearHistory.textContent = 'Clear'; }, 1500);
  }
});

els.resetAll.addEventListener('click', async () => {
  if (confirm('This will remove your entire watchlist, alerts, and settings. Are you sure?')) {
    await chrome.storage.local.clear();
    els.resetAll.textContent = 'Done';
    setTimeout(() => { els.resetAll.textContent = 'Reset'; }, 1500);
  }
});

els.upgradeBtn.addEventListener('click', () => extpay.openPaymentPage());
els.manageBtn.addEventListener('click', () => extpay.openPaymentPage());

load();
