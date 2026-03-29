export const PORT = Number(process.env['PORT'] || 3004);
export const UPSTREAM = new URL(process.env['UPSTREAM'] || 'http://localhost:6001');
export const LOG_LEVEL = process.env['LOG_LEVEL'] || 'info';
export const RISUAI_SAVE_MOUNT = process.env['RISUAI_SAVE_MOUNT'] || '/risuai-save';

/** Where Playwright navigates. Defaults to localhost (self-proxy) which is
 *  always a secure context — no certificates or special flags needed.
 *  crypto.subtle, IndexedDB, etc. all work on localhost. */
export const CRAWLER_TARGET = new URL(
  process.env['CRAWLER_TARGET'] || `http://localhost:${PORT}`,
);
