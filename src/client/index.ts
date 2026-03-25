/**
 * Setting Searchbar – client entry point.
 *
 * Injected into RisuAI via <script src="/setting-searchbar/client.js">.
 * Watches for the settings page to appear in the DOM, then prepends
 * a search bar to the sidebar. Only a single prepend — no ongoing
 * Svelte DOM manipulation (no hide/inject/class toggling on existing elements).
 */

import { createSearchUI, destroySearchUI, injectStyles } from './ui';
import { installAuthCapture } from './auth-capture';

// Capture risu-auth tokens from outgoing fetch requests.
// Must run before any RisuAI code so we intercept the first API calls.
installAuthCapture();

// Inject styles early to reserve sidebar space and prevent CLS.
// This adds padding-top to .rs-setting-cont-3 before it even renders.
injectStyles();

const SIDEBAR_SELECTOR = '.rs-setting-cont-3';
const TAG = '[setting-searchbar]';

let injected = false;
let pollId: ReturnType<typeof setInterval> | null = null;

function tryInject() {
  if (injected) return;
  const sidebar = document.querySelector(SIDEBAR_SELECTOR);
  if (!sidebar) return;

  injected = true;
  const ui = createSearchUI();
  sidebar.prepend(ui);
  console.debug(`${TAG} search bar prepended to sidebar`);
}

function onRemoved() {
  if (!injected) return;
  const sidebar = document.querySelector(SIDEBAR_SELECTOR);
  if (sidebar) return;

  injected = false;
  destroySearchUI();
  console.debug(`${TAG} search bar removed (settings closed)`);
}

function startPolling() {
  if (pollId) return;
  // Use a lightweight poll instead of MutationObserver on entire body.
  // Runs every 500ms — fast enough for UI, zero interference with Svelte.
  pollId = setInterval(() => {
    if (!injected) {
      tryInject();
    } else {
      onRemoved();
    }
  }, 500);
}

function init() {
  startPolling();
  tryInject();
  console.debug(`${TAG} initialized`);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
