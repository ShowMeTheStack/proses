// A bounded buffer with producers and consumers on the thread-step machine (src/core/sync-*.js): the slots drawn as
// a ring with the in and out pointers, the semaphores empty, full and mutex as counters with their wait queues, and
// both programs with every thread's place in them. A seeded random scheduler picks who runs each step.
(function (S) {
  'use strict';
  const D = S.Demo, box = D.box, Y = () => S.Sync, KS = () => S.Kit.sync;
  const STEPS = 44;
  const PROD = ['wait(empty)', 'wait(mutex)', 'buf[in] = item', 'in = (in + 1) % N', 'post(mutex)', 'post(full)'];
  const CONS = ['wait(full)', 'wait(mutex)', 'item = buf[out]', 'buf[out] = empty', 'out = (out + 1) % N', 'post(mutex)', 'post(empty)', 'use(item)'];

  function trace(knobs) {
    const k = Object.assign({ size: 4, producers: 2, consumers: 1, seed: 1 }, knobs || {});
    const spec = Y().buffer(k.size, k.producers, k.consumers);
    const run = Y().run(spec, { policy: 'random', seed: k.seed, max: STEPS });
    return Object.assign(k, { spec, run });
  }

  function layout(narrow, N, nT) {
    if (narrow) {
      const semY = 190 + 62 + 7 * N + 17 + 34 + 13 + 22, py = semY + 3 * 66 + 32 * Math.max(0, Math.ceil((nT - 1) / 4) - 1) + 20;
      const cy = py + 28 + PROD.length * 27 + 12, ly = cy + 28 + CONS.length * 27 + 8;
      return { view: box(0, 0, 400, ly + 34), ring: { cx: 200, cy: 190, R: 62 + 7 * N, cw: 54, ch: 34, gap: 34 }, sem: { x: 12, y: semY, gap: 26, perRow: 4, nameW: 70 }, prod: { x: 8, y: py }, cons: { x: 8, y: cy }, lh: 27, size: 13, markW: 30, log: null, legend: [12, ly] };
    }
    return { view: box(0, 0, 1240, 600), ring: { cx: 250, cy: 300, R: 72 + 11 * N, cw: 64, ch: 38, gap: 44 }, sem: { x: 500, y: 60, gap: 40, perRow: 6, nameW: 76 }, prod: { x: 860, y: 26 }, cons: { x: 860, y: 270 }, lh: 30, size: 14, markW: 36, log: { x: 500, y: 400 }, legend: [500, 560] };
  }

  function frames(narrow, knobs) {
    const T = D.once('bb:' + JSON.stringify(knobs), () => trace(knobs)), N = T.size, L = layout(narrow, N, T.producers + T.consumers), run = T.run;
    const names = (q) => q.map((i) => run.machine.threads[i].name);
    const nP = T.producers;

    function picture(st, o) {
      o = o || {};
      const items = [], ths = st.threads, V = st.vars;
      const count = V.buf.filter((x) => x !== null).length;
      items.push(...KS().ring({ prefix: 'rg', cx: L.ring.cx, cy: L.ring.cy, R: L.ring.R, cw: L.ring.cw, ch: L.ring.ch, slots: V.buf, inAt: V.in, outAt: V.out, act: o.slot, tagGap: L.ring.gap }).items);
      items.push({ key: 'rg:count', kind: 'text', x: L.ring.cx, y: L.ring.cy + 6, text: count + ' of ' + N + ' full', anchor: 'middle', size: narrow ? 14 : 16, cls: 'ringnote' });
      // the three semaphores, each with its queue
      let sy = L.sem.y;
      // who is inside the critical section: between its wait(mutex) and its post(mutex)
      const inside = ths.filter((th, i) => th.state !== 'blocked' && (i < nP ? th.pc >= 2 && th.pc <= 4 : th.pc >= 2 && th.pc <= 5)).map((th) => th.name);
      ['empty', 'full', 'mutex'].forEach((id) => {
        const sm = KS().sem({ prefix: 'sm' + id, x: L.sem.x, y: sy, name: id, value: st.sem[id].value, queue: names(st.sem[id].queue), act: o.sem === id, perRow: L.sem.perRow, nameW: L.sem.nameW });
        items.push(...sm.items);
        if (id === 'mutex') items.push({ key: 'sm:inside', kind: 'text', x: L.sem.x, y: sy + Math.max(40, sm.h) + 20, text: inside.length ? 'inside the critical section: ' + inside.join(', ') : 'nobody inside the critical section', size: 13, cls: 'meals' });
        sy += Math.max(40, sm.h) + L.sem.gap;
      });
      // on a phone the programs follow the semaphores (room for a wrapped queue is kept for every frame)
      const py = L.prod.y, cy = L.cons.y;
      // both programs, with each thread's next step
      const mark = (th) => ({ name: th.name, cls: (th.state === 'blocked' ? 's-blocked' : o.act === th.id ? 's-running' : 's-ready') + (o.act === th.id ? ' act' : '') });
      const pm = PROD.map(() => []), cm = CONS.map(() => []);
      ths.forEach((th, i) => (i < nP ? pm : cm)[th.pc].push(mark(th)));
      const actP = o.act !== undefined && o.act < nP ? o.line : -1, actC = o.act !== undefined && o.act >= nP ? o.line : -1;
      const opts = { lh: L.lh, size: L.size, markW: L.markW, textW: narrow ? 172 : 196 };
      items.push(...KS().code(Object.assign({ prefix: 'cp', x: L.prod.x, y: py, lines: PROD, marks: pm, act: actP, title: 'Each producer, forever:' }, opts)).items);
      items.push(...KS().code(Object.assign({ prefix: 'cc', x: L.cons.x, y: cy, lines: CONS, marks: cm, act: actC, title: 'Each consumer, forever:' }, opts)).items);
      // what the consumers have taken, in order
      if (L.log) {
        const got = o.taken || [];
        items.push({ key: 'lg:t', kind: 'text', x: L.log.x, y: L.log.y, text: 'taken out, in order', size: 15, cls: 'strong' });
        const shown = got.slice(-8);
        shown.forEach((it, j) => items.push({ key: 'lg:i' + (got.length - shown.length + j), kind: 'cell', x: L.log.x + j * 44, y: L.log.y + 14, w: 40, h: 30, rx: 5, text: it, size: 14, cls: 'slot full' }));
        if (!got.length) items.push({ key: 'lg:none', kind: 'text', x: L.log.x, y: L.log.y + 34, text: 'nothing yet', size: 13, cls: 'qnone' });
        items.push({ key: 'lg:held', kind: 'text', x: L.log.x, y: L.log.y + 78, text: ths.slice(nP).map((th) => th.name + ' holds ' + (th.reg.item || '–')).join(' · '), size: 14, cls: 'meals' });
      }
      const ent = [{ cls: 's-ready', text: 'ready' }, { cls: 's-running', text: 'just ran' }, { cls: 's-blocked', text: 'blocked' }];
      items.push(...KS().legend({ prefix: 'lgd', x: L.legend[0], y: L.legend[1], entries: ent, gap: 22 }).items);
      return items;
    }

    const out = [];
    const st0 = Y().machine(T.spec).snap();
    out.push({ items: picture(st0), view: L.view, title: 'start', say: `A ring of \`${N}\` slots, ${T.producers} producer${T.producers > 1 ? 's' : ''} and ${T.consumers} consumer${T.consumers > 1 ? 's' : ''}. The semaphore empty counts free slots (\`${N}\`), full counts filled ones (\`0\`), and mutex (\`1\`) lets one thread at a time touch buf, in and out. The scheduler picks a ready thread at random each step (seed ${T.seed}).` });
    const taken = [];
    run.steps.forEach((s) => {
      if (s.op === 'read') taken.push(s.state.threads[s.tid].reg.item);
      out.push({ items: picture(s.state, { act: s.tid, line: s.pc, sem: s.op === 'wait' || s.op === 'post' ? s.label.slice(5, -1) : null, slot: s.op === 'write' || s.op === 'read' ? slotOf(s) : undefined, taken: taken.slice() }), view: L.view, title: (s.label || s.op) + ' · ' + s.name, say: s.say });
    });
    function slotOf(s) {
      const prev = s.state.vars;
      // the slot a step touched: a producer's write is at in (before it moves), a consumer's read or clear at out
      return s.tid < nP ? prev.in : prev.out;
    }
    const last = run.steps[run.steps.length - 1].state, puts = run.steps.filter((s) => s.op === 'write' && s.tid < nP).length;
    const inBuf = last.vars.buf.filter((x) => x !== null).length;
    const blocked = last.threads.filter((th) => th.state === 'blocked').map((th) => th.name);
    out.push({ items: picture(last, { taken: taken.slice() }), view: L.view, title: 'so far', hold: 4000, say: `After \`${run.steps.length}\` steps: \`${puts}\` items put in, \`${taken.length}\` taken out in the order they went in (${taken.join(', ') || 'none yet'}), \`${inBuf}\` in the ring. empty + full = \`${last.sem.empty.value + last.sem.full.value}\`: with the threads between a wait and its post, that makes \`${N}\`, the size of the ring.${blocked.length ? ' Blocked now: ' + blocked.join(', ') + '.' : ''}` });
    return out;
  }

  D.add({
    id: 'bounded-buffer', order: 82, tag: 'Synchronisation · classic problems', short: 'Bounded buffer', title: 'A bounded buffer with three semaphores',
    blurb: 'Producers put items into a ring of slots and consumers take them out. empty makes producers wait when the ring is full, full makes consumers wait when it is empty, and mutex keeps two threads from touching it at once.',
    knobs: [
      { id: 'size', label: 'slots', min: 2, max: 8, step: 1, value: 4, fmt: (v) => String(v) },
      { id: 'producers', label: 'producers', min: 1, max: 4, step: 1, value: 2, fmt: (v) => String(v) },
      { id: 'consumers', label: 'consumers', min: 1, max: 4, step: 1, value: 1, fmt: (v) => String(v) },
      { id: 'seed', label: 'seed', min: 1, max: 20, step: 1, value: 1, fmt: (v) => String(v) },
    ],
    frames({ narrow, knobs }) { return frames(narrow, Object.assign({ size: 4, producers: 2, consumers: 1, seed: 1 }, knobs)); },
    trace,
  });
})(globalThis.Proses = globalThis.Proses || {});
