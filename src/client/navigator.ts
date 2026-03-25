import type { IndexEntry } from './types';

const NAV_WAIT_MS = 150;
const POLL_INTERVAL_MS = 50;
const CONTENT_TIMEOUT_MS = 2000;
const ACCORDION_TIMEOUT_MS = 1500;

/** Monotonically increasing navigation ID for debouncing. */
let currentNavId = 0;

function wait(ms: number): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, ms)));
}

/** Poll until `predicate` returns true, or timeout. */
function pollUntil(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  if (predicate()) return Promise.resolve(true);

  return new Promise((resolve) => {
    const start = Date.now();
    const id = setInterval(() => {
      if (predicate()) {
        clearInterval(id);
        resolve(true);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(id);
        resolve(false);
      }
    }, POLL_INTERVAL_MS);
  });
}

/** Wait for `.rs-setting-cont-4` to appear in the DOM (for mobile navigation). */
function waitForContent(): Promise<Element | null> {
  return pollUntil(
    () => !!document.querySelector('.rs-setting-cont-4'),
    CONTENT_TIMEOUT_MS,
  ).then((found) => found ? document.querySelector('.rs-setting-cont-4') : null);
}

function getMenuButtons(sidebar: Element): HTMLButtonElement[] {
  const all = sidebar.querySelectorAll<HTMLButtonElement>('button');
  return [...all].filter((b) => {
    const span = b.querySelector('span');
    return span && span.textContent?.trim();
  });
}

function getSubmenuButtons(content: Element): HTMLButtonElement[] {
  const container = content.querySelector(
    '.flex.rounded-md.border.border-darkborderc',
  );
  if (!container) return [];
  return [...container.querySelectorAll<HTMLButtonElement>('button')];
}

// ─── Highlighting ───

const HIGHLIGHT_CLASS = 'ssb-highlight';

/** Highlight the exact element matching `displayText` with a pulse animation. */
export function highlightExact(displayText: string): void {
  const contentWrapper = document.querySelector('.rs-setting-cont-4');
  if (!contentWrapper) return;

  const target = displayText.trim().toLowerCase();
  if (!target) return;

  // Search non-button elements first, then accordion buttons as fallback
  const candidates = contentWrapper.querySelectorAll(
    'h2, h3, span, label, [class*="text-textcolor"]',
  );

  let matched: Element | null = null;
  for (const el of candidates) {
    if ((el as Element).closest('button')) continue;
    if ((el as Element).closest('.flex.rounded-md.border.border-darkborderc')) continue;
    if (el.children.length > 3) continue;

    if (el.textContent?.trim().toLowerCase() === target) {
      matched = el;
      break;
    }
  }

  // Fallback: try accordion buttons
  if (!matched) {
    const buttons = contentWrapper.querySelectorAll<HTMLButtonElement>('button');
    for (const btn of buttons) {
      const cls = btn.className;
      if (!cls.includes('hover:bg-selected') || !cls.includes('text-lg')) continue;
      if (btn.textContent?.trim().toLowerCase() === target) {
        matched = btn;
        break;
      }
    }
  }

  if (matched) {
    matched.classList.add(HIGHLIGHT_CLASS);
    matched.addEventListener('animationend', () => {
      matched.classList.remove(HIGHLIGHT_CLASS);
    }, { once: true });
  }
}

/** Remove all highlights */
export function clearHighlights(): void {
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((el) => {
    el.classList.remove(HIGHLIGHT_CLASS);
  });
}

/** Scroll to the first highlighted element */
export function scrollToFirstHighlight(): void {
  const first = document.querySelector(`.${HIGHLIGHT_CLASS}`);
  if (first) {
    first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// ─── Navigation ───

/**
 * Navigate to a specific setting:
 * 1. Click the sidebar button
 * 2. Click the submenu tab (if applicable)
 * 3. Open accordions in the path
 * 4. Highlight matching text
 * 5. Scroll to first match
 *
 * Uses a navId to debounce: if a newer navigateTo is called while
 * this one is awaiting, this one bails out early.
 */
export async function navigateTo(entry: IndexEntry): Promise<void> {
  const navId = ++currentNavId;

  const sidebar = document.querySelector('.rs-setting-cont-3');
  if (!sidebar) return;

  const menuButtons = getMenuButtons(sidebar);
  const btn = menuButtons[entry.menuButtonIdx];
  if (!btn) return;

  clearHighlights();

  btn.click();
  await wait(NAV_WAIT_MS);
  if (navId !== currentNavId) return;

  const contentWrapper = await waitForContent();
  if (!contentWrapper || navId !== currentNavId) return;

  if (entry.subIdx >= 0) {
    const subButtons = getSubmenuButtons(contentWrapper);
    const subBtn = subButtons[entry.subIdx];
    if (subBtn) {
      subBtn.click();
      await wait(NAV_WAIT_MS);
      if (navId !== currentNavId) return;
    }
  }

  // Open accordions in the path (outer to inner)
  for (const accordionName of entry.accordionPath) {
    if (navId !== currentNavId) return;

    const contentArea = document.querySelector('.rs-setting-cont-4');
    if (!contentArea) return;

    const buttons = contentArea.querySelectorAll<HTMLButtonElement>('button');
    let found = false;
    for (const accBtn of buttons) {
      const cls = accBtn.className;
      if (!cls.includes('hover:bg-selected') || !cls.includes('text-lg')) continue;
      if (accBtn.textContent?.trim() !== accordionName) continue;

      found = true;
      // Check if already open: an open accordion has a sibling content div
      // rendered by Svelte's {#if open}. If nextElementSibling is a non-button
      // div, the accordion is already open.
      const next = accBtn.nextElementSibling;
      if (next && next.tagName !== 'BUTTON') break; // already open

      accBtn.click();
      // Wait until the content div appears as the next sibling
      const opened = await pollUntil(
        () => {
          const sib = accBtn.nextElementSibling;
          return !!sib && sib.tagName !== 'BUTTON';
        },
        ACCORDION_TIMEOUT_MS,
      );
      if (!opened) {
        console.warn(`[ssb:nav] accordion "${accordionName}" did not open`);
      }
      break;
    }
    if (!found) {
      console.warn(`[ssb:nav] accordion "${accordionName}" not found`);
    }
  }

  if (navId !== currentNavId) return;

  // Extra wait for Svelte to finish rendering
  await wait(NAV_WAIT_MS);
  if (navId !== currentNavId) return;

  highlightExact(entry.displayText);
  scrollToFirstHighlight();
}
