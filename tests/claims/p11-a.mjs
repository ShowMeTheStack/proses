// Part 11 claims: demand paging, copy-on-write, mmap, replacement and reference strings (merged into
// tests/claims-p11.mjs). Each topic's values are worked out again here: the fault path's costs summed by hand, the
// effective access time from its formula, replacement by simulators written here (FIFO, LRU, OPT, clock, second
// chance, LFU, MFU), copy-on-write by reference counting written here, mmap by a model of the page cache written here.
import { pick, int } from './mem-lib.mjs';

const COST = { mem: 0.1, trap: 1, check: 0.5, find: 1, zero: 2, update: 0.2, restart: 1 };

// ---- replacement, independently ----
/** frames after each reference and the faults, for the policies simulated here; null for the others */
export function simulate(policy, refs, n) {
  const R = refs.map((r) => (typeof r === 'object' ? r : { page: r, write: false }));
  const fr = Array(n).fill(null), load = Array(n).fill(0), last = Array(n).fill(0), cnt = Array(n).fill(0), use = Array(n).fill(0);
  let faults = 0, hand = 0, seq = 0;
  const out = [];
  const victimOf = (i) => {
    if (policy === 'fifo') return load.indexOf(Math.min(...load));
    if (policy === 'lru') return last.indexOf(Math.min(...last));
    if (policy === 'lfu' || policy === 'mfu') {
      let s = 0;
      for (let k = 1; k < n; k++) { const better = policy === 'lfu' ? cnt[k] < cnt[s] : cnt[k] > cnt[s]; if (better || (cnt[k] === cnt[s] && load[k] < load[s])) s = k; }
      return s;
    }
    if (policy === 'opt') {
      const next = fr.map((p) => { for (let j = i + 1; j < R.length; j++) if (R[j].page === p) return j; return Infinity; });
      let s = 0; for (let k = 1; k < n; k++) if (next[k] > next[s]) s = k; return s;
    }
    if (policy === 'second') {
      for (;;) { const s = load.indexOf(Math.min(...load)); if (!use[s]) return s; use[s] = 0; load[s] = ++seq; }
    }
    return -1;
  };
  for (let i = 0; i < R.length; i++) {
    const p = R[i].page, at = fr.indexOf(p);
    if (at >= 0) { last[at] = i + 1; cnt[at]++; use[at] = 1; out.push({ hit: true, frames: fr.slice() }); continue; }
    faults++;
    let s;
    if (policy === 'clock') { for (;;) { if (fr[hand] === null || !use[hand]) { s = hand; break; } use[hand] = 0; hand = (hand + 1) % n; } hand = (s + 1) % n; }
    else { const e = fr.indexOf(null); s = e >= 0 ? e : victimOf(i); }
    if (s < 0) return null;
    const victim = fr[s];
    fr[s] = p; load[s] = ++seq; last[s] = i + 1; cnt[s] = 1; use[s] = 1;
    out.push({ hit: false, frames: fr.slice(), victim });
  }
  return { faults, steps: out };
}
export const SIMULATED = ['fifo', 'lru', 'opt', 'clock', 'second', 'lfu', 'mfu'];
const parseRefs = (xs) => xs.map((x) => { const m = /^(\d+)(w?)$/.exec(x); return { page: +m[1], write: !!m[2] }; });

export const P11A = {
  'vmem-fault-path': {
    constants: [0.1],
    random: (rnd) => {
      const frame = pick(rnd, ['free', 'clean', 'dirty']), res = frame === 'free' ? [0, 2, 3] : [0, 2, 3, 5];
      return { page: pick(rnd, [0, 1, 2, 3, 4, 5, 6, 7].filter((p) => !res.includes(p))), access: pick(rnd, ['read', 'write']), frame, source: pick(rnd, ['swap', 'file', 'zero']), diskMs: pick(rnd, [0.1, 1, 4, 8, 12]) };
    },
    check({ input, r, near, ok }) {
      const disk = input.diskMs * 1000, illegal = input.page >= 6, steps = r.frames.slice(1);
      let want;
      if (illegal) want = COST.trap + COST.check;
      else want = COST.trap + COST.check + COST.find + (input.frame === 'dirty' ? disk : 0) + (input.source === 'zero' ? COST.zero : disk) + COST.update + COST.restart;
      near(steps[steps.length - 1].meta.t, want, 'the total time of the fault');
      ok(steps.map((f) => f.meta.phase).join(' ') === (illegal ? 'trap check kill' : ['trap', 'check', 'frame'].concat(input.frame === 'dirty' ? ['writeBack'] : [], [input.source === 'zero' ? 'zero' : 'read', 'update', 'restart']).join(' ')), 'the steps in order');
      if (!illegal) near(steps[0].meta.frame, input.frame === 'free' ? 3 : input.frame === 'clean' ? 0 : 2, 'the frame used');
    },
  },
  'vmem-demand-eat': {
    random: (rnd) => ({ memNs: pick(rnd, [20, 50, 100, 200]), faultMs: pick(rnd, [0.05, 0.1, 1, 8, 20]), every: pick(rnd, [100, 1000, 10000, 100000, 1000000, 50000000]), slow: pick(rnd, [1, 5, 10, 50, 100]) }),
    check({ input, frame, near, ok }) {
      const m = input.memNs / 1000, f = input.faultMs * 1000, p = 1 / input.every;
      near(frame('yours').meta.eat, (1 - p) * m + p * f, 'EAT from its formula');
      const pmax = (input.slow / 100) * m / (f - m);
      near(frame('budget').meta.pmax, pmax, 'the largest fault rate');
      ok((p <= pmax) === (frame('budget').meta.over <= 1), 'within the budget or not');
      for (const [every, eat] of frame('table').meta.rows) near(eat, (1 - 1 / every) * m + f / every, 'a row of the table');
    },
  },
  'vmem-demand-run': {
    constants: [0.1],
    random: (rnd) => {
      const pages = int(rnd, 3, 8);
      return { refs: Array.from({ length: int(rnd, 4, 20) }, () => int(rnd, 0, pages - 1) + (rnd() < 0.3 ? 'w' : '')), frames: int(rnd, 1, 5), policy: pick(rnd, ['fifo', 'lru', 'opt', 'clock', 'second', 'lfu', 'mfu', 'aging', 'nru', 'eclock']), anon: [...new Set(Array.from({ length: int(rnd, 0, 3) }, () => String(int(rnd, 0, pages - 1))))], diskMs: pick(rnd, [0.1, 8]) };
    },
    check({ input, r, frame, frames, near, ok }) {
      const refs = parseRefs(input.refs), disk = input.diskMs * 1000, anon = new Set(input.anon.map(Number));
      const steps = r.frames.filter((f) => ['hit', 'fault'].includes(f.meta.phase));
      ok(steps.length === refs.length, 'a frame per reference');
      // prices worked out here from what each step did: the victim's dirtiness tracked independently
      const dirty = new Map(), swapped = new Set();
      let total = 0;
      steps.forEach((f, i) => {
        const m = f.meta, w = refs[i].write;
        let cost;
        if (m.phase === 'hit') { cost = COST.mem; if (w) dirty.set(m.page, true); }
        else {
          let wbCost = 0;
          if (m.victim !== null && dirty.get(m.victim)) { wbCost = disk; swapped.add(m.victim); }
          if (m.victim !== null) dirty.delete(m.victim);
          const zero = anon.has(m.page) && !swapped.has(m.page);
          cost = COST.trap + COST.check + COST.find + wbCost + (zero ? COST.zero : disk) + COST.update + COST.restart + COST.mem;
          dirty.set(m.page, w);
          ok(m.kind === (wbCost ? 'wr' : zero ? 'zero' : 'read'), 'the source of fault ' + (i + 1));
        }
        near(m.us, cost, 'the cost of reference ' + (i + 1));
        total += cost;
      });
      const e = frame('end').meta;
      near(e.total, total, 'the total time');
      near(e.eat, total / refs.length, 'the effective access time');
      const sim = SIMULATED.includes(input.policy) ? simulate(input.policy, refs, input.frames) : null;
      if (sim) near(e.faults, sim.faults, 'faults against a simulator written here');
      near(e.faults, frames('fault').length, 'faults counted');
    },
  },
  'vmem-cow': {
    random: (rnd) => {
      const np = int(rnd, 1, 5), pages = Array.from({ length: np }, () => (rnd() < 0.3 ? 'zero' : String(int(rnd, 1, 9))));
      const script = []; let forked = false, gone = new Set();
      for (let k = int(rnd, 2, 10); k > 0; k--) {
        if (!forked && rnd() < 0.3) { script.push('fork'); forked = true; continue; }
        const pid = forked && rnd() < 0.5 ? 2 : 1;
        if (gone.has(pid)) continue;
        if (pid === 2 && rnd() < 0.08) { script.push('exit2'); gone.add(2); continue; }
        script.push((rnd() < 0.5 ? 'r' : 'w') + pid + '.' + int(rnd, 0, np - 1) + (rnd() < 0.5 ? '=' + int(rnd, 1, 9) : ''));
      }
      if (!script.length) script.push('fork');
      return { pages, script };
    },
    check({ input, r, near, ok, frame }) {
      // values by meaning: each process's own view of its pages, copied at fork
      const view = { 1: input.pages.map((x) => (x === 'zero' ? 0 : +x)) };
      // sharing by reference counts kept here: a group id per mapped page, and how many entries point at it
      const grp = { 1: input.pages.map((x, i) => (x === 'zero' ? null : 'g' + i)) }, refs = {};
      for (const g of grp[1]) if (g) refs[g] = 1;
      let copies = 0, zeroRefs = 0, nextG = 0, value = 10;
      const steps = r.frames.filter((f) => f.meta.phase !== 'end').slice(1);
      input.script.forEach((tok, k) => {
        const f = steps[k].meta;
        if (tok === 'fork') { view[2] = view[1].slice(); grp[2] = grp[1].slice(); for (const g of grp[2]) if (g) refs[g]++; return; }
        if (tok.startsWith('exit')) { const pid = +tok[4]; for (const g of grp[pid]) if (g) refs[g]--; delete grp[pid]; delete view[pid]; return; }
        const m = /^([rw])(\d)\.(\d+)(?:=(\d+))?$/.exec(tok), pid = +m[2], page = +m[3];
        if (m[1] === 'r') { if (grp[pid][page] === null) { grp[pid][page] = 'Z'; zeroRefs++; ok(f.phase === 'zero-map', 'a zero map'); } else if (grp[pid][page] !== 'Z') near(f.value, view[pid][page], 'the value read by ' + pid); return; }
        const v = m[4] === undefined ? value++ : +m[4], g = grp[pid][page];
        let want;
        if (g === null || g === 'Z') { want = 'zero-fill'; if (g === 'Z') zeroRefs--; }
        else if (refs[g] > 1) { want = 'cow-copy'; refs[g]--; copies++; }
        else want = f.phase === 'write' ? 'write' : 'cow-reuse';
        if (g !== null && g !== 'Z' && refs[g] === 1 && want !== 'cow-copy') { /* the writer holds it alone */ }
        else { const ng = 'n' + nextG++; grp[pid][page] = ng; refs[ng] = 1; }
        ok(f.phase === want, tok + ': ' + want + ', got ' + f.phase);
        view[pid][page] = v;
      });
      near(frame('end').meta.copies, copies, 'pages copied');
      // every frame's value agrees with the views of the processes that point at it
      const sn = steps[steps.length - 1].meta.snap;
      for (const pid of Object.keys(sn.procs)) for (const e of sn.procs[pid]) if (e.frame !== null && e.frame !== sn.zeroFrame) near(sn.frames.find((x) => x.id === e.frame).value, view[pid][e.page], 'process ' + pid + ' page ' + e.page + ' holds its value');
    },
  },
  'vmem-mmap': {
    random: (rnd) => {
      const np = int(rnd, 1, 5), file = Array.from({ length: np }, () => String(int(rnd, 1, 60)));
      const script = [], mapped = new Set();
      for (let k = int(rnd, 2, 12); k > 0; k--) {
        const pid = int(rnd, 1, 2);
        if (!mapped.has(pid)) { script.push('m' + pid + pick(rnd, ['s', 'p'])); mapped.add(pid); continue; }
        const x = rnd();
        if (x < 0.1) { script.push('u' + pid); mapped.delete(pid); } else if (x < 0.2) script.push('s' + pid);
        else script.push((rnd() < 0.5 ? 'r' : 'w') + pid + '.' + int(rnd, 0, np - 1) + '=' + int(rnd, 61, 99));
      }
      return { file, script };
    },
    check({ input, r, near, ok, frame }) {
      const file = input.file.map(Number), cache = new Map(), own = {}, mode = {};
      const steps = r.frames.filter((f) => f.meta.phase !== 'end');
      input.script.forEach((tok, k) => {
        const f = steps[k].meta, pid = +tok[1];
        const flush = () => { const out = []; for (const [p, c] of cache) if (c.dirty) { file[p] = c.v; c.dirty = false; out.push(p); } return out.sort((a, b) => a - b); };
        if (tok[0] === 'm') { mode[pid] = tok[2] === 's' ? 'shared' : 'private'; own[pid] = new Map(); return; }
        if (tok[0] === 's') { near(f.pages, flush(), 'msync writes the dirty pages'); return; }
        if (tok[0] === 'u') { near(f.pages, mode[pid] === 'shared' ? flush() : [], 'unmap writes back'); delete mode[pid]; return; }
        const m = /^([rw])\d\.(\d+)=?(\d+)?$/.exec(tok), p = +m[2];
        if (!cache.has(p) && !(mode[pid] === 'private' && own[pid].has(p) && m[1] === 'r')) cache.set(p, { v: file[p], dirty: false });
        if (m[1] === 'r') { near(f.value, mode[pid] === 'private' && own[pid].has(p) ? own[pid].get(p) : cache.get(p).v, tok + ' reads'); return; }
        if (mode[pid] === 'shared') { cache.get(p).v = +m[3]; cache.get(p).dirty = true; } else own[pid].set(p, +m[3]);
      });
      near(frame('end').meta.file, file, 'the file at the end');
      ok(true, 'ran');
    },
  },
  'vmem-replace': {
    random: (rnd) => { const pages = int(rnd, 2, 9); return { policy: pick(rnd, ['fifo', 'opt', 'lru', 'clock', 'second', 'eclock', 'lfu', 'mfu', 'aging', 'nru']), refs: Array.from({ length: int(rnd, 3, 20) }, () => int(rnd, 1, pages) + (rnd() < 0.25 ? 'w' : '')), frames: int(rnd, 1, 6), bits: int(rnd, 2, 8), reset: int(rnd, 1, 8) }; },
    nRandom: 20,
    check({ input, r, frame, near, ok }) {
      const refs = parseRefs(input.refs), steps = r2(r.frames);
      const sim = SIMULATED.includes(input.policy) ? simulate(input.policy, refs, input.frames) : null;
      let prev = Array(input.frames).fill(null);
      steps.forEach((f, i) => {
        const st = f.meta.st;
        ok(st.hit === prev.includes(refs[i].page), 'a hit exactly when the page is resident, reference ' + (i + 1));
        if (st.victim !== null) ok(prev.includes(st.victim) && !st.frames.includes(st.victim), 'the victim was resident and leaves');
        if (sim) near(st.frames, sim.steps[i].frames, input.policy + ': the frames after reference ' + (i + 1));
        prev = st.frames;
      });
      if (sim) near(frame('end').meta.faults, sim.faults, 'faults against the simulator written here');
      const o = simulate('opt', refs, input.frames).faults;
      near(frame('end').meta.cmp.opt, o, 'OPT for comparison');
      ok(frame('end').meta.faults >= o, 'no policy beats OPT');
    },
  },
  'vmem-compare': {
    random: (rnd) => { const all = ['fifo', 'opt', 'lru', 'clock', 'second', 'eclock', 'lfu', 'mfu', 'aging', 'nru']; const k = int(rnd, 1, 10), pols = all.slice().sort(() => rnd() - 0.5).slice(0, k); return { refs: Array.from({ length: int(rnd, 3, 20) }, () => String(int(rnd, 1, 7)) + (rnd() < 0.2 ? 'w' : '')), frames: int(rnd, 1, 6), pols }; },
    check({ input, frame, frames, near, ok }) {
      const refs = parseRefs(input.refs), e = frame('end').meta;
      input.pols.forEach((p, k) => { if (SIMULATED.includes(p)) near(e.faults[k], simulate(p, refs, input.frames).faults, p + ' faults against the simulator written here'); });
      const o = simulate('opt', refs, input.frames).faults;
      ok(e.faults.every((x) => x >= o), 'nothing beats OPT');
      if (input.pols.length <= 3) ok(frames('ref').length === refs.length, 'a frame per reference');
      else near(frames('policy').map((f) => f.meta.faults), e.faults, 'the bars');
    },
  },
  'vmem-belady': {
    random: (rnd) => ({ source: 'typed', refs: Array.from({ length: int(rnd, 5, 18) }, () => String(int(rnd, 1, 6))), policy: pick(rnd, ['fifo', 'clock', 'second', 'lru', 'lfu']), max: int(rnd, 3, 7) }),
    check({ input, r, frames, frame, near, ok }) {
      const refs = r.frames[0].say.includes('search found this') ? null : parseRefs(input.refs).map((x) => x.page);
      const sw = frames('sweep');
      if (refs) sw.forEach((f) => { for (const p of ['lru', 'opt'].concat(SIMULATED.includes(input.policy) ? [input.policy] : [])) near(p === input.policy ? f.meta.faults : f.meta[p], simulate(p, refs, f.meta.k).faults, p + ' with ' + f.meta.k + ' frames'); });
      sw.forEach((f, k) => { if (k) { ok(f.meta.lru <= sw[k - 1].meta.lru, 'LRU never rises'); ok(f.meta.opt <= sw[k - 1].meta.opt, 'OPT never rises'); } });
      const rise = sw.some((f, k) => k && f.meta.faults > sw[k - 1].meta.faults);
      ok(!!frame('anomaly') === rise, 'an anomaly frame exactly when the curve rises');
      if (frame('anomaly')) ok(frame('anomaly').meta.fb > frame('anomaly').meta.fa, 'more frames, more faults');
    },
  },
  'vmem-refs': {
    random: (rnd) => ({ kind: pick(rnd, ['random', 'loop', 'phases', 'walk']), length: int(rnd, 10, 120), pages: int(rnd, 3, 16), seed: int(rnd, 0, 9999), delta: int(rnd, 2, 20), policy: pick(rnd, ['lru', 'fifo', 'clock', 'opt']) }),
    check({ S, input, frame, near, ok }) {
      const P = S.VM.refgen({ kind: input.kind, length: input.length, pages: input.pages, seed: input.seed });
      near(frame('string').meta.distinct, new Set(P).size, 'distinct pages');
      // the working set worked out here: distinct pages among the last delta references
      const w = P.map((_, t) => new Set(P.slice(Math.max(0, t - input.delta + 1), t + 1)).size);
      near(frame('ws').meta.avg, w.reduce((a, b) => a + b, 0) / w.length, 'the average working-set size');
      near(frame('ws').meta.max, Math.max(...w), 'the largest working set');
      const c = frame('curve').meta;
      c.curve.forEach((f, k) => near(f, simulate(input.policy, P, k + 1).faults, 'faults with ' + (k + 1) + ' frames'));
      ok(c.curve.every((f) => f >= new Set(P).size), 'never fewer faults than pages used');
    },
  },
  'vmem-refs-c': {
    nRandom: 4,
    random: (rnd) => ({ prog: pick(rnd, ['rows', 'cols', 'list', 'recur']), pageBytes: pick(rnd, ['64', '128', '256', '512']), stack: pick(rnd, ['with', 'without']), policy: pick(rnd, ['lru', 'fifo', 'clock', 'opt']), frames: int(rnd, 1, 12) }),
    check({ S, t, input, frame, near, ok }) {
      const pb = +input.pageBytes, src = t.srcOf(input.prog);
      // the string built here from the C run's raw accesses: filter the stack, divide, collapse runs
      const tr = S.VM.traceC(src, { pageBytes: pb }), base = S.CLang.compile(src).stackBase, refs = [];
      for (const a of tr.accesses) { if (input.stack !== 'with' && a.addr >= base) continue; const p = Math.floor(a.addr / pb); if (!refs.length || refs[refs.length - 1] !== p) refs.push(p); }
      near(frame('trace').meta.n, refs.length, 'the length of the string');
      for (const [addr, page] of frame('trace').meta.first) near(page, Math.floor(addr / pb), 'the page of address ' + addr);
      const run = frame('run').meta;
      near(run.faults, simulate(input.policy, refs, input.frames).faults, 'faults against the simulator written here');
      near(run.pages, new Set(refs).size, 'pages touched');
      run.curve.forEach((f, k) => near(f, simulate(input.policy, refs, k + 1).faults, 'the curve at ' + (k + 1) + ' frames'));
      const o = frame('other');
      if (o) ok(input.prog === 'rows' ? o.meta.faults2 >= o.meta.faults : o.meta.faults2 <= o.meta.faults, 'rows never page worse than columns');
    },
  },
};
const r2 = (frames) => frames.filter((f) => ['hit', 'fill', 'evict'].includes(f.meta.phase));

