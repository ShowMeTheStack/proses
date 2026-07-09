// CPU scheduling, part 6: a CFS-style fair scheduler, with weights from nice values, virtual runtime and a
// red-black tree of the ready jobs.
//   S.Sched.cfs(work, {latency, minGran, wakeupGran, sleeperCredit, cs}) -> trace
// The rules (time in ticks):
//   - each job has a weight from its nice value (Sch.WEIGHTS, the standard table: nice 0 is 1024, each step about
//     1.25 times); running one tick adds 1024 / weight to its vruntime;
//   - the ready jobs sit in a red-black tree keyed by vruntime (ties: the one inserted first is to the left, so the
//     job that has waited longest wins); the running job is not in the tree; the leftmost job runs next;
//   - its time slice is period × weight / (the weights of every runnable job), never under minGran, where the
//     period is the target latency (default 12) or, with more than latency / minGran jobs, jobs × minGran;
//   - when the slice is used up the job goes back into the tree and the leftmost runs (perhaps the same job);
//   - min_vruntime only grows: the least of the running job's and the leftmost job's vruntime, never less than it was;
//   - a new job starts at min_vruntime; a job back from I/O gets max(its vruntime, min_vruntime − latency / 2)
//     (sleeperCredit, default on; off: max(its vruntime, min_vruntime));
//   - a job that wakes or arrives preempts the running one when its vruntime is less than the running job's by more
//     than wakeupGran (default 1).
// Each step has tree (the red-black tree as nested {id, v, red, l, r}, v rounded to 2 places), vr {id: vruntime},
// minV, slice (the running job's slice) and ran (ticks of it used). The trace has fairness = Sch.fairness(trace,
// weight). Sch.rbCheck(tree) -> null or what is wrong (tests and views use it).
(function (S) {
  'use strict';
  const Sch = (S.Sched = S.Sched || {});
  const r2 = (v) => Math.round(v * 100) / 100;

  // ---- a left-leaning red-black tree (insert and remove the least), keys {v, seq} --------------------------------
  const cmp = (a, b) => (a.v < b.v ? -1 : a.v > b.v ? 1 : a.seq - b.seq);
  const red = (h) => !!h && h.red;
  function rotL(h) { const x = h.r; h.r = x.l; x.l = h; x.red = h.red; h.red = true; return x; }
  function rotR(h) { const x = h.l; h.l = x.r; x.r = h; x.red = h.red; h.red = true; return x; }
  function flip(h) { h.red = !h.red; h.l.red = !h.l.red; h.r.red = !h.r.red; }
  function fix(h) {
    if (red(h.r) && !red(h.l)) h = rotL(h);
    if (red(h.l) && red(h.l.l)) h = rotR(h);
    if (red(h.l) && red(h.r)) flip(h);
    return h;
  }
  function ins(h, k) {
    if (!h) return { k, red: true, l: null, r: null };
    if (cmp(k, h.k) < 0) h.l = ins(h.l, k); else h.r = ins(h.r, k);
    return fix(h);
  }
  function moveRedLeft(h) { flip(h); if (red(h.r.l)) { h.r = rotR(h.r); h = rotL(h); flip(h); } return h; }
  function delMin(h) {
    if (!h.l) return null;
    if (!red(h.l) && !red(h.l.l)) h = moveRedLeft(h);
    h.l = delMin(h.l);
    return fix(h);
  }
  class Tree {
    constructor() { this.root = null; this.n = 0; }
    insert(k) { this.root = ins(this.root, k); this.root.red = false; this.n++; }
    min() { let h = this.root; if (!h) return null; while (h.l) h = h.l; return h.k; }
    popMin() {
      const k = this.min();
      if (!k) return null;
      if (!red(this.root.l) && !red(this.root.r)) this.root.red = true;
      this.root = delMin(this.root);
      if (this.root) this.root.red = false;
      this.n--;
      return k;
    }
    items() { const out = []; const walk = (h) => { if (!h) return; walk(h.l); out.push(h.k); walk(h.r); }; walk(this.root); return out; }
    snap() { const c = (h) => (h ? { id: h.k.x.j.id, v: r2(h.k.v), red: h.red, l: c(h.l), r: c(h.r) } : null); return c(this.root); }
  }
  Sch.RBTree = Tree;
  /** null when a snapshot is a valid red-black tree in order, else what is wrong */
  Sch.rbCheck = function (t) {
    if (!t) return null;
    if (t.red) return 'the root is red';
    let bh = -1, bad = null, prev = -Infinity;
    const walk = (h, blacks, parentRed) => {
      if (!h) { if (bh < 0) bh = blacks; else if (bh !== blacks) bad = bad || 'black heights differ'; return; }
      if (h.red && parentRed) bad = bad || 'a red node has a red child';
      walk(h.l, blacks + (h.red ? 0 : 1), h.red);
      if (h.v < prev) bad = bad || 'keys out of order at ' + h.id;
      prev = h.v;
      walk(h.r, blacks + (h.red ? 0 : 1), h.red);
    };
    walk(t, 0, false);
    return bad;
  };

  Sch.cfs = function (work, params) {
    const P = Object.assign({ latency: 12, minGran: 2, wakeupGran: 1, sleeperCredit: true, cs: 0 }, params || {});
    P.cs = Math.max(0, Math.round(P.cs || 0));
    const jobs = Sch.norm(work);
    const X = jobs.map((j) => ({ j, w: Sch.weight(j.nice), b: 0, left: j.bursts[0], v: 0, state: 'future', ioUntil: -1, ran: 0, slice: 0, sw: 0 }));
    const tree = new Tree(), steps = [], events = [], perTick = [], finish = {}, first = {};
    let run = null, t = 0, minV = 0, seq = 0, lastOn = null, overhead = 0;
    const ev = (kind, x, say, more) => { events.push(Object.assign({ kind, t, job: x ? x.j.id : null, say }, more || {})); };
    const put = (x) => { x.state = 'ready'; tree.insert({ v: x.v, seq: seq++, x }); };
    const runnable = () => tree.items().map((k) => k.x).concat(run ? [run] : []);
    const sliceOf = (x) => {
      const all = runnable().includes(x) ? runnable() : runnable().concat([x]);
      const n = all.length, W = all.reduce((a, y) => a + y.w, 0);
      const period = Math.max(P.latency, n * P.minGran);
      return Math.max(P.minGran, (period * x.w) / W);
    };
    const updMin = () => { const l = tree.min(); const cands = [run ? run.v : Infinity, l ? l.v : Infinity]; const m = Math.min(...cands); if (m !== Infinity) minV = Math.max(minV, m); };
    while (t < 100000) {
      const said = [];
      let decision = null, reason = '', why = '';
      if (run && !run.sw) {
        const x = run;
        if (x.left === 0) {
          if (x.b + 1 < x.j.bursts.length) { x.ioUntil = t + x.j.bursts[x.b + 1]; x.b += 2; x.left = x.j.bursts[x.b]; x.state = 'io'; said.push(`${x.j.id} starts I/O until t = \`${x.ioUntil}\` with vruntime \`${r2(x.v)}\``); ev('block', x, `${x.j.id} blocks for I/O until t = ${x.ioUntil}`); }
          else { x.state = 'done'; finish[x.j.id] = t; said.push(`${x.j.id} finishes`); ev('finish', x, `${x.j.id} finishes at t = ${t}`); }
          run = null;
        } else if (x.ran >= x.slice) {
          said.push(`${x.j.id} has used its slice of \`${r2(x.slice)}\`, so it goes back into the tree at vruntime \`${r2(x.v)}\``);
          ev('expire', x, `${x.j.id}'s slice is used up`);
          run = null; put(x);
        }
      }
      updMin();
      // arrivals and wake-ups, in name order
      const come = X.filter((x) => (x.state === 'future' && x.j.arrive === t) || (x.state === 'io' && x.ioUntil === t));
      for (const x of come) {
        const back = x.state === 'io';
        const was = x.v;
        x.v = back ? Math.max(x.v, minV - (P.sleeperCredit ? P.latency / 2 : 0)) : Math.max(x.v, minV);
        put(x);
        said.push(back ? `${x.j.id} wakes with vruntime \`${r2(x.v)}\`` + (x.v !== was ? ` (raised from ${r2(was)}: min_vruntime is ${r2(minV)})` : '') : `${x.j.id} arrives (nice ${x.j.nice}, weight ${x.w}) and starts at min_vruntime \`${r2(x.v)}\``);
        ev(back ? 'wake' : 'arrive', x, `${x.j.id} ${back ? 'wakes' : 'arrives'} at vruntime ${r2(x.v)}`);
      }
      // wake-up preemption
      if (run && !run.sw && come.length) {
        const l = tree.min();
        if (l && run.v - l.v > P.wakeupGran) {
          said.push(`${l.x.j.id}'s vruntime \`${r2(l.v)}\` is more than ${P.wakeupGran} below ${run.j.id}'s \`${r2(run.v)}\`, so ${run.j.id} is preempted`);
          ev('preempt', run, `${l.x.j.id} preempts ${run.j.id}`);
          put(run); run = null; decision = 'preempt';
        }
      }
      if (run) {
        decision = 'continue';
        why = run.sw ? `switching to ${run.j.id}` : `${run.j.id} runs on`;
        reason = run.sw ? `the switch to ${run.j.id} goes on` : `${run.j.id} runs on: \`${run.ran}\` of its slice of \`${r2(run.slice)}\` used, vruntime \`${r2(run.v)}\``;
      } else if (tree.n) {
        const snapBefore = tree.items().map((k) => `${k.x.j.id} ${r2(k.v)}`);
        const k = tree.popMin(), x = k.x;
        x.state = 'running'; x.ran = 0; x.slice = sliceOf(x);
        x.sw = P.cs && lastOn && lastOn !== x ? P.cs : 0; lastOn = x; run = x;
        decision = decision === 'preempt' ? 'preempt' : 'dispatch';
        const W = runnable().reduce((a, y) => a + y.w, 0), n = runnable().length;
        reason = `${x.j.id} runs: the leftmost in the tree (${snapBefore.join(', ')}), with a slice of max(${P.minGran}, ${Math.max(P.latency, n * P.minGran)} × ${x.w} / ${W}) = \`${r2(x.slice)}\`` + (x.sw ? `, after a context switch of ${Sch.sv(P.cs, 'tick')}` : '');
        why = `${x.j.id} runs: least vruntime (${r2(x.v)})`;
        ev('dispatch', x, reason);
      }
      updMin();
      if (!X.some((x) => x.state !== 'done')) { steps.push({ kind: 'end', t, run: null, ready: [], io: [], tree: null, vr: {}, minV: r2(minV), decision: 'end', why: 'all done', say: `At t = \`${t}\` ${said.length ? said.join('; ') + '; ' : ''}every job has finished.` }); break; }
      if (!run) { decision = 'idle'; why = 'idle: nothing is ready'; reason = 'the CPU idles: the tree is empty'; }
      const vr = {};
      for (const x of X) if (x.state !== 'future' && x.state !== 'done') vr[x.j.id] = r2(x.v);
      const st = { kind: 'tick', t, run: run ? run.j.id : null, ready: tree.items().map((k) => k.x.j.id), io: X.filter((x) => x.state === 'io').map((x) => ({ id: x.j.id, until: x.ioUntil })), tree: tree.snap(), vr, minV: r2(minV), slice: run ? r2(run.slice) : null, ran: run ? run.ran : null, decision, why, say: `At t = \`${t}\` ${said.length ? said.join('; ') + '; ' : ''}${reason}.` };
      if (run && run.sw) st.cs = true;
      steps.push(st);
      if (run && run.sw) { perTick.push('~' + run.j.id); run.sw--; overhead++; }
      else {
        perTick.push(run ? run.j.id : null);
        if (run) { if (first[run.j.id] === undefined) first[run.j.id] = t; run.left--; run.ran++; run.v += 1024 / run.w; }
      }
      t++;
    }
    const tr = { policy: 'cfs', name: 'CFS', params: P, jobs, steps, events, segs: Sch.segments(perTick), metrics: Sch.metrics(jobs, finish, first, { end: t, overhead }), end: t };
    tr.fairness = Sch.fairness(tr, (j) => Sch.weight(j.nice));
    return tr;
  };
})(globalThis.Proses = globalThis.Proses || {});
