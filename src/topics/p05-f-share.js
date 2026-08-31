// Part 5: proportional share. Lottery draws a ticket number and the job holding it runs: the strip of tickets is
// drawn with each job's range and the number drawn; over many draws each job's share of the CPU approaches its
// share of the tickets. Stride does the same without chance: each job has a pass value on a number line, the lowest
// runs, and running moves it on by its stride, which is smaller the more tickets it holds.
(function (S) {
  'use strict';
  const P = S.P05, Sch = () => S.Sched, G = () => S.Kit.gantt;
  const SHARES = 'A 0 30 tickets=300\nB 0 30 tickets=200\nC 0 30 tickets=100';

  /** the decision ticks to draw: every one when few, else the first few and then an even spread, and the end */
  const pickTicks = (all, first, more) => (all.length <= first + more ? all : all.slice(0, first).concat(P.spread(all.slice(first), more)));

  /** bars of each job's CPU so far against its share of the tickets: o {x, y, w, got, tickets, jobs} */
  function shareBars(o) {
    const items = [], tot = Object.values(o.got).reduce((a, b) => a + b, 0), tk = o.jobs.reduce((a, id) => a + o.tickets[id], 0);
    items.push(P.text('shT', o.x, o.y - 12, 'CPU received (bar) against ticket share (line)', 'glabel', 14));
    o.jobs.forEach((id, k) => {
      const y = o.y + k * 32, got = tot ? o.got[id] / tot : 0, want = o.tickets[id] / tk;
      items.push(P.text('shn' + id, o.x + 20, y + 17, id, 'glname', 14, 'end'));
      items.push({ key: 'shk' + id, kind: 'cell', x: o.x + 28, y, w: o.w, h: 24, text: '', cls: 'gtrack' });
      items.push({ key: 'shb' + id, kind: 'cell', x: o.x + 28, y, w: Math.max(1, Math.round(o.w * got)), h: 24, text: '', cls: 'gseg ' + P.pcls(o.jobs, id) });
      items.push({ key: 'shw' + id, kind: 'path', d: `M${Math.round(o.x + 28 + o.w * want)},${y - 3} v30`, cls: 'p05want', audit: 'ignore', layer: 'top' });
      items.push(P.text('shv' + id, o.x + 36 + o.w, y + 17, Math.round(100 * got) + '% (' + Math.round(100 * want) + '%)', 'p05val', 14));
    });
    return items;
  }

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'sch-lottery', family: 'p05-share', order: 10, title: 'Lottery scheduling',
    blurb: 'Each job holds tickets. At every decision the scheduler draws a ticket number at random and the job holding it runs for a quantum. A job with twice the tickets wins twice as often on average, so shares of the CPU follow shares of the tickets, without any bookkeeping of the past. A client can lend its tickets to a server it is waiting on. The draws come from a seed, so the same seed gives the same run.',
    inputs: [
      P.workInput(SHARES, { maxCpu: 120 }),
      { id: 'q', kind: 'number', label: 'Quantum (ticks)', def: 2, min: 1, max: 6 },
      { id: 'seed', kind: 'number', label: 'Seed', def: 7, min: 0, max: 9999 },
      { id: 'lend', kind: 'list', label: 'Lend tickets: from, to, how many, until (or leave empty)', def: [], max: 4, check: (v, inp) => (v.length === 0 ? null : v.length < 3 || !v.slice(2).every((x) => /^\d+$/.test(x)) ? 'Lend tickets: from, to, how many and optionally until when, such as C, S, 100, 12' : null) },
    ],
    presets: [
      { label: 'Tickets 3 : 2 : 1', values: { work: SHARES, seed: 7 } },
      { label: 'The same, another seed', values: { work: SHARES, seed: 42 } },
      { label: 'Short jobs: luck matters', values: { work: 'A 0 6 tickets=300\nB 0 6 tickets=100', seed: 3 } },
      { label: 'A client lends 200 tickets to a server, recalled when it alone is ready', values: { work: 'C 0 4 (6) 4 tickets=200\nS 0 16 tickets=50\nX 0 16 tickets=250', lend: ['C', 'S', '200'], seed: 5 } },
      { label: 'A client lends 200 tickets to a server until t = 16', values: { work: 'C 0 4 (6) 4 tickets=200\nS 0 16 tickets=50\nX 0 16 tickets=250', lend: ['C', 'S', '200', '16'], seed: 5 } },
    ],
    run(inp) {
      const work = P.work(inp.work, { maxCpu: 120 }), transfers = inp.lend.length >= 3 ? [Object.assign({ t: 0, from: inp.lend[0], to: inp.lend[1], tickets: +inp.lend[2] }, inp.lend[3] ? { until: +inp.lend[3] } : {})] : [];
      const tr = Sch().lottery(work, { quantum: inp.q, seed: inp.seed, transfers }), jobs = tr.jobs.map((j) => j.id), W = P.W_;
      const decide = tr.steps.map((s, t) => (s.draw ? t : -1)).filter((t) => t >= 0);
      const ts = pickTicks(decide, 10, 8).concat([tr.end]);
      const frames = [];
      for (const t of ts) {
        const st = tr.steps[t], end = st.kind === 'end', items = [P.now('now', 0, 4, t, end)];
        items.push(...P.gantt({ prefix: 'g', tr, jobs, t, x0: P.X0, x1: W, y: 50, label: 'CPU', final: end }).items);
        const got = Sch().share(tr, 0, t), tickets = {};
        for (const j of tr.jobs) tickets[j.id] = j.tickets;
        if (!end && (st.draw.skipped || !st.draw.total)) items.push(P.text('stT', 0, 160, 'no ready job holds a ticket, even with loans recalled: no draw; the first ready job runs', 'glabel', 14));
        else if (!end) {
          const d = st.draw, sx = 0, sw = W, sy = 140, per = sw / d.total;
          if (d.recalled && d.recalled.length) items.push(P.text('stR', W, sy - 14, 'loans recalled from ' + P.list(d.recalled), 'hot', 14, 'end'));
          items.push(P.text('stT', 0, sy - 14, `the ${d.total} tickets of the ready jobs, and the number drawn`, 'glabel', 14));
          d.holders.filter((h) => h.tickets > 0).forEach((h) => {
            const x = Math.round(sx + h.lo * per), w = Math.round((h.hi - h.lo + 1) * per);
            const lab = `${h.id}: ${h.lo}–${h.hi}`, fits = S.geom.textWidth(lab, 14, { bold: true }) + 10 < w;
            items.push({ key: 'tk' + h.id, kind: 'cell', x, y: sy, w, h: 34, text: fits ? lab : h.id, size: 14, cls: 'gseg ' + P.pcls(jobs, h.id) + (h.id === d.winner ? ' now' : '') });
          });
          items.push({ key: 'draw', kind: 'head', x: Math.max(60, Math.min(W - 60, Math.round(sx + (d.number + 0.5) * per))), y: sy + 34, text: 'draw ' + d.number + ': ' + d.winner, side: 'below', cls: 'act' });
        }
        items.push(...shareBars({ x: 0, y: end ? 160 : 250, w: 420, got, tickets: tr.steps[Math.min(t, tr.steps.length - 1)].tickets || tickets, jobs }));
        const meta = { phase: end ? 'end' : 'draw', t, run: st.run, ready: st.ready || [], step: st, draw: st.draw, got, decision: st.decision };
        let say = P.clean(st.say);
        if (end) {
          const f = tr.fairness;
          meta.fair = f; meta.nDraws = tr.draws.length; meta.pct = jobs.map((id) => Math.round((100 * got[id]) / Math.max(1, Object.values(got).reduce((a, b) => a + b, 0))));
          say = `All done at t = ${tr.end} after ${P.s(tr.draws.length, 'draw')}. Over the run the CPU went ` + jobs.map((id, k) => `${meta.pct[k]}% to ${id}`).join(', ') + `. While all competed (t = ${f.from} to ${f.to}) the CPU per ticket gave a fairness index of ${P.f(f.jain)} (1 is perfectly proportional).`;
        }
        frames.push({ items, say, meta, title: end ? 'end' : 'draw ' + (decide.indexOf(t) + 1) });
      }
      return { frames, def: P.def(['A draw', ['list the ready jobs; job i owns tickets [lo_i, hi_i]', 'draw n uniformly from 0 to total − 1', 'the owner of n runs for one quantum']], ['Why it is fair on average', 'A job with t of T tickets wins each draw with probability t / T, so over n draws it expects n·t / T of them. The spread around that shrinks as the number of draws grows, which is why short jobs see unfair luck.'], ['Ticket transfer', 'A client blocked on a server can lend it its tickets, so the server runs with the client\'s share and the client gets its answer sooner.']) };
    },
    predict: [{ at: (f, i, fr) => f.meta.phase === 'draw' && fr[i + 1] && fr[i + 1].meta.phase === 'draw' && i === 1, pick: 'option', ask: (fr, i) => `The next draw is ${fr[i + 1].meta.draw.number} of ${fr[i + 1].meta.draw.total}. Whose ticket is it?`, options: (fr, i) => fr[i + 1].meta.draw.holders.map((h) => h.id), answer: (fr, i) => fr[i + 1].meta.draw.winner, explain: (fr, i) => fr[i + 1].say }],
    quiz: [
      { q: 'A holds 300 tickets and B holds 100. What is A\'s chance of winning a draw?', options: ['3/4', '1/3', '1/2', '3/1'], answer: 0, why: '300 / 400.' },
      { q: 'Over 400 draws, about how many does A win?', options: ['300', '100', '200', '400'], answer: 0, why: '400 × 3/4.' },
      { q: 'Why can a short job get far less than its share under lottery?', options: ['With few draws, chance has not evened out', 'Short jobs hold fewer tickets', 'The quantum is longer for them', 'Lottery favours long jobs'], answer: 0, why: 'Proportionality holds on average over many draws.' },
      { q: 'What does lending tickets to a server achieve?', options: ['The server runs with the client\'s share while the client waits for it', 'The client runs faster', 'The server gets a new priority class', 'Nothing'], answer: 0, why: 'The client\'s waiting time is spent on its own request.' },
      { q: 'What must a lottery scheduler remember about the past?', options: ['Nothing: each draw is fresh', 'Every job\'s CPU so far', 'The last quantum of each job', 'Each job\'s waiting time'], answer: 0, why: 'That is its simplicity, and the source of its variance.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'sch-stride', family: 'p05-share', order: 20, title: 'Stride scheduling',
    blurb: 'Stride scheduling gives the same proportions as a lottery, deterministically. Each job has a stride, a large number divided by its tickets, and a pass value. The job with the lowest pass runs, and each tick it runs adds its stride to its pass. A job with three times the tickets has a third of the stride, so it runs three times as often. On the number line, the lowest marker runs and hops on by its stride.',
    inputs: [P.workInput(SHARES, { maxCpu: 120 }), { id: 'q', kind: 'number', label: 'Quantum (ticks)', def: 2, min: 1, max: 6 }, { id: 'L', kind: 'number', label: 'Large number L (stride = L / tickets)', def: 600, min: 60, max: 100000 }],
    check: (inp) => { const r = P.parseWork(inp.work, { maxCpu: 120 }); if (r.error) return null; const most = Math.max(...r.jobs.map((j) => (j.tickets === undefined ? 100 : j.tickets))); return inp.L < most ? `L must be at least the largest ticket count (${most}), or a stride would be 0` : null; },
    presets: [
      { label: 'Tickets 3 : 2 : 1', values: { work: SHARES, L: 600 } },
      { label: 'Tickets 3 : 1, quantum 1', values: { work: 'A 0 12 tickets=300\nB 0 12 tickets=100', q: 1, L: 600 } },
      { label: 'A late arrival starts at the global pass', values: { work: 'A 0 20 tickets=200\nB 0 20 tickets=200\nC 8 10 tickets=200', L: 600 } },
      { label: 'A job with I/O keeps its place', values: { work: 'A 0 14 tickets=100\nB 0 4 (6) 4 (6) 4 tickets=100', L: 600 } },
    ],
    run(inp) {
      const work = P.work(inp.work, { maxCpu: 120 }), tr = Sch().stride(work, { quantum: inp.q, L: inp.L }), jobs = tr.jobs.map((j) => j.id), W = P.W_;
      const decide = tr.steps.map((s, t) => (s.decision === 'dispatch' ? t : -1)).filter((t) => t >= 0);
      const ts = pickTicks(decide, 12, 8).concat([tr.end]);
      const maxS = Math.max(...tr.jobs.map((j) => Math.floor(inp.L / j.tickets)));
      const frames = [];
      for (const t of ts) {
        const st = tr.steps[t], end = st.kind === 'end', items = [P.now('now', 0, 4, t, end)];
        items.push(...P.gantt({ prefix: 'g', tr, jobs, t, x0: P.X0, x1: W, y: 50, label: 'CPU', final: end }).items);
        const tab = st.table || [];
        if (!end) {
          // one track per job, its marker at its pass value; the global pass as a dashed line across them
          const passes = tab.map((r) => r.pass).concat([st.gpass]), lo = Math.min(...passes), span = Math.max(1, maxS * 2.6, Math.max(...passes) - lo + maxS);
          const x0 = 250, x1 = W - 30, X = (v) => Math.round(x0 + ((v - lo) / span) * (x1 - x0)), ry = (k) => 140 + k * 48, rows = tr.jobs.length;
          items.push(P.text('nlT', 0, 114, 'pass values (the lowest ready job runs next)', 'glabel', 14));
          const nice = S.Kit.curve.ticks(lo, lo + span, 6);
          for (const v of nice) if (X(v) >= x0 && X(v) <= x1) items.push(P.text('nt' + v, X(v), ry(rows) + 10, String(v), 'tick', 13, 'middle'));
          tr.jobs.forEach((j, k) => {
            const r = tab.find((x) => x.id === j.id), y = ry(k);
            items.push(P.text('jl' + j.id, 0, y + 22, j.id, 'glname', 15));
            items.push(P.text('jd' + j.id, 34, y + 22, `${j.tickets} tickets · stride ${Math.floor(inp.L / j.tickets)}`, 'glabel', 14));
            items.push(...G().track({ prefix: 'tk' + j.id, x: x0 - 20, y: y + 4, w: x1 - x0 + 40, h: 28 }));
            if (!r) { items.push(P.text('jn' + j.id, x0, y + 23, t < j.arrive ? 'not arrived' : 'done', 'glabel', 14)); return; }
            const b = G().job('j:' + j.id, X(r.pass) - 26, y + 1, String(r.pass), jobs, { w: 52, h: 34, cls: (j.id === st.run ? 'run' : r.state === 'io' ? 'io' : '') + ' ' + P.pcls(jobs, j.id) });
            b.size = 14;
            items.push(b);
            if (j.id === st.run) {
              let n = 0;
              for (let u = t; u < tr.steps.length && tr.steps[u].run === st.run && (u === t || tr.steps[u].decision !== 'dispatch'); u++) if (!tr.steps[u].cs) n++;
              n = Math.max(1, n);
              const to = Math.min(x1 + 20, X(r.pass + n * r.stride));
              const lab = '+' + n + ' × ' + r.stride, tw = S.geom.textWidth(lab, 14, { bold: true });
              // right of the arrow; when the arrow reaches the end of the track, above its tip instead
              let lx = Math.max(X(r.pass) + 26, to) + tw / 2 + 10, lyy = y + 18;
              if (lx + tw / 2 > W + 4) { lx = Math.min(W - tw / 2, to - tw / 2); lyy = y - 6; }
              items.push({ key: 'hop', kind: 'edge', from: 'j:' + j.id, to: { x: to, y: y + 18 }, cls: 'p05back', label: lab, size: 14, lx: Math.round(lx), ly: lyy });
            }
          });
          items.push({ key: 'gpl', kind: 'path', d: `M${X(st.gpass)},${ry(0) - 4} V${ry(rows) - 6}`, cls: 'gboost', audit: 'ignore', layer: 'top' });
          items.push(P.text('gpt', X(st.gpass), ry(rows) + 30, 'global pass ' + st.gpass, 'gboost', 13, 'middle'));
        }
        const got = Sch().share(tr, 0, t);
        const meta = { phase: end ? 'end' : 'tick', t, run: st.run, ready: st.ready || [], step: st, table: tab, got, decision: st.decision, gpass: st.gpass, gstride: st.gstride };
        let say = P.clean(st.say);
        if (end) {
          const f = tr.fairness;
          meta.fair = f;
          items.push(...G().table({ prefix: 'fin', x: 0, y: 130, cols: [{ w: 60, label: 'job' }, { w: 90, label: 'tickets' }, { w: 160, label: 'CPU while all ran' }, { w: 150, label: 'per 100 tickets' }], rows: tr.jobs.map((j, k) => ({ key: j.id, cells: [{ text: j.id, cls: P.pcls(jobs, j.id) }, String(j.tickets), String(f.got[j.id]), P.f(100 * f.per[k])] })), rowH: 28, size: 14 }).items);
          say = `All done at t = ${tr.end}. While every job competed (t = ${f.from} to ${f.to}) the CPU ticks they got were ` + tr.jobs.map((j) => `${j.id} ${f.got[j.id]}`).join(', ') + `: per ticket, a fairness index of ${P.f(f.jain)}.`;
        }
        frames.push({ items, say, meta, title: end ? 'end' : 't = ' + t });
      }
      P.markAsks(frames, 3);
      return { frames, def: P.def(['The rule', ['stride = ⌊L / tickets⌋', 'run the ready job with the lowest pass (ties: the one waiting longest)', 'each tick it runs: pass += stride']], ['Joining and leaving', 'A new job starts at the global pass plus its stride, so it neither waits for ages nor jumps the queue. A job that leaves for I/O keeps the distance between its pass and the global pass, and gets it back when it returns.'], ['Against lottery', 'Stride reaches the exact proportions within one round instead of on average, at the price of keeping a pass per job and a global pass.']) };
    },
    predict: [P.askNext()],
    quiz: [
      { q: 'L = 600; A has 300 tickets, B has 100. Their strides are…', options: ['2 and 6', '300 and 100', '6 and 2', '0.5 and 1.5'], answer: 0, why: '600 / 300 and 600 / 100.' },
      { q: 'Passes A 4, B 6, C 5. Who runs next?', options: ['A', 'B', 'C', 'the one with most tickets'], answer: 0, why: 'The lowest pass.' },
      { q: 'A (stride 2) and B (stride 6) both start at pass 0. Over 8 ticks of quantum 1, how many does A get?', options: ['6', '4', '2', '8'], answer: 0, why: 'A runs three times for each run of B.' },
      { q: 'Why does a new job start at the global pass and not at 0?', options: ['At 0 it would monopolise the CPU until it caught up', 'To save memory', '0 is not allowed', 'So it starts last'], answer: 0, why: 'Everyone else has passed far beyond 0.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
