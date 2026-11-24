// Copies the runtime files of the mesh CLI into the distributable skill (skills/agent-mesh/tools/mesh).
// dev/ stays the source of truth; `npx skills add` only installs files inside the skill folder
// (symlinks pointing outside it are skipped: SKILLS_SYMLINK_OUTSIDE_SKILL), so the copy is committed.
//   node scripts/sync-skill.ts          write the copy
//   node scripts/sync-skill.ts --check  exit 1 if the copy is stale
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DEV = resolve(import.meta.dirname, '..');
const OUT = resolve(DEV, '../skills/agent-mesh/tools/mesh');
const pkg = JSON.parse(readFileSync(join(DEV, 'package.json'), 'utf8'));

/** published path -> content. Only what `mesh` needs at runtime: no tests, no dev dependencies. */
function expected(): Map<string, string> {
  const files = new Map<string, string>();
  files.set('bin/mesh', readFileSync(join(DEV, 'bin/mesh'), 'utf8'));
  for (const f of readdirSync(join(DEV, 'src')).filter((f) => f.endsWith('.ts')).sort()) {
    files.set(`src/${f}`, readFileSync(join(DEV, 'src', f), 'utf8'));
  }
  // "type": "module" makes Node treat src/*.ts as ESM; no dependencies are needed at runtime
  files.set('package.json', JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: 'module', engines: pkg.engines }, null, 2) + '\n');
  return files;
}

function listOut(dir = OUT, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listOut(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]);
}

const want = expected();
if (process.argv.includes('--check')) {
  const stale = [...want].filter(([p, c]) => !existsSync(join(OUT, p)) || readFileSync(join(OUT, p), 'utf8') !== c).map(([p]) => p);
  const extra = listOut().filter((p) => !want.has(p));
  if (stale.length || extra.length) {
    console.error(`skill copy is out of date (run: pnpm sync:skill)\n  changed: ${stale.join(', ') || '-'}\n  extra: ${extra.join(', ') || '-'}`);
    process.exit(1);
  }
  console.log(`skill copy is up to date (${want.size} files)`);
} else {
  rmSync(OUT, { recursive: true, force: true });
  for (const [p, c] of want) {
    mkdirSync(join(OUT, p, '..'), { recursive: true });
    writeFileSync(join(OUT, p), c);
  }
  chmodSync(join(OUT, 'bin/mesh'), 0o755);
  console.log(`synced ${want.size} files to ${OUT}`);
}
