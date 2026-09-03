// Part 7, the race: count++ as a load, an add and a store, run by threads under a schedule the reader types; every
// interleaving of two such threads as a tree (S.Sync.raceTree); and the same race in real C on the simulated
// kernel at machine granularity, where the model checker (S.MC over S.MC.kernel) finds a schedule that loses an
// update and replays it.
(function (S) {
  'use strict';
  const H = S.P07, Y = () => S.Sync, K7 = () => S.Kit.sync7;
  const LINES = ['load:  r = count', 'add:   r = r + 1', 'store: count = r'];

  // ---- 1. stepping count++ by hand ------------------------------------------------------------------------------
  function scheduleCheck(v, input) {
    const n = +input.threads, names = Array.from({ length: n }, (_, i) => 'T' + i);
    const bad = (v || []).find((x) => !names.includes(x));
    if (bad !== undefined) return 'Schedule: "' + bad + '" is not one of ' + names.join(', ');
    for (const nm of names) { const k = v.filter((x) => x === nm).length; if (k !== 3) return 'Schedule: ' + nm + ' must appear 3 times (load, add, store), not ' + k; }
    return null;
  }
  H.topic({
    id: 'sync-race-steps', family: 'p07-race', order: 10, title: 'count++ is three steps',
    blurb: 'One line of C, count++, is three machine steps: load count into a register, add 1 in the register, store the register back. Each thread has its own register, the count is shared, and the scheduler may switch threads between any two steps. Type a schedule and watch where an update disappears.',
    inputs: [
      { id: 'threads', kind: 'choice', label: 'Threads', def: '2', options: [{ value: '2', label: '2 threads' }, { value: '3', label: '3 threads' }] },
      { id: 'order', kind: 'list', label: 'Schedule (who steps, in order)', def: ['T0', 'T1', 'T0', 'T1', 'T0', 'T1'], min: 6, max: 9, check: scheduleCheck },
    ],
    presets: [
      { label: 'Lost update', values: { threads: '2', order: ['T0', 'T1', 'T0', 'T1', 'T0', 'T1'] } },
      { label: 'One after the other', values: { threads: '2', order: ['T0', 'T0', 'T0', 'T1', 'T1', 'T1'] } },
      { label: 'Late load', values: { threads: '2', order: ['T0', 'T0', 'T1', 'T0', 'T1', 'T1'] } },
      { label: 'Three threads, two lost', values: { threads: '3', order: ['T0', 'T1', 'T2', 'T0', 'T1', 'T2', 'T0', 'T1', 'T2'] } },
      { label: 'Three threads, one lost', values: { threads: '3', order: ['T0', 'T0', 'T0', 'T1', 'T2', 'T1', 'T2', 'T1', 'T2'] } },
    ],
    counters: [{ id: 'step', label: 'steps taken' }, { id: 'count', label: 'count' }],
    run(inp) {
      const n = +inp.threads, spec = Y().counter('race', n);
      const run = Y().run(spec, { policy: 'manual', order: inp.order.slice() });
      const F = new S.Frames(['step', 'count']), colW = n === 3 ? 228 : 262, memX = n * colW + 10;
      const view = H.box(-10, -10, memX + 240, 420);
      const strip = (upto) => K7().strip({ prefix: 'sc', x: 0, y: 290, w: memX + 200, steps: inp.order.map((nm) => ({ tid: +nm.slice(1), text: nm })), upto, cw: 44, ch: 30, size: 13, title: 'the schedule' }).items;
      const lost = [];
      function picture(st, o) {
        o = o || {};
        const items = [];
        st.threads.forEach((th, i) => {
          const x = i * colW;
          items.push(...K7().threads({ prefix: 'th' + i, x, y: 20, threads: [{ id: i, name: th.name, state: th.state === 'ready' && o.act === i ? 'running' : th.state, act: o.act === i }], w: 74, h: 38 }).items);
          const r = th.reg.r === undefined ? '–' : th.reg.r;
          items.push({ key: 'rg' + i, kind: 'cell', x: x + 84, y: 22, w: n === 3 ? 96 : 110, h: 34, rx: 6, text: 'r = ' + r, size: 15, cls: 'regcell' + (o.act === i && (o.op === 'read' || o.op === 'local') ? ' hot' : '') });
          items.push(...H.code('cd' + i, x, 84, spec, st, [i], { lines: LINES, act: o.act, line: o.line, textW: n === 3 ? 160 : 186, size: 14, lh: 34, markW: 34 }).items);
          items.push(H.text('dn' + i, x, 210, th.state === 'done' ? 'done' : 'next: ' + LINES[th.pc].split(':')[0], th.state === 'done' ? 'good' : 'p7note', 13));
        });
        items.push(H.title('mt', memX, 30, 'shared memory'));
        items.push(...K7().vars({ prefix: 'mem', x: memX, y: 44, rows: [{ name: 'count', value: st.vars.count, act: o.op === 'write', hot: !!o.lostHere }], nameW: 70, valW: 70 }).items);
        if (o.lostHere) items.push(H.text('lw', memX, 112, o.lostHere, 'hot', 13));
        items.push(...strip(o.upto || 0));
        if (o.verdict) items.push(...K7().verdict(Object.assign({ prefix: 'vd', x: memX, y: 150, w: 220 }, o.verdict)).items);
        return items;
      }
      const st0 = Y().machine(spec).snap();
      F.add({ items: picture(st0, { upto: 0 }), say: `${H.plural(n, 'thread')} each run count++ once, as three steps: load count into its own register r, add 1 to r, store r back into count. count starts at \`0\`; if no update is lost it ends at \`${n}\`. The schedule says who takes each of the ${inp.order.length} steps.`, meta: { vals: [n, inp.order.length, 3, 0] } });
      run.steps.forEach((s, k) => {
        const st = s.state, prev = k ? run.steps[k - 1].state : st0;
        let lostHere = '', say = s.say;
        if (s.op === 'write') {
          const before = prev.vars.count, stored = st.vars.count, loadedAt = s.state.threads[s.tid].reg.r - 1;
          if (before >= stored) {
            const victims = run.steps.slice(0, k).filter((x) => x.op === 'write' && x.tid !== s.tid && x.state.vars.count > loadedAt).map((x) => x.name);
            lost.push(...victims.filter((v) => !lost.includes(v)));
            lostHere = 'lost: ' + victims.join(', ') + '’s update';
            say += ` count was already \`${before}\`: ${s.name} loaded \`${loadedAt}\` before ${H.list(victims)} stored, so ${victims.length > 1 ? 'their updates are' : 'that update is'} written over.`;
          } else say += ` count goes from \`${before}\` to \`${stored}\`.`;
        }
        F.set('step', k + 1).set('count', st.vars.count);
        const next = run.steps[k + 1];
        F.add({ items: picture(st, { act: s.tid, line: s.pc, op: s.op, upto: k + 1, lostHere }), say, meta: { vals: [k + 1, st.vars.count, prev.vars.count, ...st.threads.map((t) => t.reg.r).filter((x) => x !== undefined), s.state.threads[s.tid].reg.r - 1], step: s.op, next: next && next.op === 'write' ? next.name : null, store: next && next.op === 'write' ? next.state.vars.count : null } });
      });
      const fin = run.machine.vars.count, ok = fin === n;
      F.add({ items: picture(run.machine.snap(), { upto: inp.order.length, verdict: ok ? { kind: 'ok', head: 'count = ' + fin, lines: ['every update counted'] } : { kind: 'bad', head: 'count = ' + fin + ', not ' + n, lines: [H.plural(n - fin, 'update') + ' lost'] } }), say: ok ? `Every thread has finished and count is \`${fin}\`, as it should be: in this schedule no thread loaded count while another had loaded it and not yet stored.` : `Every thread has finished, but count is \`${fin}\`, not \`${n}\`: ${H.plural(n - fin, 'update')} lost. A thread that loads before another's store works from an old value, and its store wipes the other's work out. Nothing failed and no error is reported: the program is simply wrong for this schedule.`, meta: { vals: [fin, n, n - fin], fin } });
      return { frames: F.list, def: H.def('count++ in machine steps', ['load   r = count     (r: a register,', '                     one per thread)', 'add    r = r + 1', 'store  count = r', '', 'a switch may come between any two steps', 'a lost update: load, other\'s store, store']) };
    },
    predict: [
      { at: (f) => !!(f.meta && f.meta.next), pick: 'option', once: true, ask: (fr, i) => 'What value will ' + fr[i].meta.next + ' store into count?', options: (fr, i, inp) => Array.from({ length: +inp.threads }, (_, k) => String(k + 1)), answer: (fr, i) => String(fr[i + 1].meta.vals[1]), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Two threads each run count++ once from count = 0. Which final values are possible?', options: ['1 or 2', 'only 2', '0, 1 or 2', 'only 1'], answer: 0, why: 'Each store writes at least 1; a lost update leaves 1, and no loss leaves 2.' },
      { q: 'Why does each thread have its own r?', options: ['registers belong to the thread, saved and restored on a switch', 'the compiler makes a copy of count', 'r lives in shared memory', 'r is a lock'], answer: 0, why: 'A context switch saves a thread\'s registers; another thread gets its own.' },
      { q: 'Which step can be moved anywhere without changing the result?', options: ['the add, which touches only the thread\'s register', 'the load', 'the store', 'none of them'], answer: 0, why: 'The add reads and writes only r, so no other thread can see when it happens.' },
      { q: 'A lost update happens exactly when…', options: ['a thread loads count, then another stores to it, then the first stores', 'two threads add at once', 'a thread stores twice', 'the count overflows'], answer: 0, why: 'The first store is computed from a value that is now stale, and it overwrites the newer one.' },
      { q: 'With three threads, what is the smallest final count?', options: ['1', '0', '2', '3'], answer: 0, why: 'If all three load 0 before any stores, every store writes 1.' },
    ],
  });

  // ---- 2. every interleaving as a tree ---------------------------------------------------------------------------
  const PROGS = { race: 'count++ as three steps', mutex: 'count++ inside lock(m) … unlock(m)', atomic: 'fetch-and-add: one step' };
  H.topic({
    id: 'sync-race-tree', family: 'p07-race', order: 20, title: 'Every interleaving, as a tree',
    blurb: 'From the start, either thread may take the next step; from there, either again, and so on. Drawing every choice gives a tree whose leaves are the complete schedules. Count the leaves that end with the right total: for count++ in three steps most of them do not, with a lock all of them do.',
    inputs: [{ id: 'prog', kind: 'choice', label: 'Each thread runs', def: 'race', options: Object.entries(PROGS).map(([value, label]) => ({ value, label })) }],
    presets: [{ label: 'The race', values: { prog: 'race' } }, { label: 'With a mutex', values: { prog: 'mutex' } }, { label: 'Atomic add', values: { prog: 'atomic' } }],
    counters: [{ id: 'depth', label: 'steps deep' }, { id: 'paths', label: 'schedules so far' }],
    run(inp) {
      const spec = Y().counter(inp.prog, 2), T = Y().raceTree(spec), N = T.nodes;
      const maxD = Math.max(...N.map((x) => x.depth)), nl = T.leaves.length;
      const cw = Math.max(34, Math.min(60, 860 / nl)), lh = maxD > 8 ? 46 : 62, x0 = 20, y0 = 60;
      const P = (nd) => ({ x: Math.round(x0 + nd.x * cw), y: y0 + nd.depth * lh });
      const view = H.box(-20, -10, Math.max(900, nl * cw + 60), y0 + maxD * lh + 120);
      const F = new S.Frames(['depth', 'paths']);
      const good = (v) => v === 2;
      function picture(upto, o) {
        o = o || {};
        const items = [H.title('tt', 0, 18, PROGS[inp.prog] + ', two threads, count starts at 0')];
        for (const nd of N) {
          if (nd.depth > upto) continue;
          const p = P(nd), leaf = !nd.kids.length && nd.depth <= upto && o.finals;
          const on = o.path && o.path.includes(nd.id);
          items.push({ key: 'n' + nd.id, kind: 'state', x: p.x, y: p.y, r: 12, text: String(nd.count), size: 13, cls: 'tnode' + (leaf ? (good(nd.count) ? ' ok' : ' bad') : '') + (on ? ' path' : '') });
          if (nd.parent !== null) items.push({ key: 'e' + nd.id, kind: 'edge', from: 'n' + nd.parent, to: 'n' + nd.id, head: false, cls: (on ? 'path ' : '') + K7().pcls(nd.tid) });
        }
        const ly = y0 + maxD * lh + 40;
        items.push(...H.KS().legend({ prefix: 'lg', x: 0, y: ly, entries: [{ cls: 'p0', text: 'T0 takes a step', line: true }, { cls: 'p1', text: 'T1 takes a step', line: true }, { cls: 'ok', text: 'ends at 2', round: true }, { cls: 'bad', text: 'ends below 2', round: true }], gap: 26 }).items);
        items.push(H.text('nt', 0, ly + 44, 'each circle holds count after that step', 'p7note', 13));
        return items;
      }
      for (let d = 0; d <= maxD; d++) {
        const at = N.filter((x) => x.depth === d), ended = N.filter((x) => x.depth <= d && !x.kids.length).length;
        F.set('depth', d).set('paths', at.length + ended - at.filter((x) => !x.kids.length).length);
        const vals = [...new Set(at.map((x) => x.count))].sort((a, b) => a - b);
        F.add({ items: picture(d), say: d === 0 ? `The root is the start: both threads ready, count = \`0\`. Each level down is one more step, and each branch is a choice of which thread takes it.` : `After ${H.plural(d, 'step')}: ${H.plural(at.length, 'different schedule')} so far${ended - at.filter((x) => !x.kids.length).length ? ' (plus ' + (ended - at.filter((x) => !x.kids.length).length) + ' already finished)' : ''}; count is ${vals.map((v) => '`' + v + '`').join(' or ')} at this depth.`, meta: { vals: [d, at.length, ended - at.filter((x) => !x.kids.length).length, ...vals, 0], depth: d } });
      }
      const fin = T.finals, okN = (fin.find((f) => good(f.value)) || { leaves: 0 }).leaves;
      F.add({ items: picture(maxD, { finals: true }), say: T.say + (okN === nl ? ' Every schedule gives the right answer.' : ` Only ${H.plural(okN, 'schedule')} of ${nl} ${okN === 1 ? 'is' : 'are'} right.`), meta: { vals: [nl, okN, ...fin.flatMap((f) => [f.value, f.leaves]), 2], total: nl } });
      const badLeaf = T.leaves.find((id) => !good(N[id].count)), okLeaf = T.leaves.find((id) => good(N[id].count));
      const pathTo = (id) => { const p = []; for (let u = id; u !== null; u = N[u].parent) p.unshift(u); return p; };
      if (badLeaf !== undefined) {
        const p = pathTo(badLeaf), steps = p.slice(1).map((id) => N[id]);
        F.add({ items: picture(maxD, { finals: true, path: p }), say: `One losing path: ${steps.map((x) => x.name + ' ' + (x.label || '').split(':')[0]).join(', ')}. Both threads load \`0\` before either stores, so both store \`1\`.`, meta: { vals: [0, 1] } });
      }
      if (okLeaf !== undefined) {
        const p = pathTo(okLeaf), steps = p.slice(1).map((id) => N[id]);
        F.add({ items: picture(maxD, { finals: true, path: p }), say: `A winning path: ${steps.map((x) => x.name + ' ' + (x.label || '').split(':')[0].replace(/\(.*$/, '')).join(', ')}. ${inp.prog === 'race' ? 'One thread finishes all three steps before the other loads.' : inp.prog === 'mutex' ? 'The lock keeps the other thread out between the load and the store.' : 'Each update is a single indivisible step, so there is nothing to interleave inside it.'}`, meta: { vals: [] } });
      }
      return { frames: F.list, def: H.def('Counting interleavings', ['two threads of a and b steps:', '  (a + b)! / (a! b!) schedules', 'a = b = 3:  6! / (3! 3!) = 20', 'a = b = 1:  2 schedules', 'a lock removes the schedules that', '  would put the other thread inside']) };
    },
    predict: [
      { at: (f, i) => i === 0, pick: 'option', ask: 'How many complete schedules will the tree have?', options: (fr) => { const n = fr.find((x) => x.meta.total).meta.total; return [...new Set([2, 6, 10, 20, n])].sort((a, b) => a - b).map(String); }, answer: (fr) => String(fr.find((x) => x.meta.total).meta.total), explain: (fr) => fr.find((x) => x.meta.total).say },
    ],
    quiz: [
      { q: 'Two threads of three steps each: how many schedules?', options: ['20', '6', '9', '64'], answer: 0, why: 'Choose which 3 of the 6 slots belong to T0: 6!/(3!·3!) = 20.' },
      { q: 'Why does the mutex tree have fewer leaves even though each thread has more steps?', options: ['a blocked thread cannot be chosen, so many branches never exist', 'the lock removes steps', 'the tree merges equal states', 'mutex threads never switch'], answer: 0, why: 'Once one thread holds the lock, the other can only take its lock step and block.' },
      { q: 'How many of the 20 race schedules end with count = 2?', options: ['2', '1', '10', '18'], answer: 0, why: 'Only the two schedules where one thread runs all three steps first.' },
      { q: 'Testing a racy program a few times finds the bug…', options: ['only if a run happens to hit a losing schedule', 'always', 'never', 'only on one core'], answer: 0, why: 'Most runs may take the common schedules; a checker explores them all.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
