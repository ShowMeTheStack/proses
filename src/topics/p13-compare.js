// Part 13, polling, interrupts and DMA side by side: one transfer done all three ways on a shared time axis, the
// CPU time each one costs, and a sweep over the device's speed that shows where each way wins. Everything comes
// from the transfer model (S.IO.transfer and S.IO.compare).
(function (S) {
  'use strict';
  const R = Math.round;
  const MODES = ['polling', 'interrupt', 'dma'], NAME = { polling: 'polling', interrupt: 'interrupts', dma: 'DMA' };
  const SWEEP = [0.5, 1, 2, 5, 10, 20, 50, 100, 200];
  /** every other sweep point, and the chosen one in place of its neighbours */
  const ticksFor = (xs, k0) => xs.map((_, k) => k).filter((k) => k === k0 || (k % 2 === 0 && Math.abs(k - k0) !== 1));

  S.topic({
    id: 'io-xfer-compare', family: 'p13-xfer', order: 40, title: 'Polling, interrupts and DMA compared',
    blurb: 'The same transfer three ways. Polling keeps the CPU busy the whole time; interrupts give it back while the device works but charge a fixed price for each unit; DMA charges one set-up and one interrupt for the whole block. Which is best depends on how fast the device is and how much data moves.',
    inputs: [
      { id: 'bytes', kind: 'number', label: 'bytes', def: 32, min: 1, max: 4096 },
      { id: 'unit', kind: 'number', label: 'bytes a unit', def: 4, min: 1, max: 512 },
      { id: 'device', kind: 'number', label: 'device µs a unit', def: 10, min: 0.1, max: 5000, integer: false },
      { id: 'poll', kind: 'number', label: 'one poll µs', def: 0.5, min: 0.05, max: 100, integer: false },
      { id: 'irq', kind: 'number', label: 'interrupt µs', def: 4, min: 0.1, max: 200, integer: false },
      { id: 'dmaSetup', kind: 'number', label: 'DMA set-up µs', def: 5, min: 0.1, max: 200, integer: false },
    ],
    check: (inp) => (Math.ceil(inp.bytes / inp.unit) > 256 ? 'at most 256 units: raise the bytes a unit' : null),
    presets: [
      { label: 'A middling device', values: { bytes: 32, unit: 4, device: 10, poll: 0.5, irq: 4, dmaSetup: 5 } },
      { label: 'A very fast device', values: { bytes: 32, unit: 4, device: 0.5, poll: 0.5, irq: 4, dmaSetup: 5 } },
      { label: 'A slow device, little data', values: { bytes: 4, unit: 1, device: 100, poll: 0.5, irq: 4, dmaSetup: 5 } },
      { label: 'A disk sector', values: { bytes: 512, unit: 8, device: 3, poll: 0.3, irq: 3, dmaSetup: 6 } },
    ],
    counters: [{ id: 'shown', label: 'ways shown' }],
    run(inp) {
      const t = S.T12, a = Object.assign({}, S.IO.defaults, inp), res = {}, F = new S.Frames(['shown']);
      for (const m of MODES) res[m] = S.IO.transfer(m, a);
      const tmax = Math.max(...MODES.map((m) => res[m].totals.time));
      const tot = {}; for (const m of MODES) tot[m] = res[m].totals;
      const pct = (m) => R(tot[m].cpuShare * 100);
      // the sweep over device speeds (the chosen speed included)
      const xs = [...new Set(SWEEP.concat([inp.device]))].sort((x, y) => x - y);
      const sweep = xs.map((d) => ({ d, c: S.IO.compare(Object.assign({}, a, { device: d })) }));
      const firstWin = sweep.find((p) => p.c.interrupt.cpuBusy < p.c.polling.cpuBusy - 1e-9);
      // the exact crossover: polling's cost only grows with the device's time, so bisect for where interrupts start to win
      const wins = (d) => { const c = S.IO.compare(Object.assign({}, a, { device: d })); return c.interrupt.cpuBusy < c.polling.cpuBusy - 1e-9; };
      let cross = null, crossIncl = false;
      if (firstWin && firstWin.d > xs[0]) {
        let lo = xs[0], hi = firstWin.d;
        for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (wins(mid)) hi = mid; else lo = mid; }
        cross = Math.round(hi * 1000) / 1000; crossIncl = wins(cross);
      }
      const base = { a, tot, tmax, pct: { polling: pct('polling'), interrupt: pct('interrupt'), dma: pct('dma') }, sweep: sweep.map((p) => ({ d: p.d, polling: p.c.polling.cpuBusy, interrupt: p.c.interrupt.cpuBusy, dma: p.c.dma.cpuBusy })), win: firstWin ? firstWin.d : null, cross, crossIncl };
      const pic = (lit, nBars, curve) => {
        const items = [];
        const rows = MODES.map((m) => ({ id: m, label: NAME[m], labelCls: lit === m ? 'act-t' : '', segs: res[m].lanes.cpu.map((s) => ({ from: s.from, to: s.to, cls: S.T13.KCLS[s.kind] + (lit === m ? ' act' : '') })) }));
        items.push(t.title('xc:tt', 0, 18, 'the CPU’s time, each way'));
        const L = t.lanes({ prefix: 'xc', x: 0, y: 34, w: 800, labelW: 92, t1: tmax, rows, rowH: 30, gap: 10, unit: 'µs' });
        items.push(...L.items);
        const lg = t.legend('xcg', 92, 34 + L.h + 8, ['cmd', 'poll', 'copy', 'irq', 'setup', 'free'].map((k) => ({ cls: 'tl ' + S.T13.KCLS[k], text: S.T13.KNAME[k] })), 708, 13);
        items.push(...lg.items);
        const by = 34 + L.h + lg.h + 44;
        items.push(t.title('xc:bt', 0, by, 'CPU time spent on the transfer'));
        const maxB = Math.max(...MODES.map((m) => tot[m].cpuBusy)) || 1;
        MODES.slice(0, nBars).forEach((m, i) => {
          const y = by + 18 + i * 40, w = Math.max(3, R((200 * tot[m].cpuBusy) / maxB));
          items.push(t.text('xc:bl' + i, 92, y + 19, NAME[m], 'strong' + (lit === m ? ' act-t' : ''), 14, 'end'));
          items.push(t.cell('xc:b' + i, 102, y, w, 28, '', 'tl ' + (m === 'polling' ? 'io-poll' : m === 'interrupt' ? 'io-irq' : 'io-dma') + (lit === m ? ' act' : ''), 13));
          items.push(t.text('xc:bv' + i, 102 + w + 8, y + 19, t.fix(tot[m].cpuBusy, 3) + ' µs (' + pct(m) + '%)', 'mono', 13));
        });
        if (curve) {
          const all = sweep.flatMap((p) => [p.c.polling.cpuBusy, p.c.interrupt.cpuBusy, p.c.dma.cpuBusy]).filter((v) => v > 0);
          const lo = Math.floor(Math.log10(Math.min(...all))), hi = Math.max(lo + 1, Math.ceil(Math.log10(Math.max(...all))));
          const yt = []; for (let k = lo; k <= hi; k++) yt.push(k);
          const ax = S.Kit.curve.axes({ prefix: 'xk', x: 530, y: by + 26, w: 260, h: 120, xr: [0, xs.length - 1], yr: [lo, hi], xticks: ticksFor(xs, xs.indexOf(inp.device)), fmtX: (k) => t.fix(xs[R(k)], 2), yticks: yt.length > 5 ? yt.filter((k) => (k - lo) % 2 === 0) : yt, fmtY: (v) => t.fix(Math.pow(10, v), 3), xname: 'device µs a unit', yname: 'CPU µs busy (log scale)', grid: true });
          items.push(...ax.items);
          MODES.forEach((m, j) => items.push(S.Kit.curve.line(ax, 'xk:l' + m, sweep.map((p, k) => [k, Math.log10(Math.max(1e-9, p.c[m].cpuBusy))]), 'c' + j)));
          const k0 = xs.indexOf(inp.device);
          items.push(S.Kit.curve.vline(ax, 'xk:now', k0, 'act'));
          items.push(...S.Kit.curve.legend('xk:lg', 530, by + 210, MODES.map((m, j) => ({ text: NAME[m], cls: 'c' + j })), {}));
        }
        return items;
      };
      F.add({ items: pic(null, 0, false), title: 'one transfer', say: `${t.cap(t.plural(a.bytes, "byte"))} in ${t.plural(tot.polling.units, 'unit')}, the device taking ${a.device} µs a unit. The three timelines show only the CPU: what it spends on the transfer, and the stretches it is free for other work.`, meta: Object.assign({ phase: 'start' }, base) });
      MODES.forEach((m, i) => {
        F.set('shown', i + 1);
        const x = tot[m];
        const say = m === 'polling' ? `Polling finishes at ${x.time} µs and keeps the CPU busy ${x.cpuBusy} µs (${pct(m)}%), ${x.polls} status reads among it.`
          : m === 'interrupt' ? `Interrupts finish at ${x.time} µs; the CPU spends ${x.cpuBusy} µs (${pct(m)}%), ${x.irqTime} µs of it entering and leaving ${t.plural(x.interrupts, 'interrupt')}, and is free for ${x.cpuFree} µs.`
          : `DMA finishes at ${x.time} µs with the CPU busy only ${x.cpuBusy} µs (${pct(m)}%): one set-up, one command and ${t.plural(x.interrupts, 'interrupt')}; the bus was borrowed for ${x.busBusy} µs.`;
        F.add({ items: pic(m, i + 1, false), title: NAME[m], say, meta: Object.assign({ phase: m }, base) });
      });
      const order = MODES.slice().sort((x, y) => tot[x].cpuBusy - tot[y].cpuBusy);
      const fastest = MODES.slice().sort((x, y) => tot[x].time - tot[y].time)[0];
      F.add({ items: pic(order[0], 3, false), title: 'the ranking', say: `Least CPU: ${NAME[order[0]]} with ${tot[order[0]].cpuBusy} µs; most: ${NAME[order[2]]} with ${tot[order[2]].cpuBusy} µs. Soonest done: ${NAME[fastest]}, at ${tot[fastest].time} µs.`, meta: Object.assign({ phase: 'rank' }, base) });
      const lo = xs[0], hi = xs[xs.length - 1];
      const sw = firstWin ? (firstWin.d === lo ? `interrupts cost the CPU less than polling at every speed from ${lo} µs to ${hi} µs` : `interrupts cost the CPU less than polling once the device takes ${crossIncl ? cross + ' µs a unit or more' : 'more than ' + cross + ' µs a unit'}; below that, polling’s few reads are cheaper than an interrupt`) : `polling costs the CPU less than interrupts at every speed from ${lo} µs to ${hi} µs: the units are too quick for an interrupt to pay`;
      F.add({ items: pic(null, 3, true), title: 'device speed', say: `Sweeping the device from ${lo} to ${hi} µs a unit: ${sw}. DMA’s cost stays flat whatever the speed: one set-up and one interrupt.`, meta: Object.assign({ phase: 'sweep', lo, hi }, base) });
      return { frames: F.list, def: { sections: [{ id: 'f', kind: 'math', title: 'CPU cost of n units', text: ['polling:    n × (command + polls + copy)', '            polls ≈ device / poll + 1', 'interrupts: n × (command + interrupt + copy)', 'DMA:        set-up + command + interrupt', '            (per block; the bus is borrowed', '             one cycle a unit)'].join('\n') }, { id: 't', kind: 'text', text: 'Each way is drawn step by step in [[io-polling]], [[io-interrupt]] and [[io-dma]].' }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'Which way will cost the CPU the least time?', options: ['polling', 'interrupts', 'DMA'], answer: (fr) => { const tt = fr[0].meta.tot; return NAME[MODES.slice().sort((x, y) => tt[x].cpuBusy - tt[y].cpuBusy)[0]]; }, explain: (fr) => fr[fr.length - 2].say },
      { at: (f) => f.meta.phase === 'rank', pick: 'option', ask: 'As the device gets slower, polling’s CPU cost…', options: ['grows: more polls a unit', 'stays the same', 'shrinks'], answer: 'grows: more polls a unit', explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'A device answers within one status read. Which is cheapest for the CPU?', options: ['polling', 'interrupts', 'it makes no difference', 'neither works'], answer: 0, why: 'One poll costs less than saving state and running a handler.' },
      { q: 'Why does DMA’s CPU cost hardly depend on the size of the transfer?', options: ['the CPU pays one set-up and one interrupt per block', 'DMA is faster than memory', 'the device is idle', 'polls are free'], answer: 0, why: 'The controller moves every unit; the CPU only starts it and hears it end.' },
      { q: 'What does DMA take from the CPU while it runs?', options: ['bus cycles, now and then', 'all of its time', 'nothing at all', 'its registers'], answer: 0, why: 'Cycle stealing: the CPU waits a little when it needs the bus at the same moment.' },
      { q: 'Interrupt-driven I/O with a slow device: the CPU is busy for…', options: ['a small share of the transfer', 'all of it', 'none of it', 'exactly half'], answer: 0, why: 'Most of the time the device works and the CPU runs something else.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
