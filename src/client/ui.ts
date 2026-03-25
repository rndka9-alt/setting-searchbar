import type { IndexEntry } from './types';
import { buildIndex } from './indexer';
import { navigateTo, clearHighlights } from './navigator';
import { searchIndex } from './search';

let index: IndexEntry[] = [];
let isIndexed = false;
let activeQuery = '';
let selectedItemIdx = -1;
let flatItems: { el: HTMLElement; entry: IndexEntry }[] = [];

// ─── Styles (injected once) ───

let stylesInjected = false;

/** Inject styles early (at script load) to reserve sidebar space and prevent CLS. */
export function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    /* Reserve space in sidebar so the search bar doesn't cause layout shift.
       Height = margin-top(8) + border(2) + padding(12) + font(1rem)
              + padding-bottom(8) + border-bottom(1) + margin-bottom(4) */
    .rs-setting-cont-3 {
      padding-top: calc(1rem + 35px);
    }

    .ssb-root {
      margin-top: calc(-1rem - 35px);
      padding: 0 0 8px;
      /* width: 0 makes this element contribute 0 to the parent's intrinsic
         width calculation. min-width: 100% then stretches it to fill whatever
         width the parent gets from its other children (the menu buttons). */
      width: 0;
      min-width: 100%;
      overflow: hidden;
      border-bottom: 1px solid var(--risu-theme-darkborderc);
      margin-bottom: 4px;
    }

    .ssb-highlight {
      border-radius: 4px;
      outline: 1px solid var(--risu-theme-borderc);
      outline-offset: 2px;
      animation: ssb-pulse 3s ease-out forwards;
    }

    @keyframes ssb-pulse {
      0%   { background-color: var(--risu-theme-borderc); }
      20%  { background-color: var(--risu-theme-selected); }
      60%  { background-color: var(--risu-theme-selected); }
      100% { background-color: transparent; outline-color: transparent; }
    }

    .ssb-results {
      max-height: 60vh;
      overflow: auto;
      scrollbar-width: none;
    }
    .ssb-results::-webkit-scrollbar { display: none; }

    .ssb-group-label {
      padding: 8px 12px 2px;
      font-size: 11px; font-weight: 600;
      color: var(--risu-theme-textcolor2);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      position: sticky;
      left: 0;
    }

    .ssb-item {
      padding: 6px 12px 6px 20px;
      font-size: 13px;
      color: var(--risu-theme-textcolor);
      cursor: pointer;
      display: flex; align-items: baseline; gap: 8px;
      transition: background-color 0.1s;
      white-space: nowrap;
    }
    .ssb-item:hover,
    .ssb-item-selected {
      background-color: var(--risu-theme-selected);
    }

    .ssb-item-sub {
      color: var(--risu-theme-textcolor2);
      font-size: 11px; flex-shrink: 0;
    }

    .ssb-more {
      padding: 2px 12px 6px 20px; font-size: 11px;
      color: var(--risu-theme-textcolor2);
    }
    .ssb-more-toggle {
      cursor: pointer;
    }
    .ssb-more-toggle:hover {
      color: var(--risu-theme-textcolor);
    }

    .ssb-status {
      font-size: 11px; padding: 8px 12px 0;
      color: var(--risu-theme-textcolor2);
    }

    .ssb-empty {
      padding: 16px; font-size: 13px;
      color: var(--risu-theme-textcolor2);
      text-align: center;
    }

    .ssb-input::placeholder {
      color: var(--risu-theme-textcolor2);
    }

    .ssb-icon {
      display: flex; align-items: center; flex-shrink: 0;
      color: var(--risu-theme-textcolor2);
    }
  `;
  document.head.appendChild(style);
}

// ─── Search logic ───

function search(query: string): IndexEntry[] {
  return searchIndex(index, query);
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

// ─── Results rendering (all inside our own container, no Svelte DOM touched) ───

let resultsEl: HTMLElement | null = null;

const MAX_PER_GROUP = 5;

function renderResults(groups: MenuGroup[]) {
  if (!resultsEl) return;
  resultsEl.innerHTML = '';
  flatItems = [];
  selectedItemIdx = -1;

  if (groups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'ssb-empty';
    empty.textContent = 'No results';
    resultsEl.appendChild(empty);
    resultsEl.style.display = 'block';
    return;
  }

  for (const group of groups) {
    // Group header
    const header = document.createElement('div');
    header.className = 'ssb-group-label';
    header.textContent = group.menuLabel;
    resultsEl.appendChild(header);

    // Items
    const visible = group.entries.slice(0, MAX_PER_GROUP);
    for (const entry of visible) {
      const item = document.createElement('div');
      item.className = 'ssb-item';

      const name = document.createElement('span');
      name.textContent = entry.displayText;
      item.appendChild(name);

      const pathLabel = [entry.subLabel, ...entry.accordionPath].filter(Boolean).join(' › ');
      if (pathLabel) {
        const sub = document.createElement('span');
        sub.className = 'ssb-item-sub';
        sub.textContent = pathLabel;
        item.appendChild(sub);
      }

      item.addEventListener('click', () => {
        navigateAndHighlight(entry);
      });

      resultsEl.appendChild(item);
      flatItems.push({ el: item, entry });
    }

    if (group.entries.length > MAX_PER_GROUP) {
      const hiddenEntries = group.entries.slice(MAX_PER_GROUP);
      const hiddenContainer = document.createElement('div');
      hiddenContainer.style.display = 'none';

      for (const entry of hiddenEntries) {
        const item = document.createElement('div');
        item.className = 'ssb-item';

        const name = document.createElement('span');
        name.textContent = entry.displayText;
        item.appendChild(name);

        const pathLabel = [entry.subLabel, ...entry.accordionPath].filter(Boolean).join(' › ');
        if (pathLabel) {
          const sub = document.createElement('span');
          sub.className = 'ssb-item-sub';
          sub.textContent = pathLabel;
          item.appendChild(sub);
        }

        item.addEventListener('click', () => {
          navigateAndHighlight(entry);
        });

        hiddenContainer.appendChild(item);
        flatItems.push({ el: item, entry });
      }

      // Bottom collapse button (inside hidden container, only visible when expanded)
      const bottomCollapse = document.createElement('div');
      bottomCollapse.className = 'ssb-more ssb-more-toggle';
      bottomCollapse.textContent = '- collapse';
      hiddenContainer.appendChild(bottomCollapse);

      // Top toggle button — placed BEFORE hiddenContainer so it sits
      // between the visible items and the expanded hidden items.
      const topToggle = document.createElement('div');
      topToggle.className = 'ssb-more ssb-more-toggle';
      topToggle.textContent = `+${hiddenEntries.length} more`;
      resultsEl.appendChild(topToggle);
      resultsEl.appendChild(hiddenContainer);

      const toggle = (expanded: boolean) => {
        hiddenContainer.style.display = expanded ? 'none' : 'block';
        topToggle.textContent = expanded
          ? `+${hiddenEntries.length} more`
          : '- collapse';
      };
      topToggle.addEventListener('click', () => {
        toggle(hiddenContainer.style.display !== 'none');
      });
      bottomCollapse.addEventListener('click', () => {
        toggle(true);
      });
    }
  }

  resultsEl.style.display = 'block';
}

function hideResults() {
  if (resultsEl) {
    resultsEl.style.display = 'none';
    resultsEl.innerHTML = '';
  }
  flatItems = [];
  selectedItemIdx = -1;
}

// ─── Selection & navigation ───

function updateSelection(idx: number) {
  flatItems[selectedItemIdx]?.el.classList.remove('ssb-item-selected');
  selectedItemIdx = idx;
  if (idx >= 0 && idx < flatItems.length) {
    flatItems[idx].el.classList.add('ssb-item-selected');
    flatItems[idx].el.scrollIntoView({ block: 'nearest' });
  }
}

async function navigateAndHighlight(entry: IndexEntry) {
  await navigateTo(entry);
}

// ─── Indexing ───

let statusEl: HTMLElement | null = null;

async function triggerIndex(force = false) {
  console.debug(`[ssb:ui] triggerIndex called, isIndexed=${isIndexed}, force=${force}`);
  if (isIndexed && !force) return;
  if (statusEl) {
    statusEl.textContent = force ? 'Re-crawling...' : 'Indexing...';
    statusEl.style.display = 'block';
  }

  try {
    index = await buildIndex((msg) => {
      if (statusEl) statusEl.textContent = msg;
    }, force);
    isIndexed = true;
    console.debug(`[ssb:ui] index built: ${index.length} entries`);
    if (statusEl) {
      statusEl.textContent = `${index.length} items indexed`;
      setTimeout(() => {
        if (statusEl) statusEl.style.display = 'none';
      }, 1200);
    }
    // Re-run search if user already typed a query while indexing
    if (activeQuery) applySearch(activeQuery);
  } catch (err) {
    console.error('[ssb:ui] index error:', err);
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
  await triggerIndex(true);
  if (activeQuery) applySearch(activeQuery);
}

// ─── Core search flow ───

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function applySearch(query: string) {
  activeQuery = query;
  console.debug(`[ssb:ui] applySearch: query="${query}", isIndexed=${isIndexed}, indexSize=${index.length}`);

  if (!query.trim()) {
    hideResults();
    clearHighlights();
    return;
  }

  if (!isIndexed) {
    console.warn(`[ssb:ui] applySearch: skipped — not indexed yet`);
    return;
  }

  const results = search(query);
  const groups = groupByMenu(results);
  console.debug(`[ssb:ui] applySearch: ${results.length} results, ${groups.length} groups`);
  renderResults(groups);
}

// ─── DOM ───

const SEARCH_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;
const REFRESH_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`;
const CLEAR_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;

let root: HTMLElement | null = null;

export function createSearchUI(): HTMLElement {
  injectStyles();

  const wrapper = document.createElement('div');
  wrapper.className = 'ssb-root';

  // Input row
  const inputRow = document.createElement('div');
  inputRow.style.cssText = `
    display: flex; align-items: center; gap: 6px;
    border: 1px solid var(--risu-theme-darkborderc);
    border-radius: 8px; padding: 6px 10px;
    margin: 8px 12px 0 0;
    background: var(--risu-theme-darkbg);
  `;

  const icon = document.createElement('span');
  icon.className = 'ssb-icon';
  icon.innerHTML = SEARCH_ICON;

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Search settings...';
  input.className = 'ssb-input';
  input.style.cssText = `
    flex: 1; border: none; outline: none;
    background: transparent; font-size: 1rem;
    color: var(--risu-theme-textcolor); min-width: 0;
  `;

  const clearBtn = document.createElement('button');
  clearBtn.style.cssText = `
    display: none; align-items: center; justify-content: center;
    border: none; background: none; cursor: pointer;
    opacity: 0.4; padding: 2px; flex-shrink: 0;
    color: var(--risu-theme-textcolor);
  `;
  clearBtn.innerHTML = CLEAR_ICON;

  const refreshBtn = document.createElement('button');
  refreshBtn.title = 'Rebuild index';
  refreshBtn.style.cssText = `
    display: flex; align-items: center; justify-content: center;
    border: none; background: none; cursor: pointer;
    opacity: 0.4; padding: 2px; flex-shrink: 0;
    color: var(--risu-theme-textcolor);
  `;
  refreshBtn.innerHTML = REFRESH_ICON;

  inputRow.append(icon, input, clearBtn, refreshBtn);

  // Status
  const status = document.createElement('div');
  status.className = 'ssb-status';
  status.style.display = 'none';
  statusEl = status;

  // Results list (rendered entirely inside our own container)
  const results = document.createElement('div');
  results.className = 'ssb-results';
  results.style.display = 'none';
  resultsEl = results;

  wrapper.append(inputRow, status, results);
  root = wrapper;

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
        navigateAndHighlight(flatItems[next].entry);
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flatItems.length > 0) {
        const prev = Math.max(selectedItemIdx - 1, 0);
        updateSelection(prev);
        navigateAndHighlight(flatItems[prev].entry);
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedItemIdx >= 0 && flatItems[selectedItemIdx]) {
        navigateAndHighlight(flatItems[selectedItemIdx].entry);
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

  for (const btn of [clearBtn, refreshBtn]) {
    btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.8'; });
    btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.4'; });
  }

  return wrapper;
}

export function destroySearchUI() {
  // Don't clearHighlights here — highlights live in the content area,
  // not the sidebar. On mobile the sidebar disappears while the user
  // is viewing highlighted content. The pulse animation auto-clears.
  hideResults();
  root?.remove();
  root = null;
  resultsEl = null;
  statusEl = null;
  index = [];
  isIndexed = false;
  activeQuery = '';
}
