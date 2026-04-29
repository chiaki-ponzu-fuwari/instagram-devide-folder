import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(path.join(__dirname, '..', 'www'));
const host = process.env.HOST || '127.0.0.1';
const explicitPort =
  process.env.PORT !== undefined && String(process.env.PORT).trim() !== '';
const startPort = explicitPort ? Number(process.env.PORT) : 8080;
const maxAttempts = explicitPort ? 1 : 30;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function urlToFilePath(urlPathname) {
  const segments = urlPathname.split('/').filter(Boolean).map((seg) => {
    try {
      return decodeURIComponent(seg);
    } catch {
      return seg;
    }
  });
  const joined = path.join(root, ...segments);
  const resolved = path.resolve(joined);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return resolved;
}

function createServer() {
  return http.createServer((req, res) => {
    if (!req.url) {
      res.writeHead(400);
      res.end();
      return;
    }
    const urlPath = new URL(req.url, `http://${host}`).pathname;
    let filePath = urlToFilePath(urlPath === '/' ? '' : urlPath);
    if (urlPath === '/' || urlPath.endsWith('/')) {
      const asDir = urlToFilePath(urlPath === '/' ? '' : urlPath.replace(/\/+$/, ''));
      if (asDir) filePath = path.join(asDir, 'index.html');
    }
    if (!filePath) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const trySend = (p) => {
      fs.stat(p, (err, st) => {
        if (!err && st.isFile()) {
          const ext = path.extname(p);
          res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
          fs.createReadStream(p).pipe(res);
          return;
        }
        if (!err && st.isDirectory()) {
          trySend(path.join(p, 'index.html'));
          return;
        }
        res.writeHead(404);
        res.end('Not found');
      });
    };
    trySend(filePath);
  });
}

function tryListen(port, attemptsLeft) {
  const server = createServer();
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 1) {
      const next = port + 1;
      console.warn(`ポート ${port} は使用中です。${next} を試します…`);
      tryListen(next, attemptsLeft - 1);
      return;
    }
    console.error(err.message);
    if (err.code === 'EADDRINUSE') {
      console.error(`解放する例: lsof -nP -iTCP:${port} -sTCP:LISTEN`);
    }
    process.exit(1);
  });
  server.listen(port, host, () => {
    console.log(`Open http://${host}:${port}/  (serving ${root})`);
  });
}

tryListen(startPort, maxAttempts);
