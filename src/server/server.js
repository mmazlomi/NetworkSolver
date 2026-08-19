// Dependency-free static file server for local development. Exists only
// because browsers block `type="module"` imports from file:// URLs -- no
// application logic lives here; the solver runs entirely client-side.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SERVER_DIR = fileURLToPath(new URL('.', import.meta.url));
// Support both project/server.js and project/subdir/server.js layouts.
const PROJECT_ROOT = [SERVER_DIR, resolve(SERVER_DIR, '..')].find((candidate) =>
  existsSync(join(candidate, 'web'))
) || resolve(SERVER_DIR, '..');
const WEB_ROOT = join(PROJECT_ROOT, 'web');
// The browser-side app imports the solver core with a plain relative ES
// module specifier ('../../solver/index.js' from src/web/js/state.js),
// which resolves to a /solver/... URL. The solver lives outside src/web
// on disk (deliberately, so it stays importable by Node too -- see
// docs/research.md), so it needs its own root here alongside WEB_ROOT.
const SOLVER_ROOT = join(PROJECT_ROOT, 'solver');

const requestedPort = Number(process.env.PORT);
const PORT = Number.isInteger(requestedPort) && requestedPort >= 1 && requestedPort <= 65535
  ? requestedPort
  : 4173;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function isInside(root, filePath) {
  const rootPath = resolve(root);
  const file = resolve(filePath);
  const rel = relative(rootPath, file);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${requireSeparator()}`) && !rel.includes('\0'));
}

// Avoid relying on path.sep in the containment check's string boundary.
function requireSeparator() {
  return process.platform === 'win32' ? '\\' : '/';
}

async function resolveFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(new URL(urlPath, 'http://localhost').pathname);
  } catch {
    throw new Error('Invalid URL');
  }

  const isSolver = decoded === '/solver' || decoded.startsWith('/solver/');
  const root = isSolver ? SOLVER_ROOT : WEB_ROOT;
  const relativePath = isSolver ? decoded.slice('/solver'.length) : decoded;
  let filePath = join(root, relativePath === '/' || relativePath === '' ? 'index.html' : relativePath);

  if (!isInside(root, filePath)) throw new Error('Path traversal');

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
    if (!isInside(root, filePath)) throw new Error('Path traversal');
  } catch (error) {
    if (error?.message === 'Path traversal') throw error;
  }
  return filePath;
}

export function createStaticServer() {
  return createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Method Not Allowed');
    }

    try {
      const filePath = await resolveFile(req.url || '/');
      const content = await readFile(filePath);
      const mime = MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': content.byteLength, 'Cache-Control': 'no-cache' });
      return req.method === 'HEAD' ? res.end() : res.end(content);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
  });
}

const invokedFile = process.argv[1] && resolve(process.argv[1]);
if (invokedFile && pathToFileURL(invokedFile).href === import.meta.url) {
  const server = createStaticServer();
  server.on('error', (error) => {
    console.error(`Unable to start the local server on port ${PORT}: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(PORT, () => {
    console.log(`NetworkSolver dev server running at http://localhost:${PORT}`);
  });
}
