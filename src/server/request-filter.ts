/** Same-origin GET paths that are known to be read-only. */
export const SAFE_API_PREFIXES = [
  '/api/read',
  '/api/list',
  '/api/test_auth',
  '/api/crypto',
  '/sw/init',
  '/sw/check/',
  '/sw/img/',
  '/sw/share/',
];

/** API paths that are safe to POST (authentication flow). */
export const SAFE_POST_PREFIXES = [
  '/api/login',
  '/api/test_auth',
  '/api/crypto',
];

/** Static resource patterns (path-based). */
export const STATIC_PREFIXES = [
  '/assets/',
  '/setting-searchbar/',
  '/db/',
  '/remote-inlay/',
  '/sync/',
  '/.proxy/',         // with-sqlite proxy config
];

/** Static resource extensions. */
export const STATIC_EXTENSIONS = [
  '.js', '.css', '.woff', '.woff2', '.ttf', '.eot',
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
  '.json', '.map',
];

/**
 * Whitelist-based request filter for the Playwright crawler.
 * Returns true only for requests known to be safe (read-only).
 * Unknown requests are blocked by default.
 */
export function isAllowed(method: string, url: string, targetOrigin: string): boolean {
  // Non-GET/HEAD/OPTIONS → block unless it's a safe POST
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    if (method === 'POST') {
      try {
        const pathname = new URL(url).pathname;
        const isSameOrigin = url.startsWith(targetOrigin);
        if (isSameOrigin && SAFE_POST_PREFIXES.some((p) => pathname.startsWith(p))) {
          return true;
        }
      } catch {}
    }
    return false;
  }

  // Parse pathname from URL
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }

  const isSameOrigin = url.startsWith(targetOrigin);

  // Same-origin: check against whitelist
  if (isSameOrigin) {
    // Root HTML
    if (pathname === '/') return true;

    // Safe API endpoints
    if (SAFE_API_PREFIXES.some((p) => pathname.startsWith(p))) return true;

    // Static resources by prefix
    if (STATIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;

    // Static resources by extension
    if (STATIC_EXTENSIONS.some((ext) => pathname.endsWith(ext))) return true;

    // Everything else (including /api/remove!) → block
    return false;
  }

  // Cross-origin: allow static resources (CDN, fonts, etc.)
  if (STATIC_EXTENSIONS.some((ext) => pathname.endsWith(ext))) return true;

  // Allow known font/CDN domains
  try {
    const host = new URL(url).hostname;
    if (host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com') return true;
  } catch {}

  // Block unknown cross-origin requests
  return false;
}
