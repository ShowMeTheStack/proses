// The Storage lab, part five: the I/O workbench, three views from S.IO.
//   xfer   the same transfer by polling, by interrupts and by DMA: the CPU, the device and the bus on one time axis,
//          frame by frame, and the CPU's share compared at the end
//   modes  one read by a process A beside a CPU-bound B: blocking, non-blocking and asynchronous, with A, B, the CPU
//          and the device on one time axis
//   read   the life of one read(): the layers from the program to the disk and back, the process's state, and the
//          time spent in each layer (S.IO.lifeOfRead, the disk's time from the disk model)
//   SL.ioCheck(v) -> 'why not' | null      SL.ioRun(v, ctx) -> the lab's result
(function (S) {
  'use strict';
  const SL = S.StoLab;
  const IO = () => S.IO;
  const fix = (x, d) => SL.fix(x, d === undefined ? 2 : d);

  SL.ioXferOpts = (v) => ({ bytes: v.xBytes, unit: v.xUnit, device: v.xDevice, cmd: v.xCmd, poll: v.xPoll, copy: v.xCopy, irq: v.xIrq, dmaSetup: v.xDmaSetup, dmaBlock: v.xDmaBlock, bus: v.xBus });
  SL.ioModeOpts = (v) => ({ device: v.mDevice, work: v.mWork, use: v.mUse, other: v.mOther, syscall: v.mSyscall, copy: v.mCopy, slice: v.mSlice, notify: v.mNotify, irq: v.mIrq });
  /** the file blocks a read covers, and its options for S.IO.lifeOfRead */
  SL.ioReadOpts = function (v) {
    const bs = v.rdBlock, first = Math.floor(v.rdOffset / bs), last = Math.floor((v.rdOffset + v.rdBytes - 1) / bs);
    const blocks = [], cached = [];
    for (let b = 0; b <= last; b++) {
      const i = b - first;
      blocks.push(i >= 0 && i < v.rdDisk.length ? v.rdDisk[i] : i >= 0 ? v.rdDisk[v.rdDisk.length - 1] + (i - v.rdDisk.length + 1) : 5000 + b);
      cached.push(i >= 0 && i < v.rdCached.length ? /^hit$/i.test(v.rdCached[i]) : false);
    }
    return { file: 'notes.txt', fd: 3, bytes: v.rdBytes, offset: v.rdOffset, blockSize: bs, blocks, cached, n: last - first + 1, first };
  };

  SL.ioCheck = function (v) {
    if (SL.KS_VIEWS && SL.KS_VIEWS.includes(v.ioView)) return SL.ksCheck(v);
    if (v.ioView === 'xfer') {
      const units = Math.ceil(v.xBytes / v.xUnit);
      if (units > 64) return 'The transfer: ' + units + ' units of ' + v.xUnit + ' bytes; at most 64, so each one can be drawn (move fewer bytes or more a unit)';
      if (v.xDmaBlock && v.xDmaBlock < v.xUnit) return 'DMA block: at least one unit (' + v.xUnit + ' bytes), or 0 for all at once';
    }
    if (v.ioView === 'read') {
      const o = SL.ioReadOpts(v);
      if (o.n > 16) return 'The read covers ' + o.n + ' blocks; at most 16 here (read fewer bytes or use larger blocks)';
    }
    return null;
  };

  /** a step's sentence with the method named once: "Polling, unit 0: …", "DMA moves …" */
  SL.ioWho = (name, say) => (say.startsWith(name) || say.startsWith(name.split(' ')[0]) ? say : /^Unit /.test(say) ? name + ', u' + say.slice(1) : name + ': ' + say);
  const XCLS = { cmd: 'io-cmd', poll: 'io-poll', copy: 'io-copy', irq: 'io-irq', setup: 'io-setup', free: 'io-free', busy: 'io-busy', status: 'io-status', data: 'io-data', dma: 'io-dma' };
  const XWORD = { cmd: 'cmd', poll: 'poll', copy: 'copy', irq: 'irq', setup: 'setup', free: 'free', busy: 'unit', status: '', data: '', dma: '' };
  /** frame times: every step's time, thinned to at most n, and the end */
  const times = (list, end, n) => {
    let ts = [...new Set(list.filter((t) => t > 0 && t < end).map((t) => SL.r3(t)))].sort((a, b) => a - b);
    if (ts.length > n) { const out = []; for (let k = 1; k <= n; k++) out.push(ts[Math.floor((k * ts.length) / (n + 1))]); ts = [...new Set(out)]; }
    return ts.concat([end]);
  };

  function xferRun(v, ctx) {
    const narrow = ctx.narrow, W = narrow ? 370 : 960, o = SL.ioXferOpts(v);
    const runs = ['polling', 'interrupt', 'dma'].map((m) => IO().transfer(m, o));
    const T = Math.max(...runs.map((r) => r.totals.time));
    const ts = times(runs.flatMap((r) => r.steps.map((s) => s.t)), T, 10);
    const blockH = 3 * 32 + 64, frames = [], trace = [];
    runs.forEach((r) => r.steps.forEach((s) => trace.push({ kind: r.mode + '-' + s.kind, t: s.t, say: SL.ioWho(r.name, s.say) })));
    trace.sort((a, b) => a.t - b.t);
    ts.forEach((t, k) => {
      const fin = k === ts.length - 1, items = [];
      runs.forEach((r, i) => {
        const y = i * blockH;
        items.push(SL.text('x' + i + ':nm', 0, y + 14, r.name, 'strong', 15));
        const tt = r.totals, upto = Math.min(t, tt.time);
        items.push(SL.text('x' + i + ':st', W, y + 14, t >= tt.time ? 'done at ' + fix(tt.time) + ' µs · CPU busy ' + Math.round(tt.cpuShare * 100) + '%' : 't = ' + fix(t) + ' µs', t >= tt.time ? 'act-t' : 'tick', 13, 'end'));
        const seg = (lane) => (r.lanes[lane] || []).map((s) => ({ from: s.from, to: s.to, cls: XCLS[s.kind] || '', text: s.kind === 'poll' ? s.polls + ' polls' : XWORD[s.kind] }));
        const L = SL.lanes({ prefix: 'x' + i, x: 0, y: y + 26, w: W, labelW: narrow ? 58 : 76, t1: T, rows: [{ label: 'CPU', segs: seg('cpu') }, { label: 'device', segs: seg('device') }, { label: 'bus', segs: seg('bus') }], rowH: 26, gap: 6, upTo: upto, now: fin ? null : t, unit: 'µs', size: 13 });
        items.push(...L.items);
      });
      const ly = 3 * blockH + 4;
      items.push(...SL.legend('xl', 0, ly, [['io-cmd', 'command'], ['io-poll', 'polling the status'], ['io-copy', 'copying'], ['io-irq', 'interrupt'], ['io-setup', 'DMA set-up'], ['io-free', 'CPU free'], ['io-busy', 'device working'], ['io-dma', 'DMA on the bus']].map(([c, tx]) => ({ cls: 'tl ' + c, text: tx })), W, 12).items);
      const now = trace.filter((s) => s.t > (k ? ts[k - 1] : -1) && s.t <= t);
      const say = fin
        ? 'All three move ' + SL.plural(v.xBytes, 'byte') + ' in ' + Math.ceil(v.xBytes / v.xUnit) + ' units. ' + runs.map((r) => r.name + ': ' + fix(r.totals.time) + ' µs, the CPU busy ' + fix(r.totals.cpuBusy) + ' µs (' + Math.round(r.totals.cpuShare * 100) + '%)' + (r.totals.polls ? ', ' + r.totals.polls + ' polls' : '') + (r.totals.interrupts ? ', ' + SL.plural(r.totals.interrupts, 'interrupt') : '')).join('; ') + '.'
        : now.length ? now.map((s) => s.say).join(' ') : 'At t = ' + fix(t) + ' µs the three transfers are under way.';
      frames.push({ items, say, title: fin ? 'totals' : 't = ' + fix(t), at: Math.max(0, trace.findIndex((s) => s.t >= t)), hold: 1500 });
    });
    const tables = [{ title: 'The three ways compared', cols: ['', 'time µs', 'CPU busy µs', 'CPU free µs', 'CPU share', 'interrupts', 'polls', 'bus busy µs'], rows: runs.map((r) => [r.name, fix(r.totals.time), fix(r.totals.cpuBusy), fix(r.totals.cpuFree), Math.round(r.totals.cpuShare * 100) + '%', String(r.totals.interrupts), String(r.totals.polls), fix(r.totals.busBusy)]) }];
    const best = runs.slice().sort((a, b) => a.totals.cpuBusy - b.totals.cpuBusy)[0];
    const metrics = runs.map((r) => ({ label: r.name + ': CPU busy', value: fix(r.totals.cpuBusy), unit: 'µs', note: 'of ' + fix(r.totals.time) + ' µs', cls: r === best ? 'good' : '' }));
    return { frames, trace, tables, metrics };
  }

  const PCLS = { user: 'ps-user', kernel: 'ps-kernel', blocked: 'ps-blocked', ready: 'ps-ready' };
  const CCLS = { A: 'ps-user', B: 'ps-B', irq: 'io-irq', idle: 'ps-idle' };
  function modesRun(v, ctx) {
    const narrow = ctx.narrow, W = narrow ? 370 : 960, md = IO().modes(SL.ioModeOpts(v));
    const runs = ['blocking', 'nonblocking', 'async'].map((k) => md[k]);
    const T = Math.max(...runs.map((r) => r.end));
    const ts = times(runs.flatMap((r) => r.steps.map((s) => s.t)), T, 10);
    const blockH = 4 * 30 + 64, frames = [], trace = [];
    runs.forEach((r) => r.steps.forEach((s) => trace.push({ kind: r.kind + '-' + s.kind, t: s.t, say: SL.ioWho(r.name, s.say.replace(/^t = [\d.]+: /, 'at t = ' + fix(s.t) + ', ')) })));
    trace.sort((a, b) => a.t - b.t);
    ts.forEach((t, k) => {
      const fin = k === ts.length - 1, items = [];
      runs.forEach((r, i) => {
        const y = i * blockH;
        items.push(SL.text('m' + i + ':nm', 0, y + 14, r.name, 'strong', 15));
        items.push(SL.text('m' + i + ':st', W, y + 14, t >= r.finishA ? 'A done at ' + fix(r.finishA) + ' µs · ' + SL.plural(r.syscalls, 'system call') : 't = ' + fix(t) + ' µs', t >= r.finishA ? 'act-t' : 'tick', 13, 'end'));
        const ps = (lane) => r.lanes[lane].filter((s) => s.state !== 'done').map((s) => ({ from: s.from, to: s.to, cls: lane === 'B' && s.state === 'user' ? 'ps-B' : PCLS[s.state] || '', text: s.label || '' }));
        const L = SL.lanes({ prefix: 'm' + i, x: 0, y: y + 26, w: W, labelW: narrow ? 58 : 76, t1: T, rows: [{ label: 'A', segs: ps('A') }, { label: 'B', segs: ps('B') }, { label: 'CPU', segs: r.lanes.cpu.map((s) => ({ from: s.from, to: s.to, cls: CCLS[s.who] || '', text: s.who === 'idle' ? 'idle' : s.who })) }, { label: 'device', segs: r.lanes.device.map((s) => ({ from: s.from, to: s.to, cls: 'io-busy', text: 'reading' })) }], rowH: 24, gap: 6, upTo: t, now: fin ? null : t, unit: 'µs', size: 13 });
        items.push(...L.items);
      });
      items.push(...SL.legend('ml', 0, 3 * blockH + 4, [['ps-user', 'A running its code'], ['ps-kernel', 'A in the kernel'], ['ps-blocked', 'blocked'], ['ps-ready', 'ready, waiting for the CPU'], ['ps-B', 'B computing'], ['io-irq', 'interrupt'], ['io-busy', 'device busy']].map(([c, tx]) => ({ cls: 'tl ' + c, text: tx })), W, 12).items);
      const now = trace.filter((s) => s.t > (k ? ts[k - 1] : -1) && s.t <= t);
      const say = fin
        ? runs.map((r) => r.name + ': A finishes at ' + fix(r.finishA) + ' µs and B at ' + fix(r.finishB) + ' µs, with ' + SL.plural(r.syscalls, 'system call') + (r.retries ? ' (' + SL.plural(r.retries, 'retry', 'retries') + ')' : '') + ' and ' + fix(r.cpu.A) + ' µs of CPU for A').join('; ') + '.'
        : now.length ? now.map((s) => s.say).join(' ') : 'At t = ' + fix(t) + ' µs.';
      frames.push({ items, say, title: fin ? 'totals' : 't = ' + fix(t), at: Math.max(0, trace.findIndex((s) => s.t >= t)), hold: 1500 });
    });
    const tables = [{ title: 'One read, three ways', cols: ['', 'A done µs', 'B done µs', 'CPU for A', 'CPU for B', 'interrupts µs', 'idle µs', 'system calls', 'retries'], rows: runs.map((r) => [r.name, fix(r.finishA), fix(r.finishB), fix(r.cpu.A), fix(r.cpu.B), fix(r.cpu.irq), fix(r.cpu.idle), String(r.syscalls), String(r.retries)]) }];
    const metrics = runs.map((r) => ({ label: r.name + ': A done', value: fix(r.finishA), unit: 'µs', note: 'B done at ' + fix(r.finishB) + ' µs' }));
    return { frames, trace, tables, metrics };
  }

  function readRun(v, ctx) {
    const narrow = ctx.narrow, W = narrow ? 370 : 960, o = SL.ioReadOpts(v);
    const r = IO().lifeOfRead({ file: o.file, fd: o.fd, bytes: o.bytes, offset: o.offset, blockSize: o.blockSize, blocks: o.blocks, cached: o.cached });
    const layers = IO().layers, frames = [], trace = r.steps.map((s) => ({ kind: s.layer, t: s.t, say: s.say }));
    const lw = narrow ? 170 : 220, lh = 34, lg = 6, sx = narrow ? 190 : 270;
    const dtSoft = r.steps.filter((s) => s.mode !== 'device').reduce((a, s) => a + s.dt, 0), dtDev = r.steps.filter((s) => s.mode === 'device').reduce((a, s) => a + s.dt, 0);
    r.steps.forEach((s, k) => {
      const items = [], seen = new Set(r.steps.slice(0, k).map((x) => x.layer));
      layers.forEach((L, i) => {
        const y = i * (lh + lg);
        items.push(SL.cell('ly:' + L.id, 0, y, lw, lh, L.name, 'ly ' + L.mode + (L.id === s.layer ? ' act' : seen.has(L.id) ? ' seen' : ''), 14));
      });
      const li = layers.findIndex((L) => L.id === s.layer);
      items.push({ key: 'req', kind: 'token', x: lw + 16, y: li * (lh + lg) + lh / 2, r: 9, text: '', cls: 'req13' });
      const stH = layers.length * (lh + lg) - lg;
      // the process's state and the clock
      items.push(SL.cell('ps', sx, 0, narrow ? 180 : 200, 34, 'process: ' + s.proc, 'pstate ' + s.proc, 14));
      items.push(SL.text('clk', narrow ? sx : sx + 230, narrow ? 60 : 22, 't = ' + fix(s.t + s.dt, 3) + ' µs', 'act-t', 14));
      // the steps so far, with the time each took
      const shown = narrow ? 0 : 10, from = Math.max(0, k + 1 - shown);
      if (!narrow) r.steps.slice(from, k + 1).forEach((x, j) => {
        const y = 54 + j * 26, L = layers.find((q) => q.id === x.layer);
        items.push(SL.text('sl' + (from + j), sx, y + 14, L.name, x === s ? 'strong' : 'tick', 13));
        items.push(SL.text('sd' + (from + j), sx + 190, y + 14, fix(x.dt, 3) + ' µs', x === s ? 'act-t' : 'tick', 13));
        items.push(SL.text('sm' + (from + j), sx + 290, y + 14, x.mode === 'device' ? 'device' : x.mode + ' mode', 'tick', 12));
      });
      // the narration of this layer, in the panel
      const py = narrow ? stH + 20 : 54 + Math.min(k + 1, shown) * 26 + 14;
      const p = SL.para('sy', narrow ? 0 : sx, py, s.say, narrow ? W : W - sx, 13, '');
      items.push(...p.items);
      // software against device time so far
      const by = narrow ? py + p.h + 20 : stH - 46, bw = narrow ? W : W - sx;
      const soft = r.steps.slice(0, k + 1).filter((x) => x.mode !== 'device').reduce((a, x) => a + x.dt, 0), dev = r.steps.slice(0, k + 1).filter((x) => x.mode === 'device').reduce((a, x) => a + x.dt, 0);
      items.push(SL.text('bt', narrow ? 0 : sx, by - 8, 'so far: ' + fix(soft, 3) + ' µs in software, ' + fix(dev, 3) + ' µs on the device', 'tick', 12));
      items.push(SL.cell('btr', narrow ? 0 : sx, by, bw, 18, '', 'tl-track', 12));
      const tot = Math.max(1e-9, dtSoft + dtDev);
      items.push(...SL.stack({ prefix: 'bs', x: narrow ? 0 : sx, y: by, h: 18, scale: bw / tot, parts: [{ v: soft, cls: 'ps-kernel' }, { v: dev, cls: 'io-busy' }] }).items);
      frames.push({ items, say: s.say, title: layers[li].name, at: k, hold: 1400 });
    });
    const tables = [{ title: 'The read, layer by layer', cols: ['#', 'layer', 'mode', 'process', 'starts µs', 'takes µs'], rows: r.steps.map((s, i) => [String(i + 1), layers.find((L) => L.id === s.layer).name, s.mode, s.proc, fix(s.t, 3), fix(s.dt, 3)]) },
      { title: 'File blocks', cols: ['file block', 'disk block', 'page cache'], rows: Array.from({ length: o.n }, (_, i) => [String(o.first + i), String(o.blocks[o.first + i]), o.cached[o.first + i] ? 'hit' : { text: 'miss', cls: 'bad' }]) }];
    const metrics = [{ label: 'The read took', value: fix(r.total, 3), unit: 'µs' }, { label: 'On the disk', value: fix(r.diskMs, 3), unit: 'ms', note: fix((100 * dtDev) / Math.max(1e-9, dtDev + dtSoft), 1) + '% of the time' }, { label: 'Blocks', value: r.blocks.length, note: SL.plural(r.misses.length, 'miss', 'misses') + ' in the page cache' }];
    return { frames, trace, tables, metrics, result: r };
  }

  SL.ioRun = function (v, ctx) {
    if (SL.KS_VIEWS && SL.KS_VIEWS.includes(v.ioView)) return SL.ksRun(v, ctx);
    if (v.ioView === 'modes') return modesRun(v, ctx);
    if (v.ioView === 'read') return readRun(v, ctx);
    return xferRun(v, ctx);
  };
})(globalThis.Proses = globalThis.Proses || {});
