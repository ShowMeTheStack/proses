// I/O systems, part 1: moving N bytes from a device by polling, by interrupts and by DMA, as timelines of the CPU,
// the device and the bus; and one byte sent to a device through its controller's registers.
//   S.IO.transfer(mode: 'polling'|'interrupt'|'dma', o) -> {mode, name, lanes: {cpu, device, bus}, totals, steps,
//       truncated}
//     o (times in µs): bytes (N), unit (bytes a device transfer moves through the data register), device (device time
//     per unit), cmd (CPU time to write a command), poll (one status-register read), copy (CPU time to move one unit
//     between the data register and memory), irq (interrupt entry, dispatch and return), dmaSetup (CPU time to
//     program the DMA controller), dmaBlock (bytes per DMA transfer; one interrupt each), bus (bus time per unit).
//     polling    for each unit: write the command, read the status register again and again until the device is
//                ready (a poll sees ready if the device finished before it began), then copy the unit. The CPU is
//                busy throughout.
//     interrupt  write the command and go and do other work; the device interrupts when the unit is ready, and the
//                handler copies it and starts the next one.
//     dma        the CPU programs the DMA controller per block; the device fills units one after another and the
//                controller writes each to memory over the bus (cycle stealing); one interrupt per block.
//     lanes: cpu [{from, to, kind: cmd|poll|copy|irq|setup|free, unit?, polls?}], device [{from, to, kind: busy,
//       unit}], bus [{from, to, kind: status|data|dma, unit}]  (kept to maxSegments, default 3000, per lane)
//     totals: {time, cpuBusy, cpuFree, cpuShare, interrupts, irqTime, polls, busBusy, units}
//   S.IO.compare(o) -> {polling, interrupt, dma}: the three totals side by side
//   S.IO.handshake(byte, start?) -> {byte, hex, steps: [{k, who: 'cpu'|'ctl', reg: 'STAT'|'TX'|'CMD'|'device',
//       op: 'read'|'write'|'act', regs: {GO, DONE, FAULT, TX} after the step, say}], cpuReads, cpuWrites, ctlActs}
//     One byte sent through a controller's registers: TX (the data byte), CMD (the GO bit) and STAT (DONE, FAULT).
//     The CPU reads STAT (DONE is 1), loads TX and sets GO; the controller drops DONE, sends TX to the device and
//     raises DONE; the CPU polls STAT, finds DONE, and clears GO. 2 reads and 3 writes a byte. start: the registers
//     before the byte (default GO 0, DONE 1, FAULT 0, TX null).
(function (S) {
  'use strict';
  const pl = (n, w, ws) => n + ' ' + (n === 1 ? w : ws || w + 's');
  const IO = (S.IO = S.IO || {});
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const NAMES = { polling: 'Polling', interrupt: 'Interrupt-driven I/O', dma: 'DMA' };
  IO.transferModes = Object.keys(NAMES);
  IO.defaults = { bytes: 64, unit: 4, device: 10, cmd: 1, poll: 0.5, copy: 0.5, irq: 4, dmaSetup: 5, dmaBlock: 0, bus: 0.2, maxSegments: 3000 };

  IO.transfer = function (mode, o) {
    if (!NAMES[mode]) throw new Error('unknown transfer mode ' + mode);
    const a = Object.assign({}, IO.defaults, o || {});
    const units = Math.ceil(a.bytes / a.unit), lanes = { cpu: [], device: [], bus: [] }, steps = [];
    let truncated = false, cpuBusy = 0, busBusy = 0, irqs = 0, irqTime = 0, polls = 0;
    const seg = (lane, from, to, kind, extra) => {
      if (to <= from) return;
      if (lane === 'cpu' && kind !== 'free') cpuBusy += to - from;
      if (lane === 'bus') busBusy += to - from;
      const L = lanes[lane], last = L[L.length - 1];
      if (last && last.kind === kind && near(last.to, from) && kind === 'free') { last.to = r3(to); return; }
      if (L.length >= a.maxSegments) { truncated = true; return; }
      L.push(Object.assign({ from: r3(from), to: r3(to), kind }, extra || {}));
    };
    const near = (x, y) => Math.abs(x - y) < 1e-9;
    let t = 0;
    if (mode === 'polling') {
      for (let u = 0; u < units; u++) {
        seg('cpu', t, t + a.cmd, 'cmd', { unit: u }); t += a.cmd;
        const done = t + a.device; seg('device', t, done, 'busy', { unit: u });
        const n = Math.max(1, Math.ceil((done - t) / a.poll - 1e-9) + 1);
        seg('cpu', t, t + n * a.poll, 'poll', { unit: u, polls: n }); seg('bus', t, t + n * a.poll, 'status', { unit: u, polls: n });
        if (u < 2) steps.push({ kind: 'poll', t: r3(t), unit: u, polls: n, say: `Unit ${u}: the CPU writes the command at t = ${r3(t - a.cmd)} and reads the status register ${pl(n, 'time')}, ${r3(n * a.poll)} µs of busy waiting, until the device is ready at ${r3(done)}.` });
        polls += n; t += n * a.poll;
        seg('cpu', t, t + a.copy, 'copy', { unit: u }); seg('bus', t, t + a.copy, 'data', { unit: u }); t += a.copy;
      }
    } else if (mode === 'interrupt') {
      seg('cpu', 0, a.cmd, 'cmd', { unit: 0 }); t = a.cmd;
      for (let u = 0; u < units; u++) {
        const done = t + a.device;
        seg('device', t, done, 'busy', { unit: u }); seg('cpu', t, done, 'free');
        seg('cpu', done, done + a.irq, 'irq', { unit: u }); irqs++; irqTime += a.irq;
        seg('cpu', done + a.irq, done + a.irq + a.copy, 'copy', { unit: u }); seg('bus', done + a.irq, done + a.irq + a.copy, 'data', { unit: u });
        t = done + a.irq + a.copy;
        if (u + 1 < units) { seg('cpu', t, t + a.cmd, 'cmd', { unit: u + 1 }); t += a.cmd; }
        if (u < 2) steps.push({ kind: 'interrupt', t: r3(done), unit: u, say: `Unit ${u}: the device works for ${a.device} µs while the CPU is free; at t = ${r3(done)} it interrupts, and the handler spends ${a.irq} µs entering and leaving plus ${a.copy} µs copying${u + 1 < units ? ' and ' + a.cmd + ' µs starting the next unit' : ''}.` });
      }
    } else {
      const per = Math.max(1, Math.ceil((a.dmaBlock || a.bytes) / a.unit));
      for (let u0 = 0; u0 < units; u0 += per) {
        const n = Math.min(per, units - u0);
        seg('cpu', t, t + a.dmaSetup, 'setup', { unit: u0 }); t += a.dmaSetup;
        seg('cpu', t, t + a.cmd, 'cmd', { unit: u0 }); t += a.cmd;
        const st = t;
        for (let u = u0; u < u0 + n; u++) { seg('device', t, t + a.device, 'busy', { unit: u }); seg('bus', t + a.device, t + a.device + a.bus, 'dma', { unit: u }); t += a.device; }
        t += a.bus;
        seg('cpu', st, t, 'free');
        seg('cpu', t, t + a.irq, 'irq', { unit: u0 + n - 1 }); irqs++; irqTime += a.irq;
        steps.push({ kind: 'dma-block', t: r3(t), from: u0, units: n, say: `DMA moves ${n === 1 ? 'unit ' + u0 : 'units ' + u0 + ' to ' + (u0 + n - 1)} (${pl(Math.min(n * a.unit, a.bytes - u0 * a.unit), 'byte')}) straight into memory, stealing ${a.bus} µs of bus per unit; the CPU is free for ${r3(t - st)} µs and takes one interrupt at t = ${r3(t)}.` });
        t += a.irq;
      }
    }
    const time = t, cpuFree = time - cpuBusy;
    const totals = { time: r3(time), cpuBusy: r3(cpuBusy), cpuFree: r3(cpuFree), cpuShare: r3(cpuBusy / time), interrupts: irqs, irqTime: r3(irqTime), polls, busBusy: r3(busBusy), units };
    steps.push({ kind: 'done', t: r3(time), say: `${NAMES[mode]} moves ${pl(a.bytes, 'byte')} (${units} unit${units === 1 ? '' : 's'}) in ${r3(time)} µs; the CPU is busy ${r3(cpuBusy)} µs (${Math.round((cpuBusy / time) * 100)}%) and free ${r3(cpuFree)} µs${irqs ? ', with ' + irqs + ' interrupt' + (irqs === 1 ? '' : 's') + ' costing ' + r3(irqTime) + ' µs' : ''}${polls ? ', after ' + pl(polls, 'status poll') : ''}.` });
    return { mode, name: NAMES[mode], lanes, totals, steps, truncated };
  };
  IO.compare = (o) => ({ polling: IO.transfer('polling', o).totals, interrupt: IO.transfer('interrupt', o).totals, dma: IO.transfer('dma', o).totals });

  IO.handshake = function (byte, start) {
    const v = byte === undefined ? 0x41 : byte & 0xff, hx = '0x' + v.toString(16).padStart(2, '0');
    const st = Object.assign({ GO: 0, DONE: 1, FAULT: 0, TX: null }, start || {}), steps = [];
    const put = (who, reg, op, change, say) => { Object.assign(st, change); steps.push({ k: steps.length, who, reg, op, regs: Object.assign({}, st), say }); };
    put('cpu', 'STAT', 'read', {}, 'The CPU reads STAT: DONE is 1, so the controller is idle and the last byte has gone.');
    put('cpu', 'TX', 'write', { TX: v }, `The CPU loads ${hx} into TX.`);
    put('cpu', 'CMD', 'write', { GO: 1 }, 'The CPU sets GO in CMD: send what is in TX.');
    put('ctl', 'STAT', 'act', { DONE: 0 }, 'The controller sees GO and drops DONE to 0: a send is under way.');
    put('ctl', 'device', 'act', {}, `The controller shifts ${hx} out of TX to the device.`);
    put('ctl', 'STAT', 'act', { DONE: 1, FAULT: 0 }, 'The device took the byte without trouble: the controller leaves FAULT at 0 and raises DONE.');
    put('cpu', 'STAT', 'read', {}, 'The CPU polls STAT and finds DONE back at 1, with FAULT 0: the byte is out.');
    put('cpu', 'CMD', 'write', { GO: 0 }, 'The CPU clears GO, so the controller will not send the same byte twice.');
    const cpu = steps.filter((x) => x.who === 'cpu');
    return { byte: v, hex: hx, steps, cpuReads: cpu.filter((x) => x.op === 'read').length, cpuWrites: cpu.filter((x) => x.op === 'write').length, ctlActs: steps.length - cpu.length };
  };
})(globalThis.Proses = globalThis.Proses || {});
