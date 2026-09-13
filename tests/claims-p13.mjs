// Part 13, I/O systems: every preset and random inputs of each topic; every number in the narration must be in the
// frame's values (tests/claims-lib-p12.mjs), and those values are worked out again here apart from the engines:
// the transfer times by closed formulas, the I/O-mode timelines by a small event model of their own, buffering by
// its steady-state formulas and a direct simulation, the cache by an LRU list kept here, the spool by hand, the
// request queue by re-sorting, and the read path by summing the layer costs.
// Usage: node tests/claims-p13.mjs [topic id ...]
import { setup, runPart, pick, int } from './claims-lib-p12.mjs';

const { S, t, rnd } = setup('claims-p13');
const only = process.argv.slice(2);
const close = (a, b, tol = 0.002) => Math.abs(a - b) <= tol + 1e-9 * Math.abs(b);
const D = () => S.IO.defaults;

// ---- the three transfers by formula ----
function hand(mode, o) {
  const a = Object.assign({}, D(), o), units = Math.ceil(a.bytes / a.unit);
  if (mode === 'polling') {
    const n = Math.max(1, Math.ceil(a.device / a.poll - 1e-9) + 1), per = a.cmd + n * a.poll + a.copy, time = units * per;
    return { time, cpuBusy: time, polls: units * n, interrupts: 0, n, units };
  }
  if (mode === 'interrupt') {
    const time = units * (a.cmd + a.device + a.irq + a.copy);
    return { time, cpuBusy: time - units * a.device, polls: 0, interrupts: units, units };
  }
  const per = Math.max(1, Math.ceil((a.dmaBlock || a.bytes) / a.unit)), blocks = Math.ceil(units / per);
  const time = blocks * (a.dmaSetup + a.cmd + a.bus + a.irq) + units * a.device;
  return { time, cpuBusy: blocks * (a.dmaSetup + a.cmd + a.irq), polls: 0, interrupts: blocks, units, blocks };
}
const xferRandom = (mode) => (r) => {
  const unit = pick(r, [1, 2, 4, 8, 16]), bytes = int(r, 1, unit * pick(r, [4, 12, 40])), v = { bytes, unit, device: pick(r, [0.3, 1, 2.5, 10, 37, 150]), cmd: pick(r, [0.5, 1, 2]) };
  if (mode === 'polling') Object.assign(v, { poll: pick(r, [0.1, 0.5, 1.5]), copy: pick(r, [0.2, 0.5]) });
  if (mode === 'interrupt') Object.assign(v, { copy: pick(r, [0.2, 0.5]), irq: pick(r, [1, 4, 9]) });
  if (mode === 'dma') Object.assign(v, { dmaSetup: pick(r, [2, 5]), dmaBlock: pick(r, [0, unit * 3, unit * 8]), bus: pick(r, [0.1, 0.2, 1]), irq: pick(r, [1, 4]) });
  return v;
};
const xferCheck = (mode) => ({ input, r, fail, pass }) => {
  const h = hand(mode, input), m = r.frames[0].meta, T = m.totals;
  (close(T.time, h.time) && close(T.cpuBusy, h.cpuBusy) && T.polls === h.polls && T.interrupts === h.interrupts ? pass : fail)(mode + ' totals ' + JSON.stringify(T) + ', by formula ' + JSON.stringify(h));
  (close(T.cpuShare, h.cpuBusy / h.time, 0.0006) ? pass : fail)('share');
  for (const f of r.frames) {
    const q = f.meta;
    if (q.phase === 'poll') (q.polls === h.n ? pass : fail)('polls a unit ' + q.polls + ', by hand ' + h.n);
    if (q.phase === 'cmd' || q.phase === 'poll' || q.phase === 'copy') (q.busy <= q.now + 1e-9 ? pass : fail)('busy within time');
    if (mode === 'polling') (close(q.busy, q.now) ? pass : fail)('polling keeps the CPU busy throughout');
    if (q.phase === 'irq' && mode === 'dma') { const per = Math.max(1, Math.ceil((input.dmaBlock || input.bytes) / input.unit)); (q.n === Math.min(per, h.units - q.block * per) ? pass : fail)('units in block'); }
  }
  const L = r.frames.at(-1);
  (L.counters.busy === T.cpuBusy || close(L.counters.busy, T.cpuBusy) ? pass : fail)('counter at the end');
};


// ---- the I/O modes: closed forms for the blocking read, and invariants of every timeline ----
function modeChecks(kind, a, res, fail, pass) {
  const sum = (L, f) => L.filter(f).reduce((n, s) => n + s.to - s.from, 0);
  // the CPU lane covers [0, end] without gaps or overlaps
  let tt = 0, ok = true;
  for (const s of res.lanes.cpu) { if (!close(s.from, tt)) ok = false; tt = s.to; }
  (ok && close(tt, res.end) ? pass : fail)(kind + ': the CPU lane is continuous');
  (close(sum(res.lanes.cpu, (s) => s.who === 'B'), a.other) ? pass : fail)(kind + ': B gets exactly its computing');
  (close(res.cpu.A, sum(res.lanes.A, (s) => s.state === 'user' || s.state === 'kernel')) ? pass : fail)(kind + ': A’s CPU time from its own lane');
  (close(sum(res.lanes.device, () => true), a.device) ? pass : fail)(kind + ': the device works once');
  const calls = Math.round(res.lanes.A.filter((s) => s.state === 'kernel' && /\(\)/.test(s.label)).reduce((n, s) => n + s.to - s.from, 0) / a.syscall);
  (calls === res.syscalls ? pass : fail)(kind + ': system calls ' + res.syscalls + ', counted on the lane ' + calls);
  if (kind === 'blocking') {
    const fa = a.syscall + a.device + a.irq + a.copy + a.work + a.use;
    (close(res.finishA, fa) ? pass : fail)('blocking: A done at ' + res.finishA + ', by hand ' + fa);
    (res.syscalls === 1 ? pass : fail)('blocking: one call');
  }
  if (kind === 'nonblocking') (res.syscalls === res.retries + 2 ? pass : fail)('non-blocking: the first call, the retries and the one that finds the data');
  const busy = res.cpu.A + res.cpu.B + res.cpu.irq;
  (close(busy + res.cpu.idle, res.end) ? pass : fail)(kind + ': busy + idle = end');
}
const modeRandom = (r) => ({ device: int(r, 1, 120), work: int(r, 0, 80), use: int(r, 0, 30), other: pick(r, [0, 10, 40, 150]), syscall: pick(r, [1, 2, 3.5]), copy: pick(r, [1, 3]), slice: int(r, 1, 20) });

const mods = {
  'io-buffering': {
    random: (r) => { const v = (a) => (r() < 0.7 ? [String(pick(r, a))] : [...Array(int(r, 2, 5))].map(() => String(pick(r, a)))); return { kind: pick(r, ['none', 'single', 'double', 'circular']), blocks: int(r, 2, 12), fill: v([1, 4, 10, 20]), move: pick(r, [0, 1, 2, 3.5]), compute: v([2, 6, 12]), slots: int(r, 2, 6) }; },
    check({ input, r, fail, pass }) {
      const m = r.frames[0].meta, n = input.blocks, F = input.fill.map(Number), C = input.compute.map(Number), M = input.move, k = { none: 0, single: 1, double: 2, circular: input.slots }[input.kind];
      if (F.length === 1 && C.length === 1) {
        const T0 = F[0], C0 = C[0];
        const want = !k ? n * (T0 + C0) : k === 1 ? T0 + M + C0 + (n - 1) * (Math.max(T0, C0) + M) : (T0 >= C0 + M ? n * T0 + M + C0 : T0 + n * (M + C0));
        (close(m.total, want) ? pass : fail)(input.kind + ' total ' + m.total + ', by the closed form ' + want);
      }
      const T0 = F[0], C0 = C[0], per = !k ? T0 + C0 : k === 1 ? Math.max(T0, C0) + M : Math.max(T0, C0 + M);
      (close(m.perBlock, per) ? pass : fail)('steady state ' + m.perBlock + ', by hand ' + per);
      (close(m.unbuffered, F.length === 1 && C.length === 1 ? n * (F[0] + C[0]) : [...Array(n)].reduce((x, _, i) => x + F[i % F.length] + C[i % C.length], 0)) ? pass : fail)('unbuffered total');
      (m.total <= m.unbuffered + 1e-9 || M > 0 ? pass : fail)('buffering never loses without a move cost');
    },
  },
  'io-spool': {
    random: (r) => { const n = int(r, 1, 6); return { jobs: [...Array(n)].map((_, i) => 'j' + i + ' ' + pick(r, [0, 0.5, 1, 3, 8]) + ' ' + int(r, 1, 12)).join('; '), pageTime: pick(r, [0.5, 2, 3]), spoolTime: pick(r, [0.05, 0.2, 1]) }; },
    check({ input, r, fail, pass }) {
      const jobs = input.jobs.split(';').map((x) => x.trim().split(/\s+/)).map(([p, a, g], i) => ({ p, at: +a, pages: +g, i }));
      const order = jobs.slice().sort((x, y) => x.at - y.at || x.i - y.i);
      let free = 0, sum = 0;
      for (const j of order) { const st = Math.max(free, j.at); free = st + j.pages * input.pageTime; sum += free - j.at; }
      const m = r.frames[0].meta;
      (close(m.direct.meanDelay, sum / jobs.length) ? pass : fail)('direct mean ' + m.direct.meanDelay + ', by hand ' + sum / jobs.length);
      const sp = jobs.reduce((x, j) => x + j.pages * input.spoolTime, 0) / jobs.length;
      (close(m.spooled.meanDelay, sp) ? pass : fail)('spooled mean ' + m.spooled.meanDelay + ', by hand ' + sp);
      const pages = jobs.reduce((x, j) => x + j.pages, 0) * input.pageTime;
      (close(m.spooled.printer.reduce((x, s) => x + s.to - s.from, 0), pages) ? pass : fail)('the printer prints every page once');
    },
  },
  'io-cache': {
    random: (r) => ({ ops: [...Array(int(r, 2, 14))].map(() => (r() < 0.08 ? 'sync' : pick(r, ['r', 'r', 'w']) + int(r, 0, 7))), size: int(r, 1, 5), write: pick(r, ['back', 'through']), readAhead: pick(r, [0, 0, 1, 2]) }),
    check({ input, r, fail, pass }) {
      const m = r.frames.at(-1).meta.stats, ops = input.ops.map((x) => (x === 'sync' ? { op: 'sync' } : { op: x[0], b: +x.slice(1) }));
      const rw = ops.filter((x) => x.op !== 'sync').length;
      (m.hits + m.misses === rw ? pass : fail)('every read and write is a hit or a miss');
      if (input.readAhead) return;
      // an LRU list kept here
      const L = []; let hits = 0, misses = 0, dr = 0, dw = 0;
      for (const o of ops) {
        if (o.op === 'sync') { for (const e of L) if (e.d) { e.d = false; dw++; } continue; }
        const i = L.findIndex((e) => e.b === o.b), w = o.op === 'w';
        if (i >= 0) { hits++; const e = L.splice(i, 1)[0]; L.push(e); if (w) { if (input.write === 'through') dw++; else e.d = true; } continue; }
        misses++; if (!w) dr++;
        if (L.length >= input.size) { const v = L.shift(); if (v.d) dw++; }
        L.push({ b: o.b, d: w && input.write === 'back' }); if (w && input.write === 'through') dw++;
      }
      (m.hits === hits && m.misses === misses && m.diskReads === dr && m.diskWrites === dw ? pass : fail)('LRU by hand: ' + [hits, misses, dr, dw] + ' against ' + [m.hits, m.misses, m.diskReads, m.diskWrites]);
      (r.frames.at(-1).meta.pct === Math.round(100 * (rw ? hits / rw : 0)) || Math.abs(r.frames.at(-1).meta.pct - 100 * hits / rw) <= 0.6 ? pass : fail)('hit ratio');
    },
  },
  'io-block-queue': {
    random: (r) => ({ reqs: [...Array(int(r, 1, 10))].map(() => int(r, 0, 20) + ' ' + int(r, 0, 60) * 8 + ' ' + pick(r, [8, 8, 16]) + ' ' + pick(r, ['r', 'r', 'w'])).join('; '), elevator: pick(r, ['noop', 'look', 'deadline']), merge: pick(r, ['on', 'off']), start: int(r, 0, 400), seek: pick(r, [0, 0.01, 0.05]), readExpire: pick(r, [5, 50]), writeExpire: pick(r, [50, 500]) }),
    check({ input, r, fail, pass }) {
      const m = r.frames[0].meta, T = m.totals, D = m.dispatched, reqs = input.reqs.split(';').map((x) => x.trim().split(/\s+/));
      (T.requests === reqs.length && D.reduce((x, d) => x + d.ids.length, 0) === reqs.length ? pass : fail)('every request goes out once');
      (T.dispatches === reqs.length - T.merges ? pass : fail)('dispatches = requests − merges');
      let head = input.start, mv = 0, tm = 0;
      for (const d of D) {
        mv += Math.abs(d.sector - head);
        const dur = 2 + d.count * 0.1 + Math.abs(d.sector - head) * input.seek;
        (close(d.end - d.start, dur) ? pass : fail)('dispatch time');
        head = d.sector + d.count - 1; tm = d.end;
        (d.count === d.ids.reduce((x, id) => x + +reqs[id][2], 0) ? pass : fail)('a merged request covers its parts');
      }
      (mv === T.movement ? pass : fail)('head travel ' + T.movement + ', by hand ' + mv);
      (close(tm, T.time) ? pass : fail)('end time');
      if (input.elevator === 'noop' && input.merge === 'off') { const firsts = D.map((d) => d.ids[0]); const ord = reqs.map((x, i) => [+x[0], i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[1]); (JSON.stringify(firsts) === JSON.stringify(ord) ? pass : fail)('noop keeps arrival order'); }
    },
  },
  'io-life-of-read': {
    random: (r) => ({ bytes: pick(r, [2, 100, 4096, 5000, 16384, 30000]), offset: pick(r, [0, 0, 512, 4096, 10000]), blockSize: pick(r, ['1024', '4096']), cached: pick(r, ['none', 'all', 'first', 'last']), layout: pick(r, ['contiguous', 'scattered']) }),
    check({ input, r, fail, pass }) {
      const m = r.frames[0].meta, steps = r.frames.filter((f) => f.meta.dt !== undefined).map((f) => f.meta);
      const sum = steps.reduce((x, s) => x + s.dt, 0);
      (close(sum, m.total, 0.01) ? pass : fail)('total ' + m.total + ', the sum of the steps ' + sum);
      const bs = +input.blockSize, first = Math.floor(input.offset / bs), last = Math.floor((input.offset + input.bytes - 1) / bs), n = last - first + 1;
      (m.blocks.length === n ? pass : fail)('blocks covered');
      const nmiss = input.cached === 'all' ? 0 : input.cached === 'none' ? n : input.cached === 'first' ? n - Math.ceil(n / 2) : Math.ceil(n / 2);
      (m.misses.length === nmiss ? pass : fail)('misses ' + m.misses.length + ', by hand ' + nmiss);
      (steps.some((s) => s.phase === 'controller') === (nmiss > 0) ? pass : fail)('the disk only on a miss');
      const ctl = steps.find((s) => s.phase === 'controller');
      if (ctl) (close(ctl.dt / 1000, m.diskMs, 0.002) ? pass : fail)('disk time');
    },
  },
  'io-driver': {
    random: (r) => ({ bytes: pick(r, [512, 4096, 9000, 65536]), driver: pick(r, [0.5, 1.5, 4]), irq: pick(r, [0.3, 1.5, 9]), bottom: pick(r, [1, 2, 7]) }),
    check({ input, r, fail, pass }) {
      const L = r.frames.at(-1).meta;
      (close(L.inDriver, input.driver + input.irq + input.bottom) ? pass : fail)('time in the driver ' + L.inDriver + ', by hand ' + (input.driver + input.irq + input.bottom));
    },
  },
  'io-modes': {
    random: (r) => Object.assign({ mode: pick(r, ['blocking', 'nonblocking', 'async']) }, modeRandom(r)),
    check({ input, r, fail, pass }) {
      const m = r.frames[0].meta, res = S.IO.mode(input.mode, m.a);
      modeChecks(input.mode, Object.assign({}, S.IO.modeDefaults, m.a), res, fail, pass);
      (m.finishA === res.finishA && m.finishB === res.finishB ? pass : fail)('finish times');
      (r.frames.at(-1).counters.calls === res.syscalls ? pass : fail)('calls counter');
    },
  },
  'io-modes-compare': {
    random: modeRandom,
    check({ input, r, fail, pass }) {
      const m = r.frames[0].meta;
      for (const k of ['blocking', 'nonblocking', 'async']) { const res = S.IO.mode(k, m.a); modeChecks(k, Object.assign({}, S.IO.modeDefaults, m.a), res, fail, pass); (m.sum[k].finishA === res.finishA ? pass : fail)(k + ' finish'); }
    },
  },
  'io-bus': {
    random: (r) => ({ device: pick(r, ['printer', 'serial', 'disk']), ch: pick(r, [...'AZaz09!~ ']) }),
    check({ input, r, fail, pass }) {
      const v = input.ch.charCodeAt(0);
      for (const f of r.frames) {
        const m = f.meta;
        (m.v === v ? pass : fail)('the byte');
        if (m.phase === 'step' && m.k >= 1) (m.regs.TX === v ? pass : fail)('TX holds the byte once it is loaded');
        if (m.phase === 'step' && m.k === 3) (m.regs.DONE === 0 && m.regs.GO === 1 ? pass : fail)('DONE drops while GO is set');
        if (m.phase === 'step' && m.k === 7) (m.regs.DONE === 1 && m.regs.GO === 0 && m.regs.FAULT === 0 ? pass : fail)('idle again at the end');
        if (m.phase === 'done') (m.cpuN === 5 && m.reads === 2 && m.writes === 3 && m.ctlN === 3 ? pass : fail)('five CPU accesses (two STAT reads, three writes) and three controller actions');
      }
    },
  },
  'io-registers': {
    extra: (inp) => (inp.msg.match(/\d+/g) || []).map(Number).concat([...inp.msg].filter((c) => /\d/.test(c)).map(Number)),
    random: (r) => ({ msg: [...Array(int(r, 1, 8))].map(() => String.fromCharCode(int(r, 33, 126))).join('') }),
    check({ input, r, fail, pass }) {
      const cs = [...input.msg];
      for (const f of r.frames) {
        const m = f.meta;
        if (m.bin !== undefined) {
          let v = m.v, b = ''; for (let i = 0; i < 8; i++) { b = (v & 1) + b; v >>= 1; }
          (b === m.bin && m.v === cs[m.c].charCodeAt(0) ? pass : fail)('binary of byte ' + m.c);
        }
        if (m.phase === 'byte') (m.reads === 2 * (m.c + 1) && m.writes === 3 * (m.c + 1) ? pass : fail)('two STAT reads and three writes a byte');
      }
      const L = r.frames.at(-1).meta;
      (L.reads === 2 * cs.length && L.writes === 3 * cs.length ? pass : fail)('totals');
    },
  },
  'io-polling': { random: xferRandom('polling'), check: xferCheck('polling') },
  'io-interrupt': { random: xferRandom('interrupt'), check: xferCheck('interrupt') },
  'io-dma': { random: xferRandom('dma'), check: xferCheck('dma') },
  'io-xfer-compare': {
    random: (r) => { const unit = pick(r, [1, 4, 8]); return { bytes: int(r, 1, unit * 30), unit, device: pick(r, [0.2, 1, 3, 10, 70]), poll: pick(r, [0.2, 0.5, 1]), irq: pick(r, [1, 4, 8]), dmaSetup: pick(r, [2, 5, 9]) }; },
    check({ input, r, fail, pass }) {
      const m = r.frames[0].meta;
      for (const mode of ['polling', 'interrupt', 'dma']) { const h = hand(mode, input); (close(m.tot[mode].cpuBusy, h.cpuBusy) && close(m.tot[mode].time, h.time) ? pass : fail)(mode + ' totals'); }
      const win = m.sweep.find((p) => hand('interrupt', Object.assign({}, input, { device: p.d })).cpuBusy < hand('polling', Object.assign({}, input, { device: p.d })).cpuBusy - 1e-9);
      ((win ? win.d : null) === m.win ? pass : fail)('first speed where interrupts win: ' + m.win + ', by hand ' + (win && win.d));
      // the crossover the narration states, checked by hand on either side of it
      if (m.cross !== null && m.cross !== undefined) {
        const w = (d) => hand('interrupt', Object.assign({}, input, { device: d })).cpuBusy < hand('polling', Object.assign({}, input, { device: d })).cpuBusy - 1e-9;
        (w(m.cross) === m.crossIncl && !w(m.cross - 0.001) && w(m.cross + 0.001) ? pass : fail)('crossover at ' + m.cross + ' µs (inclusive ' + m.crossIncl + ')');
        const say = r.frames.at(-1).say;
        (say.includes(String(m.cross) + ' µs a unit') ? pass : fail)('the narration states the crossover ' + m.cross);
      }
      for (const p of m.sweep) (close(p.dma, hand('dma', Object.assign({}, input, { device: p.d })).cpuBusy) ? pass : fail)('sweep dma');
    },
  },
};

const { runs, seen } = runPart(S, t, rnd, /^p13-/, mods, only);
for (const id of Object.keys(mods)) if (!only.length && !seen.has(id)) t.ok(false, id + ': a claims module for a topic that does not exist');
console.log('  (' + runs + ' runs over ' + seen.size + ' topics)');
t.done();
