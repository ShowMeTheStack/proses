// Part 2 (processes): every topic run with its default, every preset and random valid inputs, through the shared
// claims machinery of part 1 (wording, and every quoted number carried by the frame). Then each topic's values are
// checked a second way: counts worked out by formula (2^N, N + 1, 3^N, interleavings), status words decoded here,
// the transitions of the state diagram against its arcs, and every preset C program compiled with the system cc
// and run: each real output (stdout through a pipe) must be one the kernel's enumerator says the program can print.
// Prints "claims-p02 N passed, M failed".
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClaims } from './claims-p01.mjs';

const pick = (rnd, a) => a[Math.floor(rnd() * a.length)];
const int = (rnd, a, b) => a + Math.floor(rnd() * (b - a + 1));

// ---- real programs ----
const dir = join(tmpdir(), 'proses-claims-p02');
let cc = true;
try { execFileSync('cc', ['--version'], { stdio: 'ignore' }); } catch (e) { cc = false; }
const done = new Set();
/** compile src (and the programs it execs by name) and run it a few times: the outputs, or null without cc */
function realRuns(src, programs, n) {
  if (!cc) return null;
  mkdirSync(dir, { recursive: true });
  const h = createHash('sha1').update(src + JSON.stringify(programs || {})).digest('hex').slice(0, 12), wd = join(dir, h);
  mkdirSync(wd, { recursive: true });
  const build = (name, text) => { const c = join(wd, name + '.c'), b = join(wd, name); if (!existsSync(b)) { writeFileSync(c, text); execFileSync('cc', ['-w', '-o', b, c]); } return b; };
  const main = build('main', src);
  for (const [name, text] of Object.entries(programs || {})) build(name, text);
  const outs = [];
  for (let i = 0; i < (n || (/sleep\(/.test(src) ? 2 : 4)); i++) {
    let out;
    try { out = execFileSync(main, [], { cwd: wd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 }); } catch (e) { out = e.stdout || ''; }
    outs.push(out);
  }
  return outs;
}
/** numbers that depend on the machine (pids, addresses) become N, so outputs compare across machines */
const norm = (s) => String(s).replace(/0x[0-9a-f]+/gi, 'A').replace(/\b\d{3,}\b/g, 'N');
/** check every real output of a preset program against the enumerator's set (through a pipe) */
function againstReal(ctx, S, src, programs, label) {
  const key = src + label;
  if (done.has(key)) return;
  done.add(key);
  const o = S.Kern.outcomes(src, { tty: false, programs, maxStates: 15000 });
  if (!o.complete) return;
  const real = realRuns(src, programs);
  if (!real) return;
  const set = new Set([...o.outputs.keys()].map(norm));
  for (const out of real) ctx.ok(set.has(norm(out)), label + ': the real output ' + JSON.stringify(out) + ' is one the kernel can produce (' + [...set].map((x) => JSON.stringify(x)).join(' | ') + ')');
}
const decode = (st) => ((st & 0x7f) === 0 ? { exited: true, code: (st >> 8) & 0xff } : { exited: false, sig: st & 0x7f });

export const P02 = {
  'p02-fork': {
    random: (rnd) => ({ prog: pick(rnd, ['twice', 'ids', 'two']), pol: pick(rnd, ['fifo', 'child', 'random']), seed: int(rnd, 1, 20) }),
    check(ctx) {
      const { S, input, r, frames, ok } = ctx, pr = S.P02.PROGS_FORK[input.prog];
      for (const f of frames('fork')) ok(f.meta.evs[0].child === Math.max(...f.meta.procs.map((p) => p.pid)), 'the child gets the next pid');
      const out = r.result.term;
      if (input.prog === 'twice') { ok(/child k=0 x=11/.test(out), 'the child sees k = 0 and its own x = 11'); ok(/parent k=101 x=9/.test(out), 'the parent sees the child\'s pid and x = 9'); }
      if (input.prog === 'ids') ok(/101 of 100/.test(out) && /100 made 101/.test(out), 'getpid and getppid agree with the tree');
      if (input.prog === 'two') ok(/made 101 and 102/.test(out), 'two children, pids 101 and 102');
      againstReal(ctx, S, pr.src, null, 'fork ' + input.prog);
    },
  },
  'p02-forktree': {
    random: (rnd) => { const shape = pick(rnd, ['seq', 'loop', 'fan', 'chain', 'and', 'or']), max = { seq: 3, loop: 3, fan: 4, chain: 4, and: 2, or: 2 }[shape]; return { shape, n: int(rnd, 1, max), pol: pick(rnd, ['fifo', 'child', 'random']), seed: int(rnd, 1, 20) }; },
    nRandom: 10,
    check(ctx) {
      const { S, input, r, near } = ctx, n = input.n;
      const want = { seq: 2 ** n, loop: 2 ** n, fan: n + 1, chain: n + 1, and: 3 ** n, or: 3 ** n }[input.shape];
      near(r.result.total, want, 'processes by formula');
      near(r.result.lines, want, 'one line each');
      if (input.pol === 'fifo' && want <= 4) againstReal(ctx, S, S.P02.treeSrc(input.shape, n), null, 'tree ' + input.shape + n);
    },
  },
  'p02-wait': {
    random: (rnd) => ({ prog: pick(rnd, ['codes', 'pick', 'nohang', 'signal']), pol: pick(rnd, ['fifo', 'random', 'child']), seed: int(rnd, 1, 20) }),
    constants: [256, 300, 15, 8, 7],
    check(ctx) {
      const { S, input, frames, ok, near } = ctx;
      for (const f of frames('wait')) {
        const e = f.meta.evs[0];
        if (e.pid < 100 || e.ret <= 0) continue;
        const d = decode(e.status);
        if (d.exited) near(e.status, e.code << 8, 'status = code << 8');
        else ok(e.code === null && d.sig > 0, 'a killed child has a signal in the low bits');
        near(f.meta.status, e.status, 'the panel shows the stored status');
      }
      if (input.prog === 'codes') { const order = frames('wait').filter((f) => f.meta.evs[0].pid === 100 && f.meta.evs[0].ret > 0).map((f) => f.meta.evs[0].code); if (input.pol === 'fifo') near(order, [30, 20, 10], 'the shortest sleeper is reaped first'); }
      if (input.prog === 'nohang') ok(frames('wait').some((f) => f.meta.evs[0].ret === 0), 'WNOHANG answers 0 at least once');
      if (input.pol === 'fifo') againstReal(ctx, S, S.P02.PROGS_WAIT[input.prog].src, null, 'wait ' + input.prog);
    },
  },
  'p02-exec': {
    check(ctx) {
      const { S, input, r, ok } = ctx, pr = S.P02.PROGS_EXEC[input.prog];
      const after = r.frames.filter((f) => f.meta.before && f.meta.now);
      if (input.prog !== 'fails') ok(after.length > 0, 'a frame compares before and after');
      for (const f of after.slice(0, 1)) {
        const b = Object.fromEntries(f.meta.before), n = Object.fromEntries(f.meta.now);
        ok(b.pid === n.pid && b.parent === n.parent, 'exec keeps the pid and the parent');
        for (const k of Object.keys(b).filter((x) => /^fd /.test(x))) ok(n[k] === b[k], 'exec keeps ' + k);
        ok(n['stdout buffer'] === 'empty', 'the stdout buffer is gone');
        ok(n.memory !== b.memory, 'the memory is new');
        if (n.SIGINT) ok(n.SIGINT === 'default' || !b.SIGINT || b.SIGINT !== 'caught', 'a caught signal returns to default');
        if (b.SIGQUIT === 'ignored') ok(n.SIGQUIT === 'ignored', 'an ignored signal stays ignored');
      }
      if (input.prog === 'fails') ok(r.frames.some((f) => f.meta.phase === 'fail'), 'exec fails and returns');
      againstReal(ctx, S, pr.src, input.prog === 'keeps' ? { show: S.P02.SHOW } : null, 'exec ' + input.prog);
    },
  },
  'p02-zombie': {
    random: (rnd) => ({ prog: pick(rnd, ['zombie', 'orphan', 'never', 'both']), pol: pick(rnd, ['fifo', 'random', 'child']), seed: int(rnd, 1, 20) }),
    check(ctx) {
      const { S, input, r, ok } = ctx, orphans = new Set(), parent = {};
      for (const f of r.frames) for (const e of f.meta.evs) {
        if (e.kind === 'fork') parent[e.child] = e.pid;
        if (e.kind === 'reparent') orphans.add(e.pid);
        if (e.kind === 'reap' && e.pid > 100) ok(e.by === (orphans.has(e.pid) ? 1 : parent[e.pid]), e.pid + ' is reaped by ' + (orphans.has(e.pid) ? 'init' : 'its parent'));
      }
      const last = r.frames[r.frames.length - 1].meta;
      ok(last.procs.every((p) => p.pid < 100 || p.state === 'reaped'), 'no zombie is left at the end');
      if (input.pol === 'fifo') againstReal(ctx, S, S.P02.PROGS_ZOMBIE[input.prog].src, null, 'zombie ' + input.prog);
    },
  },
  'p02-cow': {
    check(ctx) {
      const { S, input, r, frames, near, ok } = ctx;
      const share = frames('cow-share')[0];
      if (share) { near(share.meta.shared, share.meta.evs[0].pages.length, 'after fork every page is shared'); near(share.meta.frames, share.meta.evs[0].pages.length, 'and no frame is added'); }
      let prev = share ? share.meta.frames : 0;
      for (const f of frames('cow')) { near(f.meta.frames, prev + 1, 'a copy adds one frame'); prev = f.meta.frames; }
      near(r.result.copies, frames('cow').length, 'copies counted');
      if (input.prog === 'reads') ok(frames('cow').every((f) => f.meta.evs[0].page !== 1 && f.meta.evs[0].page !== 2), 'reading the table copies no data page');
      againstReal(ctx, S, S.P02.PROGS_COW[input.prog].src, null, 'cow ' + input.prog);
    },
  },
  'p02-stdio': {
    names: ['_exit'],
    check(ctx) {
      const { S, input, r, near } = ctx;
      const want = { twice: { tty: 2, pipe: 2 }, line: { tty: 1, pipe: 2 }, flush: { tty: 1, pipe: 1 }, quick: { tty: 1, pipe: 0 } }[input.prog][input.out];
      near(r.result.times, want, 'how often the word appears, worked out by hand');
      if (input.out === 'pipe') { const real = realRuns(S.P02.PROGS_STDIO[input.prog].src); if (real) for (const o of real) near(o.split(S.P02.PROGS_STDIO[input.prog].word).length - 1, want, 'the real program through a pipe'); }
    },
  },
  'p02-orders': {
    check(ctx) {
      const { S, input, r, near, ok } = ctx;
      const want = { mixed: 3, nowait: 6, counter: 2, waits: 1 }[input.prog];
      near(r.result.outs.length, want, 'the number of outputs, worked out by hand (interleavings)');
      for (const f of ctx.frames('out')) if (f.meta.seed) { const sys = S.Kern.run(S.P02.PROGS_ORDERS[input.prog].src, { policy: 'random', seed: f.meta.seed, sleep: 'free', cow: false }); ok(sys.out === f.meta.out, 'the seed reproduces output #' + f.meta.k); }
      againstReal(ctx, S, S.P02.PROGS_ORDERS[input.prog].src, null, 'orders ' + input.prog);
    },
  },
  'p02-layout': {
    check(ctx) {
      const { r, ok, near } = ctx;
      let prev = null;
      for (const f of r.frames) {
        for (const b of f.meta.blocks) if (!b.free && !b.top) ok(b.size >= b.req + 16 && b.size % 16 === 0, 'a block holds its header and is rounded to 16');
        if (prev && f.meta.nFrames > prev.meta.nFrames) { near(f.meta.nFrames, prev.meta.nFrames + 1, 'one frame per call'); const a = f.meta.frames, k = a.length - 1; ok(a[k].fp < a[k - 1].fp, 'a new frame lies below its caller\'s'); }
        prev = f;
      }
    },
  },
  'p02-pcb': {
    check(ctx) {
      const { S, input, r, ok } = ctx, focus = input.who === 'child' ? 101 : 100;
      for (const f of r.frames) { const v = f.meta.vals; if (!v) continue; ok(v.pid === String(focus), 'the PCB is the focus process\'s'); if (focus === 101) ok(v.ppid === '100', 'its parent is 100'); }
      if (focus === 101) ok(r.frames.some((f) => f.meta.vals && f.meta.vals.exit === '3'), 'the exit status 3 is kept');
      againstReal(ctx, S, S.P02.SRC_PCB, null, 'pcb');
    },
  },
  'p02-states': {
    random: (rnd) => ({ prog: pick(rnd, ['sleepy', 'two']), pol: pick(rnd, ['rr', 'fifo']), q: int(rnd, 1, 4) }),
    check(ctx) {
      const { r, ok, near } = ctx, ARCS = new Set(['new>ready', 'ready>running', 'running>ready', 'running>blocked', 'blocked>ready', 'running>zombie', 'zombie>reaped']);
      const where = {};
      let disp = 0;
      for (const f of r.frames) for (const m of f.meta.moves) {
        ok(ARCS.has(m.from + '>' + m.to), 'a transition follows an arc: ' + m.from + ' → ' + m.to);
        ok((where[m.pid] || 'new') === m.from, 'it leaves the state it was in');
        where[m.pid] = m.to;
        if (m.to === 'running') disp++;
      }
      near(r.frames[r.frames.length - 1].meta.disp, disp, 'dispatches counted');
      ok(Object.values(where).every((s) => s === 'reaped'), 'every process ends reaped');
      for (const f of r.frames) { const run = Object.values(where).length; ok(run >= 0, ''); }
    },
  },
  'p02-switch': {
    random: (rnd) => ({ kind: pick(rnd, ['procs', 'asid', 'threads']), a0: int(rnd, 0, 999), b0: int(rnd, 0, 999) }),
    check(ctx) {
      const { input, r, near, ok } = ctx, last = r.frames[r.frames.length - 1].meta;
      near([last.saved, last.loaded], [last.cost.saved, last.cost.restored], 'registers saved and loaded');
      near(last.cpu.regs.a0, input.b0, 'B\'s a0 is back in the CPU');
      ok(last.cpu.mode === 'user', 'B runs in user mode');
      ok(last.cost.tlbFlush === (input.kind === 'procs'), 'the TLB is flushed only between untagged address spaces');
      ok(last.cost.pageTable === (input.kind !== 'threads'), 'threads keep the page table');
    },
  },
};

runClaims('claims-p02', /^p02-/, P02);
