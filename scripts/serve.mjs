#!/usr/bin/env node
// Petit serveur de fichiers statiques, sans dépendance, pour essayer l'appli en local
// et pour les tests de navigateur.   Usage : node scripts/serve.mjs [port]   (défaut : 8080)
//
// L'appli n'a besoin d'aucun serveur « intelligent » : tout fichier statique convient
// (GitHub Pages, Netlify, un dossier partagé sur le réseau local…).
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.gz': 'application/gzip', // modèle OCR : renvoyé tel quel, sans Content-Encoding
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/**
 * @param {{port?: number, root?: string, headers?: Record<string,string>, log?: boolean}} [opts]
 * @returns {Promise<{url: string, port: number, close: () => Promise<void>}>}
 */
export function startServer({ port = 0, root = ROOT, headers = {}, log = false } = {}) {
  const base = resolve(root);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = resolve(join(base, rel));
      const inside = file === base || file.startsWith(base + sep);
      const hidden = rel.split('/').some((seg) => seg.startsWith('.') && seg.length > 1) || rel.startsWith('/node_modules/');
      if (!inside || hidden || (req.method !== 'GET' && req.method !== 'HEAD')) {
        res.writeHead(inside && !hidden ? 405 : 403).end('Interdit');
        return;
      }
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Introuvable');
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': body.length,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        ...headers,
      });
      res.end(req.method === 'HEAD' ? undefined : body);
      if (log) console.log(req.method, rel);
    } catch (e) {
      res.writeHead(500).end(String(e?.message || e));
    }
  });
  return new Promise((resolveStart, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const p = server.address().port;
      resolveStart({
        url: `http://127.0.0.1:${p}`,
        port: p,
        close: () => new Promise((r) => (server.closeAllConnections?.(), server.close(() => r()))),
      });
    });
  });
}

// Lancement direct : « node scripts/serve.mjs 8080 »
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]) || 8080;
  const s = await startServer({ port, log: process.argv.includes('--log') }).catch((e) => {
    console.error(e.code === 'EADDRINUSE' ? `Le port ${port} est déjà utilisé : essaie « node scripts/serve.mjs ${port + 1} ».` : e.message);
    process.exit(1);
  });
  console.log(`Carnet Libre : ${s.url}\n(Ctrl+C pour arrêter)`);
}
