import type { IndexEntry } from './types';
import { buildIndex } from './indexer';
import { navigateTo, clearHighlights } from './navigator';

let index: IndexEntry[] = [];
let isIndexed = false;
let activeQuery = '';
let injectedElements: HTMLElement[] = [];
let selectedItemIdx = -1;
let flatItems: { el: HTMLElement; entry: IndexEntry }[] = [];

// ─── Styles (injected once) ───

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .ssb-hidden { display: none !important; }

    .ssb-highlight {
      background-color: rgba(137, 180, 250, 0.18) !important;
      border-radius: 4px;
      outline: 1px solid rgba(137, 180, 250, 0.3);
      outline-offset: 2px;
    }

    .ssb-sub-container {
      padding: 2px 0 4px 32px;
      display: flex; flex-direction: column;
    }

    .ssb-sub-item {
      padding: 4px 10px;
      font-size: 12px;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: baseline;
      gap: 6px;
      transition: background-color 0.1s;
    }
    .ssb-sub-item:hover {
      background-color: var(--dark-button-color, #313244);
    }
    .ssb-sub-item-selected {
      background-color: var(--dark-button-color, #313244);
    }

    .ssb-sub-label {
      opacity: 0.45; font-size: 11px; flex-shrink: 0;
    }
    .ssb-sub-more {
      padding: 2px 10px; font-size: 11px; opacity: 0.35;
    }
  `;
  document.head.appendChild(style);
}

// ─── Search logic ───

function search(query: string): IndexEntry[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);

  const scored: { entry: IndexEntry; score: number }[] = [];

  for (const entry of index) {
    const display = entry.displayText.toLowerCase();
    const full = entry.searchText.toLowerCase();
    let score = 0;

    if (display.includes(q)) score += 100;
    if (full.includes(q)) score += 50;

    for (const tok of tokens) {
      if (display.includes(tok)) score += 20;
      if (full.includes(tok)) score += 10;
    }

    const path = `${entry.menuLabel} ${entry.subLabel}`.toLowerCase();
    for (const tok of tokens) {
      if (path.includes(tok)) score += 5;
    }

    if (score > 0) scored.push({ entry, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.entry);
}

// ─── Grouping ───

interface MenuGroup {
  menuButtonIdx: number;
  menuLabel: string;
  entries: IndexEntry[];
}

function groupByMenu(entries: IndexEntry[]): MenuGroup[] {
  const map = new Map<number, MenuGroup>();
  for (const entry of entries) {
    let g = map.get(entry.menuButtonIdx);
    if (!g) {
      g = {
        menuButtonIdx: entry.menuButtonIdx,
        menuLabel: entry.menuLabel,
        entries: [],
      };
      map.set(entry.menuButtonIdx, g);
    }
    g.entries.push(entry);
  }
  return [...map.values()];
}

// ─── Sidebar filtering ───

function getMenuButtons(): HTMLButtonElement[] {
  const sidebar = document.querySelector('.rs-setting-cont-3');
  if (!sidebar) return [];
  const all = sidebar.querySelectorAll<HTMLButtonElement>('button');
  return [...all].filter((b) => {
    const span = b.querySelector('span');
    return span && span.textContent?.trim();
  });
}

function restoreSidebar() {
  // Show all hidden buttons
  document.querySelectorAll('.ssb-hidden').forEach((el) => {
    el.classList.remove('ssb-hidden');
  });
  // Remove injected sub-item containers
  for (const el of injectedElements) el.remove();
  injectedElements = [];
  flatItems = [];
  selectedItemIdx = -1;
}

const MAX_SUB_ITEMS = 6;

function filterSidebar(groups: MenuGroup[]) {
  restoreSidebar();

  const buttons = getMenuButtons();
  const matchingIdxs = new Set(groups.map((g) => g.menuButtonIdx));

  // Hide non-matching buttons
  for (let i = 0; i < buttons.length; i++) {
    if (!matchingIdxs.has(i)) {
      buttons[i].classList.add('ssb-hidden');
    }
  }

  // Inject sub-items under each matching category
  for (const group of groups) {
    const btn = buttons[group.menuButtonIdx];
    if (!btn) continue;

    const container = document.createElement('div');
    container.className = 'ssb-sub-container';

    const visible = group.entries.slice(0, MAX_SUB_ITEMS);
    for (const entry of visible) {
      const item = document.createElement('div');
      item.className = 'ssb-sub-item';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = entry.displayText;

      item.appendChild(nameSpan);

      if (entry.subLabel) {
        const tag = document.createElement('span');
        tag.className = 'ssb-sub-label';
        tag.textContent = entry.subLabel;
        item.appendChild(tag);
      }

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        selectAndNavigate(entry);
      });

      container.appendChild(item);
      flatItems.push({ el: item, entry });
    }

    if (group.entries.length > MAX_SUB_ITEMS) {
      const more = document.createElement('div');
      more.className = 'ssb-sub-more';
      more.textContent = `+${group.entries.length - MAX_SUB_ITEMS} more`;
      container.appendChild(more);
    }

    btn.insertAdjacentElement('afterend', container);
    injectedElements.push(container);
  }
}

// ─── Selection & navigation ───

function updateSelection(idx: number) {
  // Clear previous
  flatItems[selectedItemIdx]?.el.classList.remove('ssb-sub-item-selected');
  selectedItemIdx = idx;
  if (idx >= 0 && idx < flatItems.length) {
    flatItems[idx].el.classList.add('ssb-sub-item-selected');
    flatItems[idx].el.scrollIntoView({ block: 'nearest' });
  }
}

async function selectAndNavigate(entry: IndexEntry) {
  await navigateTo(entry, activeQuery);
}

async function autoNavigateFirst() {
  if (flatItems.length === 0) return;
  updateSelection(0);
  await selectAndNavigate(flatItems[0].entry);
}

// ─── Indexing ───

let statusEl: HTMLElement | null = null;

async function triggerIndex() {
  if (isIndexed) return;
  if (statusEl) {
    statusEl.textContent = 'Indexing...';
    statusEl.style.display = 'block';
  }

  try {
    index = await buildIndex((msg) => {
      if (statusEl) statusEl.textContent = msg;
    });
    isIndexed = true;
    if (statusEl) {
      statusEl.textContent = `${index.length} items indexed`;
      setTimeout(() => {
        if (statusEl) statusEl.style.display = 'none';
      }, 1200);
    }
  } catch (err) {
    console.error('[setting-searchbar] index error:', err);
    if (statusEl) {
      statusEl.textContent = 'Index failed';
      setTimeout(() => {
        if (statusEl) statusEl.style.display = 'none';
      }, 2000);
    }
  }
}

async function forceReindex() {
  isIndexed = false;
  index = [];
  await triggerIndex();
  // Re-apply current query if any
  if (activeQuery) applySearch(activeQuery);
}

// ─── Core search flow ───

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let navigateTimer: ReturnType<typeof setTimeout> | null = null;

function applySearch(query: string) {
  activeQuery = query;

  if (!query.trim()) {
    restoreSidebar();
    clearHighlights();
    return;
  }

  if (!isIndexed) return;

  const results = search(query);
  const groups = groupByMenu(results);
  filterSidebar(groups);

  // Auto-navigate to first result (debounced to avoid rapid tab switching)
  if (navigateTimer) clearTimeout(navigateTimer);
  navigateTimer = setTimeout(() => {
    autoNavigateFirst();
  }, 300);
}

// ─── DOM ───

const SEARCH_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;
const REFRESH_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`;
const CLEAR_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;

let root: HTMLElement | null = null;
let inputEl: HTMLInputElement | null = null;

export function createSearchUI(): HTMLElement {
  injectStyles();

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'padding: 8px 12px 4px;';

  // Input row
  const inputRow = document.createElement('div');
  inputRow.style.cssText = `
    display: flex; align-items: center; gap: 6px;
    border: 1px solid var(--dark-border-color, #313244);
    border-radius: 8px; padding: 6px 10px;
    background: var(--bg-color, #1e1e2e);
  `;

  const icon = document.createElement('span');
  icon.style.cssText = 'display:flex; align-items:center; opacity:0.5; flex-shrink:0;';
  icon.innerHTML = SEARCH_ICON;

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Search settings...';
  input.style.cssText = `
    flex: 1; border: none; outline: none;
    background: transparent; font-size: 13px;
    color: var(--text-color, #cdd6f4); min-width: 0;
  `;

  const clearBtn = document.createElement('button');
  clearBtn.style.cssText = `
    display: none; align-items: center; justify-content: center;
    border: none; background: none; cursor: pointer;
    opacity: 0.4; padding: 2px; flex-shrink: 0;
    color: var(--text-color, #cdd6f4);
  `;
  clearBtn.innerHTML = CLEAR_ICON;

  const refreshBtn = document.createElement('button');
  refreshBtn.title = 'Rebuild index';
  refreshBtn.style.cssText = `
    display: flex; align-items: center; justify-content: center;
    border: none; background: none; cursor: pointer;
    opacity: 0.4; padding: 2px; flex-shrink: 0;
    color: var(--text-color, #cdd6f4);
  `;
  refreshBtn.innerHTML = REFRESH_ICON;

  inputRow.append(icon, input, clearBtn, refreshBtn);

  // Status line
  const status = document.createElement('div');
  status.style.cssText = `
    font-size: 11px; padding: 4px 0 0 4px;
    opacity: 0.5; display: none;
  `;
  status.className = 'text-textcolor2';
  statusEl = status;

  wrapper.append(inputRow, status);
  root = wrapper;
  inputEl = input;

  // ─── Events ───

  input.addEventListener('focus', () => {
    triggerIndex();
  });

  input.addEventListener('input', () => {
    const hasValue = input.value.trim().length > 0;
    clearBtn.style.display = hasValue ? 'flex' : 'none';

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      applySearch(input.value);
    }, 200);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      clearBtn.style.display = 'none';
      applySearch('');
      input.blur();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flatItems.length > 0) {
        const next = Math.min(selectedItemIdx + 1, flatItems.length - 1);
        updateSelection(next);
        selectAndNavigate(flatItems[next].entry);
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flatItems.length > 0) {
        const prev = Math.max(selectedItemIdx - 1, 0);
        updateSelection(prev);
        selectAndNavigate(flatItems[prev].entry);
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedItemIdx >= 0 && flatItems[selectedItemIdx]) {
        selectAndNavigate(flatItems[selectedItemIdx].entry);
      }
      return;
    }
  });

  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    input.value = '';
    clearBtn.style.display = 'none';
    applySearch('');
    input.focus();
  });

  refreshBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    forceReindex();
  });

  // Hover effects
  for (const btn of [clearBtn, refreshBtn]) {
    btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.8'; });
    btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.4'; });
  }

  return wrapper;
}

export function destroySearchUI() {
  restoreSidebar();
  clearHighlights();
  root?.remove();
  root = null;
  inputEl = null;
  statusEl = null;
  index = [];
  isIndexed = false;
  activeQuery = '';
}
