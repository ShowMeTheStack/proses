// Part 4, user and kernel threads: user threads mapped onto kernel threads and cores under the three models
// (S.P04.mapSim), tick by tick. A user thread's work alternates computing and blocking system calls; the picture
// shows which kernel thread carries which user thread, which core runs which kernel thread, and a Gantt row per
// user thread, and the last frame compares the three models on the same work.
(function (S) {
  'use strict';
  const H = S.P04, G = () => S.Kit.gantt;
  const MODELS = { 'many-to-one': 'many-to-one (a thread library)', 'one-to-one': 'one-to-one (kernel threads)', 'many-to-many': 'many-to-many' };
  function parseWork(v) { return v.map((x) => String(x).split('/').map(Number)); }
  function checkWork(v) {
    if (v.length < 2 || v.length > 5) return 'Work: 2 to 5 user threads';
    for (const x of v) {
      const p = String(x).split('/');
      if (p.length % 2 === 0 || p.length > 5) return 'Work: "' + x + '" must be compute/block/compute…, an odd number of parts, at most 5';
      if (p.some((q) => !/^\d+$/.test(q) || +q < 1 || +q > 6)) return 'Work: each part of "' + x + '" is a whole number from 1 to 6';
    }
    const tot = v.reduce((s, x) => s + String(x).split('/').reduce((a, b) => a + +b, 0), 0);
    if (tot > 40) return 'Work: at most 40 ticks of work in all, so the chart stays readable';
    return null;
  }

  H.topic({
    id: 'thr-models', family: 'p04-mapping', order: 10, title: 'Many-to-one, one-to-one, many-to-many',
    blurb: 'A thread library can run many user threads on one kernel thread: switching is cheap, but the kernel sees one thread, so one blocking system call stops them all and only one core is ever used. One kernel thread per user thread fixes both, at the cost of a kernel thread each. Many-to-many shares a smaller pool of kernel threads.',
    inputs: [
      { id: 'model', kind: 'choice', label: 'Model', def: 'many-to-one', options: Object.entries(MODELS).map(([value, label]) => ({ value, label })) },
      { id: 'cores', kind: 'choice', label: 'Cores', def: '2', options: ['1', '2', '4'].map((v) => ({ value: v, label: v })) },
      { id: 'kernel', kind: 'choice', label: 'Kernel threads (many-to-many)', def: '2', options: ['2', '3'].map((v) => ({ value: v, label: v })) },
      { id: 'work', kind: 'list', label: 'Work per user thread (compute/block/compute)', def: ['2/4/2', '3', '3'], check: checkWork },
    ],
    presets: [
      { label: 'One blocks, many-to-one', values: { model: 'many-to-one', cores: '2', work: ['2/4/2', '3', '3'] } },
      { label: 'Same, one-to-one', values: { model: 'one-to-one', cores: '2', work: ['2/4/2', '3', '3'] } },
      { label: 'Same, many-to-many on 2', values: { model: 'many-to-many', cores: '2', kernel: '2', work: ['2/4/2', '3', '3'] } },
      { label: 'Four computers, one core', values: { model: 'one-to-one', cores: '1', work: ['3', '3', '3', '3'] } },
      { label: 'A server: four that wait', values: { model: 'many-to-many', cores: '2', kernel: '3', work: ['1/5/1', '1/5/1', '1/5/1', '1/5/1'] } },
    ],
    counters: [{ id: 't', label: 'tick' }, { id: 'done', label: 'finished' }],
    run(inp) {
      const work = parseWork(inp.work), n = work.length, cores = +inp.cores;
      const sim = H.mapSim({ model: inp.model, kernel: +inp.kernel, cores, work });
      const U = (u) => 'U' + u, jobs = work.map((_, u) => U(u));
      const F = new S.Frames(['t', 'done']);
      const T = G().time({ x0: 110, x1: 790, t1: Math.max(sim.end, 1) });
      const gy = 250, rowH = 34;
      const segsOf = (u, upTo) => {
        const segs = [];
        sim.ticks.slice(0, upTo).forEach((tk, t) => {
          const c = tk.core.indexOf(u), kind = c >= 0 ? 'run' : tk.blocked.includes(u) ? 'io' : sim.finish[u] !== null && sim.finish[u] <= t ? null : 'wait';
          if (!kind) return;
          const last = segs[segs.length - 1];
          if (last && last.kind === kind && last.end === t && (kind !== 'run' || last.c === c)) last.end = t + 1;
          else segs.push({ kind, c, start: t, end: t + 1 });
        });
        return segs;
      };
      function picture(t) {
        const items = [], tk = sim.ticks[Math.min(t, sim.ticks.length - 1)] || { core: [], kt: [], blocked: [], ready: [] }, live = t < sim.ticks.length;
        items.push(H.title('lu', 0, 22, 'user threads'));
        work.forEach((w, u) => {
          const fin = sim.finish[u] !== null && sim.finish[u] <= t;
          const st = fin ? 's-done' : !live ? 's-done' : tk.core.includes(u) ? 's-running' : tk.blocked.includes(u) ? 's-blocked' : 's-ready';
          items.push({ key: 'u' + u, kind: 'cell', x: 170 + u * 100, y: 4, w: 84, h: 32, rx: 7, text: U(u), size: 15, cls: 'thcard ' + st });
        });
        items.push(H.title('lk', 0, 82, 'kernel threads'));
        for (let k = 0; k < sim.K; k++) {
          const u = live ? tk.kt[k] : null, blocked = u !== null && u !== undefined && tk.blocked.includes(u);
          items.push({ key: 'k' + k, kind: 'cell', x: 170 + k * 100, y: 64, w: 84, h: 32, rx: 7, text: 'K' + k + (u === null || u === undefined ? '' : ' · ' + U(u)), size: 13, cls: 'kt' + (blocked ? ' s-blocked' : u !== null && u !== undefined ? ' s-running' : '') });
        }
        items.push(H.title('lc', 0, 142, 'cores'));
        for (let c = 0; c < cores; c++) {
          const u = live ? tk.core[c] : null, k = u === null || u === undefined ? -1 : tk.kt.indexOf(u);
          items.push({ key: 'c' + c, kind: 'cell', x: 170 + c * 100, y: 124, w: 84, h: 32, rx: 7, text: u === null || u === undefined ? 'idle' : 'K' + k + ' · ' + U(u), size: 13, cls: u === null || u === undefined ? 'gseg idle' : 'gseg ' + H.pcls(u) });
        }
        items.push(H.text('mdl', 0, 196, MODELS[inp.model] + ', ' + H.plural(cores, 'core') + ', ' + H.plural(sim.K, 'kernel thread'), 'strong', 15));
        items.push(...G().axis({ prefix: 'ax', X: T.X, t1: sim.end, y: gy - 14, step: sim.end > 20 ? 5 : sim.end > 10 ? 2 : 1, size: 12 }));
        work.forEach((w, u) => {
          const y = gy + u * (rowH + 6);
          items.push(H.text('rl' + u, 0, y + 22, U(u) + ': ' + w.join('/'), 'mono', 14));
          for (const s of segsOf(u, t)) {
            const x = T.X(s.start), ww = T.X(s.end) - x;
            items.push({ key: 'g' + u + '_' + s.start, kind: 'cell', x, y, w: ww, h: rowH - 4, rx: 3, text: s.kind === 'run' && ww >= 34 ? 'c' + s.c : '', size: 12, cls: 'gseg ' + (s.kind === 'run' ? H.pcls(u) : s.kind === 'io' ? 'io' : 'wait') });
          }
          if (sim.finish[u] !== null && sim.finish[u] <= t) items.push(H.text('fn' + u, T.X(sim.finish[u]) + 6, y + 21, 'done ' + sim.finish[u], 'good', 13));
        });
        const ly = gy + n * (rowH + 6) + 12;
        if (t <= sim.end && t > 0) items.push(...G().cursor({ prefix: 'cu', X: T.X, t: Math.min(t, sim.end), y1: gy - 2, y2: ly - 8 }));
        items.push(...S.Kit.sync.legend({ prefix: 'lg', x: 0, y: ly + 8, entries: [{ cls: 'p0', text: 'computing (on core c)' }, { cls: 'io', text: 'in a blocking call' }, { cls: 'wait', text: 'ready, but no kernel thread or core' }], gap: 22 }).items);
        return items;
      }
      const total = work.reduce((s, w) => s + w.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0), 0);
      F.add({ items: picture(0), say: `${H.plural(n, 'user thread')} with ${H.plural(total, 'tick')} of computing between them, on ${H.plural(cores, 'core')}. ${inp.model === 'many-to-one' ? 'A library in the process switches them, all on one kernel thread: the kernel sees a single thread.' : inp.model === 'one-to-one' ? 'Each user thread is a kernel thread of its own, which the kernel schedules on the cores.' : 'A library puts them on a pool of ' + H.plural(sim.K, 'kernel thread') + ', which the kernel schedules on the cores.'}`, meta: { vals: [n, total, cores, sim.K] } });
      sim.ticks.forEach((tk, t) => {
        const run = tk.core.map((u, c) => (u === null ? null : U(u) + ' on core ' + c)).filter(Boolean);
        const waitK = tk.ready.length ? H.list(tk.ready.map(U)) + (tk.ready.length > 1 ? ' wait' : ' waits') + ' for a kernel thread' : '';
        const idleReady = tk.kt.map((u, k) => (u !== null && !tk.blocked.includes(u) && !tk.core.includes(u) ? U(u) : null)).filter(Boolean);
        const parts = [run.length ? H.list(run) + (run.length > 1 ? ' compute' : ' computes') : 'no core has anything to run'];
        if (tk.blocked.length) parts.push(H.list(tk.blocked.map(U)) + (tk.blocked.length > 1 ? ' are' : ' is') + ' in a blocking call' + (inp.model !== 'one-to-one' ? ', holding ' + (tk.blocked.length > 1 ? 'their kernel threads' : 'its kernel thread') : ''));
        if (waitK) parts.push(waitK);
        if (idleReady.length) parts.push(H.list(idleReady) + ' could run but every core is taken');
        const fin = sim.finish.map((f, u) => (f === t + 1 ? U(u) : null)).filter(Boolean);
        F.set('t', t).set('done', sim.finish.filter((f) => f !== null && f <= t + 1).length);
        const why = inp.model === 'many-to-one' && tk.blocked.length && !run.length && tk.ready.length ? ' The one kernel thread is blocked in the kernel, so the library cannot switch to another user thread.' : '';
        F.add({ items: picture(t + 1), say: `Tick ${t}: ${parts.join('; ')}.${why}${fin.length ? ' ' + H.list(fin) + ' ' + (fin.length > 1 ? 'finish' : 'finishes') + ' at ' + (t + 1) + '.' : ''}`, meta: { vals: [t, t + 1, ...tk.core.map((u, c) => c), ...sim.finish.filter((f) => f !== null)], tick: t } });
      });
      const all = Object.keys(MODELS).map((m) => [m, H.mapSim({ model: m, kernel: +inp.kernel, cores, work })]);
      const lines = all.map(([m, r]) => `${m}: the last finishes at ${r.end}, cores busy ${r.busy} of ${r.end * cores} core-ticks`);
      const items = picture(sim.end);
      const ty = 250 + n * 40 + 60;
      all.forEach(([m, r], i) => items.push({ key: 'cmpc' + i, kind: 'cell', x: i * 268, y: ty, w: 260, h: 34, rx: 6, text: m + ': ends at ' + r.end, size: 14, cls: 'varval' + (m === inp.model ? ' act' : '') }));
      F.add({ items, say: `All work done at tick ${sim.end}, with the cores busy for ${sim.busy} of ${sim.end * cores} core-ticks. The same work under each model: ${lines.join('; ')}.`, meta: { vals: [sim.end, sim.busy, sim.end * cores, ...all.flatMap(([, r]) => [r.end, r.busy, r.end * cores])], ends: Object.fromEntries(all.map(([m, r]) => [m, r.end])) } });
      return { frames: F.list, def: H.def('Who schedules whom', ['user thread:   a library schedules it', 'kernel thread: the kernel schedules it', '', 'many-to-one', '  cheap switches, one core,', '  one blocking call stops all', 'one-to-one', '  real parallelism, a kernel', '  thread (and its cost) each', 'many-to-many', '  m kernel threads for n users']) };
    },
    predict: [
      { at: (f, i) => i === 0, pick: 'option', ask: 'At which tick will the last user thread finish under this model?', options: (fr) => { const e = fr[fr.length - 1].meta.ends; return [...new Set(Object.values(e).concat([Math.max(...Object.values(e)) + 2]))].sort((a, b) => a - b).map(String); }, answer: (fr, i, inp) => String(fr[fr.length - 1].meta.ends[inp.model]), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'Under many-to-one, one user thread calls read() and blocks in the kernel. The others…', options: ['stop too: their one kernel thread is blocked', 'run on another core', 'run on another kernel thread', 'are killed'], answer: 0, why: 'The kernel blocks the only thread it knows about.' },
      { q: 'Why can many-to-one never use two cores at once?', options: ['the kernel has only one thread to place on a core', 'the library forbids it', 'cores cannot share memory', 'user threads have no stacks'], answer: 0, why: 'Cores are given to kernel threads; one kernel thread runs on one core.' },
      { q: 'What does one-to-one cost?', options: ['a kernel thread per user thread: kernel memory, and a system call to create or switch', 'nothing at all', 'it cannot block', 'one core per thread'], answer: 0, why: 'Every thread is a kernel object, and switching goes through the kernel.' },
      { q: 'Many-to-many with 2 kernel threads and 4 user threads that all block for a long time…', options: ['can still run only 2 at once, and stalls when both carriers block', 'runs all 4 in parallel', 'is the same as many-to-one', 'deadlocks'], answer: 0, why: 'A blocked user thread holds its kernel thread here; real systems add kernel threads or scheduler activations to fix this.' },
      { q: 'What is the main appeal of user-level threads?', options: ['creating and switching them needs no system call', 'they run on every core', 'they never block', 'the kernel protects them from each other'], answer: 0, why: 'A switch is a function call in the library.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
