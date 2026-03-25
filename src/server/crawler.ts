import { chromium, type Browser, type Page, type Route } from 'playwright';
import { isAllowed } from './request-filter.js';

const TAG = '[ssb:crawler]';
const CRAWL_TIMEOUT_MS = 60_000;
const RENDER_WAIT_MS = 200;
const MAX_DIALOG_DISMISS_ATTEMPTS = 10;
const DIALOG_DISMISS_WAIT_MS = 500;
const DIALOG_BUTTON_TEXTS = ['NO', 'OK', 'CANCEL', 'CLOSE', '닫기', '아니오', '취소', '확인'];
const POST_PRELOAD_WAIT_MS = 3000;

interface IndexEntry {
  displayText: string;
  searchText: string;
  menuButtonIdx: number;
  menuLabel: string;
  subIdx: number;
  subLabel: string;
  accordionPath: string[];
}

// ─── Browser pool (reuse across crawls) ───

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }
  console.log(`${TAG} launching headless Chromium`);
  browserInstance = await chromium.launch({ headless: true });
  return browserInstance;
}

// ─── Network interception (whitelist from request-filter.ts) ───

interface RequestLog {
  method: string;
  url: string;
  action: 'allowed' | 'blocked';
  timestamp: number;
}

function setupRouteInterception(
  page: Page,
  risuAuth: string,
  targetOrigin: string,
  requestLog: RequestLog[],
) {
  return page.route('**/*', async (route: Route) => {
    const req = route.request();
    const method = req.method();
    const url = req.url();

    if (isAllowed(method, url, targetOrigin)) {
      requestLog.push({ method, url, action: 'allowed', timestamp: Date.now() });

      // Inject auth header for same-origin API requests
      if (url.startsWith(targetOrigin) && url.includes('/api/')) {
        const headers = { ...req.headers(), 'risu-auth': risuAuth };
        await route.continue({ headers });
      } else {
        await route.continue();
      }
    } else {
      requestLog.push({ method, url, action: 'blocked', timestamp: Date.now() });
      console.debug(`${TAG} blocked: ${method} ${url.slice(0, 100)}`);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    }
  });
}

// ─── Pre-interaction: dismiss dialogs, open sidebar ───

async function dismissDialogsAndOpenSidebar(page: Page): Promise<void> {
  // Dismiss any confirmation dialogs (e.g., plugin permission prompts)
  // Keep dismissing until no more dialogs appear
  const dialogTexts = DIALOG_BUTTON_TEXTS;
  for (let i = 0; i < MAX_DIALOG_DISMISS_ATTEMPTS; i++) {
    const dismissed = await page.evaluate((texts: string[]) => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent?.trim().toUpperCase();
        if (text && texts.includes(text)) {
          btn.click();
          return text;
        }
      }
      return null;
    }, dialogTexts);
    if (dismissed) {
      console.log(`${TAG} dismissed dialog button: "${dismissed}"`);
      await page.waitForTimeout(DIALOG_DISMISS_WAIT_MS);
    } else {
      break;
    }
  }

  // Open sidebar if collapsed — click the top-left toggle button.
  // First, click the page body to ensure focus
  await page.click('body');
  await page.waitForTimeout(200);

  // Strategy 1: find a small button containing an SVG (arrow icon) in the top-left area
  // Strategy 2 (fallback): positional heuristic for buttons near the top-left corner
  const sidebarToggle = await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');

    // Prefer a button with an SVG child near the top-left
    for (const btn of buttons) {
      if (!btn.querySelector('svg')) continue;
      const rect = btn.getBoundingClientRect();
      if (rect.left < 80 && rect.top < 80 && rect.width < 60 && rect.height < 60) {
        btn.click();
        return `svg-button: ${rect.left},${rect.top} ${rect.width}x${rect.height}`;
      }
    }

    // Fallback: any small button in top-left corner
    for (const btn of buttons) {
      const rect = btn.getBoundingClientRect();
      if (rect.left < 60 && rect.top < 60 && rect.width < 50) {
        btn.click();
        return `positional-fallback: ${rect.left},${rect.top} ${rect.width}x${rect.height}`;
      }
    }

    return null;
  });
  if (sidebarToggle) {
    console.log(`${TAG} sidebar toggle: ${sidebarToggle}`);
    await page.waitForTimeout(1000);
  }
}

// ─── Settings page interaction ───

async function openSettings(page: Page): Promise<boolean> {
  // First, clear any blocking dialogs and ensure sidebar is visible
  await dismissDialogsAndOpenSidebar(page);

  // Diagnostic: screenshot after dialog dismissal
  const buttonCount = await page.evaluate(() => document.querySelectorAll('button').length);
  const bodySnippet = await page.evaluate(() => document.body?.innerText?.slice(0, 300) || '(empty)');
  console.log(`${TAG} after dialog dismissal: buttons=${buttonCount}`);
  console.log(`${TAG} body: ${bodySnippet.slice(0, 200)}`);
  try {
    const debugPath = process.env.SSB_DEBUG_DIR || '/tmp';
    await page.screenshot({ path: `${debugPath}/ssb-crawl-debug.png`, fullPage: true });
    console.log(`${TAG} screenshot saved to ${debugPath}/ssb-crawl-debug.png`);
  } catch {}

  // Use Ctrl+S keyboard shortcut (RisuAI default hotkey for settings)
  await page.keyboard.press('Control+s');
  try {
    await page.waitForSelector('.rs-setting-cont-3', { timeout: 5000 });
    console.log(`${TAG} settings opened via Ctrl+S`);
    return true;
  } catch {
    // Fallback: find button by text
    console.log(`${TAG} Ctrl+S didn't work, trying button click`);
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await btn.textContent();
      const lower = (text || '').toLowerCase();
      if (lower.includes('setting') || lower.includes('설정') || lower.includes('設定')) {
        await btn.click();
        try {
          await page.waitForSelector('.rs-setting-cont-3', { timeout: 5000 });
          console.log(`${TAG} settings opened via button click`);
          return true;
        } catch {
          continue;
        }
      }
    }
    console.warn(`${TAG} could not open settings`);
    return false;
  }
}

// ─── DOM crawling (runs inside the browser page) ───

async function crawlAllTabs(page: Page): Promise<IndexEntry[]> {
  // Run the crawl logic inside the browser context
  return page.evaluate(async (renderWait: number) => {
    function wait(ms: number): Promise<void> {
      return new Promise((r) => setTimeout(r, ms));
    }

    function getMenuButtons(sidebar: Element): HTMLButtonElement[] {
      const all = sidebar.querySelectorAll<HTMLButtonElement>('button');
      return [...all].filter((b) => {
        const span = b.querySelector('span');
        return span && span.textContent?.trim();
      });
    }

    function getSubmenuButtons(root: Element): HTMLButtonElement[] {
      const container = root.querySelector(
        '.flex.rounded-md.border.border-darkborderc',
      );
      if (!container) return [];
      return [...container.querySelectorAll<HTMLButtonElement>('button')];
    }

    /**
     * Expand all closed accordions in the content area.
     * Accordion buttons are identified by `hover:bg-selected` + `text-lg` classes.
     * Handles nested accordions by iterating up to `maxDepth` times.
     */
    async function expandAccordions(contentWrapper: Element, renderWait: number, maxDepth = 3): Promise<void> {
      for (let depth = 0; depth < maxDepth; depth++) {
        const buttons = contentWrapper.querySelectorAll<HTMLButtonElement>('button');
        const closedAccordions = [...buttons].filter((btn) => {
          // Skip submenu tab buttons
          if (btn.closest('.flex.rounded-md.border.border-darkborderc')) return false;
          // Skip sidebar buttons
          if (btn.closest('.rs-setting-cont-3')) return false;
          // Accordion buttons have these Tailwind classes
          const cls = btn.className;
          return cls.includes('hover:bg-selected') && cls.includes('text-lg') && !btn.classList.contains('bg-selected');
        });

        if (closedAccordions.length === 0) break;

        // Batch: click all closed accordions at once, then wait once.
        // Svelte batches DOM updates within the same synchronous block.
        for (const accBtn of closedAccordions) {
          accBtn.click();
        }
        await wait(renderWait);
      }
    }

    /** Walk up from an element to find parent accordion button names. */
    function getAccordionPath(el: Element, contentRoot: Element): string[] {
      const path: string[] = [];
      let current = el.parentElement;
      while (current && current !== contentRoot) {
        const prev = current.previousElementSibling;
        if (prev && prev.tagName === 'BUTTON') {
          const cls = prev.className;
          if (cls.includes('hover:bg-selected') && cls.includes('text-lg')) {
            const name = prev.textContent?.trim() || '';
            if (name) path.unshift(name);
          }
        }
        current = current.parentElement;
      }
      return path;
    }

    function collectLabels(root: Element): { display: string; search: string; accordionPath: string[] }[] {
      const results: { display: string; search: string; accordionPath: string[] }[] = [];
      const seen = new Set<string>();

      // Collect accordion button names as indexable entries.
      // Their accordionPath contains only PARENT accordions (not themselves),
      // so the navigator opens parents then highlights the accordion button.
      root.querySelectorAll('button').forEach((btn) => {
        const cls = btn.className;
        if (!cls.includes('hover:bg-selected') || !cls.includes('text-lg')) return;
        // Skip submenu tab buttons
        if (btn.closest('.flex.rounded-md.border.border-darkborderc')) return;
        const text = btn.textContent?.trim();
        if (!text || text.length < 2 || seen.has(text)) return;
        seen.add(text);
        // Parent accordion path (excludes self)
        const parentPath = getAccordionPath(btn, root);
        results.push({ display: text, search: text, accordionPath: parentPath });
      });

      // Collect general action buttons (non-accordion, non-submenu).
      // Blacklist filters out generic UI actions that add noise.
      const BUTTON_BLACKLIST = new Set([
        // Korean
        '삭제', '제거', '지우기', '초기화', '리셋',
        '저장', '적용', '확인', '취소', '닫기',
        '추가', '생성', '만들기', '새로 만들기',
        '편집', '수정', '변경',
        '복사', '붙여넣기', '복제',
        '로그인', '로그아웃', '가입',
        '위로', '아래로', '이전', '다음',
        '예', '아니오', '네',
        '접기', '펼치기', '더보기', '전체보기',
        // English
        'delete', 'remove', 'clear', 'reset',
        'save', 'apply', 'ok', 'confirm', 'cancel', 'close', 'done',
        'add', 'create', 'new',
        'edit', 'modify', 'change', 'update',
        'copy', 'paste', 'duplicate',
        'login', 'logout', 'log in', 'log out', 'sign in', 'sign out',
        'up', 'down', 'prev', 'next', 'back',
        'yes', 'no',
        'collapse', 'expand', 'more', 'show more', 'show all',
        'export', 'import',
        'submit', 'send', 'upload', 'download',
        'select', 'browse', 'open',
        'undo', 'redo', 'retry',
      ]);

      root.querySelectorAll('button').forEach((btn) => {
        // Skip accordion buttons (already collected above)
        const cls = btn.className;
        if (cls.includes('hover:bg-selected') && cls.includes('text-lg')) return;
        // Skip submenu tab buttons
        if (btn.closest('.flex.rounded-md.border.border-darkborderc')) return;

        const text = btn.textContent?.trim();
        if (!text || text.length < 2 || seen.has(text)) return;
        // Skip icon-only buttons (SVG with little/no text)
        if (btn.querySelector('svg') && text.length < 5) return;
        // Blacklist check (case-insensitive)
        if (BUTTON_BLACKLIST.has(text.toLowerCase())) return;

        seen.add(text);
        results.push({ display: text, search: text, accordionPath: getAccordionPath(btn, root) });
      });

      root.querySelectorAll('h2, h3').forEach((h) => {
        const text = h.textContent?.trim();
        if (text && text.length >= 2 && !seen.has(text)) {
          seen.add(text);
          results.push({ display: text, search: text, accordionPath: getAccordionPath(h, root) });
        }
      });

      root
        .querySelectorAll('span.text-textcolor, label, [class*="text-textcolor"]')
        .forEach((el) => {
          if (el.closest('button')) return;
          if (el.closest('.flex.rounded-md.border.border-darkborderc')) return;
          const display = el.textContent?.trim();
          if (!display || display.length < 2 || display.length > 120) return;
          if (seen.has(display)) return;
          seen.add(display);
          const parent = el.parentElement;
          const search = parent?.textContent?.trim() || display;
          results.push({ display, search, accordionPath: getAccordionPath(el, root) });
        });

      return results;
    }

    // ─── Main crawl loop ───

    const sidebar = document.querySelector('.rs-setting-cont-3');
    if (!sidebar) return [];

    const menuButtons = getMenuButtons(sidebar);
    if (menuButtons.length === 0) return [];

    const menuLabels = menuButtons.map((b) => b.querySelector('span')?.textContent?.trim() || '(no span)');
    console.log(`[ssb:crawl] sidebar buttons (${menuButtons.length}): ${menuLabels.join(', ')}`);

    // Click first button to ensure content area exists
    menuButtons[0].click();
    await wait(renderWait);

    let contentWrapper = document.querySelector('.rs-setting-cont-4');
    if (!contentWrapper) return [];

    const entries: IndexEntry[] = [];

    for (let mi = 0; mi < menuButtons.length; mi++) {
      const btn = menuButtons[mi];
      const menuLabel = btn.querySelector('span')?.textContent?.trim() || '';

      btn.click();
      await wait(renderWait);

      // Check if settings is still alive
      if (!document.querySelector('.rs-setting-cont-3')) break;

      contentWrapper = document.querySelector('.rs-setting-cont-4');
      if (!contentWrapper) continue;

      const subButtons = getSubmenuButtons(contentWrapper);
      let tabEntryCount = 0;

      if (subButtons.length > 0) {
        const subLabels = subButtons.map((b) => b.textContent?.trim() || '');
        console.log(`[ssb:crawl]   [${mi}] "${menuLabel}" — subtabs: ${subLabels.join(', ')}`);

        for (let si = 0; si < subButtons.length; si++) {
          subButtons[si].click();
          await wait(renderWait);

          contentWrapper = document.querySelector('.rs-setting-cont-4');
          if (!contentWrapper) break;

          // Expand all accordions so their content is in the DOM
          await expandAccordions(contentWrapper, renderWait);

          const subLabel = subButtons[si].textContent?.trim() || '';
          const labels = collectLabels(contentWrapper);
          for (const l of labels) {
            entries.push({
              displayText: l.display,
              searchText: l.search,
              menuButtonIdx: mi,
              menuLabel,
              subIdx: si,
              subLabel,
              accordionPath: l.accordionPath,
            });
          }
          tabEntryCount += labels.length;
          console.log(`[ssb:crawl]     [${mi}.${si}] "${subLabel}" → ${labels.length} entries`);
        }
      } else {
        console.log(`[ssb:crawl]   [${mi}] "${menuLabel}" — no subtabs`);

        // Expand all accordions so their content is in the DOM
        await expandAccordions(contentWrapper, renderWait);

        const labels = collectLabels(contentWrapper);
        for (const l of labels) {
          entries.push({
            displayText: l.display,
            searchText: l.search,
            menuButtonIdx: mi,
            menuLabel,
            subIdx: -1,
            subLabel: '',
            accordionPath: l.accordionPath,
          });
        }
        tabEntryCount = labels.length;
        console.log(`[ssb:crawl]     → ${labels.length} entries`);

        // Dump DOM snapshot for tabs with few entries (diagnostic)
        if (labels.length <= 1) {
          const snapshot = contentWrapper.innerHTML.slice(0, 2000);
          console.log(`[ssb:crawl]     DOM snapshot (${menuLabel}): ${snapshot}`);
        }
      }
    }

    return entries;
  }, RENDER_WAIT_MS);
}

// ─── Public API ───

export interface CrawlResult {
  entries: IndexEntry[];
  requestLog: RequestLog[];
}

export async function crawlSettingsIndex(
  crawlerTarget: URL,
  risuAuth: string,
): Promise<CrawlResult> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
  });
  const page = await context.newPage();
  const requestLog: RequestLog[] = [];

  // Set a hard timeout for the entire operation
  const timeoutId = setTimeout(() => {
    console.warn(`${TAG} crawl timed out after ${CRAWL_TIMEOUT_MS}ms`);
    context.close().catch(() => {});
  }, CRAWL_TIMEOUT_MS);

  try {
    // Forward browser console to server logs for diagnostics
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.startsWith('[ssb:crawl]')) {
        console.log(`${TAG} browser: ${text}`);
      }
    });

    const targetOrigin = crawlerTarget.origin;
    await setupRouteInterception(page, risuAuth, targetOrigin, requestLog);

    console.log(`${TAG} navigating to ${crawlerTarget.href}`);
    await page.goto(crawlerTarget.href, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // Wait for app to finish loading
    console.log(`${TAG} waiting for app initialization`);
    await page.waitForSelector('#preloading', { state: 'hidden', timeout: 30_000 }).catch(() => {
      console.warn(`${TAG} preloading indicator didn't disappear, continuing anyway`);
    });
    await page.waitForTimeout(POST_PRELOAD_WAIT_MS);

    // Open settings (handles dialogs + sidebar internally)
    const opened = await openSettings(page);
    if (!opened) {
      console.warn(`${TAG} could not open settings, returning empty index`);
      return { entries: [], requestLog };
    }

    // Crawl all tabs
    console.log(`${TAG} crawling settings tabs`);
    const entries = await crawlAllTabs(page);

    // Log summary
    const allowed = requestLog.filter((r) => r.action === 'allowed').length;
    const blocked = requestLog.filter((r) => r.action === 'blocked').length;
    console.log(`${TAG} crawl complete: ${entries.length} entries, ${allowed} requests allowed, ${blocked} blocked`);

    return { entries, requestLog };
  } finally {
    clearTimeout(timeoutId);
    await context.close();
  }
}
