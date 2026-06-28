// Runs every engine test (each tests/*.mjs but this file and the loader): node tests/run.mjs [name...]
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const only = process.argv.slice(2);
const files = readdirSync(here).filter((f) => f.endsWith('.mjs') && f !== 'run.mjs' && f !== 'load.mjs' && (!only.length || only.some((o) => f.startsWith(o)))).sort();
let bad = 0;
for (const f of files) {
  try { process.stdout.write(execFileSync('node', [join(here, f)], { encoding: 'utf8', maxBuffer: 1 << 26 })); } catch (e) { bad++; process.stdout.write(e.stdout || String(e)); }
}
process.exit(bad ? 1 : 0);
