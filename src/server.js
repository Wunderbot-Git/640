// Servidor HTTP sin dependencias externas (node:http).
// Sirve la API REST y los archivos estaticos del frontend.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';

import { openDatabase, seedDates } from './db.js';
import * as api from './api.js';
import { HttpError } from './api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

const db = openDatabase(process.env.DB_PATH);
seedDates(db);

/* ------------------------------- Router ------------------------------- */
// Cada ruta: [metodo, patron, handler]. El patron usa :param.

const routes = [
  ['GET', '/api/config', api.getConfig],
  ['GET', '/api/players', api.getPlayers],
  ['POST', '/api/players', api.postPlayer],
  ['GET', '/api/players/:id/profile', api.getPlayerProfile],
  ['PATCH', '/api/players/:id', api.patchPlayer],
  ['DELETE', '/api/players/:id', api.deletePlayerHandler],
  ['GET', '/api/dates', api.getDates],
  ['GET', '/api/dates/:id/detail', api.getDateDetail],
  ['PATCH', '/api/dates/:id', api.patchDate],
  ['PUT', '/api/dates/:id/handicaps', api.putHandicap],
  ['POST', '/api/dates/:id/handicaps/import', api.importHandicaps],
  ['POST', '/api/dates/:id/handicaps/sync', api.syncHandicaps],
  ['POST', '/api/results', api.postResult],
  ['DELETE', '/api/results/:id', api.deleteResultHandler],
  ['GET', '/api/classification', api.getClassification],
  ['GET', '/api/dashboard', api.getDashboard],
];

function matchRoute(method, pathname) {
  for (const [routeMethod, pattern, handler] of routes) {
    if (routeMethod !== method) continue;
    const patternParts = pattern.split('/').filter(Boolean);
    const pathParts = pathname.split('/').filter(Boolean);
    if (patternParts.length !== pathParts.length) continue;
    const params = {};
    let matched = true;
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
      } else if (patternParts[i] !== pathParts[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { handler, params };
  }
  return null;
}

/* --------------------------- Cuerpo JSON ------------------------------ */

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 5 * 1024 * 1024) {
        reject(new HttpError(413, 'Cuerpo demasiado grande.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'JSON invalido.'));
      }
    });
    req.on('error', reject);
  });
}

/* ---------------------------- Estaticos ------------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = normalize(join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Prohibido');
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    // Fallback al index (SPA).
    try {
      const data = await readFile(join(PUBLIC_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'] }).end(data);
    } catch {
      res.writeHead(404).end('No encontrado');
    }
  }
}

/* ------------------------------ Servidor ------------------------------ */

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/')) {
    return serveStatic(pathname, res);
  }

  const route = matchRoute(req.method, pathname);
  if (!route) {
    return sendJson(res, 404, { error: 'Ruta no encontrada.' });
  }

  try {
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    const query = Object.fromEntries(url.searchParams.entries());
    const result = await route.handler({ db, params: route.params, query, body });
    sendJson(res, result.status || 200, result.body);
  } catch (err) {
    if (err instanceof HttpError) {
      sendJson(res, err.status, { error: err.message });
    } else {
      console.error('Error interno:', err);
      sendJson(res, 500, { error: 'Error interno del servidor.' });
    }
  }
});

server.listen(PORT, () => {
  console.log(`FedEx 6:40 escuchando en http://localhost:${PORT}`);
});

export { server, db };
