// Proses end-to-end test orchestrator.
// usage: node tests/e2e/run.mjs [--workers N] [--grep text] [--spec name] [--bail] [--list]
// Spawns N worker processes; each launches its own headless Chrome (separate profile) and runs
// whole spec files. Results are aggregated into tests/e2e/artifacts/results.json.
import { fork } from 'node:child_process';
import { readdirSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { execSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const workers = Math.max(1, +opt('--workers', Math.min(6, Math.max(2, cpus().length - 2))));
const grep = opt('--grep', null);
const only = opt('--spec', null);
const list = args.includes('--list');
const artifacts = join(here, 'artifacts');
if (!only && !grep) rmSync(artifacts, { recursive: true, force: true });
mkdirSync(artifacts, { recursive: true });

// the tests run against the built page, as it is published
if (!list) execSync('node build.mjs', { cwd: join(here, '..', '..'), stdio: 'ignore' });

let specs = readdirSync(join(here, 'specs')).filter((f) => f.endsWith('.spec.mjs')).sort();
if (only) specs = specs.filter((f) => only.split(',').some((o) => f.includes(o)));
// heavier specs first for better packing
const queue = specs.slice();
const results = [];
const t0 = Date.now();
let active = 0;
let failedTotal = 0;

function startWorker(id) {
  if (!queue.length) return;
  const spec = queue.shift();
  active++;
  const w = fork(join(here, 'worker.mjs'), [spec, grep || '', list ? 'list' : ''], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  w.on('message', (m) => {
    if (m.type === 'result') {
      results.push(m);
      if (!m.ok) failedTotal++;
      const mark = m.ok ? (m.skipped ? '-' : '✓') : '✗';
      if (!m.ok || process.env.E2E_VERBOSE) process.stdout.write(`${mark} [${m.spec}] ${m.name}${m.ok ? '' : '\n    ' + m.error.split('\n').join('\n    ')}\n`);
    } else if (m.type === 'spec-done') {
      process.stdout.write(`  ${m.spec}: ${m.passed} passed, ${m.failed} failed (${(m.ms / 1000).toFixed(1)}s)\n`);
    }
  });
  w.on('exit', (code) => {
    active--;
    if (code !== 0) { results.push({ type: 'result', spec, name: '(worker crashed)', ok: false, error: 'exit code ' + code }); failedTotal++; }
    if (queue.length) startWorker(id);
    else if (active === 0) finish();
  });
}

function finish() {
  const passed = results.filter((r) => r.ok && !r.skipped).length;
  const failed = results.filter((r) => !r.ok).length;
  writeFileSync(join(artifacts, only || grep ? `results-${(only || grep).replace(/[^a-z0-9-]+/gi, '_')}.json` : 'results.json'), JSON.stringify({ passed, failed, ms: Date.now() - t0, results }, null, 1));
  console.log(`\n${passed} passed, ${failed} failed, ${results.length} total in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (failed) console.log('Failures: tests/e2e/artifacts/results.json (screenshots in tests/e2e/artifacts/)');
  process.exit(failed ? 1 : 0);
}

console.log(`Running ${specs.length} spec files with ${workers} workers`);
for (let i = 0; i < Math.min(workers, specs.length); i++) startWorker(i);
