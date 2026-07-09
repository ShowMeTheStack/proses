// CPU scheduling, part 5: proportional share, by lottery and by stride.
//   S.Sched.lottery(work, {quantum, seed, currencies, transfers, cs}) -> trace
//   S.Sched.stride(work, {quantum, L, cs}) -> trace
// Both run a job for a quantum (default 2 ticks, less if its burst ends first) and then decide again; a job that
// arrives or comes back from I/O waits for the next decision. Each job holds job.tickets (default 100).
// Lottery: at each decision the ready jobs are listed in name order, each owning a range of ticket numbers in
//   proportion to its tickets; a seeded draw picks a number in [0, total) and its owner runs. Each step that
//   decides has draw {total, number, holders: [{id, tickets, lo, hi}], winner}.
//   currencies {name: tickets}: a job with job.currency = name holds tickets in that currency, which is worth
//   `tickets` base tickets shared among the currency's jobs that are ready or running, in proportion to their
//   holdings (rounded to whole tickets, at least 1); a currency whose jobs are all away is worth nothing.
//   transfers [{t, from, to, tickets, until}]: from t until `until` (default: until `from` finishes), `from`
//   lends up to `tickets` of its base tickets to `to` (a client lending its tickets to a server it waits on).
//   A draw needs tickets: when the ready jobs hold none between them (each has lent its tickets away), the loans
//   made by ready jobs come back for that draw (event 'recall', draw.recalled); should there still be none, no
//   draw is made (draw.skipped) and the first ready job in name order runs. The same seed gives the same draws.
// Stride: each job has stride = floor(L / tickets) (L default 10000) and a pass, starting at the global pass plus
//   its stride when it joins; the ready job with the lowest pass runs (ties: the one that has waited longest),
//   and every tick it runs adds its stride to its pass. The global pass grows each busy tick by the global stride,
//   floor(L / the tickets of all jobs ready or running). A job leaving for I/O keeps pass − global pass and gets
//   it back on return. Each step has table [{id, tickets, stride, pass}], gpass and gstride.
// Both traces have fairness = Sch.fairness(trace, tickets) (Jain's index of CPU per ticket while all compete).
(function (S) {
  'use strict';
  const Sch = (S.Sched = S.Sched || {});

  /** the quantum loop both share: pick(t, ready, said) -> {x, reason, why, data} chooses among the ready jobs */
  function loop(jobs, P, hooks) {
    const X = jobs.map((j) => ({ j, b: 0, left: j.bursts[0], slice: 0, state: 'future', ioUntil: -1, sw: 0 }));
    const ready = [], steps = [], events = [], perTick = [], finish = {}, first = {};
    let run = null, t = 0, lastOn = null, overhead = 0;
    const ev = (kind, x, say, more) => { events.push(Object.assign({ kind, t, job: x ? x.j.id : null, say }, more || {})); };
    const ctx = { X, ready, ev, get t() { return t; } };
    while (t < 100000) {
      const said = [];
      let decision = null, reason = '', why = '', data = null, expired = null;
      if (run && !run.sw) {
        const x = run;
        if (x.left === 0) {
          if (x.b + 1 < x.j.bursts.length) { x.ioUntil = t + x.j.bursts[x.b + 1]; x.b += 2; x.left = x.j.bursts[x.b]; x.state = 'io'; said.push(`${x.j.id} starts I/O until t = \`${x.ioUntil}\``); ev('block', x, `${x.j.id} blocks for I/O until t = ${x.ioUntil}`); }
          else { x.state = 'done'; finish[x.j.id] = t; said.push(`${x.j.id} finishes`); ev('finish', x, `${x.j.id} finishes at t = ${t}`); }
          if (hooks.leave) hooks.leave(x, ctx);
          run = null;
        } else if (x.slice >= P.quantum) { x.state = 'ready'; expired = x; run = null; said.push(`${x.j.id}'s quantum of \`${P.quantum}\` is up`); }
      }
      const come = X.filter((x) => (x.state === 'future' && x.j.arrive === t) || (x.state === 'io' && x.ioUntil === t));
      for (const x of come) { const back = x.state === 'io'; x.state = 'ready'; ready.push(x); if (hooks.join) hooks.join(x, ctx, !back); ev(back ? 'io-done' : 'arrive', x, `${x.j.id} ${back ? 'is back from I/O' : 'arrives'}`); }
      if (come.length) said.push(come.map((x) => `${x.j.id} ${x.b > 0 ? 'is back from I/O' : 'arrives'}`).join(', '));
      if (expired) ready.push(expired);
      if (run) { decision = 'continue'; why = run.sw ? `switching to ${run.j.id}` : `${run.j.id} runs on`; reason = run.sw ? `the switch to ${run.j.id} goes on` : `${run.j.id} runs on, tick ${run.slice + 1} of its quantum`; }
      else if (ready.length) {
        const r = hooks.pick(ctx, run);
        const x = r.x;
        ready.splice(ready.indexOf(x), 1);
        decision = 'dispatch'; reason = r.reason; why = r.why; data = r.data;
        x.state = 'running'; x.slice = 0; x.sw = P.cs && lastOn && lastOn !== x ? P.cs : 0; lastOn = x; run = x;
        if (x.sw) reason += `, after a context switch of ${Sch.sv(P.cs, 'tick')}`;
        ev('dispatch', x, reason, data ? { data } : undefined);
      }
      if (!X.some((x) => x.state !== 'done')) { steps.push({ kind: 'end', t, run: null, ready: [], io: [], decision: 'end', why: 'all done', say: `At t = \`${t}\` ${said.length ? said.join('; ') + '; ' : ''}every job has finished.` }); break; }
      if (!run) { decision = 'idle'; why = 'idle: nothing is ready'; reason = 'the CPU idles: nothing is ready'; }
      const st = { kind: 'tick', t, run: run ? run.j.id : null, ready: ready.map((x) => x.j.id), io: X.filter((x) => x.state === 'io').map((x) => ({ id: x.j.id, until: x.ioUntil })), decision, why, say: `At t = \`${t}\` ${said.length ? said.join('; ') + '; ' : ''}${reason}.` };
      if (data) Object.assign(st, data);
      if (run && run.sw) st.cs = true;
      if (hooks.snap) Object.assign(st, hooks.snap(ctx));
      steps.push(st);
      if (run && run.sw) { perTick.push('~' + run.j.id); run.sw--; overhead++; }
      else {
        perTick.push(run ? run.j.id : null);
        if (run) { if (first[run.j.id] === undefined) first[run.j.id] = t; run.left--; run.slice++; if (hooks.ran) hooks.ran(run, ctx); }
      }
      if (hooks.tick) hooks.tick(ctx, run);
      t++;
    }
    return { jobs, steps, events, segs: Sch.segments(perTick), metrics: Sch.metrics(jobs, finish, first, { end: t, overhead }), end: t };
  }

  Sch.lottery = function (work, params) {
    const P = Object.assign({ quantum: 2, seed: 1, currencies: null, transfers: [], cs: 0 }, params || {});
    P.quantum = Math.max(1, Math.round(P.quantum)); P.cs = Math.max(0, Math.round(P.cs || 0));
    const rnd = Sch.rng(P.seed), jobs = Sch.norm(work), draws = [];
    const active = (x) => x.state === 'ready' || x.state === 'running';
    /** each job's tickets in base units now: its currency's worth, then loans */
    function base(ctx, recall) {
      const v = {};
      for (const x of ctx.X) {
        const cur = x.j.currency && P.currencies && P.currencies[x.j.currency] !== undefined ? x.j.currency : null;
        if (!cur) { v[x.j.id] = x.j.tickets; continue; }
        const mates = ctx.X.filter((y) => y.j.currency === cur && active(y)), held = mates.reduce((a, y) => a + y.j.tickets, 0);
        v[x.j.id] = active(x) && held ? Math.max(1, Math.round((P.currencies[cur] * x.j.tickets) / held)) : 0;
      }
      for (const tr of P.transfers || []) {
        const from = ctx.X.find((x) => x.j.id === tr.from), live = ctx.t >= tr.t && (tr.until === undefined ? from && from.state !== 'done' : ctx.t < tr.until);
        if (!live || v[tr.from] === undefined || v[tr.to] === undefined || (recall && recall.has(tr.from))) continue;
        const give = Math.min(v[tr.from], tr.tickets);
        v[tr.from] -= give; v[tr.to] += give;
      }
      return v;
    }
    const tr = loop(jobs, P, {
      pick(ctx) {
        const list = ctx.ready.slice().sort((a, b) => a.j.idx - b.j.idx);
        let v = base(ctx), total = list.reduce((a, x) => a + v[x.j.id], 0), recalled = [];
        // every ready job has lent its tickets away: the loans of the ready jobs come back for this draw
        if (total === 0) {
          const lenders = new Set(list.map((x) => x.j.id).filter((id) => (P.transfers || []).some((tr) => tr.from === id)));
          v = base(ctx, lenders); total = list.reduce((a, x) => a + v[x.j.id], 0);
          recalled = [...lenders].filter((id) => v[id] > 0);
          if (recalled.length) ctx.ev('recall', null, `no ready job holds a ticket, so ${Sch.list(recalled)} ${recalled.length === 1 ? 'takes its loan' : 'take their loans'} back for this draw`, { ids: recalled });
        }
        let lo = 0;
        const holders = list.map((x) => { const h = { id: x.j.id, tickets: v[x.j.id], lo, hi: lo + v[x.j.id] - 1 }; lo += v[x.j.id]; return h; });
        if (total === 0) {
          // nothing to draw with (a currency worth nothing): the first ready job in name order runs, no draw is made
          const x = list[0], draw = { total: 0, number: null, holders, winner: x.j.id, skipped: true };
          draws.push(Object.assign({ t: ctx.t }, draw));
          return { x, data: { draw }, why: `no tickets: ${x.j.id} runs without a draw`, reason: `no ready job holds a ticket, so there is no draw and ${x.j.id}, first in name order, runs` };
        }
        const number = Math.floor(rnd() * total);
        const win = holders.find((h) => number >= h.lo && number <= h.hi) || holders[holders.length - 1];
        const x = list.find((y) => y.j.id === win.id);
        const draw = { total, number, holders, winner: win.id };
        if (recalled.length) draw.recalled = recalled;
        draws.push(Object.assign({ t: ctx.t }, draw));
        const rng = holders.map((h) => (h.tickets ? `${h.id} ${h.lo}–${h.hi}` : `${h.id} none`)).join(', ');
        const back = recalled.length ? `no ready job holds a ticket, so ${Sch.list(recalled)} ${recalled.length === 1 ? 'takes its loan' : 'take their loans'} back for this draw; ` : '';
        return { x, data: { draw }, why: `draw ${number} of ${total}: ${win.id} wins`, reason: back + (holders.length === 1 ? `${win.id} runs, the only job ready (draw \`${number}\` of \`${total}\`)` : `the draw is \`${number}\` of ${Sch.sv(total, 'ticket')} (${rng}), so ${win.id} runs, with a chance of ${win.tickets}/${total}`) };
      },
      snap: (ctx) => ({ tickets: base(ctx) }),
    });
    tr.policy = 'lottery'; tr.name = 'Lottery'; tr.params = P; tr.draws = draws;
    tr.fairness = Sch.fairness(tr, (j) => j.tickets);
    return tr;
  };

  Sch.stride = function (work, params) {
    const P = Object.assign({ quantum: 2, L: 10000, cs: 0 }, params || {});
    P.quantum = Math.max(1, Math.round(P.quantum)); P.cs = Math.max(0, Math.round(P.cs || 0));
    const jobs = Sch.norm(work);
    const stride = (x) => Math.floor(P.L / x.j.tickets);
    let gpass = 0, gstride = 0;
    const live = (ctx) => ctx.X.filter((x) => x.state === 'ready' || x.state === 'running');
    const table = (ctx) => ctx.X.filter((x) => x.pass !== undefined && x.state !== 'done').map((x) => ({ id: x.j.id, tickets: x.j.tickets, stride: stride(x), pass: x.pass, state: x.state }));
    const tr = loop(jobs, P, {
      join(x, ctx, fresh) { x.pass = gpass + (fresh ? stride(x) : x.remain); },
      leave(x) { x.remain = x.pass - gpass; },
      pick(ctx) {
        let b = ctx.ready[0];
        for (const x of ctx.ready) if (x.pass < b.pass) b = x;
        const ties = ctx.ready.filter((x) => x !== b && x.pass === b.pass).map((x) => x.j.id);
        const passes = ctx.ready.map((x) => `${x.j.id} ${x.pass}`).join(', ');
        return { x: b, why: `${b.j.id} runs: lowest pass (${b.pass})`, reason: `${b.j.id} runs: its pass \`${b.pass}\` is the lowest of ${passes}` + (ties.length ? `; it ties with ${Sch.list(ties)} and has waited longer` : '') + `; each tick it runs adds its stride \`${stride(b)}\`` };
      },
      ran(x) { x.pass += stride(x); },
      tick(ctx, run) {
        const tot = live(ctx).reduce((a, x) => a + x.j.tickets, 0);
        gstride = tot ? Math.floor(P.L / tot) : 0;
        if (run && !run.sw) gpass += gstride;
      },
      snap: (ctx) => ({ table: table(ctx), gpass, gstride: (() => { const tot = live(ctx).reduce((a, x) => a + x.j.tickets, 0); return tot ? Math.floor(P.L / tot) : 0; })() }),
    });
    tr.policy = 'stride'; tr.name = 'Stride'; tr.params = P;
    tr.fairness = Sch.fairness(tr, (j) => j.tickets);
    return tr;
  };
})(globalThis.Proses = globalThis.Proses || {});
