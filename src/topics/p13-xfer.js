// Part 13, polling, interrupts and DMA: the same transfer done three ways, each a topic of its own drawn as the
// machine on its bus over a timeline of the CPU, the bus and the device. Every time and count comes from the
// transfer model (S.IO.transfer, src/core/io-a-transfer.js); the frames step through its CPU lane.
(function (S) {
  'use strict';
  const R = Math.round;
  const pctOf = (x) => R(x * 100);

  const IN = {
    bytes: { id: 'bytes', kind: 'number', label: 'bytes', def: 16, min: 1, max: 4096 },
    unit: { id: 'unit', kind: 'number', label: 'bytes a unit', def: 4, min: 1, max: 512 },
    device: { id: 'device', kind: 'number', label: 'device µs a unit', def: 10, min: 0.1, max: 5000, integer: false },
    cmd: { id: 'cmd', kind: 'number', label: 'command µs', def: 1, min: 0.1, max: 100, integer: false },
    poll: { id: 'poll', kind: 'number', label: 'one poll µs', def: 0.5, min: 0.05, max: 100, integer: false },
    copy: { id: 'copy', kind: 'number', label: 'copy a unit µs', def: 0.5, min: 0.05, max: 100, integer: false },
    irq: { id: 'irq', kind: 'number', label: 'interrupt µs', def: 4, min: 0.1, max: 200, integer: false },
    dmaSetup: { id: 'dmaSetup', kind: 'number', label: 'DMA set-up µs', def: 5, min: 0.1, max: 200, integer: false },
    dmaBlock: { id: 'dmaBlock', kind: 'number', label: 'DMA block bytes (0: all)', def: 0, min: 0, max: 4096 },
    bus: { id: 'bus', kind: 'number', label: 'bus µs a unit', def: 0.2, min: 0.01, max: 50, integer: false },
  };
  const KEYS = { polling: ['bytes', 'unit', 'device', 'cmd', 'poll', 'copy'], interrupt: ['bytes', 'unit', 'device', 'cmd', 'copy', 'irq'], dma: ['bytes', 'unit', 'device', 'cmd', 'dmaSetup', 'dmaBlock', 'bus', 'irq'] };
  const paramsOf = (mode, inp) => { const o = {}; for (const k of KEYS[mode]) o[k] = inp[k]; return o; };
  const check = (inp) => (Math.ceil(inp.bytes / inp.unit) > 256 ? 'at most 256 units, so the timeline stays readable: raise the bytes a unit' : null);

  /** cumulative CPU time spent (not free) and polls by time t */
  const busyBy = (res, t) => res.lanes.cpu.filter((s) => s.kind !== 'free').reduce((n, s) => n + Math.max(0, Math.min(s.to, t) - s.from), 0);
  const pollsBy = (res, t) => res.lanes.cpu.filter((s) => s.kind === 'poll' && s.to <= t + 1e-9).reduce((n, s) => n + s.polls, 0);
  const irqsBy = (res, t) => res.lanes.cpu.filter((s) => s.kind === 'irq' && s.to <= t + 1e-9).length;

  /** the picture at time now with the given CPU, bus and device segments lit */
  function picture(mode, a, res, now, lit, act) {
    const t = S.T12, T13 = S.T13, items = [];
    const sys = T13.system({ prefix: 'xs', x: 0, y: 40, w: 800, dma: mode === 'dma', dev: 'device controller', lit });
    items.push(...sys.items);
    const lab = (k, u) => (k === 'free' ? 'free' : k === 'busy' ? 'u' + u : k === 'poll' ? 'poll' : k === 'copy' ? 'copy' : k === 'cmd' ? 'cmd' : k === 'irq' ? 'irq' : k === 'setup' ? 'set-up' : '');
    const row = (id, label, segs) => ({ id, label, segs: segs.map((s, j) => ({ from: s.from, to: s.to, cls: S.T13.KCLS[s.kind] + (act && act(id, s, j) ? ' act' : ''), text: lab(s.kind, s.unit) })) });
    const L = t.lanes({ prefix: 'xl', x: 0, y: 214, w: 800, labelW: 74, t1: res.totals.time, rows: [row('cpu', 'CPU', res.lanes.cpu), row('bus', 'bus', res.lanes.bus), row('device', 'device', res.lanes.device)], rowH: 34, gap: 12, upTo: now, unit: 'µs', now });
    items.push(...L.items);
    const kinds = mode === 'polling' ? ['cmd', 'poll', 'copy', 'status', 'data', 'busy'] : mode === 'interrupt' ? ['cmd', 'free', 'irq', 'copy', 'data', 'busy'] : ['setup', 'cmd', 'free', 'irq', 'dma', 'busy'];
    const lg = t.legend('xg', 74, 214 + L.h + 10, kinds.map((k) => ({ cls: 'tl ' + S.T13.KCLS[k], text: S.T13.KNAME[k] })), 726, 13);
    items.push(...lg.items);
    // the CPU's time so far: busy against free
    const by = 214 + L.h + 10 + lg.h + 34, bw = 726, busy = busyBy(res, now), free = Math.max(0, now - busy);
    items.push(t.text('xb:l', 64, by + 18, 'CPU so far', 'strong', 13, 'end'));
    if (now > 0) {
      const wb = Math.max(busy > 0 ? 2 : 0, R((bw * busy) / now));
      if (busy > 0) items.push(t.cell('xb:busy', 74, by, wb, 26, wb > 150 ? 'busy ' + t.fix(busy, 3) + ' µs' : '', 'tl io-poll', 13));
      if (free > 0) items.push(t.cell('xb:free', 74 + wb, by, bw - wb, 26, bw - wb > 150 ? 'free ' + t.fix(free, 3) + ' µs' : '', 'tl io-free', 13));
    } else items.push(t.cell('xb:none', 74, by, bw, 26, 'nothing yet', 'tl-track', 13));
    return items;
  }

  /** the frames: the first units step by step, the rest in groups, then the totals */
  function frames(mode, inp) {
    const t = S.T12, a = Object.assign({}, S.IO.defaults, paramsOf(mode, inp)), res = S.IO.transfer(mode, a), T = res.totals;
    const F = new S.Frames(['busy', 'polls', 'irqs']);
    const ub = (u) => Math.min(a.unit, a.bytes - u * a.unit);
    const base = { mode, a, totals: T, units: T.units, pct: pctOf(T.cpuShare) };
    const add = (now, lit, act, say, meta, title) => {
      F.set('busy', t.r3(busyBy(res, now))).set('polls', pollsBy(res, now)).set('irqs', irqsBy(res, now));
      const dm = {}; if (meta.seg) dm.dur = t.r3(meta.seg.to - meta.seg.from); if (meta.next) dm.nextDur = t.r3(meta.next.to - meta.next.from); if (meta.bus) dm.busDur = t.r3(meta.bus.to - meta.bus.from);
      F.add({ items: picture(mode, a, res, now, lit, act), say, title, meta: Object.assign(dm, { now, busy: t.r3(busyBy(res, now)), pollsSoFar: pollsBy(res, now), irqsSoFar: irqsBy(res, now) }, base, meta) });
    };
    const cpu = res.lanes.cpu;
    const isSeg = (s) => (id, x) => id === 'cpu' && x === s;
    add(0, {}, null, `${t.cap(t.plural(a.bytes, 'byte'))} to move from the device, ${t.plural(T.units, 'unit')} of ${a.unit} through the controller’s data register; the device needs ${a.device} µs a unit. ${mode === 'polling' ? 'With polling the CPU itself watches the status register.' : mode === 'interrupt' ? 'With interrupts the device tells the CPU when each unit is ready.' : 'With DMA a controller of its own moves the data into memory.'}`, { phase: 'start' }, 'the task');
    if (mode === 'polling') {
      const detail = Math.min(2, T.units);
      for (let u = 0; u < detail; u++) {
        const [c, p, k] = cpu.filter((s) => s.unit === u);
        add(c.to, { cpu: 1, bus: 1, dev: 1, reg: 'control' }, isSeg(c), `t = ${c.from}: the CPU writes unit ${u}’s command into the control register (${t.fix(c.to - c.from, 3)} µs); the device starts and will be busy ${a.device} µs.`, { phase: 'cmd', unit: u, seg: c }, 'command');
        add(p.to, { cpu: 1, bus: 1, dev: 1, reg: 'status' }, isSeg(p), `The CPU reads the status register ${p.polls} times, ${t.fix(p.to - p.from, 3)} µs of busy waiting, and at t = ${p.to} it finally sees ready. It could do nothing else meanwhile.`, { phase: 'poll', unit: u, seg: p, polls: p.polls }, 'polling');
        add(k.to, { cpu: 1, bus: 1, mem: 1, dev: 1, reg: 'data' }, isSeg(k), `It copies the ${ub(u)}-byte unit from the data register into memory (${t.fix(k.to - k.from, 3)} µs). By t = ${k.to} the CPU has been busy ${t.fix(busyBy(res, k.to), 3)} µs, all of it.`, { phase: 'copy', unit: u, seg: k, ub: ub(u), busyNow: t.r3(busyBy(res, k.to)) }, 'copy');
      }
      groups(detail);
    } else if (mode === 'interrupt') {
      const detail = Math.min(2, T.units);
      const c0 = cpu[0];
      add(c0.to, { cpu: 1, bus: 1, dev: 1, reg: 'control' }, isSeg(c0), `t = 0: the CPU writes unit 0’s command (${c0.to} µs) and goes off to other work.`, { phase: 'cmd', unit: 0, seg: c0 }, 'command');
      for (let u = 0; u < detail; u++) {
        const fr = cpu.find((s) => s.kind === 'free' && s.from >= (u ? cpu.find((x) => x.kind === 'cmd' && x.unit === u).to - 1e-9 : c0.to - 1e-9));
        const ir = cpu.find((s) => s.kind === 'irq' && s.unit === u), cp = cpu.find((s) => s.kind === 'copy' && s.unit === u), nx = cpu.find((s) => s.kind === 'cmd' && s.unit === u + 1);
        add(fr.to, { dev: 1 }, (id, s) => (id === 'cpu' && s === fr) || (id === 'device' && s.unit === u), `From ${fr.from} to ${fr.to} the device works on unit ${u} and the CPU is free: ${t.fix(fr.to - fr.from, 3)} µs it can give to other processes.`, { phase: 'free', unit: u, seg: fr }, 'device works');
        add(ir.to, { cpu: 1, dev: 1, irq: 1 }, isSeg(ir), `t = ${ir.from}: the device raises an interrupt. Saving the running program’s state, finding the handler and returning later cost ${t.fix(ir.to - ir.from, 3)} µs.`, { phase: 'irq', unit: u, seg: ir }, 'interrupt');
        const end = nx ? nx.to : cp.to;
        add(end, { cpu: 1, bus: 1, mem: 1, dev: 1, reg: nx ? 'control' : 'data' }, (id, s) => id === 'cpu' && (s === cp || s === nx), `The handler copies unit ${u} (${t.plural(ub(u), 'byte')}) into memory (${t.fix(cp.to - cp.from, 3)} µs)${nx ? ` and starts unit ${u + 1} with a new command (${t.fix(nx.to - nx.from, 3)} µs)` : ''}. Interrupts so far: ${irqsBy(res, end)}.`, { phase: 'copy', unit: u, seg: cp, next: nx || null, ub: ub(u) }, 'handler');
      }
      groups(detail);
    } else {
      const blocks = cpu.filter((s) => s.kind === 'setup');
      blocks.forEach((su, b) => {
        const cm = cpu[cpu.indexOf(su) + 1], fr = cpu[cpu.indexOf(su) + 2], ir = cpu[cpu.indexOf(su) + 3];
        const us = res.lanes.device.filter((s) => s.from >= cm.to - 1e-9 && s.to <= fr.to + 1e-9), n = us.length, u0 = us[0].unit, nb = Math.min(n * a.unit, a.bytes - u0 * a.unit);
        if (b < 2) {
          add(su.to, { cpu: 1, bus: 1, dma: 1 }, isSeg(su), `t = ${su.from}: the CPU programs the DMA controller with the memory address, the count of ${t.plural(nb, 'byte')} (${n === 1 ? 'unit ' + u0 : 'units ' + u0 + ' to ' + (u0 + n - 1)}) and the direction: ${t.fix(su.to - su.from, 3)} µs.`, { phase: 'setup', block: b, seg: su, n, u0, u1: u0 + n - 1, nb }, 'DMA set-up');
          add(cm.to, { cpu: 1, bus: 1, dev: 1, reg: 'control' }, isSeg(cm), `It writes the command to the device (${t.fix(cm.to - cm.from, 3)} µs) and from t = ${cm.to} it is free.`, { phase: 'cmd', block: b, seg: cm }, 'command');
          us.slice(0, 2).forEach((d) => {
            const bu = res.lanes.bus.find((s) => s.unit === d.unit);
            add(bu.to, { dev: 1, dma: 1, bus: 1, mem: 1 }, (id, s) => (id === 'device' && s === d) || (id === 'bus' && s === bu), `t = ${d.from}: the device fills unit ${d.unit}; at ${d.to} the DMA controller takes the bus for ${t.fix(bu.to - bu.from, 3)} µs and writes it to memory, a cycle stolen from the CPU, which carries on.`, { phase: 'dma', block: b, unit: d.unit, seg: d, bus: bu }, 'unit ' + d.unit);
          });
          if (n > 2) {
            const last = res.lanes.bus.find((s) => s.unit === us[n - 1].unit);
            add(last.to, { dev: 1, dma: 1, bus: 1, mem: 1 }, (id, s) => (id === 'device' || id === 'bus') && s.unit >= us[2].unit && s.unit <= us[n - 1].unit, `Units ${us[2].unit} to ${us[n - 1].unit} follow the same way by t = ${last.to}: ${n - 2} more bus cycles stolen while the CPU stays free.`, { phase: 'dma-rest', block: b, from: us[2].unit, to: us[n - 1].unit, k: n - 2, end: last.to }, 'the rest');
          }
          add(ir.to, { cpu: 1, dev: 1, irq: 1 }, isSeg(ir), `t = ${ir.from}: one interrupt for the whole block of ${t.plural(n, 'unit')} (${t.fix(ir.to - ir.from, 3)} µs). The CPU was free for ${t.fix(fr.to - fr.from, 3)} µs of it.`, { phase: 'irq', block: b, seg: ir, n, freeFor: t.r3(fr.to - fr.from) }, 'interrupt');
        }
      });
      if (blocks.length > 2) {
        const from = 2, to = blocks.length - 1, lastIr = cpu.filter((s) => s.kind === 'irq')[to];
        add(lastIr.to, { cpu: 1, dma: 1, bus: 1, dev: 1 }, (id, s) => id === 'cpu' && (s.kind === 'setup' || s.kind === 'irq') && s.from >= blocks[2].from - 1e-9, `${from === to ? 'Block ' + from + ' repeats' : 'Blocks ' + from + ' to ' + to + ' repeat'} it: a set-up, a command and one interrupt each. By t = ${lastIr.to}: ${t.plural(irqsBy(res, lastIr.to), 'interrupt')} in all.`, { phase: 'blocks', from, to, end: lastIr.to }, 'more blocks');
      }
    }
    function groups(done) {
      const left = T.units - done;
      if (left <= 0) return;
      const ng = Math.min(3, left), per = Math.ceil(left / ng);
      for (let g = 0; g < ng; g++) {
        const a0 = done + g * per, a1 = Math.min(T.units - 1, a0 + per - 1);
        if (a0 > a1) break;
        const segs = cpu.filter((s) => s.unit !== undefined && s.unit >= a0 && s.unit <= a1);
        const end = Math.max(...segs.map((s) => s.to));
        const np = segs.filter((s) => s.kind === 'poll').reduce((n, s) => n + s.polls, 0);
        const ni = segs.filter((s) => s.kind === 'irq').length, what = mode === 'polling' ? `${np} more status reads` : `${ni} more interrupt${ni === 1 ? '' : 's'}`;
        add(end, { cpu: 1, bus: 1, mem: 1, dev: 1 }, (id, s) => s.unit >= a0 && s.unit <= a1, `${a0 === a1 ? 'Unit ' + a0 + ' repeats' : 'Units ' + a0 + ' to ' + a1 + ' repeat'} it: ${what}. By t = ${end} the CPU has been busy ${t.fix(busyBy(res, end), 3)} µs.`, { phase: 'group', from: a0, to: a1, np, nirq: segs.filter((s) => s.kind === 'irq').length, end, busyNow: t.r3(busyBy(res, end)) }, 'units ' + a0 + '–' + a1);
      }
    }
    const extra = T.polls ? `, ${T.polls} of its status reads spent waiting` : `, with ${t.plural(T.interrupts, 'interrupt')} costing ${T.irqTime} µs`;
    add(T.time, {}, null, `${res.name} moved ${t.plural(a.bytes, 'byte')} in ${T.time} µs. The CPU was busy ${T.cpuBusy} µs (${pctOf(T.cpuShare)}%) and free ${T.cpuFree} µs${extra}.`, { phase: 'done' }, 'totals');
    return { frames: F.list, def: { sections: [{ id: 'f', kind: 'math', title: res.name, text: DEF[mode].join('\n') }] } };
  }
  const DEF = {
    polling: ['for each unit:', '  write the command', '  read status until ready  (busy waiting)', '  copy the unit from the data register', 'CPU busy: the whole transfer'],
    interrupt: ['for each unit:', '  write the command; the CPU leaves', '  device works  (CPU free)', '  interrupt: save state, run the handler', '  handler copies the unit, starts the next', 'cost: one interrupt a unit'],
    dma: ['for each block:', '  program the DMA controller (address, count)', '  write the command; the CPU leaves', '  device fills units; DMA writes them to memory', '    (one bus cycle stolen a unit)', '  one interrupt at the end of the block'],
  };
  S.T13.xferFrames = frames;

  const bucket = (x) => (x < 1 / 3 ? 'under a third' : x <= 2 / 3 ? 'a third to two thirds' : 'over two thirds');
  const sharePredict = { at: (f, i, fr) => i === fr.length - 2, pick: 'option', ask: 'Over the whole transfer, how much of the time will the CPU be busy with it?', options: ['under a third', 'a third to two thirds', 'over two thirds'], answer: (fr) => bucket(fr[fr.length - 1].meta.totals.cpuShare), explain: (fr) => fr[fr.length - 1].say };

  const mk = (mode, order, id, title, blurb, presets, predict, quiz) => S.topic({
    id, family: 'p13-xfer', order, title, blurb,
    inputs: KEYS[mode].map((k) => IN[k]), check, presets,
    counters: [{ id: 'busy', label: 'CPU µs busy' }].concat(mode === 'polling' ? [{ id: 'polls', label: 'status reads' }] : [{ id: 'irqs', label: 'interrupts' }]),
    run: (inp) => frames(mode, inp), predict: predict.concat([sharePredict]), quiz,
  });

  mk('polling', 10, 'io-polling', 'Polling: the CPU waits on the status register',
    'The simplest way to talk to a device: write a command, then read the status register over and over until the device says ready, then copy the data. Nothing is wasted when the device is quick; when it is slow, the CPU burns its time asking.',
    [
      { label: 'A small transfer', values: { bytes: 16, unit: 4, device: 10, cmd: 1, poll: 0.5, copy: 0.5 } },
      { label: 'A fast device', values: { bytes: 16, unit: 4, device: 1, cmd: 1, poll: 0.5, copy: 0.5 } },
      { label: 'A slow keyboard', values: { bytes: 4, unit: 1, device: 200, cmd: 1, poll: 0.5, copy: 0.5 } },
      { label: 'A 512-byte sector', values: { bytes: 512, unit: 4, device: 2, cmd: 0.5, poll: 0.2, copy: 0.3 } },
    ],
    [{ at: (f) => f.meta.phase === 'cmd' && f.meta.unit === 0, once: true, pick: 'option', ask: 'How many times will the CPU read the status register for unit 0?', options: (fr, i) => { const n = fr[i + 1].meta.polls; return [...new Set([n, Math.max(1, Math.round(n / 2)), n * 2, 1])].sort((x, y) => x - y).map(String); }, answer: (fr, i) => String(fr[i + 1].meta.polls), explain: (fr, i) => fr[i + 1].say }],
    [
      { q: 'While it polls, the CPU…', options: ['can do nothing else', 'runs other processes', 'sleeps', 'is switched off'], answer: 0, why: 'Polling is busy waiting: the CPU is the one asking, again and again.' },
      { q: 'When is polling a good choice?', options: ['when the device is ready almost at once', 'when the device is very slow', 'for a printer', 'never'], answer: 0, why: 'If the first poll or two find the device ready, polling costs less than taking an interrupt.' },
      { q: 'Which register does the CPU read to learn the device is ready?', options: ['status', 'control', 'data in', 'data out'], answer: 0, why: 'The status register holds the busy, ready and error bits.' },
      { q: 'A device takes 20 µs a unit and one poll takes 0.5 µs. About how many polls per unit?', options: ['about 41', 'about 10', '2', '1'], answer: 0, why: 'The CPU polls about 20 / 0.5 = 40 times while the device works, plus the one that finds it ready.' },
    ]);

  mk('interrupt', 20, 'io-interrupt', 'Interrupts: the device calls the CPU',
    'Instead of asking again and again, the CPU writes the command and goes off to run something else. When the unit is ready the device raises an interrupt; the handler copies the data and starts the next unit. Each interrupt has a fixed cost: saving state, finding the handler, returning.',
    [
      { label: 'A small transfer', values: { bytes: 16, unit: 4, device: 10, cmd: 1, copy: 0.5, irq: 4 } },
      { label: 'A slow keyboard', values: { bytes: 4, unit: 1, device: 200, cmd: 1, copy: 0.5, irq: 4 } },
      { label: 'A fast device: interrupts cost more', values: { bytes: 16, unit: 4, device: 1, cmd: 1, copy: 0.5, irq: 4 } },
      { label: 'A 512-byte sector', values: { bytes: 512, unit: 4, device: 2, cmd: 0.5, copy: 0.3, irq: 3 } },
    ],
    [{ at: (f) => f.meta.phase === 'cmd' && f.meta.unit === 0, once: true, pick: 'option', ask: 'While the device works on unit 0, what does the CPU do?', options: ['runs other processes', 'reads the status register', 'copies the data'], answer: 'runs other processes', explain: (fr, i) => fr[i + 1].say }],
    [
      { q: 'What saves the CPU time with interrupts?', options: ['it no longer waits while the device works', 'interrupts are free', 'the device copies the data itself', 'the bus is faster'], answer: 0, why: 'The waiting time goes to other processes; the CPU returns only when the device calls.' },
      { q: 'Why can interrupts be slower than polling for a very fast device?', options: ['each interrupt costs more than the few polls it replaces', 'interrupts are lost', 'the device must wait for the CPU', 'polling uses DMA'], answer: 0, why: 'Saving state and dispatching the handler has a fixed cost per unit.' },
      { q: 'A 64-byte transfer in 4-byte units with interrupt-driven I/O takes how many interrupts?', options: ['16', '1', '4', '64'], answer: 0, why: 'One interrupt for each of the 64 / 4 = 16 units.' },
      { q: 'What does the interrupt handler do here?', options: ['copies the unit into memory and starts the next', 'polls the status register', 'schedules the disk arm', 'nothing'], answer: 0, why: 'The CPU still moves every byte itself; only the waiting is gone.' },
    ]);

  mk('dma', 30, 'io-dma', 'DMA: the data goes straight to memory',
    'For a large transfer even one interrupt a unit is too many. The CPU programs a DMA controller with an address and a count, and the controller moves each unit from the device into memory itself, borrowing the bus for a moment each time. One interrupt says the whole block is done.',
    [
      { label: 'A small transfer', values: { bytes: 16, unit: 4, device: 10, cmd: 1, dmaSetup: 5, dmaBlock: 0, bus: 0.2, irq: 4 } },
      { label: 'A 512-byte sector', values: { bytes: 512, unit: 4, device: 2, cmd: 0.5, dmaSetup: 5, dmaBlock: 0, bus: 0.2, irq: 3 } },
      { label: 'Blocks of 16 bytes: an interrupt each', values: { bytes: 64, unit: 4, device: 4, cmd: 1, dmaSetup: 3, dmaBlock: 16, bus: 0.2, irq: 4 } },
      { label: 'A 4 KiB page', values: { bytes: 4096, unit: 64, device: 3, cmd: 0.5, dmaSetup: 6, dmaBlock: 0, bus: 0.5, irq: 3 } },
    ],
    [{ at: (f) => f.meta.phase === 'setup' && f.meta.block === 0, once: true, pick: 'option', ask: 'How many interrupts will this whole transfer raise?', options: (fr) => { const m = fr[0].meta; return [...new Set([m.totals.interrupts, m.units, 1, 0])].sort((x, y) => x - y).map(String); }, answer: (fr) => String(fr[0].meta.totals.interrupts), explain: 'One interrupt for each DMA block, however many units it holds.' }],
    [
      { q: 'What does the CPU tell the DMA controller?', options: ['the memory address, the byte count and the direction', 'every byte to copy', 'when to poll', 'the interrupt handler’s code'], answer: 0, why: 'With those the controller can move the whole block by itself.' },
      { q: 'What is cycle stealing?', options: ['the DMA controller using the bus for a moment, delaying the CPU’s own memory access', 'the CPU taking cycles from the device', 'a lost interrupt', 'a cache miss'], answer: 0, why: 'DMA and the CPU share the bus; each DMA transfer borrows a bus cycle.' },
      { q: 'DMA pays off most for…', options: ['large transfers', 'single key presses', 'tiny registers', 'devices without a bus'], answer: 0, why: 'The set-up cost is paid once; it is worth it when many units follow.' },
      { q: 'With DMA, how many times does the CPU copy each byte?', options: ['never: the controller writes memory', 'once', 'twice', 'once per poll'], answer: 0, why: 'The data goes from the device to memory without passing through the CPU.' },
    ]);
})(globalThis.Proses = globalThis.Proses || {});
