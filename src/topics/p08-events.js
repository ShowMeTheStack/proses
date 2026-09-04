// Part 8, event-based concurrency: one thread with an event loop and asynchronous I/O serves several requests at
// once without a thread for each. The model (S.P08.events) runs the same requests three ways: one thread with
// blocking I/O, a thread per request, and the event loop; the loop is stepped event by event with its queue and the
// I/O in flight, then the three are compared on one time axis.
(function (S) {
  'use strict';
  const H = S.P08, P7 = () => S.P07, G = () => S.Kit.gantt, KSc = () => S.Kit.scenes;

  /** "A 0 2 6 1; B 1 2 4 1" -> [{name, at, cpu, io, cpu2}] */
  function parse(text) {
    return String(text).split(/[;\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => { const [name, at, cpu, io, cpu2] = x.split(/\s+/); return { name, at: +at, cpu: +cpu, io: +io, cpu2: +cpu2 }; });
  }
  function check(v) {
    const R = parse(v);
    if (R.length < 1 || R.length > 5) return 'Requests: between 1 and 5, separated by ;';
    for (const r of R) {
      if (!/^[A-Z]$/.test(r.name || '')) return 'Requests: each starts with a capital letter as its name';
      for (const k of ['at', 'cpu', 'io', 'cpu2']) if (!Number.isInteger(r[k]) || r[k] < (k === 'at' || k === 'io' ? 0 : 1) || r[k] > 20) return 'Requests: ' + r.name + ' needs four whole numbers: arrival, CPU, I/O and CPU again (CPU 1–20, the others 0–20)';
    }
    if (new Set(R.map((r) => r.name)).size !== R.length) return 'Requests: names must differ';
    return null;
  }
  const MODES = { serial: 'one thread, blocking I/O', threads: 'a thread per request', loop: 'event loop, async I/O' };

  S.P07.topic({
    id: 'classic-events', family: 'p08-events', order: 10, title: 'The event loop and asynchronous I/O',
    blurb: 'A server can give every request its own thread, which blocks on I/O while others run; or it can run one thread round a loop: take the next event from a queue, run its short handler, and when a handler needs I/O, start it without waiting and go on. The completion arrives later as another event. Same overlap of I/O, one stack instead of many, and no locks, as long as no handler blocks or runs long.',
    inputs: [
      { id: 'reqs', kind: 'text', label: 'Requests: name, arrival, CPU, I/O, CPU (ms)', def: 'A 0 2 6 1; B 1 2 5 1; C 2 1 8 2', check },
      { id: 'sw', kind: 'number', label: 'Thread switch cost (ms)', def: 1, min: 0, max: 3 },
      { id: 'stack', kind: 'number', label: 'Stack per thread (KB)', def: 64, min: 8, max: 8192 },
    ],
    presets: [
      { label: 'Three requests', values: { reqs: 'A 0 2 6 1; B 1 2 5 1; C 2 1 8 2', sw: 1, stack: 64 } },
      { label: 'A burst of five', values: { reqs: 'A 0 1 6 1; B 0 1 6 1; C 1 1 6 1; D 1 1 6 1; E 2 1 6 1', sw: 1, stack: 64 } },
      { label: 'A slow disk', values: { reqs: 'A 0 1 12 1; B 2 1 12 1; C 4 1 12 1', sw: 0, stack: 1024 } },
      { label: 'All CPU, no I/O', values: { reqs: 'A 0 4 0 1; B 1 4 0 1; C 2 4 0 1', sw: 1, stack: 64 } },
    ],
    counters: [{ id: 't', label: 'time (ms)' }, { id: 'done', label: 'requests answered' }],
    run(inp) {
      const R = parse(inp.reqs), names = R.map((r) => r.name), F = new S.Frames(['t', 'done']);
      const res = {}; for (const m of Object.keys(MODES)) res[m] = H.events(R, m, { sw: inp.sw, stack: inp.stack });
      const L = res.loop, t1 = Math.max(...Object.values(res).map((x) => x.makespan));
      const X = G().time({ x0: 110, x1: 790, t1 }).X, gy = 250;
      const lanes = (upto, cur) => {
        const items = [{ key: 'g:cpuL', kind: 'text', x: 0, y: gy + 20, text: 'CPU', size: 13, cls: 'strong' }];
        items.push(...G().track({ prefix: 'g:cpuT', x: X(0), y: gy, w: X(t1) - X(0), h: 30 }));
        items.push(...G().bar({ prefix: 'g:cpu', X, segs: L.segs, y: gy, h: 30, upTo: upto, jobs: names, size: 13, now: cur }));
        R.forEach((r, i) => {
          const y = gy + 42 + i * 30;
          items.push({ key: 'g:ioL' + i, kind: 'text', x: 0, y: y + 16, text: 'I/O of ' + r.name, size: 13, cls: 'tick' });
          L.io.filter((s) => s.job === r.name && s.start < upto).forEach((s, k) => items.push({ key: 'g:io' + i + ':' + k, kind: 'cell', x: X(s.start), y, w: Math.max(2, X(Math.min(s.end, upto)) - X(s.start)), h: 22, rx: 3, text: '', cls: 'gseg io' }));
          if (L.done[r.name] <= upto) { const xe = X(L.done[r.name]), right = xe > 640; items.push({ key: 'g:dn' + i, kind: 'text', x: right ? X(L.io.find((s) => s.job === r.name).start) - 8 : xe + 6, y: y + 16, text: 'answered at ' + L.done[r.name], size: 13, cls: 'good', anchor: right ? 'end' : undefined }); }
        });
        items.push(...G().axis({ prefix: 'g:ax', X, t1, y: gy + 42 + R.length * 30 + 10, step: t1 > 30 ? 5 : t1 > 14 ? 2 : 1, size: 13 }));
        return items;
      };
      F.add({ items: KSc().loop({ prefix: 'lp', cx: 110, cy: 120, R: 84, running: null, queue: [], pending: [], qx: 280, qy: 40, px: 470 }).items.concat(lanes(0)), say: `${P7().plural(R.length, 'request')}: ${R.map((r) => `${r.name} arrives at ${r.at} ms, needs ${r.cpu} ms of CPU, ${r.io} ms of I/O, then ${r.cpu2} ms`).join('; ')}. One core. First the event loop, one event at a time.`, meta: { vals: R.flatMap((r) => [r.at, r.cpu, r.io, r.cpu2]).concat([R.length]) } });
      let done = 0;
      L.trace.forEach((e, k) => {
        if (e.ev !== 'request') done++;
        F.set('t', e.end).set('done', done);
        const nx = L.trace[k + 1];
        const say = e.ev === 'request'
          ? `At ${e.t} ms the loop takes “request ${e.job}” and runs its handler for ${e.end - e.t} ms: it parses the request and starts the I/O without waiting for it. The I/O will finish at ${L.io.find((s) => s.job === e.job).end} ms and come back as an event.`
          : `At ${e.t} ms the loop takes “io ${e.job}”: ${e.job}'s I/O is done, and the handler answers in ${e.end - e.t} ms, at ${e.end} ms, ${e.end - R.find((r) => r.name === e.job).at} ms after ${e.job} arrived.`;
        const qn = e.queue.length ? ` Waiting in the queue: ${e.queue.join(', ')}.` : ' The queue is empty now.';
        F.add({ items: KSc().loop({ prefix: 'lp', cx: 110, cy: 120, R: 84, running: (e.ev === 'request' ? 'request ' : 'io ') + e.job, queue: e.queue.map((q) => q.replace('io done', 'io')), pending: e.pending, qx: 280, qy: 40, px: 470 }).items.concat(lanes(e.end, e.end)), say: say + qn, meta: { vals: [e.t, e.end, e.end - e.t, e.end - R.find((r) => r.name === e.job).at, done, L.io.find((s) => s.job === e.job).end, ...R.map((r) => r.at)].concat(Object.values(L.done)), ask: nx && e.queue.length >= 2 ? { options: e.queue.map((q) => q.replace('io done', 'io')), answer: (nx.ev === 'request' ? 'request ' : 'io ') + nx.job } : null } });
      });
      // the three ways, side by side
      const rows = Object.keys(MODES), cy0 = 30, items = [];
      rows.forEach((m, i) => {
        const y = cy0 + i * 70, r = res[m];
        items.push({ key: 'c:l' + m, kind: 'text', x: 0, y: y + 20, text: MODES[m], size: 13, cls: 'strong' });
        items.push(...G().track({ prefix: 'c:t' + m, x: X(0), y: y + 28, w: X(t1) - X(0), h: 26 }));
        r.segs.forEach((s, k) => items.push({ key: 'c:s' + m + k, kind: 'cell', x: X(s.start), y: y + 28, w: Math.max(2, X(s.end) - X(s.start)), h: 26, text: X(s.end) - X(s.start) >= 16 && s.job !== '·' ? s.job : '', size: 13, cls: 'gseg ' + (s.what === 'switch' ? 'sw' : 'p' + (names.indexOf(s.job) % 6)) }));
      });
      items.push(...G().axis({ prefix: 'c:ax', X, t1, y: cy0 + 3 * 70 + 10, step: t1 > 30 ? 5 : t1 > 14 ? 2 : 1, size: 13 }));
      const tb = G().table({ prefix: 'c:tb', x: 0, y: cy0 + 3 * 70 + 50, cols: [{ w: 220, label: '' }, { w: 120, label: 'all done (ms)' }, { w: 150, label: 'mean response' }, { w: 110, label: 'threads' }, { w: 120, label: 'stacks (KB)' }], rows: rows.map((m) => ({ cells: [MODES[m], String(res[m].makespan), D(res[m].mean), String(res[m].maxThreads), String(res[m].stackKB)] })), rowH: 30, size: 13 });
      items.push(...tb.items);
      const s = res.serial, th = res.threads;
      F.add({ items, say: `All three on one time axis. One thread with blocking I/O finishes at ${s.makespan} ms (mean response ${D(s.mean)} ms): the core sits idle during every I/O. A thread per request finishes at ${th.makespan} ms (mean ${D(th.mean)}), but ${th.maxThreads === 1 ? 'needs a thread' : 'needs up to ' + th.maxThreads + ' threads alive at once'}, ${th.stackKB} KB of stacks, ${inp.sw ? 'and pays ' + inp.sw + ' ms a switch' : 'switches assumed free'}. The event loop finishes at ${L.makespan} ms (mean ${D(L.mean)}) with one thread and ${L.stackKB} KB.`, meta: { vals: Object.values(res).flatMap((r) => [r.makespan, r.mean, r.maxThreads, r.stackKB]).concat([inp.sw]) }, counters: { t: t1, done: R.length } });
      return { frames: F.list, def: P7().def('The event loop', ['while (true):', '  e = next event (wait if none)', '  run e\'s handler to the end', '  a handler starts I/O and returns;', '  the completion is a new event', '', 'never block in a handler:', '  the whole server would stop']) };
    },
    predict: [{ at: (f) => !!(f.meta && f.meta.ask), pick: 'option', once: true, ask: 'Which event does the loop take next?', options: (fr, i) => fr[i].meta.ask.options, answer: (fr, i) => fr[i].meta.ask.answer, explain: (fr, i) => fr[i + 1].say }],
    quiz: [
      { q: 'What happens if one handler blocks on a slow read?', options: ['the whole loop stops: no other request is served until it returns', 'only that request waits', 'the kernel starts a new thread', 'nothing'], answer: 0, why: 'There is only one thread; a blocking call blocks all of it.' },
      { q: 'Why does an event loop need no locks for its own data?', options: ['handlers run one at a time, each to the end, so none is interrupted by another', 'it uses atomic instructions', 'the data is read-only', 'it does need them'], answer: 0, why: 'Concurrency without parallelism: no interleaving inside a handler.' },
      { q: 'When does a thread per request beat the event loop?', options: ['when handlers are CPU-heavy and there are several cores to run them in parallel', 'never', 'when there is lots of I/O', 'with one core'], answer: 0, why: 'One loop uses one core; threads can use many.' },
      { q: 'What does asynchronous I/O give the loop?', options: ['the I/O runs while the loop handles other events; its completion comes back as an event', 'faster disks', 'more memory', 'a second thread'], answer: 0, why: 'That is where the overlap comes from.' },
    ],
  });
  function D(v) { return String(+v.toFixed(2)); }
})(globalThis.Proses = globalThis.Proses || {});
