// Part 7, lock-based data structures (S.Sync.structs, S.Sync.perf, S.Sync.scaling): a counter with one lock, with
// per-thread local counts flushed every S increments, and with fetch-and-add, measured on an ideal machine with one
// core per thread (throughput against threads) and stepped to show the batching counter's lag; and a sorted linked
// list with one big lock or hand-over-hand locking, with the broken variant the model checker catches.
(function (S) {
  'use strict';
  const H = S.P07, Y = () => S.Sync, X = () => S.Sync.structs, K7 = () => S.Kit.sync7, KC = () => S.Kit.curve;
  const NTH = [1, 2, 4, 8];
  const f2 = (v) => (+v).toFixed(2);

  H.topic({
    id: 'sync-struct-counter', family: 'p07-structs', order: 10, title: 'A concurrent counter, three ways',
    blurb: 'The simplest shared structure is a counter. One lock makes it exact, but every increment from every core queues for that lock, so adding threads adds no speed. A batching counter lets each thread count locally and add to the global count every S increments: fast, with a global value that lags a little. One atomic fetch-and-add per increment needs no lock at all.',
    inputs: [
      { id: 'variant', kind: 'choice', label: 'Step through', def: 'sloppy', options: [{ value: 'lock', label: 'one lock' }, { value: 'sloppy', label: 'batching (local counts)' }, { value: 'faa', label: 'fetch-and-add' }] },
      { id: 'thresh', kind: 'number', label: 'S (batch flushed every)', def: 2, min: 2, max: 4 },
      { id: 'ops', kind: 'number', label: 'Increments per thread', def: 3, min: 2, max: 5 },
    ],
    presets: [
      { label: 'Batching, S = 2', values: { variant: 'sloppy', thresh: 2, ops: 3 } },
      { label: 'Batching, S = 4', values: { variant: 'sloppy', thresh: 4, ops: 5 } },
      { label: 'One lock', values: { variant: 'lock', thresh: 2, ops: 3 } },
      { label: 'Fetch-and-add', values: { variant: 'faa', thresh: 2, ops: 3 } },
    ],
    counters: [{ id: 'step', label: 'step' }, { id: 'lag', label: 'global lags by' }],
    run(inp) {
      const F = new S.Frames(['step', 'lag']), V = ['lock', 'sloppy', 'faa'], NAMES = { lock: 'one lock', sloppy: 'batching, S = ' + inp.thresh, faa: 'fetch-and-add' };
      const curves = Object.fromEntries(V.map((v) => [v, Y().scaling('counter', v, { threads: NTH, ops: 12, seed: 1, threshold: inp.thresh })]));
      const ymax = Math.max(...V.flatMap((v) => curves[v].map((p) => p.throughput))) * 1.1;
      const ax = KC().axes({ prefix: 'ax', x: 50, y: 30, w: 340, h: 240, xr: [0, 8], yr: [0, ymax], xticks: NTH, yticks: null, xname: 'threads (one core each)', yname: 'increments per tick', tickSize: 13 });
      const CLS = { lock: 'c1', sloppy: 'c2', faa: 'c0' };
      function plot(upto) {
        const items = ax.items.slice();
        const drawn = [];
        V.slice(0, upto).forEach((v) => { items.push(KC().line(ax, 'ln' + v, curves[v].map((p) => [p.n, p.throughput]), CLS[v])); curves[v].forEach((p) => { const d = KC().dot(ax, 'd' + v + p.n, p.n, p.throughput, CLS[v]); if (drawn.some((q) => Math.hypot(q.x - d.x, q.y - d.y) < 10)) return; drawn.push(d); items.push(d); }); });
        if (upto) items.push(...KC().legend('lg', 50, 330, V.slice(0, upto).map((v) => ({ text: NAMES[v], cls: CLS[v] })), {}));
        return items;
      }
      const at = (v, n) => curves[v].find((p) => p.n === n);
      const per = curves.lock[0].ops, perOk = V.every((v) => curves[v].every((p) => p.ops === p.n * per));
      F.add({ items: plot(0), say: `The curves come from an ideal machine with one core per thread: every tick, each thread that is not blocked takes one step. In these measurements each thread does ${per} increments${perOk ? '' : ' (about)'}; throughput is increments finished per tick. After the curves, a small run of 2 threads doing ${inp.ops} each (${2 * inp.ops} in all) is stepped.`, meta: { vals: [per, inp.ops, 2 * inp.ops, 2], per, runTotal: 2 * inp.ops } });
      V.forEach((v, i) => {
        const a = at(v, 1), b = at(v, 8);
        F.add({ items: plot(i + 1), say: `${H.cap(NAMES[v])}: \`${f2(a.throughput)}\` increments per tick with 1 thread, \`${f2(b.throughput)}\` with 8 (${f2(b.throughput / a.throughput)} times as many), and each increment waits \`${f2(b.waitPerOp)}\` thread-ticks on a lock at 8 threads.${v === 'lock' ? ' The lock makes the increments take turns: more cores, no more speed.' : v === 'sloppy' ? ' Most increments touch only a thread\'s own count; the lock is taken once every ' + inp.thresh + '.' : ' No lock, no waiting: in this ideal machine it scales perfectly (real cores still fight over the one cache line).'}`, meta: { vals: [a.throughput, b.throughput, b.throughput / a.throughput, b.waitPerOp, 1, 8, inp.thresh].map((x) => +f2(x)).concat([inp.thresh]) } });
      });
      // a small run of the chosen counter, two threads
      const spec = X().counter(inp.variant, [inp.ops, inp.ops], { threshold: inp.thresh }), total = 2 * inp.ops;
      spec.mutexes = (spec.mutexes || []).map((id) => ({ id, name: 'm' }));
      const run = Y().run(spec, { policy: 'random', seed: 2, quantum: 3, max: 400 }), strip = run.steps.map((s) => ({ tid: s.tid, text: s.name }));
      function panel(st, o) {
        const items = plot(3), px = 450, counted = st.threads.map((t) => t.reg.n || 0), sum = counted.reduce((a, b) => a + b, 0);
        items.push(H.title('pt', px, 14, NAMES[inp.variant] + ': two threads, ' + inp.ops + ' increments each'));
        st.threads.forEach((th, i) => items.push(...K7().regs({ prefix: 'rg' + i, x: px, y: 30 + i * 40, name: th.name, cls: S.Kit.sync7.stateCls(th.state === 'ready' && o.act === i ? 'running' : th.state), act: o.act === i, regs: inp.variant === 'sloppy' ? [['counted', counted[i]], ['local', th.reg.l || 0]] : [['counted', counted[i]]], cw: 92 }).items));
        items.push(...K7().vars({ prefix: 'g', x: px, y: 116, rows: [{ name: 'global', value: st.vars.g, act: o.op === 'write' || o.op === 'faa' }, { name: 'true total', value: sum }], nameW: 96, valW: 56 }).items);
        if (inp.variant !== 'faa') items.push(...H.objects('ob', px + 190, 116, spec, st, { lit: o.op === 'lock' || o.op === 'unlock' ? Object.keys(st.mutex)[0] : null }).items);
        items.push(...K7().strip({ prefix: 'sc', x: px, y: 200, w: 420, steps: strip, upto: o.upto, cw: 32, ch: 26, size: 13, maxCols: 13, title: 'the schedule' }).items);
        if (o.verdict) items.push(...K7().verdict(Object.assign({ prefix: 'vd', x: px, y: 200 + 22 + Math.ceil(strip.length / 13) * 32 + 10, w: 400 }, o.verdict)).items);
        return items;
      }
      F.add({ items: panel(Y().machine(spec).snap(), { upto: 0 }), say: `Now two threads, ${inp.ops} increments each, stepped under a random scheduler (seed 2). "counted" is how many increments a thread has made; global is the shared count. ${inp.variant === 'sloppy' ? 'A thread adds its local count to global, under the lock, when it reaches S = ' + inp.thresh + ' and once more at the end.' : ''}`, meta: { vals: [inp.ops, 2, inp.thresh] } });
      let maxLag = 0, maxLocal = 0;
      run.steps.forEach((s, k) => {
        const sum = s.state.threads.reduce((a, t) => a + (t.reg.n || 0), 0), lag = sum - s.state.vars.g;
        maxLag = Math.max(maxLag, lag);
        for (const th of s.state.threads) maxLocal = Math.max(maxLocal, th.reg.l || 0);
        F.set('step', k + 1).set('lag', lag);
        F.add({ items: panel(s.state, { act: s.tid, op: s.op, upto: k + 1 }), say: s.say + (lag > 0 ? ` Global is behind the true total of \`${sum}\` by \`${lag}\`.` : lag < 0 ? ` Global already counts an increment its thread has not yet ticked off: \`${s.state.vars.g}\` against \`${sum}\`.` : ''), meta: { vals: H.nums(s.say).concat([k + 1, sum, lag, s.state.vars.g]) } });
      });
      const chk = H.check(X().counter(inp.variant, [Math.min(inp.ops, 3), Math.min(inp.ops, 2)], { threshold: inp.thresh }));
      F.add({ items: panel(run.machine.snap(), { upto: strip.length, verdict: { kind: 'ok', head: 'global = ' + run.machine.vars.g + ' at the end', lines: [inp.variant === 'sloppy' ? 'it lagged by up to ' + maxLag + ' on the way' : 'never behind', 'checker: ' + chk.stats.states + ' states, exact at the end'] } }), say: `At the end global is \`${run.machine.vars.g}\`, exactly the ${total} increments made${inp.variant === 'sloppy' ? `; on the way it lagged by up to \`${maxLag}\`. A thread holds at most S = ${inp.thresh} increments of its own before it adds them in (it held ${maxLocal} at most here), so the lag can never pass S per thread, ${2 * inp.thresh} in all for 2 threads` : ''}. The model checker confirms over ${chk.stats.states} states that the count is exact at the end${inp.variant === 'sloppy' ? ' and the lag never passes S × threads' : ''}.`, meta: { vals: [run.machine.vars.g, total, maxLag, chk.stats.states, inp.thresh, maxLocal, 2 * inp.thresh], global: run.machine.vars.g, total, curves, maxLag, maxLocal, thresh: inp.thresh } });
      return { frames: F.list, def: H.def('Three counters', ['lock:   lock; count++; unlock', 'batch:  local++; if (local == S)', '  { lock; global += local;', '    unlock; local = 0 }', 'faa:    fetch_and_add(&count, 1)', 'bigger S: faster, more lag']) };
    },
    predict: [{ at: (f, i) => i === 1, pick: 'option', ask: 'With one lock around the counter, how does throughput change from 1 to 8 threads?', options: ['it hardly changes', 'about 8 times as much', 'it drops to zero', 'about twice'], answer: (fr) => { const m = fr[1].meta.vals[2]; return m < 2 ? 'it hardly changes' : m < 4 ? 'about twice' : 'about 8 times as much'; }, explain: (fr) => fr[1].say }],
    quiz: [
      { q: 'Why does one lock stop a counter from scaling?', options: ['every increment on every core must take the same lock in turn', 'locks are slow to create', 'the counter overflows', 'it does scale'], answer: 0, why: 'The critical section is the whole operation, so at most one runs at a time.' },
      { q: 'What does a batching counter give up?', options: ['an exact global value at every moment', 'the final total', 'thread safety', 'nothing'], answer: 0, why: 'Each thread holds up to S increments of its own before adding them in, so the global lags by at most S per thread.' },
      { q: 'A bigger S makes the batching counter…', options: ['faster but laggier', 'slower but exact', 'wrong', 'unchanged'], answer: 0, why: 'Fewer flushes mean fewer lock acquisitions and more counts held locally, up to S per thread.' },
      { q: 'fetch-and-add needs no lock, yet on real hardware 8 cores still slow each other. Why?', options: ['they all write one cache line, which moves from core to core', 'atomic instructions sleep', 'the kernel serialises them', 'they do not'], answer: 0, why: 'Atomicity is enforced by the cache-coherence protocol, which passes the line around.' },
    ],
  });

  // ---- a sorted linked list ----
  const OPS = { a: [[{ op: 'insert', k: 20 }], [{ op: 'delete', k: 10 }, { op: 'lookup', k: 30, must: true }]], b: [[{ op: 'insert', k: 25 }], [{ op: 'delete', k: 20 }]], c: [[{ op: 'insert', k: 15 }, { op: 'insert', k: 35 }], [{ op: 'lookup', k: 40, must: true }]] };
  const INIT = { a: [10, 30], b: [10, 20, 30], c: [10, 20, 30, 40] };
  const opsText = (ops) => ops.map((l, i) => 'T' + i + ': ' + l.map((o) => o.op + '(' + o.k + ')').join(', ')).join('   ');
  H.topic({
    id: 'sync-struct-list', family: 'p07-structs', order: 20, title: 'A linked list: one lock, or hand over hand',
    blurb: 'A sorted list with one lock lets one operation at a time anywhere in it. Hand-over-hand locking gives every node a lock: a thread walking the list holds the lock of the node behind it and the node it looks at, taking the next before letting go of the last, so two threads can work on different parts at once. Let go too early and another thread can unlink the node you are standing on.',
    inputs: [
      { id: 'variant', kind: 'choice', label: 'Locking', def: 'hoh', options: [{ value: 'coarse', label: 'one lock for the list' }, { value: 'hoh', label: 'hand over hand' }, { value: 'hoh-broken', label: 'one node lock at a time (broken)' }] },
      { id: 'work', kind: 'choice', label: 'Operations', def: 'a', options: Object.keys(OPS).map((k) => ({ value: k, label: '[' + INIT[k].join(', ') + ']  ' + opsText(OPS[k]) })) },
      { id: 'seed', kind: 'number', label: 'Scheduler seed', def: 3, min: 1, max: 999 },
    ],
    presets: [
      { label: 'Hand over hand', values: { variant: 'hoh', work: 'a', seed: 3 } },
      { label: 'One lock', values: { variant: 'coarse', work: 'a', seed: 3 } },
      { label: 'Broken: lost insert', values: { variant: 'hoh-broken', work: 'b', seed: 3 } },
      { label: 'Hand over hand, longer list', values: { variant: 'hoh', work: 'c', seed: 5 } },
    ],
    counters: [{ id: 'step', label: 'step' }, { id: 'held', label: 'locks held' }],
    run(inp) {
      const spec = X().list(inp.variant, INIT[inp.work], OPS[inp.work]), F = new S.Frames(['step', 'held']);
      const chk = H.check(spec), v = H.verdictText(chk);
      const steps = chk.steps || Y().run(spec, { policy: 'random', seed: inp.seed, quantum: 2, max: 600 }).steps;
      const sched = chk.sched || steps.map((s) => s.tid), strip = H.stripSteps(spec, sched);
      const coarse = inp.variant === 'coarse';
      function draw(st, o) {
        o = o || {};
        const items = [], V = st.vars, order = [];
        for (let p = 0, g = 0; p !== -1 && g < V.key.length + 1; p = V.next[p], g++) order.push(p);
        const nodeW = 84, gap = 46, y0 = 70, nh = 50, low = y0 + 150;
        const pos = {};
        order.forEach((p, i) => { pos[p] = 20 + i * (nodeW + gap); });
        // nodes not (or no longer) in the list sit on a lower row, under the place their key would take
        const loose = V.key.map((k, i) => i).filter((i) => i > 0 && V.key[i] !== null && !order.includes(i));
        const used = [];
        loose.forEach((p) => {
          const after = order.filter((q) => q === 0 || V.key[q] < V.key[p]).length;
          let x = 20 + after * (nodeW + gap) - (nodeW + gap) / 2;
          while (used.some((u) => Math.abs(u - x) < nodeW + 10)) x += nodeW + 14;
          used.push(x); pos[p] = Math.round(x);
        });
        const own = (p) => (coarse ? null : st.mutex['n' + p] ? st.mutex['n' + p].owner : null);
        const nodeY = (p) => (order.includes(p) ? y0 : low);
        for (const p of order.concat(loose)) {
          const o2 = own(p), held = o2 !== null && o2 !== undefined;
          items.push({ key: 'nd' + p, kind: 'cell', x: pos[p], y: nodeY(p), w: nodeW, h: nh, rx: 7, lines: [p === 0 ? 'head' : String(V.key[p]), held ? st.threads[o2].name + ' locks it' : ' '], size: 15, cls: 'thcard ' + (held ? K7().pcls(o2) : 's-ready') + (loose.includes(p) ? ' dim' : '') });
        }
        for (const p of order.concat(loose)) { const q = V.next[p]; if (q >= 0 && pos[q] !== undefined) items.push({ key: 'nx' + p, kind: 'edge', from: 'nd' + p, to: 'nd' + q, cls: loose.includes(p) ? 'faint' : '' }); }
        // each thread's p and c pointers as tags: above a node in the list, below one that is not
        const tags = {};
        st.threads.forEach((th, i) => { if (th.state === 'done') return; for (const r of ['p', 'c']) { const at = th.reg[r]; if (at === undefined || at === null || at < 0 || pos[at] === undefined) continue; (tags[at] = tags[at] || []).push({ text: th.name + '.' + r, tid: i }); } });
        Object.entries(tags).forEach(([p, list]) => list.forEach((t, j) => items.push({ key: 'tg' + t.text, kind: 'cell', x: pos[p] + (list.length > 1 ? j * 44 - 2 : 20), y: loose.includes(+p) ? low + nh + 8 : y0 - 32, w: 42, h: 24, rx: 5, text: t.text, size: 13, cls: 'stepcell ' + K7().pcls(t.tid) })));
        if (coarse) items.push(...H.objects('ob', 20, 0, spec, st, {}).items.map((x) => Object.assign(x, { y: x.y + 336 })));
        items.push(H.text('ops', 20, coarse ? 414 : 336, opsText(OPS[inp.work]), 'p7note', 13));
        items.push(...K7().strip({ prefix: 'sc', x: 20, y: coarse ? 434 : 356, w: 700, steps: strip, upto: o.upto, cw: 32, ch: 26, size: 13, maxCols: 26, title: chk.steps ? 'the failing schedule' : 'the schedule (random, seed ' + inp.seed + ')' }).items);
        if (o.verdict) items.push(...K7().verdict(Object.assign({ prefix: 'vd', x: 520, y: -80, w: 300 }, o.verdict)).items);
        return items;
      }
      const vd = { kind: v.kind, head: v.head, lines: [chk.stats.states + ' states searched'].concat(chk.res.safety.violation ? ['"' + chk.res.safety.violation.name + '"'] : []) };
      F.add({ items: draw(Y().machine(spec).snap(), { upto: 0, verdict: vd }), say: `The list starts as ${INIT[inp.work].join(', ')} behind a dummy head. ${spec.about} ${chk.steps ? 'The model checker searched ' + chk.stats.states + ' states and found a schedule of ' + H.plural(chk.sched.length, 'step') + ' that breaks "' + chk.res.safety.violation.name + '". Here it is.' : 'The model checker searched all ' + chk.stats.states + ' states: the list stays sorted and ends as it should. Here is one run.'}`, meta: { vals: INIT[inp.work].concat([chk.stats.states]).concat(chk.sched ? [chk.sched.length] : []).concat(H.nums(chk.res.safety.violation ? chk.res.safety.violation.name : '')) } });
      steps.forEach((s, k) => {
        const held = Object.values(s.state.mutex).filter((m) => m.owner !== null).length;
        F.set('step', k + 1).set('held', held);
        F.add({ items: draw(s.state, { act: s.tid, upto: k + 1 }), say: s.say, meta: { vals: H.nums(s.say).concat([k + 1, held]) } });
      });
      const last = steps[steps.length - 1].state;
      const final = []; for (let p = last.vars.next[0], g = 0; p !== -1 && g < 20; p = last.vars.next[p], g++) final.push(last.vars.key[p]);
      F.add({ items: draw(last, { upto: strip.length, verdict: vd }), say: chk.steps ? `The list is now ${final.join(', ')}: ${chk.res.safety.violation.name.replace(/^at the end it holds/, 'it should hold')}. The inserting thread linked its node after a node that the other thread had already unlinked: it let go of one lock before taking the next.` : `The list is now ${final.join(', ')}, as it should be.${inp.variant === 'hoh' ? ' At most two node locks per thread were held at any moment.' : ''}`, meta: { vals: final.concat(H.nums(chk.res.safety.violation ? chk.res.safety.violation.name : '')), final, violated: !!chk.res.safety.violation } });
      return { frames: F.list, def: H.def('Hand-over-hand traversal', ['lock(head); p = head', 'c = p->next; lock(c)', 'while (c->key < k):', '    lock(c->next)', '    unlock(p)', '    p = c; c = c->next', 'act between p and c; unlock both']) };
    },
    predict: [{ at: (f, i) => i === 0, pick: 'option', ask: 'Will the model checker find a schedule that breaks this list?', options: ['yes', 'no'], answer: (fr) => (/found a schedule/.test(fr[0].say) ? 'yes' : 'no'), explain: (fr) => fr[0].say }],
    quiz: [
      { q: 'Why hold two locks while moving down the list?', options: ['so the node you are on cannot be unlinked before you have the next one', 'to go faster', 'to avoid deadlock with the head', 'one is enough'], answer: 0, why: 'Letting go first leaves a moment where another thread can change the link you are about to follow.' },
      { q: 'Can hand-over-hand locking deadlock?', options: ['no: every thread takes node locks in list order', 'yes, always', 'only with three threads', 'only on deletes'], answer: 0, why: 'A single global order of acquisition rules out a cycle of waits.' },
      { q: 'Why is hand-over-hand often slower than one lock in practice?', options: ['a lock and unlock per node visited costs more than the overlap gains', 'it is always faster', 'it uses more memory only', 'it needs atomic counters'], answer: 0, why: 'Locking overhead grows with the walk; real lists often do better with one lock or lock-free reads.' },
      { q: 'With one lock for the list, two threads working at opposite ends…', options: ['still take turns', 'run at once', 'deadlock', 'corrupt the list'], answer: 0, why: 'The single lock covers the whole list.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
