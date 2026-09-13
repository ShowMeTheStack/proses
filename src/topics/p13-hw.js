// Part 13, buses, devices and registers: the machine as a bus with the CPU, memory and several device controllers
// on it, one byte sent to a device through its controller's registers, and the registers themselves drawn bit by
// bit as a short message goes out byte after byte. The register model (TX, CMD with GO, STAT with DONE and FAULT)
// and its steps come straight from the engine's handshake (S.IO.handshake, src/core/io-a-transfer.js).
(function (S) {
  'use strict';
  const R = Math.round;
  const DEVS = { printer: 'printer', serial: 'serial line', disk: 'disk' };
  const hex = (v) => '0x' + v.toString(16).padStart(2, '0');
  const show = (c) => (c === ' ' ? '␣' : c);
  const IDLE = { GO: 0, DONE: 1, FAULT: 0, TX: null };

  // =================================================================================================================
  S.topic({
    id: 'io-bus', family: 'p13-hw', order: 10, title: 'The bus, the controllers and a byte sent out',
    blurb: 'The CPU does not drive a printer or a disk directly. Each device has a controller on the bus, and the controller has a few registers the CPU can read and write. Here: TX for the outgoing byte, CMD with a GO bit to start a send, and STAT with a DONE bit and a FAULT bit. Sending one byte is a short exchange through them.',
    inputs: [
      { id: 'device', kind: 'choice', label: 'device', def: 'printer', options: Object.keys(DEVS).map((k) => ({ value: k, label: DEVS[k] })) },
      { id: 'ch', kind: 'string', label: 'the byte (a character)', def: 'A', min: 1, max: 1, alphabet: ' !#$%&()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_abcdefghijklmnopqrstuvwxyz{|}~' },
    ],
    presets: [
      { label: 'A letter to the printer', values: { device: 'printer', ch: 'A' } },
      { label: 'A digit down a serial line', values: { device: 'serial', ch: '7' } },
      { label: 'A byte to the disk controller', values: { device: 'disk', ch: 'z' } },
    ],
    counters: [{ id: 'cpu', label: 'CPU register accesses' }],
    run(inp) {
      const t = S.T12, X = S.IO.handshake(inp.ch.charCodeAt(0)), v = X.byte, F = new S.Frames(['cpu']);
      const order = Object.keys(DEVS).filter((k) => k !== inp.device).concat([inp.device]);
      const busY = 150, cy = 196, base = { v, hexv: X.hex, steps: X.steps.length };
      const pic = (k) => {
        const s = k >= 0 ? X.steps[k] : null, rg = s ? s.regs : IDLE, items = [];
        const cpu = s && s.who === 'cpu', ctl = s && s.who === 'ctl';
        items.push(t.cell('ib:cpu', 0, 40, 140, 62, 'CPU', 'sys' + (cpu ? ' lit' : ''), 15));
        items.push(t.cell('ib:mem', 180, 40, 140, 62, 'memory', 'sys', 15));
        items.push(t.text('ib:note', 360, 66, 'one bus: addresses, data and control lines', 'tick', 13));
        items.push(t.text('ib:note2', 360, 88, 'every controller listens for its own addresses', 'tick', 13));
        items.push({ key: 'ib:bus', kind: 'line', x1: 0, y1: busY, x2: 800, y2: busY, cls: 'bus13' + (cpu ? ' lit' : ''), audit: 'ignore', layer: 'back' });
        items.push({ key: 'ib:dcpu', kind: 'line', x1: 70, y1: 102, x2: 70, y2: busY, cls: 'drop13' + (cpu ? ' lit' : ''), audit: 'ignore' });
        items.push({ key: 'ib:dmem', kind: 'line', x1: 250, y1: 102, x2: 250, y2: busY, cls: 'drop13', audit: 'ignore' });
        let x = 0;
        order.forEach((d) => {
          const main = d === inp.device, w = main ? 390 : 180, P = 'ib:' + d;
          items.push({ key: P + ':drop', kind: 'line', x1: R(x + w / 2), y1: busY, x2: R(x + w / 2), y2: cy, cls: 'drop13' + (main && cpu ? ' lit' : ''), audit: 'ignore' });
          items.push(t.cell(P + ':box', x, cy, w, main ? 96 : 62, '', 'sys' + (main && s ? ' lit' : ''), 14));
          items.push(t.text(P + ':name', x + 12, cy + 22, DEVS[d] + ' controller', 'strong', 14));
          if (main) {
            const ws = [158, 96, 104], names = ['STAT', 'CMD', 'TX'];
            const vals = [`DONE ${rg.DONE} · FAULT ${rg.FAULT}`, `GO ${rg.GO}`, rg.TX === null ? '—' : hex(rg.TX)];
            let rx = x + 12;
            names.forEach((n, j) => {
              const on = s && s.reg === n;
              items.push(t.text(P + ':rn' + j, rx + 4, cy + 46, n, 'tick', 12));
              items.push({ key: P + ':r' + j, kind: 'cell', x: R(rx), y: cy + 54, w: ws[j], h: 28, rx: 4, text: vals[j], size: 13, cls: 'reg' + (on ? (ctl ? ' dev' : ' lit') : '') });
              rx += ws[j] + 8;
            });
          } else {
            items.push(t.text(P + ':idle', x + 12, cy + 46, 'its own registers', 'tick', 12));
          }
          const dy = cy + (main ? 96 : 62) + 40, toDev = main && s && s.reg === 'device';
          items.push({ key: P + ':cable', kind: 'line', x1: R(x + w / 2), y1: cy + (main ? 96 : 62), x2: R(x + w / 2), y2: dy, cls: 'drop13' + (toDev ? ' lit' : ''), audit: 'ignore' });
          items.push(t.cell(P + ':dev', x + (w - 130) / 2, dy, 130, 44, DEVS[d], 'sys' + (toDev ? ' lit' : ''), 14));
          x += w + 25;
        });
        if (s && (s.reg === 'TX' || s.reg === 'device')) items.push({ key: 'ib:chip', kind: 'chip', x: s.reg === 'TX' ? 205 : 715, y: s.reg === 'TX' ? busY - 18 : cy + 116, text: X.hex + ' ‘' + show(inp.ch) + '’', cls: 'act', audit: 'on-wire' });
        return items;
      };
      F.add({ items: pic(-1), title: 'the machine', say: `The CPU and memory share one bus with the controllers of a ${DEVS[inp.device]} and two other devices. To send the byte ${X.hex} (‘${show(inp.ch)}’) to the ${DEVS[inp.device]}, the CPU only reads and writes that controller’s registers.`, meta: Object.assign({ phase: 'start' }, base) });
      let n = 0;
      X.steps.forEach((s, k) => {
        if (s.who === 'cpu') n++;
        F.set('cpu', n);
        F.add({ items: pic(k), title: (s.who === 'cpu' ? 'CPU: ' : 'controller: ') + s.reg, say: s.say, meta: Object.assign({ phase: 'step', k, who: s.who, reg: s.reg, regs: s.regs, cpuN: n }, base) });
      });
      F.add({ items: pic(X.steps.length - 1), title: 'done', say: `One byte took ${t.plural(n, 'register access', 'register accesses')} by the CPU (${X.cpuReads} reads of STAT, ${X.cpuWrites} writes) and ${X.ctlActs} actions by the controller. A device that sends many bytes repeats this for each one, which is why the CPU wants help: interrupts, and DMA.`, meta: Object.assign({ phase: 'done', cpuN: n, ctlN: X.ctlActs, reads: X.cpuReads, writes: X.cpuWrites }, base) });
      return { frames: F.list, def: { sections: [{ id: 'f', kind: 'math', title: 'This controller’s registers', text: ['TX    the byte to send, written by the CPU', 'CMD   GO = 1: send TX now (set and cleared by the CPU)', 'STAT  DONE = 1: idle, the last send finished', '      FAULT = 1: the device refused the byte', 'reached by port instructions or by', 'memory-mapped addresses on the bus'].join('\n') }, { id: 't', kind: 'text', text: 'Next: [[io-registers]] follows the bits as a whole message goes out, and [[io-polling]] times the waiting.' }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'step' && f.meta.k === 0, pick: 'option', ask: 'The controller is idle. What does the CPU do next?', options: ['load the byte into TX', 'set GO in CMD', 'clear DONE in STAT'], answer: 'load the byte into TX', explain: 'The byte must be in TX before GO tells the controller to send it.' },
      { at: (f) => f.meta.phase === 'step' && f.meta.k === 2, pick: 'option', ask: 'Who changes DONE now?', options: ['the controller', 'the CPU', 'the device driver’s timer'], answer: 'the controller', explain: 'The controller owns STAT: it drops DONE when it starts the send and raises it when the send is over.' },
    ],
    quiz: [
      { q: 'In this controller, which register tells the CPU the last send has finished?', options: ['STAT, through its DONE bit', 'CMD', 'TX', 'none: the CPU must wait a fixed time'], answer: 0, why: 'The controller raises DONE in STAT when the device has taken the byte.' },
      { q: 'How does the CPU start a send?', options: ['it sets GO in CMD once the byte is in TX', 'it raises an interrupt to the controller', 'it writes the byte to memory', 'it clears FAULT'], answer: 0, why: 'GO is the bit the controller watches for.' },
      { q: 'Memory-mapped I/O means…', options: ['device registers answer to addresses, so ordinary loads and stores reach them', 'devices store their data in RAM', 'the disk is used as memory', 'every device has its own bus'], answer: 0, why: 'The controller listens for its range of addresses on the bus.' },
      { q: 'Why does the CPU talk to a controller and not to the device itself?', options: ['the controller hides the device’s electrical details behind a few registers', 'the device has no power', 'the bus is too slow', 'only the controller has a clock'], answer: 0, why: 'A small register interface lets one driver drive many devices of a kind.' },
    ],
  });

  // =================================================================================================================
  S.topic({
    id: 'io-registers', family: 'p13-hw', order: 20, title: 'Device registers, bit by bit',
    blurb: 'Inside a controller the registers are just bits: DONE and FAULT in STAT, GO in CMD, eight data bits in TX. Send a short message and watch the bits change as each byte is loaded, sent and checked.',
    inputs: [{ id: 'msg', kind: 'string', label: 'message', def: 'Hi!', min: 1, max: 8, spaces: true }],
    check: (inp) => ([...inp.msg].some((c) => c.charCodeAt(0) > 126 || c.charCodeAt(0) < 32) ? 'message: plain ASCII characters only' : null),
    presets: [
      { label: 'Hi!', values: { msg: 'Hi!' } },
      { label: 'One byte', values: { msg: 'x' } },
      { label: 'OK 200', values: { msg: 'OK 200' } },
      { label: 'Eight bytes', values: { msg: 'GO 4 IT!' } },
    ],
    counters: [{ id: 'bytes', label: 'bytes sent' }, { id: 'reads', label: 'STAT reads' }, { id: 'writes', label: 'register writes' }],
    run(inp) {
      const t = S.T12, F = new S.Frames(['bytes', 'reads', 'writes']), chars = [...inp.msg], SH = S.T13.SEND_STEPS;
      let reads = 0, writes = 0, prev = null;
      const pic = (st, s, c, nSent, kOf) => {
        const items = [];
        const row = (key, y, name, bits, lit) => {
          items.push({ key: key + ':n', kind: 'cell', x: 0, y, w: 110, h: 34, rx: 4, text: name, size: 13, cls: 'rname' });
          bits.forEach((b, j) => {
            items.push(t.text(key + ':h' + j, 130 + j * 70 + 31, y - 8, b.name, 'tick', 12, 'middle'));
            items.push({ key: key + ':b' + j, kind: 'cell', x: 130 + j * 70, y, w: 62, h: 34, rx: 4, text: String(b.v), size: 15, cls: 'rb' + (b.v ? ' one' : '') + (lit ? ' lit' : '') });
          });
        };
        const on = (r) => s && s.reg === r && s.op !== 'read';
        items.push(t.title('ir:t', 0, 16, 'the controller’s registers'));
        row('ir:st', 50, 'STAT', [{ name: 'DONE', v: st.DONE }, { name: 'FAULT', v: st.FAULT }], on('STAT'));
        row('ir:ct', 120, 'CMD', [{ name: 'GO', v: st.GO }], on('CMD'));
        const d = st.TX === null ? 0 : st.TX;
        row('ir:tx', 190, 'TX', [7, 6, 5, 4, 3, 2, 1, 0].map((i) => ({ name: 't' + i, v: (d >> i) & 1 })), on('TX'));
        items.push(t.text('ir:dv', 130 + 8 * 70 + 6, 212, st.TX === null ? '' : hex(st.TX), 'mono', 14));
        if (s) items.push(t.text('ir:who', 0, 262, s.who === 'cpu' ? 'the CPU acts' : 'the controller acts', 'strong ' + (s.who === 'cpu' ? 'act-t' : ''), 14));
        items.push(t.title('ir:mt', 0, 312, 'the message'));
        chars.forEach((ch, i) => items.push({ key: 'ir:m' + i, kind: 'cell', x: i * 86, y: 326, w: 78, h: 44, rx: 5, lines: ['‘' + show(ch) + '’', hex(ch.charCodeAt(0))], size: 13, cls: 'op13' + (i < nSent ? ' done' : i === c ? ' act' : '') }));
        items.push(t.title('ir:sl', 0, 408, 'sending one byte'));
        SH.forEach((x, j) => items.push({ key: 'ir:s' + j, kind: 'cell', x: (j < 4 ? 0 : 400), y: 422 + (j % 4) * 34, w: 380, h: 28, rx: 4, text: (j + 1) + '. ' + x, size: 13, align: 'left', cls: 'op13' + (s && kOf === j ? ' act' : s && kOf > j ? ' done' : '') }));
        return items;
      };
      F.add({ items: pic(IDLE, null, -1, 0), title: 'the registers', say: `To send “${inp.msg}”, ${t.plural(chars.length, 'byte')}, the CPU goes through the same exchange once for each byte. STAT says what the controller is doing; CMD says what the CPU wants; TX holds the byte.`, meta: { phase: 'start', n: chars.length } });
      chars.forEach((ch, c) => {
        const X = S.IO.handshake(ch.charCodeAt(0), prev || IDLE), v = X.byte, bin = v.toString(2).padStart(8, '0');
        if (c === 0) {
          X.steps.forEach((s, k) => {
            if (s.who === 'cpu' && s.op === 'read') reads++;
            if (s.who === 'cpu' && s.op === 'write') writes++;
            if (k === X.steps.length - 1) F.set('bytes', 1);
            F.set('reads', reads).set('writes', writes);
            const bits = s.reg === 'TX' ? ` In binary ${X.hex} is ${bin}.` : '';
            F.add({ items: pic(s.regs, s, 0, k === X.steps.length - 1 ? 1 : 0, k), title: 'byte 0: ' + s.reg, say: s.say + bits, meta: { phase: 'step', c, k, v, bin, reads, writes, regs: s.regs } });
          });
        } else {
          reads += X.cpuReads; writes += X.cpuWrites;
          F.set('bytes', c + 1).set('reads', reads).set('writes', writes);
          F.add({ items: pic(X.steps[X.steps.length - 1].regs, X.steps[1], c, c + 1, 99), title: 'byte ' + c, say: `Byte ${c}, ‘${show(ch)}’ = ${X.hex} = ${bin} in binary, goes through the same ${X.steps.length} steps: ${t.plural(X.cpuReads, 'read')} of STAT and ${t.plural(X.cpuWrites, 'register write')} by the CPU. Totals so far: ${reads} reads, ${writes} writes.`, meta: { phase: 'byte', c, v, bin, r: X.cpuReads, w: X.cpuWrites, reads, writes, nsteps: X.steps.length } });
        }
        prev = X.steps[X.steps.length - 1].regs;
      });
      F.add({ items: pic(prev, null, -1, chars.length), title: 'sent', say: `All ${t.plural(chars.length, 'byte')} sent: ${reads} reads of STAT and ${writes} register writes by the CPU, here with every byte done by the first poll. A slow device would need many more polls for each byte: [[io-polling]] times them.`, meta: { phase: 'done', reads, writes, n: chars.length } });
      return { frames: F.list, def: { sections: [{ id: 'f', kind: 'math', title: 'Sending one byte', text: SH.map((x, j) => (j + 1) + '. ' + x).concat(['the CPU polls STAT in step 7 until DONE = 1', 'FAULT = 1 there would mean: send it again']).join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'step' && f.meta.k === 0, pick: 'option', ask: 'Which TX bits will be 1 once the byte is loaded?', options: (fr, i) => { const b = fr[i].meta.bin; const flip = b.split('').map((x) => (x === '1' ? '0' : '1')).join(''); return [b, flip, '11111111'].filter((x, k, a) => a.indexOf(x) === k); }, answer: (fr, i) => fr[i].meta.bin, explain: 'The byte’s binary form, most significant bit first.' },
      { at: (f) => f.meta.phase === 'step' && f.meta.k === 4, pick: 'option', ask: 'When the device has taken the byte, DONE will be…', options: ['1', '0'], answer: '1', explain: 'Raising DONE is how the controller says the send is over and it can take the next byte.' },
    ],
    quiz: [
      { q: 'The byte 0x41 in TX has which bits set?', options: ['t6 and t0', 't4 and t1', 't7 only', 'all of them'], answer: 0, why: '0x41 = 0100 0001 in binary: bits 6 and 0.' },
      { q: 'What must the CPU see before it loads a new byte into TX?', options: ['DONE = 1 in STAT', 'FAULT = 1', 'GO = 1', 'an empty memory'], answer: 0, why: 'Loading TX while a send is under way would replace a byte the controller is still sending.' },
      { q: 'Why does the CPU clear GO after the send?', options: ['so the controller does not send the same byte again', 'to clear FAULT', 'to empty TX', 'it does not need to'], answer: 0, why: 'GO left at 1 would read as a request for another send.' },
      { q: 'A message of 5 bytes needs how many GO commands?', options: ['5', '1', '8', '40'], answer: 0, why: 'One send, and so one GO, for each byte that goes through TX.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
