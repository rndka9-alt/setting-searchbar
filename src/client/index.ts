/**
 * Setting Searchbar – client entry point.
 *
 * Injected into RisuAI via <script src="/setting-searchbar/client.js">.
 * Watches for the settings page to appear in the DOM, then injects
 * a search bar into the sidebar.
 */

import { createSearchUI, destroySearchUI } from './ui';

const SIDEBAR_SELECTOR = '.rs-setting-cont-3';
const TAG = '[setting-searchbar]';

let injected = false;

function tryInject() {
  if (injected) return;
  const sidebar = document.querySelector(SIDEBAR_SELECTOR);
  if (!sidebar) return;

  injected = true;
  const ui = createSearchUI();
  sidebar.prepend(ui);
  console.log(`${TAG} search bar injected`);
}

function onRemoved() {
  if (!injected) return;
  const sidebar = document.querySelector(SIDEBAR_SELECTOR);
  if (sidebar) return; // still there

  injected = false;
  destroySearchUI();
  console.log(`${TAG} search bar removed (settings closed)`);
}

// MutationObserver to detect settings page open/close
const observer = new MutationObserver(() => {
  if (!injected) {
    tryInject();
  } else {
    onRemoved();
  }
});

function init() {
  observer.observe(document.body, { childList: true, subtree: true });
  // In case settings is already open
  tryInject();
  console.log(`${TAG} initialized`);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
