// Part 13, I/O systems: the exercises of chapter 1 (registers, polling, interrupts and DMA) and the first of chapter 2
// (buffering). Every number in a text, an answer or a hint is worked out here by the engine (S.IO): nothing is typed
// from memory.
(function (S) {
  'use strict';
  const C = S.Content, IO = S.IO;
  if (!C || !IO || C.exercises.has('ios-x-handshake')) return;
  const fx = (v, d) => { const p = Math.pow(10, d === undefined ? 3 : d); return String(Math.round(v * p) / p); };
  const list = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);

  // =========================================================================================================
  // Chapter 1: registers
  // =========================================================================================================
  const MSG = 'HELLO', hs = [...MSG].map((ch) => IO.handshake(ch.charCodeAt(0)));
  // the engine counts each byte's accesses (cpuReads, cpuWrites); the steps name the registers in order
  const statusReg = hs[0].steps[0].reg, cpuSteps = hs.map((h) => h.steps.filter((st) => st.who === 'cpu'));
  const reads = hs.reduce((n, h) => n + h.cpuReads, 0), writes = hs.reduce((n, h) => n + h.cpuWrites, 0);
  const allSteps = hs.reduce((n, h) => n + h.steps.length, 0);
  const perRead = hs[0].cpuReads, wregs = cpuSteps[0].filter((x) => x.op === 'write').map((x) => x.reg);
  C.exercise({ id: 'ios-x-handshake', chapter: 'ios-hw', title: 'Five bytes through the registers', level: 1, kind: 'number',
    text: ['The CPU sends the five bytes `' + MSG + '` to a printer controller, one handshake for each byte. For every byte it reads ' + statusReg + ' to see that DONE is 1 (the controller is free), loads the byte into TX, sets GO in CMD; once the controller has sent it, it polls ' + statusReg + ' and finds DONE again, then clears GO. With this quick controller every byte is done by the first poll. How many register accesses does the CPU make in all?'],
    answer: reads + writes,
    whyNot: { [String(writes)]: 'That counts only the writes; the reads of ' + statusReg + ' are register accesses too.', [String(MSG.length)]: 'That is one access a byte; each byte needs the whole handshake.', [String(allSteps)]: 'That counts the controller\'s own steps too. Count only what the CPU does: its reads of ' + statusReg + ' and its writes.', '*': 'Count the accesses for one byte, then multiply by the bytes.' },
    hints: ['For one byte: ' + perRead + ' reads of ' + statusReg + ' (DONE before, DONE after), and ' + wregs.length + ' writes: ' + wregs.join(', ') + ' (load the byte, set GO, clear GO).', 'One byte is ' + cpuSteps[0].length + ' accesses by the CPU: ' + cpuSteps[0].map((s) => s.reg).join(', ') + '. The controller\'s own steps are not the CPU\'s accesses.', MSG.length + ' × ' + cpuSteps[0].length + ' = ' + (reads + writes) + ' accesses: ' + reads + ' reads of ' + statusReg + ' and ' + writes + ' writes.'],
    solution: reads + writes, wrong: [writes, MSG.length, allSteps] });

  C.exercise({ id: 'ios-x-regs', chapter: 'ios-hw', title: 'Which register?', level: 1, kind: 'choice',
    text: ['In the printer handshake, which register does the CPU write to tell the controller that a byte is waiting to be sent?'],
    options: ['STAT (its DONE bit)', 'CMD (its GO bit)', 'TX', 'none: the controller watches the bus'],
    answer: 1, whyNot: { 0: 'STAT is written by the controller, to say whether it is done (DONE) or has failed (FAULT). The CPU only reads it.', 2: 'TX holds the byte itself; loading it does not start anything.', 3: 'The controller acts only when it is told to: through a register the CPU writes.' },
    hints: ['One register says what the controller is doing; another says what the CPU wants done.', 'The CPU loads the byte first, then sets a bit that means "send what is in TX".', 'CMD, its GO bit: the controller sees GO, drops DONE in STAT, and sends the byte. The CPU clears GO afterwards.'],
    solution: 1, wrong: [0, 2] });

  // =========================================================================================================
  // Chapter 1: polling, interrupts, DMA
  // =========================================================================================================
  const O = { bytes: 24, unit: 4, device: 8, cmd: 1, poll: 0.5, copy: 0.5, irq: 3, dmaSetup: 4, dmaBlock: 0, bus: 0.2 };
  const T = { polling: IO.transfer('polling', O).totals, interrupt: IO.transfer('interrupt', O).totals, dma: IO.transfer('dma', O).totals };
  const units = O.bytes / O.unit;
  const oText = 'A device delivers ' + O.bytes + ' bytes in units of ' + O.unit + ' through its data register, taking ' + O.device + ' µs to produce each unit. Writing a command to the controller (setting GO in CMD) takes the CPU ' + O.cmd + ' µs, one read of the status register STAT ' + O.poll + ' µs, and copying a unit from the data register to memory ' + O.copy + ' µs. An interrupt costs ' + O.irq + ' µs to enter, dispatch and return; programming the DMA controller costs ' + O.dmaSetup + ' µs.';
  const pollPer = T.polling.polls / units;
  C.exercise({ id: 'ios-x-poll-reads', chapter: 'ios-hw', title: 'Counting the status reads', level: 2, kind: 'number',
    text: [oText, 'The CPU moves the data by polling: for each unit it writes the command, reads STAT until a read that begins after the device has finished shows DONE, then copies the unit. How many status reads does it make in all?'],
    answer: T.polling.polls,
    whyNot: { [String(units * (O.device / O.poll))]: 'Close: the reads start after the command and go on until one begins after the device finished, so there is one more than device time / poll time for each unit.', [String(pollPer)]: 'That is for one unit; there are ' + units + '.', '*': 'For one unit: the device is busy ' + O.device + ' µs after the command; count the 0.5 µs reads until one begins at or after it finishes.' },
    hints: ['There are ' + units + ' units, each handled the same way.', 'After the command the device works ' + O.device + ' µs. Reads of ' + O.poll + ' µs begin at 0, 0.5, 1 … µs after the command; the first to begin at ' + O.device + ' µs or later sees ready.', pollPer + ' reads a unit × ' + units + ' units = ' + T.polling.polls + '. The CPU is busy all ' + T.polling.cpuBusy + ' µs.'],
    solution: T.polling.polls, wrong: [units * (O.device / O.poll), pollPer] });

  const irqPer = O.cmd + O.irq + O.copy;
  C.exercise({ id: 'ios-x-irq-busy', chapter: 'ios-hw', title: 'The CPU\'s share with interrupts', level: 2, kind: 'number',
    text: [oText, 'This time the transfer is interrupt-driven: the CPU writes the first command and goes off to other work; when a unit is ready the device interrupts, and the handler copies the unit and writes the next command. How many µs of CPU time does the transfer cost in all?'],
    answer: T.interrupt.cpuBusy,
    whyNot: { [String(T.interrupt.time)]: 'That is when the transfer ends; the CPU is free while the device works.', [String(units * O.irq)]: 'That counts only the interrupts; each unit also needs its command and its copy.', '*': 'Per unit: one command, one interrupt, one copy.' },
    hints: ['While the device works the CPU runs other processes: that time does not count.', 'Each unit costs ' + O.cmd + ' (command) + ' + O.irq + ' (interrupt) + ' + O.copy + ' (copy) = ' + irqPer + ' µs.', units + ' × ' + irqPer + ' = ' + T.interrupt.cpuBusy + ' µs, ' + Math.round(T.interrupt.cpuShare * 100) + '% of the ' + T.interrupt.time + ' µs the transfer takes.'],
    solution: T.interrupt.cpuBusy, wrong: [T.interrupt.time, units * O.irq] });

  C.exercise({ id: 'ios-x-dma-busy', chapter: 'ios-hw', title: 'The CPU\'s share with DMA', level: 2, kind: 'number',
    text: [oText, 'This time a DMA controller moves the whole ' + O.bytes + ' bytes: the CPU programs it, writes one command to the device, and hears nothing more until a single interrupt at the end. Cycle stealing on the bus does not count as CPU time. How many µs of CPU time does the transfer cost?'],
    answer: T.dma.cpuBusy,
    whyNot: { [String(T.dma.cpuBusy + units * O.copy)]: 'The DMA controller does the copying, not the CPU.', [String(O.dmaSetup + O.cmd)]: 'The final interrupt costs the CPU too.', '*': 'Add the set-up, the command and one interrupt.' },
    hints: ['The CPU does three things: program the DMA controller, start the device, take the final interrupt.', 'No copies, no per-unit interrupts: the DMA controller moves every unit itself.', O.dmaSetup + ' + ' + O.cmd + ' + ' + O.irq + ' = ' + T.dma.cpuBusy + ' µs, against ' + T.interrupt.cpuBusy + ' with interrupts and ' + T.polling.cpuBusy + ' with polling.'],
    solution: T.dma.cpuBusy, wrong: [T.dma.cpuBusy + units * O.copy, O.dmaSetup + O.cmd] });

  const OB = Object.assign({}, O, { dmaBlock: 8 }), TB = IO.transfer('dma', OB).totals;
  C.exercise({ id: 'ios-x-dma-blocks', chapter: 'ios-hw', title: 'DMA in blocks', level: 2, kind: 'number',
    text: [oText, 'The DMA controller can only be programmed for 8 bytes at a time, so the CPU programs it once for each 8-byte block and takes one interrupt at the end of each block. How many µs of CPU time does the transfer cost now?'],
    answer: TB.cpuBusy,
    whyNot: { [String(T.dma.cpuBusy)]: 'That is one block for all ' + O.bytes + ' bytes; here there are ' + O.bytes / 8 + ' blocks.', [String(TB.interrupts * O.irq)]: 'That counts only the interrupts; each block is also programmed and started.', '*': 'Count the blocks, then the CPU\'s work for each.' },
    hints: [O.bytes + ' bytes in blocks of 8: ' + O.bytes / 8 + ' blocks.', 'Each block costs a DMA set-up (' + O.dmaSetup + '), a command (' + O.cmd + ') and an interrupt (' + O.irq + ').', TB.interrupts + ' blocks × ' + (O.dmaSetup + O.cmd + O.irq) + ' = ' + TB.cpuBusy + ' µs, with ' + TB.interrupts + ' interrupts.'],
    solution: TB.cpuBusy, wrong: [T.dma.cpuBusy, TB.interrupts * O.irq] });

  const MODES = [['polling', 'polling'], ['interrupts', 'interrupt'], ['DMA', 'dma']], xcols = ['CPU busy (µs)', 'done at (µs)'];
  const xval = (m, c) => (c === xcols[0] ? T[m].cpuBusy : T[m].time);
  const xcells = (f) => Object.fromEntries(MODES.flatMap(([r, m]) => xcols.map((c) => [r + '|' + c, f(m, c)])));
  C.exercise({ id: 'ios-x-xfer-table', chapter: 'ios-hw', title: 'Three transfers side by side', level: 3, kind: 'table',
    text: [oText, 'For each method, how many µs is the CPU busy with the transfer, and at what time (from the first instruction at t = 0) is the last unit in memory and the CPU told? Under DMA, the DMA controller takes the bus for 0.2 µs to write each unit as soon as the device has it, and the device fills the units one after another; the single interrupt comes after the last one is written.'],
    rows: MODES.map((m) => m[0]), cols: xcols, corner: 'method', cells: xcells(xval), cellKind: 'number', tolerance: 0.01,
    hints: ['Polling keeps the CPU busy the whole time. With interrupts, each unit adds a command, an interrupt and a copy on top of the device\'s ' + O.device + ' µs.', 'With DMA the device starts at ' + (O.dmaSetup + O.cmd) + ' µs and fills ' + units + ' units back to back; the last bus write and the interrupt follow.', MODES.map(([r, m]) => r + ': busy ' + T[m].cpuBusy + ', done at ' + T[m].time).join('; ') + '.'],
    solution: xcells(xval),
    wrong: [xcells((m, c) => (m === 'interrupt' && c === xcols[1] ? T.interrupt.time - units * O.irq : xval(m, c))), xcells((m, c) => (m === 'dma' && c === xcols[0] ? T.dma.cpuBusy + units * O.irq : xval(m, c)))] });

  C.exercise({ id: 'ios-x-which', chapter: 'ios-hw', title: 'The right method', level: 1, kind: 'choice',
    text: ['A keyboard delivers a byte now and then, a few a second. A disk delivers 4 KiB blocks, thousands a second. Which pairing of method to device makes most sense?'],
    options: ['Keyboard by interrupts; disk by DMA', 'Keyboard by polling; disk by interrupts for every byte', 'Both by polling', 'Keyboard by DMA; disk by polling'],
    answer: 0, whyNot: { 1: 'Polling a keyboard wastes the CPU between keystrokes, and an interrupt per byte of a disk would swamp it.', 2: 'Polling would keep the CPU busy waiting on both.', 3: 'Setting up DMA for single bytes costs more than it saves, and polling a disk wastes the CPU through every seek.' },
    hints: ['Ask how long each device keeps the CPU waiting, and how many bytes each event brings.', 'Rare single bytes: let the device call the CPU. Large blocks: let something else move the bytes.', 'Interrupts for the keyboard, DMA for the disk: one interrupt per block, not per byte.'],
    solution: 0, wrong: [1, 2] });

  const DEV = [1, 2, 3, 5];
  const cmp = DEV.map((d) => ({ d, c: IO.compare(Object.assign({}, O, { device: d })) }));
  const cheaper = cmp.filter((x) => x.c.interrupt.cpuBusy < x.c.polling.cpuBusy).map((x) => x.d);
  C.exercise({ id: 'ios-x-crossover', chapter: 'ios-hw', title: 'When do interrupts pay?', level: 3, kind: 'set',
    text: [oText, 'Now imagine faster devices. For which of the device times ' + list(DEV.map((d) => d + ' µs')) + ' a unit does interrupt-driven I/O cost the CPU less time than polling? Answer as a set of the device times, like {1, 2}.'],
    answer: '{' + cheaper.join(', ') + '}',
    hints: ['With interrupts the CPU\'s cost does not depend on the device\'s speed: ' + units + ' × ' + irqPer + ' = ' + cmp[0].c.interrupt.cpuBusy + ' µs.', 'With polling the CPU is busy for the whole transfer, which grows with the device time.', cmp.map((x) => x.d + ' µs: polling ' + x.c.polling.cpuBusy + ', interrupts ' + x.c.interrupt.cpuBusy).join('; ') + '. Interrupts are cheaper for {' + cheaper.join(', ') + '}.'],
    solution: '{' + cheaper.join(', ') + '}', wrong: ['{' + DEV.join(', ') + '}', '{5}'],
    whyNot: 'Compare polling\'s whole transfer time with interrupts\' fixed ' + cmp[0].c.interrupt.cpuBusy + ' µs for each device time.' });

  // =========================================================================================================
  // Chapter 2: buffering
  // =========================================================================================================
  const BO = { blocks: 5, fill: 8, move: 1, compute: 5, slots: 3 };
  const B = Object.fromEntries(['none', 'single', 'double'].map((k) => [k, IO.buffering(k, BO)]));
  const bText = 'A program reads ' + BO.blocks + ' blocks from a device and computes on each. The device takes T = ' + BO.fill + ' to read a block, the program takes C = ' + BO.compute + ' to compute on one, and M = ' + BO.move + ' to move a block out of a kernel buffer into its own space.';
  C.exercise({ id: 'ios-x-buf-none', chapter: 'ios-kernel', title: 'No buffer at all', level: 1, kind: 'number',
    text: [bText, 'With no buffer the device reads each block straight into the program, which waits, and the device waits while the program computes (no move is needed). How long do the ' + BO.blocks + ' blocks take?'],
    answer: B.none.total,
    whyNot: { [String(BO.blocks * BO.fill)]: 'That counts only the device; the program\'s computing does not overlap it.', [String(BO.blocks * (BO.fill + BO.compute + BO.move))]: 'With no buffer there is nothing to move out: M is not paid.', '*': 'Each block costs T + C, one after the other.' },
    hints: ['Nothing overlaps: the device reads a block, then the program computes on it.', 'Each block costs T + C = ' + (BO.fill + BO.compute) + '.', BO.blocks + ' × ' + (BO.fill + BO.compute) + ' = ' + B.none.total + '.'],
    solution: B.none.total, wrong: [BO.blocks * BO.fill, BO.blocks * (BO.fill + BO.compute + BO.move)] });

  const sSay = B.single.steps.filter((s) => /^Block \d/.test(s.say || '')).map((s) => s.say);
  C.exercise({ id: 'ios-x-buf-single', chapter: 'ios-kernel', title: 'One kernel buffer', level: 2, kind: 'number',
    text: [bText, 'Now the kernel has one buffer. The device fills it while the program computes on the previous block; the program moves each block out of the buffer (M) before computing on it, and the device can refill the buffer only once it has been emptied. How long do the ' + BO.blocks + ' blocks take?'],
    answer: B.single.total,
    whyNot: { [String(B.none.total)]: 'That is with no buffer; the device now reads ahead while the program computes.', [String(B.double.total)]: 'That is double buffering: with one buffer the device must wait for each move.', '*': 'Follow block by block: when the buffer is filled, moved out, and computed on.' },
    hints: ['The first block: the device fills the buffer from 0 to ' + BO.fill + ', the program moves it out (' + BO.move + ') and computes (' + BO.compute + ').', 'The device starts the next block as soon as the buffer is emptied. In the steady state a block costs max(T, C) + M = ' + B.single.perBlock + '.', sSay.length ? sSay[sSay.length - 1] + ' In all ' + B.single.total + '.' : 'In all ' + B.single.total + '.'],
    solution: B.single.total, wrong: [B.none.total, B.double.total] });

  C.exercise({ id: 'ios-x-buf-double', chapter: 'ios-kernel', title: 'Two buffers', level: 2, kind: 'number',
    text: [bText, 'Now the kernel has two buffers: the device fills one while the program moves and computes on the other, and moves on to the next free buffer at once. How long do the ' + BO.blocks + ' blocks take?'],
    answer: B.double.total,
    whyNot: { [String(B.single.total)]: 'That is a single buffer: with two, the device never waits for a move.', '*': 'The steady state costs max(T, C + M) a block; add the start and the end.' },
    hints: ['The device can read block k + 1 while the program works on block k.', 'Here T = ' + BO.fill + ' and C + M = ' + (BO.compute + BO.move) + ', so the device sets the pace: a block every ' + B.double.perBlock + '.', 'The device finishes the last block at ' + BO.blocks + ' × ' + BO.fill + ' = ' + BO.blocks * BO.fill + '; the program then moves it and computes: ' + B.double.total + '.'],
    solution: B.double.total, wrong: [B.single.total, BO.blocks * BO.fill] });

  C.exercise({ id: 'ios-x-buf-formula', chapter: 'ios-kernel', title: 'The steady state', level: 1, kind: 'choice',
    text: ['With double buffering, in the steady state, what does each block cost? (T: the device reads a block; C: the program computes on it; M: moving it out of the buffer.)'],
    options: ['T + C + M', 'max(T, C) + M', 'max(T, C + M)', 'T'],
    answer: 2, whyNot: { 0: 'That is with nothing overlapping at all.', 1: 'That is a single buffer: the device waits while the program moves the block out.', 3: 'Only when the device is the slower side.' },
    hints: ['Two things run at once: the device filling one buffer, and the program moving and computing on the other.', 'The slower of the two sets the pace.', 'max(T, C + M): with T = 10, C = 6, M = 2 that is 10 a block.'],
    solution: 2, wrong: [0, 1] });
})(globalThis.Proses = globalThis.Proses || {});
