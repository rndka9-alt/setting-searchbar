import type { IndexEntry } from './types';

const RENDER_WAIT_MS = 120;

function wait(ms: number): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, ms)));
}

/** Get sidebar navigation buttons (skip back-button / plugin-injected modals) */
function getMenuButtons(sidebar: Element): HTMLButtonElement[] {
  const all = sidebar.querySelectorAll<HTMLButtonElement>('button');
  return [...all].filter((b) => {
    const span = b.querySelector('span');
    return span && span.textContent?.trim();
  });
}

/** Get submenu tab buttons if the current page has them */
function getSubmenuButtons(
  content: Element,
): HTMLButtonElement[] {
  // Submenu container: .flex.rounded-md.border.border-darkborderc
  const container = content.querySelector(
    '.flex.rounded-md.border.border-darkborderc',
  );
  if (!container) return [];
  return [...container.querySelectorAll<HTMLButtonElement>('button')];
}

/**
 * Collect text labels from the currently visible content area.
 *
 * Strategy: find all elements that look like setting labels or headers,
 * excluding button/tab text.
 */
function collectLabels(content: Element): { display: string; search: string; idx: number }[] {
  const results: { display: string; search: string; idx: number }[] = [];
  const seen = new Set<string>();

  // Find the actual scrollable content (skip submenu tab row)
  const children = content.children;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];

    // Skip the submenu tab container
    if (
      child.classList.contains('flex') &&
      child.classList.contains('rounded-md')
    ) {
      continue;
    }

    // Collect h2 headers
    const headings = child.querySelectorAll('h2, h3');
    for (const h of headings) {
      const text = h.textContent?.trim();
      if (text && !seen.has(text)) {
        seen.add(text);
        results.push({ display: text, search: text, idx: i });
      }
    }

    // Collect label-like elements
    const labelEls = child.querySelectorAll(
      'span.text-textcolor, label, [class*="text-textcolor"]',
    );
    for (const el of labelEls) {
      // Skip if inside a button
      if ((el as Element).closest('button')) continue;

      const display = el.textContent?.trim();
      if (!display || display.length < 2 || display.length > 120) continue;
      if (seen.has(display)) continue;
      seen.add(display);

      // Use parent context for richer search
      const parent = (el as Element).parentElement;
      const search = parent?.textContent?.trim() || display;
      results.push({ display, search, idx: i });
    }

    // Fallback: if this child has direct text and wasn't captured
    const directText = child.textContent?.trim();
    if (
      directText &&
      directText.length >= 2 &&
      directText.length <= 200 &&
      !seen.has(directText) &&
      results.every((r) => r.idx !== i)
    ) {
      seen.add(directText);
      results.push({ display: directText, search: directText, idx: i });
    }
  }

  return results;
}

export type IndexState = {
  entries: IndexEntry[];
  building: boolean;
};

/**
 * Crawl all settings tabs/submenus and build a full-text search index.
 */
export async function buildIndex(
  onProgress?: (msg: string) => void,
): Promise<IndexEntry[]> {
  const sidebar = document.querySelector('.rs-setting-cont-3');
  const contentWrapper = document.querySelector('.rs-setting-cont-4');
  if (!sidebar || !contentWrapper) return [];

  const menuButtons = getMenuButtons(sidebar);
  if (menuButtons.length === 0) return [];

  // Remember current active button
  const activeBtn = sidebar.querySelector<HTMLButtonElement>(
    'button.text-textcolor',
  );
  const activeIdx = activeBtn ? menuButtons.indexOf(activeBtn) : 0;

  // Overlay to hide flickering
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: absolute; inset: 0; z-index: 9999;
    background: var(--bg-color, #1e1e2e); opacity: 0.95;
    display: flex; align-items: center; justify-content: center;
    color: var(--text-color, #cdd6f4); font-size: 14px;
  `;
  overlay.textContent = 'Indexing...';
  const wrapper = contentWrapper.parentElement || contentWrapper;
  const prevPosition = (wrapper as HTMLElement).style.position;
  (wrapper as HTMLElement).style.position = 'relative';
  wrapper.appendChild(overlay);

  const entries: IndexEntry[] = [];

  try {
    for (let mi = 0; mi < menuButtons.length; mi++) {
      const btn = menuButtons[mi];
      const menuLabel = btn.querySelector('span')?.textContent?.trim() || '';
      onProgress?.(`${menuLabel} (${mi + 1}/${menuButtons.length})`);
      overlay.textContent = `Indexing: ${menuLabel}...`;

      btn.click();
      await wait(RENDER_WAIT_MS);

      // The content is rendered inside the #key block, find actual page root
      const pageRoot = contentWrapper.firstElementChild?.firstElementChild
        || contentWrapper.firstElementChild
        || contentWrapper;

      const subButtons = getSubmenuButtons(pageRoot);

      if (subButtons.length > 0) {
        for (let si = 0; si < subButtons.length; si++) {
          const subBtn = subButtons[si];
          const subLabel = subBtn.textContent?.trim() || '';

          subBtn.click();
          await wait(RENDER_WAIT_MS);

          const labels = collectLabels(pageRoot);
          for (const l of labels) {
            entries.push({
              displayText: l.display,
              searchText: l.search,
              menuButtonIdx: mi,
              menuLabel,
              subIdx: si,
              subLabel,
              elementIdx: l.idx,
            });
          }
        }
      } else {
        const labels = collectLabels(pageRoot);
        for (const l of labels) {
          entries.push({
            displayText: l.display,
            searchText: l.search,
            menuButtonIdx: mi,
            menuLabel,
            subIdx: -1,
            subLabel: '',
            elementIdx: l.idx,
          });
        }
      }
    }
  } finally {
    // Restore original tab
    if (menuButtons[activeIdx]) {
      menuButtons[activeIdx].click();
      await wait(RENDER_WAIT_MS);
    }
    overlay.remove();
    (wrapper as HTMLElement).style.position = prevPosition;
  }

  return entries;
}
