// Runs one spec file in its own headless Chrome and reports results to the orchestrator.
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from '../../tools/cdp.mjs';
import { makePage } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const [spec, grep, mode] = process.argv.slice(2);
const send = (m) => process.send && process.send(m);

const tests = [];
const hooks = { beforeEach: [], afterEach: [] };
const reg = {
  test(name, fn, opts) { tests.push({ name, fn, opts: opts || {} }); },
  beforeEach(fn) { hooks.beforeEach.push(fn); },
  afterEach(fn) { hooks.afterEach.push(fn); },
};

const mod = await import(pathToFileURL(join(here, 'specs', spec)).href);
await mod.default(reg);
let selected = tests.filter((t) => !grep || t.name.toLowerCase().includes(grep.toLowerCase()));
if (mode === 'list') {
  for (const t of selected) send({ type: 'result', spec, name: t.name, ok: true, skipped: true });
  send({ type: 'spec-done', spec, passed: 0, failed: 0, ms: 0, count: selected.length });
  process.exit(0);
}

const t0 = Date.now();
let passed = 0, failed = 0;
let browser = null, page = null;
async function boot() {
  if (browser) { try { await browser.close(); } catch (e) { /* ignore */ } }
  browser = await launch({ width: 1400, height: 900 });
  page = makePage(browser, spec);
  await page.fresh();
}
try {
  await boot();
  for (const t of selected) {
    const started = Date.now();
    const timeout = t.opts.timeout || 30000;
    let err = null;
    page.markExceptions();
    try {
      if (t.opts.fresh) await page.fresh(t.opts.fresh === true ? {} : t.opts.fresh);
      for (const h of hooks.beforeEach) await h(page);
      await Promise.race([
        t.fn(page),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${timeout}ms`)), timeout)),
      ]);
      for (const h of hooks.afterEach) await h(page);
      const ex = page.newExceptions();
      if (ex.length && !t.opts.allowExceptions) throw new Error('Page exception(s):\n' + ex.join('\n'));
    } catch (e) {
      err = e;
    }
    if (err) {
      failed++;
      const shot = join(here, 'artifacts', (spec + '-' + t.name).replace(/[^a-z0-9.-]+/gi, '_').slice(0, 150) + '.png');
      try { await page.screenshot(shot); } catch (e) { /* ignore */ }
      send({ type: 'result', spec, name: t.name, ok: false, error: (err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n') : String(err)), ms: Date.now() - started, shot });
      // recover from a broken page state
      try { await page.recover(); } catch (e) { await boot(); }
    } else {
      passed++;
      send({ type: 'result', spec, name: t.name, ok: true, ms: Date.now() - started });
    }
  }
} catch (e) {
  send({ type: 'result', spec, name: '(spec setup)', ok: false, error: String(e && e.stack || e) });
  failed++;
} finally {
  send({ type: 'spec-done', spec, passed, failed, ms: Date.now() - t0 });
  try { await browser.close(); } catch (e) { /* ignore */ }
  process.exit(0);
}
