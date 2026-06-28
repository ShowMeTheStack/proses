// Load source files (the same ones the page uses, in manifest order) into a vm context for node tests:
// const S = load(['core']) gives globalThis.Proses with the core engines.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { expand } from '../tools/devpage.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
export function files(parts = ['core']) {
  const m = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  return [...new Set(parts.flatMap((k) => expand(m[k])))];
}
// Files run in this process's own global scope (code in a vm context looks up every global, such as Math, through
// a slow interceptor: numeric code runs many times slower there). Each load starts a fresh globalThis.Proses and
// leaves it in place, so lazy references inside functions still find it. load(parts, {vm: true}) isolates instead.
export function load(parts = ['core'], opts = {}) {
  if (opts.vm) {
    const ctx = vm.createContext({ console, performance, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, structuredClone, TextEncoder, TextDecoder, URL });
    for (const f of files(parts)) vm.runInContext(readFileSync(join(root, f), 'utf8'), ctx, { filename: f });
    return ctx.Proses;
  }
  globalThis.Proses = undefined;
  for (const f of files(parts)) vm.runInThisContext(readFileSync(join(root, f), 'utf8'), { filename: f });
  return globalThis.Proses;
}
/** a small test harness: const t = harness('aes'); t.ok(cond, msg); t.eq(a, b, msg); t.done() */
export function harness(name) {
  let pass = 0, fail = 0;
  const bad = (msg) => { fail++; if (fail <= 30) console.log('FAIL ' + msg); };
  return {
    ok(c, msg) { if (c) pass++; else bad(msg); },
    eq(a, b, msg) { const js = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() + 'n' : x)), x = js(a), y = js(b); if (x === y) pass++; else bad(msg + ': got ' + x + ', want ' + y); },
    done() { console.log(name.padEnd(12) + ' ' + pass + ' passed, ' + fail + ' failed'); if (fail) process.exitCode = 1; },
  };
}
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
