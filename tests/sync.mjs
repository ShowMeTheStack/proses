// The thread-step machine (src/core/sync-*.js): hand-worked runs of every primitive, the classic problems' invariants
// over many seeds, an independent reimplementation of mutexes and semaphores replayed on the same schedules, and
// the sample scenes' traces (dining philosophers, the bounded buffer).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { load, harness, rng } from './load.mjs';

const t = harness('sync');
const S = load(['core', 'stage']);
const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
for (const f of ['demo/scenes.js', 'demo/h-philosophers.js', 'demo/i-bounded-buffer.js']) vm.runInThisContext(readFileSync(join(src, f), 'utf8'), { filename: f });
const Y = S.Sync;

// ---- hand-worked: a mutex handed from owner to waiter ----------------------------------------------------------
{
  const spec = { threads: [{ name: 'A', prog: [{ op: 'lock', m: 'm' }, { op: 'work' }, { op: 'unlock', m: 'm' }] }, { name: 'B', prog: [{ op: 'lock', m: 'm' }, { op: 'unlock', m: 'm' }] }], mutexes: ['m'] };
  const r = Y.run(spec, { policy: 'manual', order: ['A', 'B', 'A', 'A', 'B'] });
  const k = r.steps.map((s) => s.kind);
  t.eq(k, ['acquire', 'block', 'work', 'handoff', 'release'], 'mutex: acquire, block, hand-off, release');
  t.eq(r.steps[1].state.mutex.m, { owner: 0, queue: [1] }, 'B waits in the queue while A owns m');
  t.eq(r.steps[3].state.mutex.m, { owner: 1, queue: [] }, 'unlock hands m to B');
  t.eq(r.steps[3].state.threads[1].state, 'ready', 'B is woken by the hand-off');
  t.eq(r.end.kind, 'done', 'both finish');
  t.ok(/A owns it: B blocks, and the queue of m is \[B\]/.test(r.steps[1].say), 'the block sentence names the owner and the queue');
}
// ---- hand-worked: a counting semaphore -------------------------------------------------------------------------
{
  const w = { op: 'wait', s: 's' }, spec = { threads: [{ name: 'A', prog: [w] }, { name: 'B', prog: [w] }, { name: 'C', prog: [w] }, { name: 'D', prog: [{ op: 'post', s: 's' }, { op: 'post', s: 's' }] }], sems: [{ id: 's', init: 2 }] };
  const r = Y.run(spec, { policy: 'manual', order: ['A', 'B', 'C', 'D', 'D'] });
  t.eq(r.steps.map((s) => s.state.sem.s.value), [1, 0, 0, 0, 1], 'semaphore values 2 → 1 → 0, C waits, a post wakes C, the next post counts');
  t.eq(r.steps[2].state.sem.s.queue, [2], 'C is queued on s');
  t.eq(r.steps[3].kind, 'wake', 'the first post wakes C');
  t.eq(r.end.kind, 'done', 'all finish');
}
// ---- hand-worked: condition variables, a signal that is lost and one that is not ----------------------------------
{
  const spec = { threads: [{ name: 'W', prog: [{ op: 'lock', m: 'm' }, { op: 'cwait', c: 'c', m: 'm' }, { op: 'unlock', m: 'm' }] }, { name: 'S', prog: [{ op: 'lock', m: 'm' }, { op: 'signal', c: 'c' }, { op: 'unlock', m: 'm' }] }], mutexes: ['m'], conds: ['c'] };
  const good = Y.run(spec, { policy: 'manual', order: ['W', 'W', 'S', 'S', 'S', 'W'] });
  t.eq(good.steps.map((s) => s.kind), ['acquire', 'cwait', 'acquire', 'csignal', 'handoff', 'release'], 'wait releases m, signal moves W to m, unlock hands m back');
  t.eq(good.steps[1].state.mutex.m.owner, null, 'cwait releases the mutex');
  t.eq(good.steps[3].state.mutex.m.queue, [0], 'after the signal W waits for the mutex, not the condition');
  t.eq(good.end.kind, 'done', 'both finish');
  const lost = Y.run(spec, { policy: 'manual', order: ['S', 'S', 'S', 'W', 'W'] });
  t.eq(lost.steps[1].kind, 'lost', 'a signal with nobody waiting is lost');
  t.eq(lost.end.kind, 'deadlock', 'W then waits forever');
  t.eq(lost.end.cycle, null, 'no cycle: W is stuck on a condition nobody will signal');
  t.ok(/W waits on c/.test(lost.end.say), 'the ending names where W waits');
}
// ---- misuse ------------------------------------------------------------------------------------------------------
{
  const r = Y.run({ threads: [{ name: 'A', prog: [{ op: 'unlock', m: 'm' }] }], mutexes: ['m'] }, {});
  t.eq(r.end.kind, 'error', 'unlocking a free mutex is an error');
  const r2 = Y.run({ threads: [{ name: 'A', prog: [{ op: 'lock', m: 'm' }, { op: 'lock', m: 'm' }] }], mutexes: ['m'] }, {});
  t.eq(r2.end.kind, 'error', 'locking a mutex twice is reported');
  const r3 = Y.run({ threads: [{ name: 'A', prog: [{ op: 'write', v: 'x', val: 7 }, { op: 'update', v: 'x', by: 5, mod: 10 }, { op: 'read', v: 'x', into: 'r' }] }], vars: { x: 0 } }, {});
  t.eq(r3.steps.map((s) => s.state.vars.x), [7, 2, 2], 'write, update mod 10, read');
  t.eq(r3.steps[2].state.threads[0].reg.r, 2, 'read lands in the register');
}

// ---- dining philosophers -------------------------------------------------------------------------------------------
for (let n = 3; n <= 7; n++) {
  const r = Y.run(Y.philosophers(n, 'naive'), { policy: 'rr' });
  t.eq(r.end.kind, 'deadlock', 'naive, round robin, n = ' + n + ': deadlock');
  t.eq(r.steps.length, 3 * n, 'naive n = ' + n + ': after 3n steps (think, left, block)');
  t.eq(r.end.cycle && r.end.cycle.length, n, 'the cycle has all ' + n);
  t.ok(r.end.cycle.every((c) => c.holder === (c.tid + 1) % n && c.on.id === 'f' + ((c.tid + 1) % n)), 'each waits for its right fork, held by the next');
}
function forkCheck(s, n, spec) {
  // nobody holds a fork that is not one of its own, and anyone at eat holds both
  for (let j = 0; j < n; j++) { const o = s.mutex['f' + j].owner; if (o !== null && o !== j && o !== (j + n - 1) % n) return false; }
  for (const th of s.threads) if (spec.threads[th.id].prog[th.pc].op === 'eat' && th.state === 'ready') { const L = th.id, R = (th.id + 1) % n; if (s.mutex['f' + L].owner !== th.id || s.mutex['f' + R].owner !== th.id) return false; }
  return true;
}
let naiveDead = 0, naiveRuns = 0;
for (let n = 3; n <= 7; n++) for (let seed = 1; seed <= 25; seed++) {
  for (const v of ['ordered', 'seats']) {
    const spec = Y.philosophers(n, v), r = Y.run(spec, { policy: 'random', seed, max: 1500 });
    t.ok(r.end.kind === 'limit', v + ' n = ' + n + ' seed ' + seed + ': never stuck');
    t.ok(r.machine.threads.every((th) => th.meals > 0), v + ' n = ' + n + ' seed ' + seed + ': everyone eats');
    t.ok(r.steps.every((s) => forkCheck(s.state, n, spec)), v + ' n = ' + n + ' seed ' + seed + ': forks only in their own hands');
    // seated: past wait(seats) (line 1) and not yet past post(seats) (line 7)
    if (v === 'seats') t.ok(r.steps.every((s) => s.state.sem.seats.value + s.state.threads.filter((th) => th.pc >= 2).length === n - 1), 'seats: free seats + seated = n − 1');
  }
  const spec = Y.philosophers(n, 'naive'), r = Y.run(spec, { policy: 'random', seed, max: 1500 });
  naiveRuns++;
  if (r.end.kind === 'deadlock') { naiveDead++; t.ok(r.end.cycle && r.end.cycle.length === n && r.steps[r.steps.length - 1].state.threads.every((th) => th.state === 'blocked'), 'a naive deadlock has every philosopher in the cycle'); }
  t.ok(r.steps.every((s) => forkCheck(s.state, n, spec)), 'naive: forks only in their own hands');
}
t.ok(naiveDead > 0 && naiveDead < naiveRuns, 'random schedules: the naive table sometimes deadlocks (' + naiveDead + ' of ' + naiveRuns + ')');

// ---- the bounded buffer: invariants on every step ------------------------------------------------------------------
for (let size = 1; size <= 6; size++) for (let P = 1; P <= 3; P++) for (let C = 1; C <= 3; C++) for (let seed = 1; seed <= 4; seed++) {
  const spec = Y.buffer(size, P, C), r = Y.run(spec, { policy: 'random', seed: seed * 31 + size, max: 300 });
  const at = 'buffer ' + size + '/' + P + '/' + C + ' seed ' + seed;
  t.eq(r.end.kind, 'limit', at + ': never stuck');
  let ok = true, fifo = true;
  const put = [], took = [];
  for (const s of r.steps) {
    const st = s.state, th = st.threads;
    const count = st.vars.buf.filter((x) => x !== null).length;
    if (count < 0 || count > size) ok = false;
    // a producer holds an empty-slot token from passing wait(empty) until post(full); a consumer a full one likewise
    const pIn = th.filter((x, i) => i < P && x.pc >= 1).length;
    const cIn = th.filter((x, i) => i >= P && x.pc >= 1 && x.pc <= 6).length;
    if (st.sem.empty.value + st.sem.full.value + pIn + cIn !== size) ok = false;
    const inside = th.filter((x, i) => x.state !== 'blocked' && (i < P ? x.pc >= 2 && x.pc <= 4 : x.pc >= 2 && x.pc <= 5)).length;
    if (inside + st.sem.mutex.value !== 1) ok = false;
    if (s.op === 'write' && s.tid < P) put.push(st.vars.buf[(st.vars.in)]);
    if (s.op === 'read') took.push(st.threads[s.tid].reg.item);
  }
  t.ok(ok, at + ': 0 ≤ count ≤ N, empty + full + tokens held = N, mutex + inside = 1');
  t.ok(took.every((x, i) => x === put[i]), at + ': items come out in the order they went in');
  t.ok(took.length > 0, at + ': something is consumed');
}

// ---- an independent mutex and semaphore model, replayed on the machine's own schedules -----------------------------
function indep(spec, order) {
  const ths = spec.threads.map((th) => ({ pc: 0, st: 'ready', prog: th.prog, loop: th.loop }));
  const mx = {}, sm = {};
  for (const m of spec.mutexes || []) mx[m] = { o: null, q: [] };
  for (const s of spec.sems || []) sm[s.id] = { v: s.init, q: [] };
  const next = (k) => { const th = ths[k]; th.pc++; if (th.pc >= th.prog.length) { if (th.loop) th.pc = 0; else th.st = 'done'; } };
  const out = [];
  for (const k of order) {
    const th = ths[k], op = th.prog[th.pc];
    if (op.op === 'lock') { const m = mx[op.m]; if (m.o === null) { m.o = k; next(k); } else { m.q.push(k); th.st = 'blocked'; } }
    else if (op.op === 'unlock') { const m = mx[op.m]; next(k); if (m.q.length) { const w = m.q.shift(); m.o = w; ths[w].st = 'ready'; next(w); } else m.o = null; }
    else if (op.op === 'wait') { const s = sm[op.s]; if (s.v > 0) { s.v--; next(k); } else { s.q.push(k); th.st = 'blocked'; } }
    else if (op.op === 'post') { const s = sm[op.s]; next(k); if (s.q.length) { const w = s.q.shift(); ths[w].st = 'ready'; next(w); } else s.v++; }
    else next(k);
    out.push(JSON.stringify({ t: ths.map((x) => [x.pc, x.st]), m: Object.values(mx).map((m) => [m.o, m.q]), s: Object.values(sm).map((s) => [s.v, s.q]) }));
  }
  return out;
}
const R = rng(2024);
for (let trial = 0; trial < 150; trial++) {
  const nm = 1 + Math.floor(R() * 3), ns = 1 + Math.floor(R() * 2), nt = 2 + Math.floor(R() * 4);
  const mutexes = Array.from({ length: nm }, (_, i) => 'm' + i), sems = Array.from({ length: ns }, (_, i) => ({ id: 's' + i, init: Math.floor(R() * 3) }));
  const threads = [];
  for (let k = 0; k < nt; k++) {
    const prog = [];
    for (let b = 0; b < 3; b++) {
      const c = R();
      if (c < 0.45) { const a = Math.floor(R() * nm), bb = Math.floor(R() * nm); prog.push({ op: 'lock', m: 'm' + a }); if (bb !== a) prog.push({ op: 'lock', m: 'm' + bb }, { op: 'work' }, { op: 'unlock', m: 'm' + bb }); prog.push({ op: 'unlock', m: 'm' + a }); }
      else if (c < 0.75) prog.push({ op: 'wait', s: 's' + Math.floor(R() * ns) });
      else prog.push({ op: 'post', s: 's' + Math.floor(R() * ns) });
    }
    threads.push({ name: 'T' + k, prog, loop: true });
  }
  const spec = { threads, mutexes, sems };
  const r = Y.run(spec, { policy: 'random', seed: trial + 1, max: 120 });
  const mine = r.steps.map((s) => JSON.stringify({ t: s.state.threads.map((x) => [x.pc, x.state]), m: mutexes.map((m) => [s.state.mutex[m].owner, s.state.mutex[m].queue]), s: sems.map((q) => [s.state.sem[q.id].value, s.state.sem[q.id].queue]) }));
  const theirs = indep(spec, r.steps.map((s) => s.tid));
  t.eq(mine, theirs, 'trial ' + trial + ': the machine and the independent model agree step by step');
  if (r.end.kind === 'deadlock') {
    // a reported cycle is a real one: each waits for a mutex the next one owns
    const last = r.steps[r.steps.length - 1].state;
    if (r.end.cycle) t.ok(r.end.cycle.every((c, i) => last.mutex[c.on.id].owner === c.holder && r.end.cycle[(i + 1) % r.end.cycle.length].tid === c.holder && last.threads[c.tid].on.id === c.on.id), 'trial ' + trial + ': the wait cycle is real');
    t.ok(r.machine.runnable().length === 0, 'trial ' + trial + ': deadlock means nobody can run');
  }
}

// ---- determinism, and the scenes' traces ------------------------------------------------------------------------------
const strip = (r) => JSON.stringify(r.steps.map((s) => [s.tid, s.kind, s.say]));
t.eq(strip(Y.run(Y.buffer(3, 2, 2), { policy: 'random', seed: 9, max: 200 })), strip(Y.run(Y.buffer(3, 2, 2), { policy: 'random', seed: 9, max: 200 })), 'the same seed, the same trace');
const ph = S.Demo.byId('philosophers'), bb = S.Demo.byId('bounded-buffer');
for (let n = 3; n <= 7; n++) for (let seed = 1; seed <= 6; seed++) {
  const a = ph.trace({ n, variant: 0, seed });
  t.eq(a.run.end.kind, 'deadlock', 'scene: naive n = ' + n + ' seed ' + seed + ' deadlocks');
  for (const variant of [1, 2]) {
    const b = ph.trace({ n, variant, seed });
    t.ok(b.run.end.kind === 'stopped', 'scene: fix ' + variant + ' n = ' + n + ' seed ' + seed + ' runs until a meal is over');
    t.ok(b.long.end.kind === 'limit' && b.long.machine.threads.every((th) => th.meals > 0), 'scene: fix ' + variant + ' n = ' + n + ' seed ' + seed + ': the long run keeps everyone eating');
  }
}
for (const narrow of [false, true]) {
  const fr = ph.frames({ narrow, knobs: { n: 6, variant: 0, seed: 3 } });
  t.ok(/Deadlock/.test(fr[fr.length - 1].say), 'scene: the last naive frame says deadlock');
  t.ok(fr[fr.length - 1].items.filter((it) => it.kind === 'edge' && /hot/.test(it.cls)).length === 6, 'scene: six pink arrows close the cycle');
}
const bt = bb.trace({ size: 3, producers: 3, consumers: 1, seed: 2 });
t.ok(bt.run.steps.some((s) => s.kind === 'block' && s.op === 'wait' && /empty/.test(s.say)), 'scene: with three producers and one consumer, a producer waits on empty');
// the picture follows the inputs: as many ring slots as the slots input, and the same N in the counts and the words
for (const narrow of [false, true]) for (let size = 2; size <= 8; size++) for (const [P, C] of [[1, 1], [3, 1], [2, 4]]) {
  const knobs = { size, producers: P, consumers: C, seed: size + P };
  const fr = bb.frames({ narrow, knobs }), T = bb.trace(knobs), at = 'scene buffer ' + size + '/' + P + '/' + C + (narrow ? ' (narrow)' : '');
  t.ok(fr.every((f) => f.items.filter((it) => /^rg:k\d+$/.test(it.key)).length === size), at + ': every frame draws ' + size + ' slots');
  t.ok(fr.every((f) => { const c = f.items.find((it) => it.key === 'rg:count'); return c && new RegExp(' of ' + size + ' full$').test(c.text); }), at + ': the centre counts out of ' + size);
  t.ok(fr[0].say.includes('`' + size + '` slots') && fr[0].items.find((it) => it.key === 'smempty:val').text === String(size), at + ': the narration and empty start at ' + size);
  t.ok(T.run.steps.every((s) => s.state.vars.buf.length === size && s.state.vars.in < size && s.state.vars.out < size), at + ': the engine ring has ' + size + ' slots');
  t.ok(fr.every((f) => f.items.filter((it) => /^c[pc]:t[PC]\d+$/.test(it.key)).length === P + C), at + ': every thread is marked in a program');
}
// ---- phase 2: the rest of the primitive layer, worked by hand ---------------------------------------------------------
const run = (spec, order) => Y.run(spec, { policy: 'manual', order });
{
  // reader–writer locks: R1 reads; W waits; R2 arrives: reader preference lets R2 in, writer preference and fair do not
  const mk = (policy) => ({ threads: [{ name: 'R1', prog: [{ op: 'rlock', l: 'L' }, { op: 'runlock', l: 'L' }] }, { name: 'W', prog: [{ op: 'wlock', l: 'L' }, { op: 'wunlock', l: 'L' }] }, { name: 'R2', prog: [{ op: 'rlock', l: 'L' }, { op: 'runlock', l: 'L' }] }], rwlocks: [{ id: 'L', policy }] });
  for (const [policy, r2] of [['reader', 'acquire'], ['writer', 'block'], ['fair', 'block']]) {
    const r = run(mk(policy), ['R1', 'W', 'R2']);
    t.eq(r.steps.map((s) => s.kind), ['acquire', 'block', r2], 'rwlock ' + policy + ': R1 in, W waits, R2 ' + (r2 === 'acquire' ? 'joins R1' : 'waits behind W'));
  }
  const f = run(mk('fair'), ['R1', 'W', 'R2', 'R1', 'W']);
  t.eq(f.steps[3].woke, [1], 'fair: when R1 leaves, W (first in line) gets the lock');
  t.eq(f.steps[4].woke, [2], 'fair: and then R2');
  const w = run(mk('writer'), ['R1', 'W', 'R2', 'R1']);
  t.eq(w.steps[3].state.rw.L.writer, 1, 'writer preference: W writes before R2 reads');
  const rr = run(Object.assign(mk('reader'), {}), ['R1', 'W', 'R2', 'R1', 'R2']);
  t.eq(rr.steps[4].state.rw.L.writer, 1, 'reader preference: W gets in only when the last reader leaves');
}
{
  // a barrier of three
  const spec = { threads: ['A', 'B', 'C'].map((n) => ({ name: n, prog: [{ op: 'barrier', b: 'b' }, { op: 'work' }] })), barriers: [{ id: 'b', n: 3 }] };
  const r = run(spec, ['A', 'B', 'C', 'A', 'B', 'C']);
  t.eq(r.steps.map((s) => s.kind), ['block', 'block', 'release', 'work', 'work', 'work'], 'barrier: two wait, the third releases all');
  t.eq(r.steps[2].woke, [0, 1], 'barrier: the first two wake together');
}
{
  // Hoare against Mesa: after the signal, who runs inside the monitor?
  const mk = (hoare) => ({ hoare, threads: [{ name: 'W', prog: [{ op: 'lock', m: 'm' }, { op: 'cwait', c: 'c', m: 'm' }, { op: 'write', v: 'x', val: 1 }, { op: 'unlock', m: 'm' }] }, { name: 'S', prog: [{ op: 'lock', m: 'm' }, { op: 'signal', c: 'c' }, { op: 'write', v: 'x', val: 2 }, { op: 'unlock', m: 'm' }] }], mutexes: ['m'], conds: ['c'], vars: { x: 0 } });
  const h = run(mk(true), ['W', 'W', 'S', 'S', 'W', 'W', 'S', 'S']);
  t.eq(h.steps[3].state.mutex.m.owner, 0, 'Hoare: the signal hands the monitor to W at once');
  t.eq(h.steps[3].state.threads[1].state, 'blocked', 'Hoare: the signaller waits');
  t.eq(h.steps[5].woke, 1, 'Hoare: when W leaves, S gets the monitor back first');
  t.eq(h.steps.map((s) => s.state.vars.x).slice(-1)[0], 2, 'Hoare: W wrote first, then S');
  t.eq(h.end.kind, 'done', 'Hoare: both finish');
  const m = run(mk(false), ['W', 'W', 'S', 'S', 'S', 'S', 'W', 'W']);
  t.eq(m.steps[3].state.mutex.m.owner, 1, 'Mesa: the signaller keeps the mutex');
  t.eq(m.steps.map((s) => s.state.vars.x).slice(-1)[0], 1, 'Mesa: S wrote first, then W');
}
{
  // the atomics, trylock, binary semaphores, jumps, choose and rounds
  const spec = { threads: [{ name: 'A', reg: {}, prog: [{ op: 'tas', v: 'l', into: 'o' }, { op: 'tas', v: 'l', into: 'o2' }, { op: 'cas', v: 'c', expect: 0, val: 5, into: 'ok' }, { op: 'cas', v: 'c', expect: 0, val: 6, into: 'ok2' }, { op: 'faa', v: 'n', by: 2, into: 'f' }, { op: 'xchg', v: 'p', val: 'new', into: 'old' }] }], vars: { l: 0, c: 0, n: 3, p: 'was' } };
  const r = Y.run(spec, {}), reg = r.steps[r.steps.length - 1].state.threads[0].reg, V = r.steps[r.steps.length - 1].state.vars;
  t.eq([reg.o, reg.o2, reg.ok, reg.ok2, reg.f, reg.old], [0, 1, 1, 0, 3, 'was'], 'tas, tas, cas, cas, faa, xchg return what they should');
  t.eq([V.l, V.c, V.n, V.p], [1, 5, 5, 'new'], 'and leave memory as they should');
  const tl = run({ threads: [{ name: 'A', prog: [{ op: 'lock', m: 'm' }, { op: 'work' }] }, { name: 'B', prog: [{ op: 'trylock', m: 'm', into: 'got' }] }], mutexes: ['m'] }, ['A', 'B']);
  t.eq([tl.steps[1].kind, tl.steps[1].state.threads[1].reg.got, tl.steps[1].state.threads[1].state], ['try-fail', 0, 'done'], 'trylock fails without blocking');
  const bin = run({ threads: [{ name: 'A', prog: [{ op: 'post', s: 'b' }, { op: 'post', s: 'b' }] }], sems: [{ id: 'b', init: 0, binary: true }] }, ['A', 'A']);
  t.eq(bin.steps.map((s) => s.state.sem.b.value), [1, 1], 'a binary semaphore stays at 1');
  const lp = Y.run({ threads: [{ name: 'A', prog: [{ label: 'top' }, { op: 'update', v: 'k', by: 1 }, { op: 'read', v: 'k', into: 'k' }, { op: 'jump', to: 'top', if: (r) => r.k < 4 }] }], vars: { k: 0 } }, {});
  t.eq(lp.steps[lp.steps.length - 1].state.vars.k, 4, 'labels and conditional jumps loop until k = 4');
  const it = Y.run({ threads: [{ name: 'A', loop: true, iters: 3, prog: [{ op: 'eat' }] }] }, {});
  t.eq([it.end.kind, it.machine.threads[0].meals], ['done', 3], 'iters: a looping program stops after its rounds');
  const M = Y.machine({ threads: [{ name: 'A', prog: [{ op: 'choose', n: 3, into: 'k' }, { op: 'write', v: 'x', val: (r) => r.k }] }], vars: { x: -1 } });
  t.eq(M.choices(), ['c0:0', 'c0:1', 'c0:2'], 'choose offers one choice per value');
  M.step('c0:2'); M.step(0);
  t.eq(M.vars.x, 2, 'and the chosen value is the one used');
}
{
  // store buffers: a store is invisible to others until flushed; a fence drains it
  const spec = { tso: true, threads: [{ name: 'A', prog: [{ op: 'write', v: 'x', val: 1 }, { op: 'read', v: 'x', into: 'mine' }, { op: 'fence' }] }, { name: 'B', prog: [{ op: 'read', v: 'x', into: 'seen' }, { op: 'read', v: 'x', into: 'later' }] }], vars: { x: 0 } };
  const M = Y.machine(spec);
  M.step(0); M.step(0); M.step(1);
  t.eq([M.threads[0].reg.mine, M.threads[1].reg.seen, M.vars.x], [1, 0, 0], 'tso: A reads its own store, B still sees 0, memory holds 0');
  t.eq(M.choices().includes('f0'), true, 'tso: the buffered store can be flushed as a step of its own');
  M.step(0); M.step(1);
  t.eq([M.vars.x, M.threads[1].reg.later, M.threads[0].sb.length], [1, 1, 0], 'tso: the fence drains the buffer, and then B sees 1');
}
{
  // clone and hash: a clone runs on independently; equal states hash equal, step counts do not matter
  const spec = Y.philosophers(3, 'ordered'), A = Y.machine(spec, { light: true });
  A.step(0); A.step(1);
  const B = A.clone();
  B.step(2);
  t.ok(A.hash() !== B.hash() && A.threads[2].pc === 0, 'a clone steps on its own');
  const C = Y.machine(spec, { light: true }); C.step(1); C.step(0);
  t.eq(C.hash(), A.hash(), 'the same state reached in another order hashes the same');
  // symmetry: two readers swapped give the same canonical hash
  const rw = Y.readersWriters('fair', 2, 1), P = Y.machine(rw, { light: true }), Q = Y.machine(rw, { light: true });
  P.step(0); Q.step(1);
  t.ok(P.hash() !== Q.hash() && P.canon() === Q.canon(), 'symmetric readers: different states, one canonical form');
}
{
  // a monitor: a counter whose take() waits while it is zero
  const take = Y.monitor('mon', [{ label: 'chk' }, { op: 'read', v: 'n', into: 'k' }, { op: 'jump', to: 'go', if: (r) => r.k > 0 }, { op: 'cwait', c: 'pos' }, { op: 'jump', to: 'chk' }, { label: 'go' }, { op: 'update', v: 'n', by: -1 }]);
  const give = Y.monitor('mon', [{ op: 'update', v: 'n', by: 1 }, { op: 'signal', c: 'pos' }]);
  const spec = { threads: [{ name: 'T', prog: take }, { name: 'G', prog: give }], mutexes: ['mon'], conds: ['pos'], vars: { n: 0 } };
  t.eq(take[0].op + '/' + take[take.length - 1].op + '/' + take.find((o) => o.op === 'cwait').m, 'lock/unlock/mon', 'monitor: enter, leave, and waits on its own mutex');
  const r = S.MC.check(S.MC.maker(spec), { invariants: [{ name: 'n never below 0', holds: (M) => M.vars.n >= 0 }] });
  t.eq(r.verdict, 'ok', 'monitor: under every schedule take() never drives n below 0 and nothing deadlocks');
}

// ---- lock-based data structures ----------------------------------------------------------------------------------------
{
  const X = Y.structs;
  // an independent sequential model: the same operations on a plain JS set and array, thread after thread
  const seqSet = (init, ops) => { const set = new Set(init); for (const list of ops) for (const op of list) { if (op.op === 'insert') set.add(op.k); if (op.op === 'delete') set.delete(op.k); } return [...set].sort((a, b) => a - b); };
  const R2 = rng(7);
  for (let trial = 0; trial < 60; trial++) {
    const n = 1 + Math.floor(R2() * 3), init = [5, 9, 14].filter(() => R2() < 0.7);
    const ops = Array.from({ length: n }, () => Array.from({ length: 1 + Math.floor(R2() * 4) }, () => ({ op: ['insert', 'delete', 'lookup'][Math.floor(R2() * 3)], k: 1 + Math.floor(R2() * 16) })));
    const want = seqSet(init, ops);
    for (const v of ['coarse', 'hoh', 'hoh-broken']) {
      const sp = X.list(v, init, ops), r = Y.run(sp, { policy: 'fifo' });
      t.eq(sp.final(r.machine), want, 'list ' + v + ' ' + trial + ': one thread after another gives what a plain set gives');
    }
    for (const v of ['coarse', 'bucket']) { const sp = X.hash(v, 3, init, ops), r = Y.run(sp, { policy: 'fifo' }); t.eq(sp.final(r.machine), want, 'hash ' + v + ' ' + trial + ': the same'); }
    for (const v of ['coarse', 'hoh']) {
      const sp = X.list(v, init, ops), r = Y.run(sp, { policy: 'random', seed: trial + 1, max: 5000 });
      t.eq(r.end.kind, 'done', 'list ' + v + ' ' + trial + ': a random interleaving finishes');
      t.ok(sp.final(r.machine).every((x, i, a) => i === 0 || a[i - 1] < x), 'list ' + v + ' ' + trial + ': and the list is still sorted');
    }
  }
  // the queue: one thread after another is first in, first out
  const q = X.queue('two-lock', [[{ op: 'enq', v: 'a' }, { op: 'enq', v: 'b' }, { op: 'deq' }], [{ op: 'deq' }, { op: 'deq' }]]), qr = Y.run(q, { policy: 'fifo' });
  t.eq(qr.machine.vars.out, ['a', 'b'], 'queue: what goes in comes out in order');
  t.eq(q.final(qr.machine), [], 'queue: and an empty queue is left (the third dequeue found it empty)');
  // the sloppy counter: the global value lags, by at most S per thread (S × threads in all), and is exact at the end
  const sc = X.counter('sloppy', [5, 5, 5], { threshold: 3 }), sr = Y.run(sc, { policy: 'random', seed: 2 });
  const lag = sr.steps.map((s2) => s2.state.threads.reduce((a, th) => a + (th.reg.n || 0), 0) - s2.state.vars.g);
  t.ok(lag.every((x) => x >= 0 && x <= 9) && lag.some((x) => x > 0), 'sloppy counter: the global count lags by at most S per thread, 3 × S in all (most ' + Math.max(...lag) + ')');
  t.eq(sr.machine.vars.g, 15, 'sloppy counter: exact once every thread has flushed');
  // the throughput model
  const sc1 = Y.scaling('hash', 'coarse'), sc2 = Y.scaling('hash', 'bucket');
  t.eq(JSON.stringify(Y.scaling('hash', 'bucket')), JSON.stringify(sc2), 'scaling: the same seed, the same numbers');
  t.ok(sc2[3].throughput > 2 * sc1[3].throughput, 'scaling: with 8 threads a lock per bucket beats one lock (' + sc2[3].throughput.toFixed(2) + ' against ' + sc1[3].throughput.toFixed(2) + ' ops a tick)');
  t.ok(sc1[3].waitPerOp > sc1[1].waitPerOp, 'scaling: with one lock, waiting grows with the threads');
  const fa = Y.scaling('counter', 'faa');
  t.ok(fa.every((p, i) => i === 0 || p.throughput > fa[i - 1].throughput), 'scaling: fetch-and-add keeps scaling');
  const lk = Y.scaling('counter', 'lock'), sl = Y.scaling('counter', 'sloppy');
  t.ok(sl[3].throughput > lk[3].throughput && lk[3].throughput < 2 * lk[1].throughput, 'scaling: one lock flattens out, the sloppy counter does better');
  t.ok(Y.scaling('queue', 'two-lock')[3].throughput > Y.scaling('queue', 'one-lock')[3].throughput, 'scaling: two queue locks beat one');
  t.ok(Y.scaling('list', 'hoh')[3].waitPerOp < Y.scaling('list', 'coarse')[3].waitPerOp, 'scaling: hand-over-hand waits less than one list lock');
  t.ok(Y.scaling('list', 'hoh')[0].stepsPerOp > Y.scaling('list', 'coarse')[0].stepsPerOp, 'scaling: but costs more steps per operation alone (a lock per node)');
}
// every ready-made program runs under the ordinary scheduler and narrates every step
for (const e of Y.catalog.filter((x) => !x.system)) {
  const r = Y.run(e.build(), { policy: 'random', seed: 3, max: 120 });
  t.ok(r.steps.length > 0 && r.steps.every((s) => typeof s.say === 'string' && !/undefined|NaN/.test(s.say)), e.id + ': runs and narrates every step');
}
t.done();
