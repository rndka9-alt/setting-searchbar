import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { PORT, UPSTREAM, CRAWLER_TARGET, LOG_LEVEL } from './config.js';
import { injectScriptTag } from './inject-script-tag.js';
import { crawlSettingsIndex, type CrawlResult } from './crawler.js';
import { initAuth, issueToken } from './auth.js';

const clientJs = fs.readFileSync(
  path.join(import.meta.dirname, 'client.js'),
  'utf-8',
);

function log(level: string, msg: string) {
  if (level === 'debug' && LOG_LEVEL !== 'debug') return;
  console.log(`[setting-searchbar] ${level}: ${msg}`);
}

function proxyRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  transform?: (body: Buffer) => Buffer,
) {
  const options: http.RequestOptions = {
    hostname: UPSTREAM.hostname,
    port: UPSTREAM.port,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: UPSTREAM.host },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    if (!transform) {
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      proxyRes.pipe(res);
      return;
    }

    const chunks: Buffer[] = [];
    proxyRes.on('data', (c) => chunks.push(c));
    proxyRes.on('end', () => {
      const body = transform(Buffer.concat(chunks));
      const headers = { ...proxyRes.headers };
      headers['content-length'] = String(body.length);
      delete headers['content-encoding'];
      res.writeHead(proxyRes.statusCode || 200, headers);
      res.end(body);
    });
  });

  proxyReq.on('error', (err) => {
    log('error', `proxy error: ${err.message}`);
    res.writeHead(502);
    res.end('Bad Gateway');
  });

  req.pipe(proxyReq);
}

let crawlInProgress = false;
let cachedResult: CrawlResult | null = null;
let cachedAt = 0;

const server = http.createServer((req, res) => {
  const url = req.url || '';

  if (url === '/setting-searchbar/build-index' && req.method === 'POST') {
    const risuAuth = req.headers['risu-auth'];
    if (!risuAuth || typeof risuAuth !== 'string') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing risu-auth header' }));
      return;
    }

    const forceCrawl = req.headers['x-ssb-force-crawl'] === 'true';

    // Return cached result if available and not forced
    if (!forceCrawl && cachedResult && cachedResult.entries.length > 0) {
      log('debug', `returning cached index (${cachedResult.entries.length} entries, cached ${Math.round((Date.now() - cachedAt) / 1000)}s ago)`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(cachedResult));
      return;
    }

    if (crawlInProgress) {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Crawl already in progress' }));
      return;
    }
    crawlInProgress = true;
    // 자체 등록 토큰 우선, 없으면 클라이언트 토큰 폴백
    const authForCrawl = issueToken().then((token) => token ?? risuAuth);
    authForCrawl.then((token) => crawlSettingsIndex(CRAWLER_TARGET, token))
      .then((result) => {
        // Don't overwrite good cache with empty results (auth failure etc.)
        if (result.entries.length > 0) {
          cachedResult = result;
          cachedAt = Date.now();
        } else {
          log('info', 'crawl returned 0 entries, keeping previous cache');
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result));
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log('error', `crawl failed: ${msg}`);
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Crawl failed', detail: msg }));
      })
      .finally(() => {
        crawlInProgress = false;
      });
    return;
  }

  if (url === '/setting-searchbar/client.js' && req.method === 'GET') {
    res.writeHead(200, {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-cache',
    });
    res.end(clientJs);
    return;
  }

  if (url === '/setting-searchbar/health' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (url === '/setting-searchbar/index' && req.method === 'GET') {
    const data = {
      entries: cachedResult?.entries ?? [],
      cachedAt,
      age: cachedAt ? Math.round((Date.now() - cachedAt) / 1000) : null,
    };
    res.writeHead(200, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    });
    res.end(JSON.stringify(data));
    return;
  }

  if (url === '/' && req.method === 'GET') {
    proxyRequest(req, res, (body) => {
      const html = body.toString('utf-8');
      return Buffer.from(injectScriptTag(html), 'utf-8');
    });
    return;
  }

  proxyRequest(req, res);
});

server.listen(PORT, () => {
  log('info', `listening on :${PORT}, upstream ${UPSTREAM.href}`);
  initAuth().catch((err) => {
    log('error', `auth init failed: ${err instanceof Error ? err.message : err}`);
  });
});
