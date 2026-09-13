// Part 13, the kernel I/O subsystem (1): buffering, drawn as the device, each buffer slot and the process on one
// time axis, and spooling, drawn as the printer's timeline with and without a spool directory. The times come from
// S.IO.buffering and S.IO.spool (src/core/io-c-kernel.js).
(function (S) {
  'use strict';
  const R = Math.round;
  const KNAME = { none: 'no buffer', single: 'a single buffer', double: 'double buffering', circular: 'a circular buffer' };
  const nums = (v) => (Array.isArray(v) ? v : String(v).split(/[\s,]+/)).filter((x) => x !== '').map(Number);
  const listCheck = (v) => { const a = nums(v); if (!a.length) return 'give at least one time'; if (a.some((x) => !Number.isFinite(x) || x < 0 || x > 1000)) return 'times from 0 to 1000'; if (a.length > 16) return 'at most 16 times'; return null; };

  S.topic({
    id: 'io-buffering', family: 'p13-kernel', order: 10, title: 'Buffering: letting the device and the program overlap',
    blurb: 'A program reads a file block by block and computes on each block. Without a buffer the device and the program take turns. With a buffer in the kernel the device fills the next block while the program works on this one; with two, neither waits for the other in the steady state; a ring of buffers also soaks up bursts.',
    inputs: [
      { id: 'kind', kind: 'choice', label: 'buffers', def: 'double', options: Object.keys(KNAME).map((k) => ({ value: k, label: KNAME[k] })) },
      { id: 'blocks', kind: 'number', label: 'blocks', def: 6, min: 2, max: 16 },
      { id: 'fill', kind: 'list', label: 'device time T per block (one, or a list)', def: ['10'], check: listCheck },
      { id: 'move', kind: 'number', label: 'move to the program M', def: 2, min: 0, max: 100, integer: false },
      { id: 'compute', kind: 'list', label: 'compute time C per block', def: ['6'], check: listCheck },
      { id: 'slots', kind: 'number', label: 'slots (circular)', def: 4, min: 2, max: 6 },
    ],
    presets: [
      { label: 'No buffer', values: { kind: 'none', blocks: 6, fill: ['10'], move: 2, compute: ['6'], slots: 4 } },
      { label: 'A single buffer', values: { kind: 'single', blocks: 6, fill: ['10'], move: 2, compute: ['6'], slots: 4 } },
      { label: 'Double buffering', values: { kind: 'double', blocks: 6, fill: ['10'], move: 2, compute: ['6'], slots: 4 } },
      { label: 'Compute-bound: buffers barely help', values: { kind: 'double', blocks: 6, fill: ['4'], move: 1, compute: ['12'], slots: 4 } },
      { label: 'A bursty device, double buffers', values: { kind: 'double', blocks: 8, fill: ['2', '2', '2', '20', '2', '2', '20', '2'], move: 1, compute: ['8'], slots: 4 } },
      { label: 'The same burst, a ring of 4', values: { kind: 'circular', blocks: 8, fill: ['2', '2', '2', '20', '2', '2', '20', '2'], move: 1, compute: ['8'], slots: 4 } },
    ],
    counters: [{ id: 'done', label: 'blocks done' }],
    run(inp) {
      const t = S.T12, fill = nums(inp.fill), comp = nums(inp.compute);
      const o = { blocks: inp.blocks, fill: fill.length === 1 ? fill[0] : fill, move: inp.move, compute: comp.length === 1 ? comp[0] : comp, slots: inp.slots };
      const res = S.IO.buffering(inp.kind, o), none = S.IO.buffering('none', o), F = new S.Frames(['done']);
      const k = res.slots, n = inp.blocks, T1 = Math.max(res.total, 1);
      const T = (i) => fill[i % fill.length], C = (i) => comp[i % comp.length];
      const base = { o, kind: inp.kind, total: res.total, perBlock: res.perBlock, unbuffered: none.total, k };
      const procEnd = (i) => Math.max(...res.lanes.process.filter((s) => s.block === i).map((s) => s.to));
      const pic = (now, cur) => {
        const pc = (b) => 'pr' + (b % 6) + (b === cur ? ' act' : '');
        const rows = [{ id: 'dev', label: 'device', segs: res.lanes.device.map((s) => ({ from: s.from, to: s.to, cls: pc(s.block), text: 'b' + s.block })) }];
        for (let j = 0; j < k; j++) rows.push({ id: 's' + j, label: k === 1 ? 'buffer' : 'slot ' + j, segs: res.lanes.slots.filter((s) => s.slot === j).map((s) => ({ from: s.from, to: s.to, cls: pc(s.block), text: 'b' + s.block })) });
        rows.push({ id: 'proc', label: 'program', segs: res.lanes.process.map((s) => ({ from: s.from, to: s.to, cls: 'ps-' + s.kind + (s.block === cur ? ' act' : ''), text: s.kind === 'wait' ? 'wait' : s.kind === 'move' ? 'M' : 'C' + s.block })) });
        const L = t.lanes({ prefix: 'bf', x: 0, y: 20, w: 800, labelW: 80, t1: T1, rows, rowH: 30, gap: 10, upTo: now, now: now > 0 && now < T1 ? now : undefined });
        const items = [...L.items];
        const lg = t.legend('bfg', 80, 20 + L.h + 8, [{ cls: 'tl ps-wait', text: 'program waits' }, { cls: 'tl ps-move', text: 'move M out of the buffer' }, { cls: 'tl ps-compute', text: 'compute C' }, { cls: 'tl pr0', text: 'a block, by number' }], 720, 13);
        items.push(...lg.items);
        const fy = 20 + L.h + lg.h + 44;
        items.push(t.title('bf:ft', 0, fy, 'steady state, one block'));
        items.push(t.text('bf:f1', 0, fy + 30, `${KNAME[inp.kind]}: ${res.formula} = ${res.perBlock}`, 'calc', 15));
        if (inp.kind !== 'none') items.push(t.text('bf:f2', 0, fy + 58, `no buffer: T + C = ${none.perBlock}`, 'calc muted', 14));
        items.push(t.text('bf:f3', 0, fy + 90, `T = ${fill.join(', ')}`, 'mono', 13), t.text('bf:f4', 0, fy + 114, `M = ${inp.move} · C = ${comp.join(', ')}`, 'mono', 13));
        return items;
      };
      F.add({ items: pic(0, -1), title: 'the job', say: `${t.cap(t.plural(n, 'block'))} to read and process. The device takes T = ${fill.join(', ')} a block, the program computes C = ${comp.join(', ')} on each${k ? ` and spends M = ${inp.move} moving a block out of the buffer` : ''}. Here with ${KNAME[inp.kind]}${inp.kind === 'circular' ? ' of ' + k + ' slots' : ''}.`, meta: Object.assign({ phase: 'start' }, base) });
      const detail = Math.min(n, 6);
      for (let i = 0; i < detail; i++) {
        const d = res.lanes.device.find((s) => s.block === i), ps = res.lanes.process.filter((s) => s.block === i);
        const w = ps.find((s) => s.kind === 'wait'), m = ps.find((s) => s.kind === 'move'), c = ps.find((s) => s.kind === 'compute'), end = procEnd(i);
        F.set('done', i + 1);
        let say;
        if (!k) say = `Block ${i}: the program asks and waits from ${w.from} to ${w.to} while the device reads straight into it, then computes until ${c.to}. The device sits idle meanwhile.`;
        else {
          const sl = res.lanes.slots.find((s) => s.block === i), slotWait = i >= k && d.from > (i ? res.lanes.device.find((s) => s.block === i - 1).to : 0) + 1e-9;
          say = `Block ${i} goes into ${k === 1 ? 'the buffer' : 'slot ' + sl.slot}: the device fills it from ${d.from} to ${d.to}${slotWait ? ', once that slot had been emptied' : ''}. ${w ? `The program waits ${t.fix(w.to - w.from, 3)} for it, then moves` : 'The program moves'} it out from ${m.from} and computes until ${end}.`;
        }
        F.add({ items: pic(end, i), title: 'block ' + i, say, meta: Object.assign({ phase: 'block', i, dev: d, wait: w ? t.r3(w.to - w.from) : 0, w, m, c, end, T: T(i), C: C(i) }, base) });
      }
      if (n > detail) {
        F.set('done', n);
        const wt = res.lanes.process.filter((s) => s.kind === 'wait' && s.block >= detail).reduce((x, s) => x + s.to - s.from, 0);
        F.add({ items: pic(res.total, -1), title: 'the rest', say: `Blocks ${detail} to ${n - 1} go the same way, with ${t.fix(wt, 3)} of waiting by the program among them.`, meta: Object.assign({ phase: 'rest', wt: t.r3(wt), from: detail, to: n - 1 }, base) });
      }
      const saved = t.r3(none.total - res.total);
      F.add({ items: pic(res.total, -1), title: 'totals', say: `${t.cap(t.plural(n, 'block'))} take ${res.total} with ${KNAME[inp.kind]}${inp.kind === 'none' ? ': the device and the program take turns, each idle while the other works' : `, against ${none.total} with no buffer${saved > 0 ? `: ${saved} saved` : ''}`}. In the steady state a block costs ${res.formula} = ${res.perBlock}.`, meta: Object.assign({ phase: 'done', saved }, base) });
      return { frames: F.list, def: { sections: [{ id: 'f', kind: 'math', title: 'Time per block, steady state', text: ['T: device fills a block   C: program computes', 'M: move a block out of the kernel buffer', 'none        T + C', 'single      max(T, C) + M', 'double      max(T, C + M)', 'circular    max(T, C + M) on average; absorbs', '            bursts when T or C vary'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'In the steady state, what will one block cost?', options: (fr) => { const m = fr[0].meta, T0 = nums(m.o.fill)[0], C0 = nums(m.o.compute)[0], M = m.o.move; return [...new Set([T0 + C0, Math.max(T0, C0) + M, Math.max(T0, C0 + M)].map(S.T12.r3))].sort((a, b) => a - b).map(String); }, answer: (fr) => String(fr[0].meta.perBlock), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'T = 10, C = 6, M = 2. A block with double buffering costs…', options: ['10', '16', '12', '8'], answer: 0, why: 'max(T, C + M) = max(10, 8) = 10: the device is the bottleneck.' },
      { q: 'With a single buffer, why is M added outside the max?', options: ['the device cannot refill the buffer until the program has moved the block out', 'moving is done by the device', 'M is always the largest', 'it is not'], answer: 0, why: 'One buffer is busy during the move, so filling and moving cannot overlap.' },
      { q: 'What does a circular buffer add over double buffering?', options: ['it absorbs bursts when the device or the program speeds up and slows down', 'a faster device', 'no copying', 'nothing'], answer: 0, why: 'Extra full slots carry the program through a slow patch of the device.' },
      { q: 'If C is much bigger than T, buffering…', options: ['saves only the device time T per block at best', 'saves C', 'makes things slower', 'removes C'], answer: 0, why: 'The program is the bottleneck; the overlap can hide the device time, not the computing.' },
    ],
  });

  // =================================================================================================================
  const parseJobs = (v) => String(v).split(/[;\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => { const m = x.match(/^(\w+)\s+(\d+(?:\.\d+)?)\s+(\d+)$/); return m ? { proc: m[1], at: +m[2], pages: +m[3] } : null; });
  S.topic({
    id: 'io-spool', family: 'p13-kernel', order: 30, title: 'Spooling: a queue in front of the printer',
    blurb: 'A printer serves one job at a time. If each program had to hold it while its pages print, every other program would wait. With a spool, a program writes its job to a spool directory on disk, which is quick, and carries on; a daemon prints the spooled jobs one after another.',
    inputs: [
      { id: 'jobs', kind: 'text', label: 'jobs: name, arrival, pages; …', def: 'P1 0 3; P2 1 2; P3 2 4' },
      { id: 'pageTime', kind: 'number', label: 'time to print a page', def: 2, min: 0.1, max: 60, integer: false },
      { id: 'spoolTime', kind: 'number', label: 'time to spool a page', def: 0.2, min: 0.01, max: 10, integer: false },
    ],
    check(inp) { const j = parseJobs(inp.jobs); if (!j.length || j.some((x) => !x)) return 'jobs: each as name, arrival time and pages, separated by ;'; if (j.length > 6) return 'at most 6 jobs'; if (j.some((x) => x.pages < 1 || x.pages > 50)) return 'pages from 1 to 50'; if (new Set(j.map((x) => x.proc)).size < j.length) return 'jobs: give each a different name'; return null; },
    presets: [
      { label: 'Three jobs at once', values: { jobs: 'P1 0 3; P2 1 2; P3 2 4', pageTime: 2, spoolTime: 0.2 } },
      { label: 'A long job first', values: { jobs: 'big 0 20; memo 1 1; note 2 1', pageTime: 1.5, spoolTime: 0.1 } },
      { label: 'An office morning', values: { jobs: 'ann 0 4; raj 0.5 2; li 1 6; tom 1.5 1; eva 2 3', pageTime: 3, spoolTime: 0.15 } },
      { label: 'Jobs well apart', values: { jobs: 'A1 0 2; A2 10 2; A3 20 2', pageTime: 2, spoolTime: 0.2 } },
    ],
    counters: [{ id: 'jobs', label: 'jobs shown' }],
    run(inp) {
      const t = S.T12, jobs = parseJobs(inp.jobs), res = S.IO.spool(jobs, { pageTime: inp.pageTime, spoolTime: inp.spoolTime }), F = new S.Frames(['jobs']);
      const names = jobs.map((j) => j.proc), cls = (p) => 'pr' + (names.indexOf(p) % 6);
      const t1 = Math.max(...res.direct.printer.map((s) => s.to), ...res.spooled.printer.map((s) => s.to));
      const base = { direct: res.direct, spooled: res.spooled, jobs, t1, n: jobs.length };
      const pic = (part, upTo, cur) => {
        const items = [];
        const procRows = (side, held) => names.map((p) => {
          const j = res[side].jobs.find((x) => x.proc === p);
          return { id: p, label: p, labelCls: p === cur ? 'act-t' : '', segs: j.delay > 0 ? [{ from: j.at, to: j.free, cls: (held ? 'ps-blocked' : 'ps-move') + (p === cur ? ' act' : ''), text: held ? 'held up' : 'spool' }] : [] };
        });
        items.push(t.title('sp:t1', 0, 16, 'without a spool: each program holds the printer'));
        const A = t.lanes({ prefix: 'sa', x: 0, y: 30, w: 800, labelW: 70, t1, rows: [{ id: 'pr', label: 'printer', segs: res.direct.printer.map((s) => ({ from: s.from, to: s.to, cls: cls(s.proc) + (s.proc === cur && part === 'direct' ? ' act' : ''), text: s.proc })) }].concat(procRows('direct', true)), rowH: 26, gap: 8, upTo: part === 'direct' ? upTo : Infinity });
        items.push(...A.items);
        if (part !== 'direct') {
          const y2 = 30 + A.h + 50;
          items.push(t.title('sp:t2', 0, y2 - 14, 'with a spool: write the job to disk and go on'));
          const B = t.lanes({ prefix: 'sb', x: 0, y: y2, w: 800, labelW: 70, t1, rows: [{ id: 'pr', label: 'printer', segs: res.spooled.printer.map((s) => ({ from: s.from, to: s.to, cls: cls(s.proc) + (s.proc === cur ? ' act' : ''), text: s.proc })) }].concat(procRows('spooled', false)), rowH: 26, gap: 8, upTo });
          items.push(...B.items);
          items.push(...t.legend('spg', 70, y2 + B.h + 8, [{ cls: 'tl ps-blocked', text: 'program waits for the printer' }, { cls: 'tl ps-move', text: 'program writes its job to the spool' }], 730, 13).items);
        }
        return items;
      };
      F.add({ items: pic('direct', 0, null), title: 'the jobs', say: `${t.cap(t.plural(jobs.length, 'job'))}: ${t.list(jobs.map((j) => `${j.proc} at ${j.at} with ${t.plural(j.pages, 'page')}`))}. A page takes ${inp.pageTime} to print.`, meta: Object.assign({ phase: 'start' }, base) });
      res.direct.jobs.forEach((j, i) => {
        F.set('jobs', i + 1);
        F.add({ items: pic('direct', j.end, j.proc), title: 'direct: ' + j.proc, say: `Without a spool ${j.proc} arrives at ${j.at}${j.start > j.at ? `, waits for the printer until ${j.start}` : ''}, prints until ${j.end} and only then goes on: ${j.delay} held up.`, meta: Object.assign({ phase: 'direct', j }, base) });
      });
      F.add({ items: pic('direct', Infinity, null), title: 'direct: mean', say: `Holding the printer, the programs are held up ${res.direct.meanDelay} on average.`, meta: Object.assign({ phase: 'direct-mean' }, base) });
      res.spooled.jobs.forEach((j, i) => {
        F.set('jobs', i + 1);
        F.add({ items: pic('spooled', j.end, j.proc), title: 'spooled: ' + j.proc, say: `${j.proc} spools its job of ${t.plural(jobs.find((x) => x.proc === j.proc).pages, 'page')} by ${j.spooled}, held up only ${j.delay}. The daemon prints it from ${j.start} to ${j.end}.`, meta: Object.assign({ phase: 'spooled', j }, base) });
      });
      const last = res.steps[res.steps.length - 1];
      F.add({ items: pic('spooled', Infinity, null), title: 'compared', say: last.say + ' The printer finishes at about the same time either way; it is the programs that are freed.', meta: Object.assign({ phase: 'done' }, base) });
      return { frames: F.list, def: { sections: [{ id: 'f', kind: 'math', title: 'Spooling', text: ['direct:   a program waits until its last page prints', 'spooled:  a program waits only to write its job', '          (pages × spool time) to the spool directory', 'the daemon prints spooled jobs in order, one at a time', 'the printer’s own schedule hardly changes'].join('\n') }] } };
    },
    predict: [{ at: (f) => f.meta.phase === 'direct-mean', pick: 'option', ask: 'With a spool, how long will a program be held up on average?', options: ['about as long as it takes to write its job to disk', 'as long as without a spool', 'longer, because of the extra copy'], answer: 'about as long as it takes to write its job to disk', explain: (fr) => fr[fr.length - 1].say }],
    quiz: [
      { q: 'What does a spool turn a non-shareable device into?', options: ['something every program can use at once, each through its own file', 'a faster device', 'a disk', 'a network'], answer: 0, why: 'Each program writes its own spool file at once; the daemon serialises the printing.' },
      { q: 'Who actually sends the pages to the printer?', options: ['a spooler daemon', 'each program', 'the disk controller', 'the scheduler'], answer: 0, why: 'One process owns the printer and works through the spool queue.' },
      { q: 'Does spooling make the last page come out sooner?', options: ['no: the printer is just as busy', 'yes, much sooner', 'only for long jobs', 'it prints in parallel'], answer: 0, why: 'The printer prints the same pages; only the programs stop waiting for it.' },
      { q: 'Spooling is a kind of…', options: ['buffering a whole job on disk', 'caching', 'polling', 'DMA'], answer: 0, why: 'The spool file holds the output until the slow device is ready for it.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
