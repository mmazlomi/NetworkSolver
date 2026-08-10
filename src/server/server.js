// Dependency-free static file server for local development. Exists only
// because browsers block `type="module"` imports from file:// URLs -- no
// application logic lives here; the solver runs entirely client-side.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const WEB_ROOT = join(__dirname, '..', 'web');
// The browser-side app imports the solver core with a plain relative ES
// module specifier ('../../solver/index.js' from src/web/js/state.js),
// which resolves to a /solver/... URL. The solver lives outside src/web
// on disk (deliberately, so it stays importable by Node too -- see
// docs/research.md), so it needs its own root here alongside WEB_ROOT.
const SOLVER_ROOT = join(__dirname, '..', 'solver');
const PORT = process.env.PORT ? Number(process.env.PORT) : 4173;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const safePath = normalize(decoded).replace(/^(\.\.[/\\])+/, '');

  let root = WEB_ROOT;
  let relative = safePath;
  if (safePath === '/solver' || safePath.startsWith('/solver/')) {
    root = SOLVER_ROOT;
    relative = safePath.slice('/solver'.length) || '/';
  }

  let filePath = join(root, relative === '/' ? 'index.html' : relative);
  if (!filePath.startsWith(root)) filePath = join(WEB_ROOT, 'index.html');

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    // fall through to 404 below
  }
  return filePath;
}

export function createStaticServer() {
  return createServer(async (req, res) => {
    try {
      const filePath = await resolveFile(req.url || '/');
      const content = await readFile(filePath);
      const mime = MIME_TYPES[extname(filePath)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
      res.end(content);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createStaticServer();
  server.listen(PORT, () => {
    console.log(`NetworkSolver dev server running at http://localhost:${PORT}`);
  });
}
