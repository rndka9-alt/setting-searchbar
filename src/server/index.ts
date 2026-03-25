import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { PORT, UPSTREAM, LOG_LEVEL } from './config.js';
import { injectScriptTag } from './inject-script-tag.js';

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

const server = http.createServer((req, res) => {
  const url = req.url || '';

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
});
