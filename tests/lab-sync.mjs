// The Sync lab in node: every ready-made program checked against what it should find; the failing schedules
// replayed on a fresh kernel, step by kernel step, to the same failure; every frame well formed (keys, a sentence
// each, editor tags on real lines) with the numbers it draws equal to the kernel's own objects; the same seed, the
// same run; a schedule picked by hand replays; the specification's expressions against a second evaluator; and the
// checker's verdict on a race against the kernel's own enumeration of every output.
import { files, harness, rng } from './load.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
globalThis.Proses = undefined;
const want = /\/(lab-0-registry|lab-widgets|lab-setup|lab-sync-[a-z]+)\.js$/;
for (const f of files(['core', 'stage']).concat(files(['app']).filter((f) => want.test(f)))) vm.runInThisContext(readFileSync(join(root, f), 'utf8'), { filename: f });
const S = globalThis.Proses;
S.UI = S.UI || { storage: { get: (k, d) => d, set() {} } };
const t = harness('lab-sync');
const SL = S.SyncLab, lab = S.Labs.get('sync'), LS = S.LabSetup;
t.ok(!!lab, 'the Sync lab registers');
t.ok(LS.check(lab, LS.defaults(lab)) === null, 'the defaults are a valid setup');
const valuesOf = (p, extra) => LS.merge(lab, Object.assign({}, LS.defaults(lab), { src: p.src, spec: p.spec, gran: p.gran, mode: p.mode }, extra || {}));

/** frames well formed; the objects drawn are the kernel's */
function wellFormed(r, src, what) {
  const lines = src.split('\n').length;
  t.ok(!r.error, what + ': runs (' + (r.error && (r.error.msg || r.error.message)) + ')');
  if (r.error) return;
  t.ok(r.frames.length >= 1, what + ': has frames');
  r.frames.forEach((f, i) => {
    const keys = new Set();
    for (const it of f.items) { if (!it.key || keys.has(it.key)) { t.ok(false, what + ': frame ' + i + ' has a duplicate or missing key ' + it.key); break; } keys.add(it.key); }
    t.ok(typeof f.say === 'string' && f.say.length > 12 && !/undefined|NaN|\[object/.test(f.say), what + ': frame ' + i + ' says something sensible: ' + f.say);
    for (const m of f.marks || []) t.ok(m.line >= 1 && m.line <= lines, what + ': frame ' + i + ' tags a real line (' + m.line + ')');
    t.ok(f.at >= 0 && f.at < r.trace.length, what + ': frame ' + i + ' points into the trace');
    for (const it of f.items) if (it.kind === 'text' || it.kind === 'cell') { const s = it.text === undefined ? '' : String(it.text); if (/undefined|NaN|\[object/.test(s)) { t.ok(false, what + ': frame ' + i + ' shows "' + s + '"'); break; } }
  });
  // the semaphore values and mutex owners drawn are the world's, and the world's are the kernel's
  const x = r.sync, beats = x.run.beats;
  beats.forEach((b, i) => {
    const f = r.frames[i];
    for (const s of b.world.sems) { const it = f.items.find((z) => z.key === 'obs' + s.name + ':val'); if (it) t.eq(String(it.text), String(s.value === null ? '–' : s.value), what + ': frame ' + i + ' draws ' + s.name); }
    for (const m of b.world.mutexes) { const it = f.items.find((z) => z.key === 'obm' + m.name + ':own'); if (it) t.eq(it.text, m.owner || 'free', what + ': frame ' + i + ' draws the owner of ' + m.name); }
  });
}

/** replay a check's schedule on a fresh kernel, kernel step by kernel step, from the beats' own events */
function rawReplay(P, R) {
  const sys = new S.Kern.System(P.prog, { tty: true, sleep: 'free', policy: 'hand', choose: (c) => c[0], granularity: P.gran, snap: false, cow: false });
  const K = S.Kern, old = K.TSTACK;
  K.TSTACK = SL.TSTACK;
  try {
    for (const b of R.beats.slice(1)) {
      // the beat's kernel steps, one by one, then the shell's reaping
      for (let k = 0; k < b.rec.n; k++) sys.step(b.rec.tid);
      for (let k = 0; k < 8; k++) { const cs = sys.choices(); if (!cs.length || !cs.every((c) => sys.proc(sys.thread(c).pid).role !== 'prog')) break; sys.step(cs[0]); }
    }
  } finally { K.TSTACK = old; }
  return sys;
}
/** a global's value straight from the kernel's memory (not through the lab) */
function globalOf(P, sys, name) {
  const g = P.prog.globals.get(name), p = sys.procs.find((q) => q.role === 'prog'), th = sys.threads.find((x) => x.pid === p.pid && x.vm);
  return S.CLang.load(th.vm, g.addr, 4, 1);
}

// ---- every ready-made program: the verdict, the replay, the frames ----------------------------------------------
const MAP = { invariant: 'invariant', deadlock: 'deadlock', assert: 'assert', ok: 'ok', starve: 'starve' };
for (const p of SL.PROGS) {
  const v = valuesOf(p, { mode: 'check' });
  const r = SL.build(v, { seed: 1, narrow: false });
  wellFormed(r, p.src, p.id + ' (check)');
  if (r.error) continue;
  const R = r.sync.run.R;
  const got = R.verdict === 'violation' ? R.kind : R.verdict === 'starve' ? 'starve' : R.verdict;
  t.eq(got, MAP[p.expect], p.id + ': Check it finds what the program is about');
  t.ok(R.stats && R.stats.states > 0, p.id + ': states were searched');
  t.ok(R.verdict !== 'bounded' && R.verdict !== 'none' && (!R.live || R.live.complete || R.verdict === 'starve'), p.id + ': a complete verdict within the default limit (raised to ' + R.limit + ')');
  if (R.verdict === 'violation') {
    const P = r.sync.P, sys = rawReplay(P, R), last = R.beats[R.beats.length - 1];
    if (R.kind === 'deadlock') t.eq(sys.status(), 'deadlock', p.id + ': the schedule deadlocks a fresh kernel too');
    if (R.kind === 'assert') t.ok(sys.trace.some((e) => e.kind === 'error'), p.id + ': the schedule fails on a fresh kernel too');
    if (R.kind === 'invariant') t.ok(last.truth.some((x) => x.ok === false) || (last.status === 'done'), p.id + ': the last state breaks the property');
    t.eq(R.beats.length - 1, R.schedule.length, p.id + ': every step of the schedule replays');
  }
  if (R.verdict === 'starve') {
    t.ok(R.cycleLen > 0 && R.schedule.length === R.cycleFrom + 2 * R.cycleLen, p.id + ': a lasso, the cycle shown twice');
    // the cycle comes back to the state it started from
    const b1 = R.beats[R.cycleFrom], b2 = R.beats[R.cycleFrom + R.cycleLen];
    t.eq(JSON.stringify(b2.world.vars) + b2.world.threads.map((x) => x.state + x.line).join(), JSON.stringify(b1.world.vars) + b1.world.threads.map((x) => x.state + x.line).join(), p.id + ': the cycle returns to where it began');
  }
}

// ---- random runs: same seed, same run; numbers against a fresh kernel ------------------------------------------
for (const id of ['buffer', 'phil', 'barber', 'rw-fair', 'counter-sloppy', 'queue']) {
  const p = SL.prog(id);
  for (const seed of [1, 7, 42]) {
    const v = valuesOf(p, { mode: 'random', steps: 60 });
    const a = SL.build(v, { seed, narrow: false }), b = SL.build(v, { seed, narrow: true });
    wellFormed(a, p.src, id + ' random ' + seed);
    wellFormed(b, p.src, id + ' random ' + seed + ' narrow');
    t.eq(a.trace.map((x) => x.say), b.trace.map((x) => x.say), id + ': the same seed gives the same run, wide or narrow');
  }
}
{
  const p = SL.prog('buffer'), v = valuesOf(p, { mode: 'random', steps: 200 });
  const outs = new Set([1, 2, 3, 4, 5, 6].map((seed) => SL.build(v, { seed, narrow: false }).trace.map((x) => x.tid).join()));
  t.ok(outs.size > 1, 'different seeds give different schedules');
  const r = SL.build(v, { seed: 3, narrow: false }), last = r.sync.run.beats[r.sync.run.beats.length - 1];
  t.eq(last.status, 'done', 'the bounded buffer finishes');
  t.eq(last.world.vars.find((x) => x.name === 'buf').value, [0, 0], 'every item was taken out');
}

// ---- by hand -------------------------------------------------------------------------------------------------------
{
  const p = SL.prog('lock-order');
  let v = valuesOf(p, { mode: 'hand', sched: '' });
  let r = SL.build(v, { seed: 1, narrow: false });
  wellFormed(r, p.src, 'by hand, start');
  const waiting = r.sync.run.waiting.map((c) => r.sync.run.beats.at(-1).names[c].name);
  t.ok(waiting.length >= 2, 'by hand: the run waits for a choice (' + waiting.join(' ') + ')');
  t.ok(r.frames.at(-1).items.some((it) => it.key === 'pick:' + waiting[0] && it.pick), 'by hand: each choice is a chip to click');
  // drive it into the deadlock: pay takes lockA, refund takes lockB, then each asks for the other
  const picks = [];
  for (let k = 0; k < 40; k++) {
    v = valuesOf(p, { mode: 'hand', sched: picks.join(' ') });
    r = SL.build(v, { seed: 1, narrow: false });
    const run = r.sync.run;
    if (!run.waiting) break;
    const names = run.waiting.map((c) => run.beats.at(-1).names[c].name);
    const w = run.beats.at(-1).world;
    const free = (n) => !w.mutexes.find((m) => m.name === n).owner;
    const pick = names.includes('P0') && free('lockA') ? 'P0' : !names.includes('R0') && names.includes('main') ? 'main' : names.includes('R0') && free('lockB') ? 'R0' : names.includes('P0') ? 'P0' : names.includes('R0') ? 'R0' : names[0];
    picks.push(pick);
  }
  t.eq(r.sync.run.beats.at(-1).status, 'deadlock', 'by hand: taking the locks in turn deadlocks');
  t.ok(r.frames.at(-1).say.includes('deadlock'), 'by hand: the last sentence says so');
  const bad = SL.build(valuesOf(p, { mode: 'hand', sched: 'XX' }), { seed: 1, narrow: false });
  t.ok(!!bad.sync.run.bad && /XX/.test(bad.frames.at(-1).say), 'by hand: a name that cannot run is pointed out');
}

// ---- the checker against the kernel's own enumeration ----------------------------------------------------------
{
  const src = SL.prog('race').src.replace('#include <pthread.h>', '#include <stdio.h>\n#include <pthread.h>').replace('    return 0;\n}\n', '    printf("%d\\n", count);\n    return 0;\n}\n');
  const outs = S.Kern.outcomes(src, { granularity: 'machine', maxStates: 200000 });
  const finals = [...outs.outputs.keys()].map((o) => +o.trim()).sort();
  const check = (what, ok) => { const P = SL.prepare({ src, spec: [{ kind: 'end', what }], gran: 'machine' }); const R = SL.check(P, {}); t.eq(R.verdict === 'ok', ok, 'race: "' + what + '" is ' + (ok ? 'true' : 'false') + ' in every schedule, as the enumeration of outputs (' + finals.join(', ') + ') says'); };
  t.ok(finals.length >= 2, 'the kernel enumerates several final counts');
  check('count == 4', finals.every((x) => x === 4));
  check('count >= ' + Math.min(...finals), true);
  check('count >= ' + (Math.min(...finals) + 1), false);
  check('count <= 4', true);
}

// ---- the specification's expressions against JavaScript ----------------------------------------------------------
{
  const P = SL.prepare({ src: SL.prog('phil').src, spec: [], gran: 'statement' });
  const r = rng(5), ops = ['+', '-', '*', '<', '<=', '>', '>=', '==', '!=', '&&', '||', '&', '|', '^'];
  const J = { '&&': (a, b) => (a && b ? 1 : 0), '||': (a, b) => (a || b ? 1 : 0), '<': (a, b) => +(a < b), '<=': (a, b) => +(a <= b), '>': (a, b) => +(a > b), '>=': (a, b) => +(a >= b), '==': (a, b) => +(a === b), '!=': (a, b) => +(a !== b), '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '&': (a, b) => a & b, '|': (a, b) => a | b, '^': (a, b) => a ^ b };
  for (let k = 0; k < 300; k++) {
    const vals = [0, 1, 2].map(() => Math.floor(r() * 5) - 1);
    const a = Math.floor(r() * 7) - 2, op1 = ops[Math.floor(r() * ops.length)], op2 = ops[Math.floor(r() * ops.length)];
    const text = '(eating[0] ' + op1 + ' ' + a + ') ' + op2 + ' (sum(eating) ' + op1 + ' N)';
    const x = SL.expr(text, P.I);
    const env = { load: (g, i) => vals[i], inFn: () => 0, sem: () => 0 };
    const want = J[op2](J[op1](vals[0], a), J[op1](vals[0] + vals[1] + vals[2], 3));
    t.eq(x.error ? x.error : x.fn(env), want, 'expression ' + text + ' with eating = ' + vals.join(','));
  }
  t.ok(!!SL.expr('nosuch > 1', P.I).error, 'an unknown name is an error');
  t.ok(/mutex/.test(SL.expr('forks[0] > 1', P.I).error || ''), 'a mutex is not a number, and the error says so');
  t.eq(SL.expr('N * 2 + 1', P.I).fn({}), 7, '#define constants are known');
}
// ---- the reduction keeps every property's verdict -----------------------------------------------------------
// A thread entering or leaving a function the specification watches (in(f), "calls f") is a visible step. The
// checker's verdicts (macro steps, partial-order reduction) must equal those of a plain search: one statement a
// step, no reduction. First the case that showed it: a function with only local statements inside.
{
  const pool = '#include <pthread.h>\nint in_pool = 0;\npthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;\npthread_cond_t free_lane = PTHREAD_COND_INITIALIZER;\nvoid swim(void) {\n    int laps = 0;\n    laps++;\n}\nvoid *swimmer(void *arg) {\n    pthread_mutex_lock(&m);\n    if (in_pool == 1)\n        pthread_cond_wait(&free_lane, &m);\n    in_pool++;\n    pthread_mutex_unlock(&m);\n    swim();\n    pthread_mutex_lock(&m);\n    in_pool--;\n    pthread_cond_signal(&free_lane);\n    pthread_mutex_unlock(&m);\n    return NULL;\n}\nint main(void) {\n    pthread_t a, b, c;\n    pthread_create(&a, NULL, swimmer, NULL);\n    pthread_create(&b, NULL, swimmer, NULL);\n    pthread_create(&c, NULL, swimmer, NULL);\n    pthread_join(a, NULL);\n    pthread_join(b, NULL);\n    pthread_join(c, NULL);\n    return 0;\n}\n';
  const P = SL.prepare({ src: pool, spec: [{ kind: 'never', what: 'in(swim) > 1' }], gran: 'statement' });
  const R = SL.check(P, { search: 'full', maxStates: 50000 });
  t.eq(R.verdict + ' ' + R.kind, 'violation invariant', 'if instead of while: two swimmers in swim at once are found');
  const last = R.beats[R.beats.length - 1];
  t.eq(last.world.threads.filter((x) => x.cur === 'swim' && x.state !== 'done').length, 2, 'the replay ends with two threads inside swim');
}
function verdictOf(P, o) {
  const R = SL.check(P, Object.assign({ search: 'full', maxStates: 40000 }, o));
  if (R.verdict === 'bounded' || (R.stats && !R.stats.complete)) return null;
  return R.verdict === 'violation' ? R.kind + ':' + R.name : R.verdict === 'starve' ? 'starve:' + R.name : R.verdict;
}
{
  const r = rng(11), pick = (a) => a[Math.floor(r() * a.length)];
  const BODY = ['x++;', 'x = x + 2;', 'f();', 'g();', 'sem_post(&s);', 'sem_wait(&s);', 'y = x;'];
  const PROPS = [{ kind: 'never', what: 'in(f) > 1' }, { kind: 'never', what: 'in(f) > 0 && in(g) > 0' }, { kind: 'always', what: 'x <= 3' }, { kind: 'never', what: 'value(s) == 0 && in(g) > 0' }, { kind: 'end', what: 'x == y' }, { kind: 'always', what: 'in(g) == 0 || y < 2' }];
  let compared = 0;
  for (let k = 0; k < 40; k++) {
    const thread = (name) => {
      const lines = [];
      const n = 2 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        if (r() < 0.3) lines.push('    pthread_mutex_lock(&m);', '    ' + pick(BODY), '    pthread_mutex_unlock(&m);');
        else lines.push('    ' + pick(BODY));
      }
      return 'void *' + name + '(void *arg) {\n' + lines.join('\n') + '\n    return NULL;\n}\n';
    };
    const loop = r() < 0.25;
    let src = '#include <pthread.h>\n#include <semaphore.h>\nint x = 0, y = 0;\nsem_t s;\npthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;\nvoid f(void) {\n    int a = 1;\n    a++;\n}\nvoid g(void) {\n    int b = 2;\n    b--;\n}\n' + thread('one') + thread('two');
    if (loop) src = src.replace('void *two(void *arg) {\n', 'void *two(void *arg) {\n    while (1) {\n        f();\n        x = 0;\n    }\n');
    src += 'int main(void) {\n    pthread_t a, b;\n    sem_init(&s, 0, ' + Math.floor(r() * 2) + ');\n    pthread_create(&a, NULL, one, NULL);\n    pthread_create(&b, NULL, two, NULL);\n    pthread_join(a, NULL);\n    pthread_join(b, NULL);\n    return 0;\n}\n';
    const spec = [{ kind: 'deadlock', what: '' }, pick(PROPS), pick(PROPS)].concat(loop ? [{ kind: 'live', what: 'one calls g' }] : []);
    const P = SL.prepare({ src, spec, gran: r() < 0.5 ? 'statement' : 'machine' });
    if (P.error || P.spec.errors.length) { t.ok(false, 'random program ' + k + ' does not prepare: ' + (P.error ? P.error.msg : P.spec.errors[0])); continue; }
    const fast = verdictOf(P, {}), plain = verdictOf(P, { por: false, single: true }), noPor = verdictOf(P, { por: false });
    if (fast === null || plain === null || noPor === null) continue;
    compared++;
    t.eq(fast, plain, 'random program ' + k + ': the reduced search agrees with a plain one (' + spec.slice(1).map((x) => x.kind + ' ' + x.what).join('; ') + ')');
    t.eq(noPor, plain, 'random program ' + k + ': without partial-order reduction too');
  }
  t.ok(compared >= 25, 'most random programs were compared (' + compared + ')');
}

// ---- the step machine's own programs on the stage ------------------------------------------------------------------
for (const c of S.Sync.catalog) {
  const spec = c.build(), sp = spec.spec || spec, want = sp.expect && sp.expect !== 'ok' ? sp.expect : sp.expectLive === 'starve' ? 'starve' : 'ok';
  const v = LS.merge(lab, Object.assign({}, LS.defaults(lab), { source: 'model', cat: c.id, mode: 'check' }));
  const r = SL.build(v, { seed: 1, narrow: false });
  wellFormed(r, '', 'step machine ' + c.id);
  const R = r.sync.run.R;
  t.ok(R.verdict !== 'bounded' && (!R.live || R.live.complete || R.verdict === 'starve'), 'step machine ' + c.id + ': a complete verdict within the default limit (raised to ' + R.limit + ')');
  t.eq(R.verdict === 'violation' ? R.kind : R.verdict, want, 'step machine ' + c.id + ': Check it finds what the catalogue says');
  if (R.schedule) t.eq(r.sync.run.beats.length - 1, R.schedule.length, 'step machine ' + c.id + ': the schedule replays to the end');
}
{
  const v = LS.merge(lab, Object.assign({}, LS.defaults(lab), { source: 'model', cat: 'lock-ticket', mode: 'hand', sched: '' }));
  const r = SL.build(v, { seed: 1, narrow: false }), run = r.sync.run;
  t.ok(run.waiting && run.waiting.length >= 2, 'step machine by hand: it waits for a choice');
  const pick = run.label(run.waiting[1]);
  const r2 = SL.build(Object.assign({}, v, { sched: pick }), { seed: 1, narrow: false });
  t.eq(r2.sync.run.beats[1].rec.full, pick, 'step machine by hand: the thread picked takes the step');
  const a = SL.build(Object.assign({}, v, { mode: 'random' }), { seed: 9, narrow: false }), b = SL.build(Object.assign({}, v, { mode: 'random' }), { seed: 9, narrow: true });
  t.eq(a.trace.map((x) => x.say), b.trace.map((x) => x.say), 'step machine: the same seed, the same run');
}
t.done();
