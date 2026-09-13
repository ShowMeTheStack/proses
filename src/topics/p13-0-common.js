// Part 13, I/O systems: the families, and what its topics share (S.T13): the machine drawn as boxes on a bus (the
// CPU, memory, a DMA controller and a device controller with its registers, and the interrupt line), and the
// classes for each kind of CPU, bus and device time.
(function (S) {
  'use strict';
  const fam = (id, order, title, blurb) => S.family({ id, part: 'io', order, title, blurb });
  fam('p13-hw', 10, 'Buses, devices and registers', 'The CPU, memory and device controllers joined by a bus; a controller’s status, control and data registers; and the handshake that moves one byte through them.');
  fam('p13-xfer', 20, 'Polling, interrupts and DMA', 'Three ways to move data from a device, each drawn as a timeline of the CPU, the bus and the device: who is busy, who waits, and what the CPU gets back.');
  fam('p13-modes', 30, 'Blocking, non-blocking and asynchronous I/O', 'What a program’s read does while the device works: sleep until the data is in, return at once and try again, or ask to be told when it is done.');
  fam('p13-kernel', 40, 'The kernel I/O subsystem', 'What the kernel puts between programs and devices: buffers that let the two run at once, a cache of blocks, a spool for the printer, and a request queue that merges and orders disk requests.');
  fam('p13-read', 50, 'The life of a read', 'One read() followed from the program through the C library, the system call, the file system, the block layer and the driver to the disk, and back by the interrupt.');

  const T = (S.T13 = S.T13 || {});
  const R = Math.round;

  /** the short names of the eight steps of S.IO.handshake (TX, CMD's GO bit, STAT's DONE and FAULT bits), for a step list */
  T.SEND_STEPS = ['CPU reads STAT: DONE = 1', 'CPU loads the byte into TX', 'CPU sets GO in CMD', 'controller drops DONE', 'controller sends TX to the device', 'controller raises DONE', 'CPU polls STAT: DONE = 1', 'CPU clears GO'];
  /** the class of each kind of CPU, bus or device time on a timeline */
  T.KCLS = { cmd: 'io-cmd', poll: 'io-poll', copy: 'io-copy', irq: 'io-irq', setup: 'io-setup', free: 'io-free', busy: 'io-busy', status: 'io-status', data: 'io-data', dma: 'io-dma' };
  T.KNAME = { cmd: 'command', poll: 'polling', copy: 'copy', irq: 'interrupt', setup: 'DMA set-up', free: 'free for others', busy: 'device busy', status: 'status read', data: 'data', dma: 'DMA write' };

  /**
   * the machine: T13.system({prefix, x, y, w, dma: bool, dev: 'disk controller', lit: {cpu, mem, dma, dev, bus,
   * irq, reg: 'status'|'control'|'data'}, regText: {status, control, data}}) -> {items, h, at: {cpu, mem, dma, dev}}
   */
  T.system = function (o) {
    const t = S.T12, P = o.prefix, items = [], lit = o.lit || {}, y = o.y, bh = 62, busY = y + bh + 46;
    const boxes = [['cpu', 'CPU', 130], ['mem', 'memory', 130]];
    if (o.dma) boxes.push(['dma', 'DMA controller', 150]);
    const devW = o.w - boxes.reduce((n, b) => n + b[2], 0) - boxes.length * 34;
    boxes.push(['dev', o.dev || 'device controller', devW]);
    let x = o.x;
    const at = {};
    for (const [id, label, w] of boxes) {
      at[id] = { x, w, cx: x + w / 2 };
      const isDev = id === 'dev';
      items.push({ key: P + ':' + id, kind: 'cell', x: R(x), y: R(y), w: R(w), h: bh, rx: 8, text: isDev ? '' : label, size: 15, cls: 'sys' + (lit[id] ? ' lit' : '') });
      if (isDev) {
        items.push(t.text(P + ':devname', x + 12, y + 20, label, 'strong', 14));
        const regs = ['status', 'control', 'data'], rw = (w - 24 - 2 * 8) / 3;
        regs.forEach((r, i) => items.push({ key: P + ':r' + r, kind: 'cell', x: R(x + 12 + i * (rw + 8)), y: R(y + 30), w: R(rw), h: 24, rx: 4, text: (o.regText && o.regText[r]) || r, size: 13, cls: 'reg' + (lit.reg === r ? ' lit' : '') }));
      }
      items.push({ key: P + ':d' + id, kind: 'line', x1: R(x + w / 2), y1: R(y + bh), x2: R(x + w / 2), y2: R(busY), cls: 'drop13' + (lit[id] && lit.bus ? ' lit' : ''), audit: 'ignore' });
      x += w + 34;
    }
    items.push({ key: P + ':bus', kind: 'line', x1: R(o.x), y1: R(busY), x2: R(o.x + o.w), y2: R(busY), cls: 'bus13' + (lit.bus ? ' lit' : ''), audit: 'ignore', layer: 'back' });
    items.push(t.text(P + ':busl', o.x + at.mem.w + 34 + 6, busY + 24, 'bus', 'tick', 13));
    // the interrupt line, from the device controller back to the CPU, above the boxes
    const iy = y - 16;
    items.push({ key: P + ':irq', kind: 'path', d: `M${R(at.dev.x + at.dev.w - 30)},${R(y)} V${iy} H${R(at.cpu.cx)} V${R(y)}`, cls: 'irq13' + (lit.irq ? ' lit' : ''), audit: 'ignore', layer: 'back' });
    items.push(t.text(P + ':irql', at.cpu.x + at.cpu.w + 60, iy - 8, 'interrupt line', 'irq13 tick' + (lit.irq ? ' lit' : ''), 13));
    return { items, h: busY + 30 - (iy - 26), top: iy - 26, at, busY };
  };
})(globalThis.Proses = globalThis.Proses || {});
