// "Production build" for a bundler-free app: there is no compile step (the
// browser loads the ES modules directly), so building means producing a
// clean, self-contained dist/ copy of the solver + web assets, and
// verifying every relative import in src/web actually resolves. Run before
// deploying dist/ behind any static file host.
import { cp, rm, mkdir, readFile, readdir } from 'node:fs/promises';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = join(ROOT, 'dist');

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (extname(entry.name) === '.js') files.push(full);
  }
  return files;
}

async function verifyImports(files) {
  const problems = [];
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const importRe = /from\s+['"](\.[^'"]+)['"]/g;
    let match;
    while ((match = importRe.exec(content))) {
      const target = resolve(dirname(file), match[1]);
      try {
        await readFile(target);
      } catch {
        problems.push(`${file}: cannot resolve import "${match[1]}"`);
      }
    }
  }
  return problems;
}

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  await cp(join(ROOT, 'src', 'web'), join(DIST, 'web'), { recursive: true });
  await cp(join(ROOT, 'src', 'solver'), join(DIST, 'solver'), { recursive: true });
  await cp(join(ROOT, 'src', 'server'), join(DIST, 'server'), { recursive: true });
  // The browser imports the solver via a relative specifier that resolves
  // to a /solver/... URL (see src/server/server.js's SOLVER_ROOT comment).
  // Nesting a copy inside dist/web makes dist/web deployable as-is to any
  // plain static host, with no custom server required.
  await cp(join(ROOT, 'src', 'solver'), join(DIST, 'web', 'solver'), { recursive: true });

  const jsFiles = [...(await walk(join(DIST, 'web'))), ...(await walk(join(DIST, 'solver')))];
  const problems = await verifyImports(jsFiles);

  console.log(`Build output: ${DIST}`);
  console.log(`Copied ${jsFiles.length} JS files (plus HTML/CSS assets).`);
  if (problems.length) {
    console.error('Import resolution problems found:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log('All relative imports resolved successfully. Build OK.');
  }
}

main();
