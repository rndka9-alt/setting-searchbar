import { describe, it, expect } from 'vitest';
import { isAllowed } from './request-filter';

const ORIGIN = 'http://caddy:8082';
const url = (path: string) => `${ORIGIN}${path}`;
const ext = (u: string) => `https://cdn.example.com${u}`;

describe('isAllowed', () => {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // HTTP method blocking
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('HTTP methods', () => {
    it('blocks POST regardless of URL', () => {
      expect(isAllowed('POST', url('/api/read'), ORIGIN)).toBe(false);
      expect(isAllowed('POST', url('/'), ORIGIN)).toBe(false);
      expect(isAllowed('POST', url('/assets/index.js'), ORIGIN)).toBe(false);
    });

    it('blocks PUT', () => {
      expect(isAllowed('PUT', url('/api/read'), ORIGIN)).toBe(false);
    });

    it('blocks DELETE', () => {
      expect(isAllowed('DELETE', url('/api/list'), ORIGIN)).toBe(false);
    });

    it('blocks PATCH', () => {
      expect(isAllowed('PATCH', url('/api/read'), ORIGIN)).toBe(false);
    });

    it('allows GET', () => {
      expect(isAllowed('GET', url('/api/read'), ORIGIN)).toBe(true);
    });

    it('allows HEAD', () => {
      expect(isAllowed('HEAD', url('/api/read'), ORIGIN)).toBe(true);
    });

    it('allows OPTIONS', () => {
      expect(isAllowed('OPTIONS', url('/api/read'), ORIGIN)).toBe(true);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // DANGEROUS endpoints — THE CRITICAL TESTS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('dangerous endpoints (MUST block)', () => {
    it('blocks GET /api/remove — the destructive GET!', () => {
      expect(isAllowed('GET', url('/api/remove'), ORIGIN)).toBe(false);
    });

    it('blocks GET /api/remove with file-path query', () => {
      expect(isAllowed('GET', url('/api/remove?file=abc'), ORIGIN)).toBe(false);
    });

    it('blocks POST /api/write', () => {
      expect(isAllowed('POST', url('/api/write'), ORIGIN)).toBe(false);
    });

    it('blocks POST /api/set_password', () => {
      expect(isAllowed('POST', url('/api/set_password'), ORIGIN)).toBe(false);
    });

    it('allows POST /api/login (auth flow)', () => {
      expect(isAllowed('POST', url('/api/login'), ORIGIN)).toBe(true);
    });

    it('blocks POST /api/account/write', () => {
      expect(isAllowed('POST', url('/api/account/write'), ORIGIN)).toBe(false);
    });

    it('blocks POST /proxy2', () => {
      expect(isAllowed('POST', url('/proxy2'), ORIGIN)).toBe(false);
    });

    it('blocks POST /hub/realm/upload', () => {
      expect(isAllowed('POST', url('/hub/realm/upload'), ORIGIN)).toBe(false);
    });

    it('blocks POST /hub/remove', () => {
      expect(isAllowed('POST', url('/hub/remove'), ORIGIN)).toBe(false);
    });

    it('blocks POST /sw/register', () => {
      expect(isAllowed('POST', url('/sw/register/abc'), ORIGIN)).toBe(false);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // External API endpoints — MUST block
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('external API calls (MUST block)', () => {
    it('blocks OpenAI chat completions', () => {
      expect(isAllowed('POST', 'https://api.openai.com/v1/chat/completions', ORIGIN)).toBe(false);
    });

    it('blocks Anthropic messages', () => {
      expect(isAllowed('POST', 'https://api.anthropic.com/v1/messages', ORIGIN)).toBe(false);
    });

    it('blocks Google Gemini', () => {
      expect(isAllowed('POST', 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent', ORIGIN)).toBe(false);
    });

    it('blocks OpenAI image generation', () => {
      expect(isAllowed('POST', 'https://api.openai.com/v1/images/generations', ORIGIN)).toBe(false);
    });

    it('blocks OpenAI TTS', () => {
      expect(isAllowed('POST', 'https://api.openai.com/v1/audio/speech', ORIGIN)).toBe(false);
    });

    it('blocks OpenAI embeddings', () => {
      expect(isAllowed('POST', 'https://api.openai.com/v1/embeddings', ORIGIN)).toBe(false);
    });

    it('blocks unknown external GET (no static extension)', () => {
      expect(isAllowed('GET', 'https://api.openai.com/v1/models', ORIGIN)).toBe(false);
    });

    it('blocks cross-origin API-like GET', () => {
      expect(isAllowed('GET', 'https://sv.risuai.xyz/some-endpoint', ORIGIN)).toBe(false);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Safe same-origin endpoints — should allow
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('safe same-origin API endpoints', () => {
    it('allows GET /api/read', () => {
      expect(isAllowed('GET', url('/api/read'), ORIGIN)).toBe(true);
    });

    it('allows GET /api/list', () => {
      expect(isAllowed('GET', url('/api/list'), ORIGIN)).toBe(true);
    });

    it('allows GET /api/test_auth', () => {
      expect(isAllowed('GET', url('/api/test_auth'), ORIGIN)).toBe(true);
    });

    it('allows GET /api/crypto', () => {
      expect(isAllowed('GET', url('/api/crypto'), ORIGIN)).toBe(true);
    });

    it('allows root HTML GET /', () => {
      expect(isAllowed('GET', url('/'), ORIGIN)).toBe(true);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Service worker endpoints
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('service worker endpoints', () => {
    it('allows GET /sw/init', () => {
      expect(isAllowed('GET', url('/sw/init'), ORIGIN)).toBe(true);
    });

    it('allows GET /sw/check/encoded', () => {
      expect(isAllowed('GET', url('/sw/check/abc123'), ORIGIN)).toBe(true);
    });

    it('allows GET /sw/img/encoded', () => {
      expect(isAllowed('GET', url('/sw/img/abc123'), ORIGIN)).toBe(true);
    });

    it('allows GET /sw/share/character', () => {
      expect(isAllowed('GET', url('/sw/share/character'), ORIGIN)).toBe(true);
    });

    it('blocks POST /sw/register (cache mutation)', () => {
      expect(isAllowed('POST', url('/sw/register/abc'), ORIGIN)).toBe(false);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Static resources
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('static resources', () => {
    it('allows GET /assets/index-abc.js', () => {
      expect(isAllowed('GET', url('/assets/index-abc123.js'), ORIGIN)).toBe(true);
    });

    it('allows GET /assets/style.css', () => {
      expect(isAllowed('GET', url('/assets/style.css'), ORIGIN)).toBe(true);
    });

    it('allows GET /db/client.js', () => {
      expect(isAllowed('GET', url('/db/client.js'), ORIGIN)).toBe(true);
    });

    it('allows GET /remote-inlay/client.js', () => {
      expect(isAllowed('GET', url('/remote-inlay/client.js'), ORIGIN)).toBe(true);
    });

    it('allows GET /sync/client.js', () => {
      expect(isAllowed('GET', url('/sync/client.js?v=abc'), ORIGIN)).toBe(true);
    });

    it('allows cross-origin static .js', () => {
      expect(isAllowed('GET', ext('/bundle.js'), ORIGIN)).toBe(true);
    });

    it('allows cross-origin static .css', () => {
      expect(isAllowed('GET', ext('/style.css'), ORIGIN)).toBe(true);
    });

    it('allows cross-origin font .woff2', () => {
      expect(isAllowed('GET', ext('/font.woff2'), ORIGIN)).toBe(true);
    });

    it('allows cross-origin .svg', () => {
      expect(isAllowed('GET', ext('/icon.svg'), ORIGIN)).toBe(true);
    });

    it('allows cross-origin .png', () => {
      expect(isAllowed('GET', ext('/image.png'), ORIGIN)).toBe(true);
    });

    it('allows GET /.proxy/config (with-sqlite)', () => {
      expect(isAllowed('GET', url('/.proxy/config'), ORIGIN)).toBe(true);
    });

    it('allows Google Fonts CSS', () => {
      expect(isAllowed('GET', 'https://fonts.googleapis.com/css2?family=Tilt+Prism&display=swap', ORIGIN)).toBe(true);
    });

    it('allows Google Fonts static files', () => {
      expect(isAllowed('GET', 'https://fonts.gstatic.com/s/something/v1/font.woff2', ORIGIN)).toBe(true);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Unknown / edge cases — should block
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('unknown and edge cases', () => {
    it('blocks unknown same-origin GET path', () => {
      expect(isAllowed('GET', url('/api/unknown-endpoint'), ORIGIN)).toBe(false);
    });

    it('blocks GET /api/write (even as GET, not in whitelist)', () => {
      expect(isAllowed('GET', url('/api/write'), ORIGIN)).toBe(false);
    });

    it('blocks malformed URL', () => {
      expect(isAllowed('GET', 'not-a-url', ORIGIN)).toBe(false);
    });

    it('blocks empty URL', () => {
      expect(isAllowed('GET', '', ORIGIN)).toBe(false);
    });

    it('blocks same-origin path traversal attempt', () => {
      expect(isAllowed('GET', url('/../etc/passwd'), ORIGIN)).toBe(false);
    });

    it('blocks same-origin /api/remove disguised with extra path', () => {
      expect(isAllowed('GET', url('/api/remove/something'), ORIGIN)).toBe(false);
    });

    it('blocks cross-origin non-static GET', () => {
      expect(isAllowed('GET', 'https://evil.com/steal-data', ORIGIN)).toBe(false);
    });

    it('blocks cross-origin with api-like path', () => {
      expect(isAllowed('GET', 'https://evil.com/api/read', ORIGIN)).toBe(false);
    });

    it('origin mismatch: different port is cross-origin', () => {
      // caddy:8082 vs caddy:6001 → should NOT match same-origin rules
      expect(isAllowed('GET', 'http://caddy:6001/api/remove', ORIGIN)).toBe(false);
    });
  });
});
