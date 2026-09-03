// Part 7, a hash table (S.Sync.structs.hash) with one lock for the table, a lock per bucket, or no lock: the buckets
// drawn with their locks and contents and each thread's private copy of the bucket it is working on; throughput
// against threads for the two locked tables (S.Sync.scaling); and the unlocked table's lost insert, found by the
// model checker and replayed.
(function (S) {
  'use strict';
  const H = S.P07, Y = () => S.Sync, X = () => S.Sync.structs, K7 = () => S.Kit.sync7, KC = () => S.Kit.curve;
  const WORK = {
    a: { init: [1, 3], ops: [[{ op: 'insert', k: 2 }, { op: 'lookup', k: 1, must: true }], [{ op: 'insert', k: 4 }, { op: 'delete', k: 3 }]] },
    b: { init: [5], ops: [[{ op: 'insert', k: 3 }], [{ op: 'insert', k: 7 }]] },
    c: { init: [2, 4, 9], ops: [[{ op: 'insert', k: 6 }, { op: 'delete', k: 2 }], [{ op: 'insert', k: 7 }, { op: 'lookup', k: 9, must: true }], [{ op: 'insert', k: 5 }]] },
  };
  const opsText = (ops) => ops.map((l, i) => 'T' + i + ': ' + l.map((o) => o.op + '(' + o.k + ')').join(', ')).join('   ');

  H.topic({
    id: 'sync-struct-hash', family: 'p07-structs', order: 30, title: 'A hash table: one lock or a lock per bucket',
    blurb: 'A hash table is an array of buckets, and a key lives in bucket key mod B. One lock for the whole table makes every operation wait for every other. A lock per bucket lets operations on different buckets run at once, which is why it keeps scaling as threads are added. With no lock, two inserts into one bucket can both copy it, and the second write wipes out the first key.',
    inputs: [
      { id: 'variant', kind: 'choice', label: 'Locking', def: 'bucket', options: [{ value: 'coarse', label: 'one lock for the table' }, { value: 'bucket', label: 'a lock per bucket' }, { value: 'no-lock', label: 'no lock (broken)' }] },
      { id: 'buckets', kind: 'number', label: 'Buckets B', def: 2, min: 2, max: 4 },
      { id: 'work', kind: 'choice', label: 'Operations', def: 'a', options: Object.keys(WORK).map((k) => ({ value: k, label: '{' + WORK[k].init.join(', ') + '}  ' + opsText(WORK[k].ops) })) },
      { id: 'seed', kind: 'number', label: 'Scheduler seed', def: 2, min: 1, max: 999 },
    ],
    check: (inp) => (inp.work === 'c' && inp.variant === 'no-lock' ? 'Three threads without a lock: choose a smaller set of operations' : null),
    presets: [
      { label: 'Lock per bucket', values: { variant: 'bucket', buckets: 2, work: 'a', seed: 2 } },
      { label: 'One lock', values: { variant: 'coarse', buckets: 2, work: 'a', seed: 2 } },
      { label: 'No lock: a lost insert', values: { variant: 'no-lock', buckets: 2, work: 'b', seed: 2 } },
      { label: 'Three threads, 4 buckets', values: { variant: 'bucket', buckets: 4, work: 'c', seed: 4 } },
    ],
    counters: [{ id: 'step', label: 'step' }, { id: 'held', label: 'locks held' }],
    run(inp) {
      const B = inp.buckets, W = WORK[inp.work], spec = X().hash(inp.variant, B, W.init, W.ops), F = new S.Frames(['step', 'held']);
      const chk = H.check(spec), v = H.verdictText(chk);
      const steps = chk.steps || Y().run(spec, { policy: 'random', seed: inp.seed, quantum: 2, max: 400 }).steps;
      const sched = chk.sched || steps.map((s) => s.tid), strip = H.stripSteps(spec, sched);
      const curves = ['coarse', 'bucket'].map((vv) => Y().scaling('hash', vv, { threads: [1, 2, 4, 8], ops: 12, seed: 1, buckets: 8 }));
      const ymax = Math.max(...curves.flat().map((p) => p.throughput)) * 1.1;
      const ax = KC().axes({ prefix: 'ax', x: 560, y: 34, w: 280, h: 170, xr: [0, 8], yr: [0, ymax], xticks: [1, 2, 4, 8], yticks: null, xname: 'threads, 8 buckets', yname: 'operations per tick', tickSize: 13 });
      const plot = () => { const items = ax.items.slice(); const drawn = []; curves.forEach((c, i) => { items.push(KC().line(ax, 'ln' + i, c.map((p) => [p.n, p.throughput]), i ? 'c2' : 'c1')); c.forEach((p) => { const d = KC().dot(ax, 'd' + i + p.n, p.n, p.throughput, i ? 'c2' : 'c1'); if (drawn.some((q) => Math.hypot(q.x - d.x, q.y - d.y) < 10)) return; drawn.push(d); items.push(d); }); }); items.push(...KC().legend('lg', 560, 262, [{ text: 'one lock', cls: 'c1' }, { text: 'lock per bucket', cls: 'c2' }], {})); return items; };
      function draw(st, o) {
        o = o || {};
        const items = plot();
        const lockOf = (b) => (inp.variant === 'coarse' ? st.mutex.H : inp.variant === 'bucket' ? st.mutex['B' + b] : null);
        if (inp.variant === 'coarse') { const m = st.mutex.H; items.push(...K7().mutex({ prefix: 'tl', x: 0, y: 6, name: 'table lock', nameW: 104, owner: m.owner === null ? null : st.threads[m.owner].name, ownerCls: m.owner === null ? '' : K7().pcls(m.owner), queue: m.queue.map((i) => st.threads[i].name) }).items); }
        const by = inp.variant === 'coarse' ? 60 : 20;
        for (let b = 0; b < B; b++) {
          const y = by + b * 50, keys = st.vars['b' + b], m = lockOf(b);
          items.push({ key: 'bn' + b, kind: 'cell', x: 0, y, w: 84, h: 36, rx: 6, text: 'bucket ' + b, size: 14, cls: 'thcard ' + (m && m.owner !== null ? K7().pcls(m.owner) : 's-ready') });
          if (m && m.owner !== null) items.push(H.text('bo' + b, 92, y + 23, st.threads[m.owner].name, K7().pcls(m.owner), 13));
          keys.forEach((k, j) => items.push({ key: 'k' + k, kind: 'cell', x: 130 + j * 50, y: y + 2, w: 44, h: 32, rx: 5, text: String(k), size: 15, cls: 'varval' }));
          if (!keys.length) items.push(H.text('be' + b, 130, y + 23, 'empty', 'qnone', 13));
        }
        const ty = by + B * 50 + 16;
        items.push(H.title('tt', 0, ty, 'each thread\'s copy of the bucket it is working on'));
        st.threads.forEach((th, i) => items.push(...K7().regs({ prefix: 'rg' + i, x: 0, y: ty + 12 + i * 38, name: th.name, cls: S.Kit.sync7.stateCls(th.state === 'ready' && o.act === i ? 'running' : th.state), act: o.act === i, regs: [['arr', th.reg.arr ? '[' + th.reg.arr.join(', ') + ']' : '–']], cw: 120 }).items));
        const sy = Math.max(300, ty + 12 + st.threads.length * 38 + 14);
        items.push(H.text('ops', 0, sy, opsText(W.ops), 'p7note', 13));
        items.push(...K7().strip({ prefix: 'sc', x: 0, y: sy + 16, w: 530, steps: strip, upto: o.upto, cw: 32, ch: 26, size: 13, maxCols: 16, title: chk.steps ? 'the failing schedule' : 'the schedule (random, seed ' + inp.seed + ')' }).items);
        if (o.verdict) items.push(...K7().verdict(Object.assign({ prefix: 'vd', x: 560, y: 296, w: 280 }, o.verdict)).items);
        return items;
      }
      const vd = { kind: v.kind, head: v.head, lines: [chk.stats.states + ' states searched'] };
      const c1 = curves[0], c2 = curves[1];
      F.add({ items: draw(Y().machine(spec).snap(), { upto: 0, verdict: vd }), say: `${B} buckets holding ${W.init.join(', ')}; key k goes to bucket k mod ${B}. ${spec.about} On the right, measured on an ideal machine with 8 buckets: one lock gives \`${c1[3].throughput.toFixed(2)}\` operations per tick at 8 threads, a lock per bucket \`${c2[3].throughput.toFixed(2)}\`. ${chk.steps ? 'The model checker searched ' + chk.stats.states + ' states and found a schedule of ' + H.plural(chk.sched.length, 'step') + ' that loses a key. Here it is.' : 'The model checker searched all ' + chk.stats.states + ' states: every key ends where it should.'}`, meta: { vals: [B, ...W.init, 8, +c1[3].throughput.toFixed(2), +c2[3].throughput.toFixed(2), chk.stats.states].concat(chk.sched ? [chk.sched.length] : []) } });
      steps.forEach((s, k) => {
        const held = Object.values(s.state.mutex).filter((m) => m.owner !== null).length;
        F.set('step', k + 1).set('held', held);
        F.add({ items: draw(s.state, { act: s.tid, upto: k + 1 }), say: s.say, meta: { vals: H.nums(s.say).concat([k + 1, held]) } });
      });
      const last = steps[steps.length - 1].state, all = Object.keys(last.vars).flatMap((b) => last.vars[b]).sort((a, b) => a - b);
      F.add({ items: draw(last, { upto: strip.length, verdict: vd }), say: chk.steps ? `The table holds ${all.join(', ')}: ${chk.res.safety.violation.name.replace('at the end it holds', 'it should hold')}. Both threads copied the same bucket and wrote their copy back; the second write erased the first thread's key.` : `The table holds ${all.join(', ')}, as it should.`, meta: { vals: all.concat(H.nums(chk.res.safety.violation ? chk.res.safety.violation.name : '')), final: all, violated: !!chk.res.safety.violation } });
      return { frames: F.list, def: H.def('Locking a hash table', ['one lock: lock(table); op; unlock', 'per bucket: b = k mod B;', '  lock(bucket[b]); op; unlock', 'different buckets: no waiting', 'no lock: read bucket, change copy,', '  write back: two writers, one lost']) };
    },
    predict: [{ at: (f, i) => i === 0, pick: 'option', ask: 'Two inserts land in the same bucket. With a lock per bucket, do they wait for each other?', options: ['yes', 'no'], answer: 'yes', explain: () => 'They share that bucket\'s lock; only operations on different buckets run at once.' }],
    quiz: [
      { q: 'Why does a lock per bucket scale while one table lock does not?', options: ['operations on different buckets take different locks', 'bucket locks are faster', 'it uses fewer buckets', 'it does not scale either'], answer: 0, why: 'Contention falls as the keys spread over many buckets.' },
      { q: 'Keys 3 and 7 with B = 4: do inserts of both contend?', options: ['yes: both go to bucket 3', 'no', 'only on lookup', 'only with one lock'], answer: 0, why: '3 mod 4 = 7 mod 4 = 3.' },
      { q: 'What goes wrong with no lock?', options: ['two threads copy the bucket and the later write loses the other key', 'nothing', 'deadlock', 'the table is resized'], answer: 0, why: 'A read-modify-write of the bucket is a race like count++.' },
      { q: 'How many locks can a per-bucket table\'s operation hold at once?', options: ['one', 'B', 'two', 'none'], answer: 0, why: 'Each operation touches one bucket, so no lock ordering problem arises.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
