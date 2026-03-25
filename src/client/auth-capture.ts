/**
 * Lightweight fetch interceptor that captures the risu-auth token
 * from outgoing requests. Does not modify any requests.
 */

const TAG = '[ssb:auth]';

let captured: string | null = null;

export function getCapturedAuth(): string | null {
  return captured;
}

function extractRisuAuth(headers: HeadersInit | undefined): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get('risu-auth');
  if (Array.isArray(headers)) {
    for (const pair of headers) {
      if (pair[0].toLowerCase() === 'risu-auth') return pair[1];
    }
    return null;
  }
  // Record<string, string>
  return headers['risu-auth'] ?? null;
}

export function installAuthCapture(): void {
  const original = window.fetch;
  window.fetch = function (input, init) {
    const auth = extractRisuAuth(init?.headers);
    if (auth && auth !== captured) {
      captured = auth;
      console.debug(`${TAG} captured risu-auth token`);
    }
    return original.call(window, input, init);
  };
  console.debug(`${TAG} auth capture installed`);
}
