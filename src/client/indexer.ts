import type { IndexEntry } from './types';

const TAG = '[ssb:indexer]';
const RENDER_WAIT_MS = 100;

function wait(ms: number): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, ms)));
}

// ─── DOM helpers ───

function getMenuButtons(sidebar: Element): HTMLButtonElement[] {
  const all = sidebar.querySelectorAll<HTMLButtonElement>('button');
  const filtered = [...all].filter((b) => {
    const span = b.querySelector('span');
    return span && span.textContent?.trim();
  });
  console.log(
    `${TAG} getMenuButtons: ${all.length} total, ${filtered.length} after filter`,
  );
  return filtered;
}

function getSubmenuButtons(root: Element): HTMLButtonElement[] {
  const container = root.querySelector(
    '.flex.rounded-md.border.border-darkborderc',
  );
  if (!container) return [];
  return [...container.querySelectorAll<HTMLButtonElement>('button')];
}

/**
 * Collect ALL text labels from the entire subtree of the given root.
 * No more shallow children iteration — searches the full DOM tree.
 */
function collectLabels(
  root: Element,
): { display: string; search: string }[] {
  const results: { display: string; search: string }[] = [];
  const seen = new Set<string>();

  // Headers
  root.querySelectorAll('h2, h3').forEach((h) => {
    const text = h.textContent?.trim();
    if (text && text.length >= 2 && !seen.has(text)) {
      seen.add(text);
      results.push({ display: text, search: text });
    }
  });

  // Label-like elements
  root
    .querySelectorAll('span.text-textcolor, label, [class*="text-textcolor"]')
    .forEach((el) => {
      if (el.closest('button')) return;
      // Skip submenu tab container
      if (
        el.closest('.flex.rounded-md.border.border-darkborderc')
      ) return;

      const display = el.textContent?.trim();
      if (!display || display.length < 2 || display.length > 120) return;
      if (seen.has(display)) return;
      seen.add(display);

      const parent = el.parentElement;
      const search = parent?.textContent?.trim() || display;
      results.push({ display, search });
    });

  console.log(`${TAG} collectLabels: ${results.length} labels`);
  return results;
}

// ─── Main ───

export type IndexState = {
  entries: IndexEntry[];
  building: boolean;
};

/**
 * Crawl all settings tabs/submenus in the MAIN page and build
 * a full-text search index. Uses an overlay to hide visual flickering.
 */
export async function buildIndex(
  onProgress?: (msg: string) => void,
): Promise<IndexEntry[]> {
  console.log(`${TAG} buildIndex: starting`);

  const sidebar = document.querySelector('.rs-setting-cont-3');
  if (!sidebar) {
    console.warn(`${TAG} ABORT — no sidebar`);
    return [];
  }

  const menuButtons = getMenuButtons(sidebar);
  if (menuButtons.length === 0) {
    console.warn(`${TAG} ABORT — no menu buttons`);
    return [];
  }

  // Remember current active button
  const activeBtn = sidebar.querySelector<HTMLButtonElement>(
    'button.text-textcolor',
  );
  const activeIdx = activeBtn ? menuButtons.indexOf(activeBtn) : -1;

  // Ensure content area exists
  let contentWrapper = document.querySelector('.rs-setting-cont-4');
  if (!contentWrapper) {
    menuButtons[0].click();
    await wait(RENDER_WAIT_MS);
    contentWrapper = document.querySelector('.rs-setting-cont-4');
  }
  if (!contentWrapper) {
    console.warn(`${TAG} ABORT — no content wrapper`);
    return [];
  }

  // Overlay
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
      const menuLabel =
        btn.querySelector('span')?.textContent?.trim() || '';
      onProgress?.(`${menuLabel} (${mi + 1}/${menuButtons.length})`);
      overlay.textContent = `Indexing: ${menuLabel}...`;

      console.group(`${TAG} menu[${mi}] "${menuLabel}"`);

      btn.click();
      await wait(RENDER_WAIT_MS);

      // Re-query contentWrapper — Svelte may have recreated it
      contentWrapper = document.querySelector('.rs-setting-cont-4');
      if (!contentWrapper) {
        console.warn(`${TAG}   contentWrapper gone after clicking "${menuLabel}", skipping`);
        console.groupEnd();
        continue;
      }

      const subButtons = getSubmenuButtons(contentWrapper);

      if (subButtons.length > 0) {
        for (let si = 0; si < subButtons.length; si++) {
          const subBtn = subButtons[si];
          const subLabel = subBtn.textContent?.trim() || '';

          console.log(`${TAG}   sub[${si}] "${subLabel}"`);
          subBtn.click();
          await wait(RENDER_WAIT_MS);

          // Re-query again after submenu click
          contentWrapper = document.querySelector('.rs-setting-cont-4');
          if (!contentWrapper) break;

          for (const l of collectLabels(contentWrapper)) {
            entries.push({
              displayText: l.display,
              searchText: l.search,
              menuButtonIdx: mi,
              menuLabel,
              subIdx: si,
              subLabel,
              elementIdx: 0,
            });
          }
        }
      } else {
        for (const l of collectLabels(contentWrapper)) {
          entries.push({
            displayText: l.display,
            searchText: l.search,
            menuButtonIdx: mi,
            menuLabel,
            subIdx: -1,
            subLabel: '',
            elementIdx: 0,
          });
        }
      }

      console.log(`${TAG}   entries so far: ${entries.length}`);
      console.groupEnd();
    }
  } finally {
    overlay.remove();
    (wrapper as HTMLElement).style.position = prevPosition;

    if (activeIdx >= 0) {
      // Restore to the tab user was viewing
      menuButtons[activeIdx]?.click();
    } else {
      // User was at sidebar-only view (SettingsMenuIndex === -1).
      // Try to find and click a "back" button to return to sidebar view.
      const backBtn = document.querySelector<HTMLButtonElement>(
        '.rs-setting-cont-4 button[class*="ArrowLeft"], ' +
        '.rs-setting-cont button[class*="back"], ' +
        '.rs-setting-cont-2 button:first-child'
      );
      if (backBtn) {
        backBtn.click();
      } else {
        // Fallback: click the first tab so at least it's predictable
        menuButtons[0]?.click();
      }
    }
    await wait(RENDER_WAIT_MS);
  }

  console.log(`${TAG} buildIndex: DONE — ${entries.length} entries`);
  console.table(entries.slice(0, 30));
  return entries;
}
