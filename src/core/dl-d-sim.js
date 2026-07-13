// A resource simulator for the four necessary conditions of deadlock, each one switchable. Processes run scripts
// of requests and releases over resource types with several units; a request that cannot be met blocks. It is a
// model-checker system (choices, step, clone, hash, status), so S.MC.check can show that a set of scripts can
// deadlock, and that it cannot once a rule is on; S.MC.random or S.Dl.run give single runs.
//   S.Dl.sim({procs: [{name, script: [{op: 'req' | 'rel', r, n} | {op: 'work'}]}], res: [{name, units}],
//             rules: {mutex: true, holdWait: true, preempt: false, order: false}}) -> system
//     rules, each one condition left in place (true) or broken:
//       mutex: false     resources are shareable (as if spooled): a request never waits and holds nothing
//       holdWait: false  a process asks for everything its script will need at its first request, all or nothing
//       preempt: true    (no-preemption broken) a process whose request must wait gives back all it holds and
//                        starts its script again
//       order: true      (circular wait broken) each process's requests are taken in one global order of resource
//                        number: its requests before the first release are sorted, and the units of one type are
//                        asked for together
//   system.step(i) -> {kind: 'grant' | 'block' | 'release' | 'wake' | 'restart' | 'work' | 'done', say, tid, rag}
//     rag: the resource-allocation graph after the step, in S.Rag.graph's form ({procs, res, hold, want}), so a view
//     can draw it live; system.rag() and system.waitFor() give it at any time
//   S.Dl.run(sim, {seed, max}) -> {steps, end}   one seeded random run
//   S.Dl.CONDITIONS: the four conditions, each with the rule that breaks it and a sentence
(function (S) {
  'use strict';
  const D = (S.Dl = S.Dl || {});
  D.CONDITIONS = [
    { id: 'mutex', rule: { mutex: false }, name: 'mutual exclusion', say: 'Only one process can use a unit at a time. Break it by making the resource shareable, e.g. a printer spooled to disk.' },
    { id: 'holdWait', rule: { holdWait: false }, name: 'hold and wait', say: 'A process holds some units while it waits for more. Break it by asking for everything at once.' },
    { id: 'preempt', rule: { preempt: true }, name: 'no preemption', say: 'Units are given back only by their holder. Break it by making a waiting process give back what it holds.' },
    { id: 'order', rule: { order: true }, name: 'circular wait', say: 'A cycle of processes each waits for the next. Break it by taking resources in one global order.' },
  ];

  /** the scripts as the rules make them run */
  function prepare(spec, rules) {
    return spec.procs.map((p) => {
      let sc = p.script.map((x) => Object.assign({ n: 1 }, x));
      if (rules.order) {
        const cut = sc.findIndex((x) => x.op === 'rel'), head = cut < 0 ? sc : sc.slice(0, cut), tail = cut < 0 ? [] : sc.slice(cut);
        // in increasing order, and all the units of one type in a single request (two separate requests for the
        // same type would let two holders of one unit each wait for a second)
        const reqs = [];
        for (const x of head.filter((y) => y.op === 'req').sort((a, b) => a.r - b.r)) { const prev = reqs[reqs.length - 1]; if (prev && prev.r === x.r) prev.n += x.n; else reqs.push(Object.assign({}, x)); }
        const rest = head.filter((x) => x.op !== 'req');
        sc = reqs.concat(rest, tail);
      }
      if (!rules.holdWait) {
        const need = spec.res.map((_, r) => sc.filter((x) => x.op === 'req' && x.r === r).reduce((s, x) => s + x.n, 0));
        const first = sc.findIndex((x) => x.op === 'req');
        sc = sc.filter((x, i) => x.op !== 'req' || i === first).map((x, i, all) => (x.op === 'req' ? { op: 'reqAll', need } : x));
      }
      return { name: p.name, script: sc };
    });
  }

  class Sim {
    constructor(spec, from) {
      this.spec = spec; this.rules = Object.assign({ mutex: true, holdWait: true, preempt: false, order: false }, spec.rules || {});
      this.res = spec.res; this.progs = from ? from.progs : prepare(spec, this.rules);
      if (from) { this.p = from.p.map((x) => Object.assign({}, x, { held: x.held.slice(), want: x.want && Object.assign({}, x.want) })); this.avail = from.avail.slice(); this.queue = from.queue.slice(); this.t = from.t; return; }
      this.p = this.progs.map(() => ({ pc: 0, held: this.res.map(() => 0), want: null, state: 'ready', restarts: 0 }));
      this.avail = this.res.map((r) => r.units); this.queue = []; this.t = 0;
    }
    nm(i) { return this.progs[i].name; }
    rn(r) { return this.res[r].name; }
    choices() { return this.p.map((x, i) => (x.state === 'ready' ? i : -1)).filter((i) => i >= 0); }
    owner(i) { return i; }
    /** what a request needs, as a vector */
    needOf(op) { return op.op === 'reqAll' ? op.need : this.res.map((_, r) => (r === op.r ? op.n : 0)); }
    fits(v) { return v.every((x, r) => x <= this.avail[r]); }
    grant(i, v) { const x = this.p[i]; v.forEach((k, r) => { this.avail[r] -= k; x.held[r] += k; }); }
    advance(i) { const x = this.p[i]; x.pc++; if (x.pc >= this.progs[i].script.length) x.state = 'done'; }
    step(i) {
      const x = this.p[i], op = this.progs[i].script[x.pc], P = this.nm(i);
      this.t++;
      let r;
      if (op.op === 'work') { this.advance(i); r = { kind: 'work', say: `${P} works with what it holds.` }; }
      else if (op.op === 'rel') {
        const k = Math.min(op.n, x.held[op.r]);
        x.held[op.r] -= k; this.avail[op.r] += k; this.advance(i);
        const woke = this.wakeAll();
        r = { kind: 'release', woke, say: `${P} releases ${k} of ${this.rn(op.r)}; ${this.avail[op.r]} free now${woke.length ? ', so ' + woke.map((w) => this.nm(w)).join(', ') + ' can go on' : ''}.` };
      } else if (!this.rules.mutex) {
        this.advance(i);
        r = { kind: 'grant', say: `${P} uses ${op.op === 'reqAll' ? 'everything it needs' : this.rn(op.r)} at once: with the resource shareable, nobody waits for it.` };
      } else {
        const v = this.needOf(op), what = op.op === 'reqAll' ? 'everything its script needs, ' + this.vecName(v) : (op.n > 1 ? op.n + ' of ' : '') + this.rn(op.r);
        if (this.fits(v)) { this.grant(i, v); this.advance(i); r = { kind: 'grant', say: `${P} asks for ${what}: granted, ${this.availName()}.` }; }
        else if (this.rules.preempt && x.held.some((k) => k > 0)) {
          const back = x.held.slice();
          back.forEach((k, q) => { this.avail[q] += k; }); x.held = back.map(() => 0); x.pc = 0; x.restarts++;
          const woke = this.wakeAll();
          r = { kind: 'restart', woke, say: `${P} asks for ${what}, which is not free: under the preemption rule it gives back ${this.vecName(back)} and starts again${woke.length ? '; ' + woke.map((w) => this.nm(w)).join(', ') + ' can go on' : ''}.` };
        } else {
          x.state = 'blocked'; x.want = { v, op }; this.queue.push(i);
          r = { kind: 'block', say: `${P} asks for ${what}, but ${this.availName()}: it blocks${x.held.some((k) => k) ? ', holding ' + this.vecName(x.held) : ''}.` };
        }
      }
      if (x.state === 'done' && r.kind !== 'done') r.say += ` ${P} has finished.`;
      return Object.assign({ t: this.t, tid: i, name: P }, r, { rag: this.rag() });
    }
    /** after a release, grant waiting requests that now fit, in the order they blocked */
    wakeAll() {
      const woke = [];
      for (const i of this.queue.slice()) {
        const x = this.p[i];
        if (this.fits(x.want.v)) { this.grant(i, x.want.v); x.want = null; x.state = 'ready'; this.queue.splice(this.queue.indexOf(i), 1); this.advance(i); woke.push(i); }
      }
      return woke;
    }
    vecName(v) { return v.map((k, r) => (k ? k + ' ' + this.rn(r) : '')).filter(Boolean).join(' and ') || 'nothing'; }
    availName() { return 'free: ' + (this.vecName(this.avail) === 'nothing' ? 'nothing' : this.vecName(this.avail)); }
    rag() {
      const hold = [], want = [];
      this.p.forEach((x, i) => { x.held.forEach((k, r) => { for (let u = 0; u < k; u++) hold.push([i, r]); }); if (x.want) x.want.v.forEach((k, r) => { if (k) want.push([i, r, k]); }); });
      return { procs: this.progs.map((p) => p.name), res: this.res.map((r) => ({ name: r.name, units: r.units })), hold, want };
    }
    waitFor() { return S.Rag.waitFor(this.rag()); }
    clone() { return new Sim(this.spec, this); }
    hash() { return this.p.map((x) => x.pc + ':' + x.state[0] + ':' + x.held.join(',')).join('/') + '|' + this.queue.join(','); }
    status() {
      if (this.choices().length) return 'running';
      return this.p.some((x) => x.state === 'blocked') ? 'deadlock' : 'done';
    }
  }
  D.sim = (spec) => new Sim(spec);
  D.run = function (sim, opts) {
    opts = opts || {};
    const r = S.MC.rng(opts.seed || 1), steps = [], max = opts.max || 500;
    while (sim.status() === 'running' && steps.length < max) { const c = sim.choices(); steps.push(sim.step(c[Math.floor(r() * c.length)])); }
    const st = sim.status();
    const blocked = sim.p.map((x, i) => (x.state === 'blocked' ? i : -1)).filter((i) => i >= 0);
    const end = { kind: st === 'running' ? 'limit' : st, say: st === 'deadlock' ? `Deadlock: ${blocked.map((i) => sim.nm(i)).join(', ')} wait for units that only the others hold, and nobody can go on.` : st === 'done' ? 'Every process ran its script to the end.' : 'The run stops at its step limit.' };
    return { steps, end };
  };
  (S.engines = S.engines || []).push({ name: 'Deadlock rules simulator' });
})(globalThis.Proses = globalThis.Proses || {});
