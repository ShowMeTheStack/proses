// I/O systems, part 2: blocking, non-blocking and asynchronous reads as per-process timelines on one CPU.
// Process A reads from a device. It also has `work` µs of computing that does not need the data and `use` µs that
// does. Process B is CPU-bound with `other` µs to do and runs whenever A cannot; A has the higher priority, so it
// takes the CPU back as soon as it can run. The device's completion interrupt costs `irq` µs on the CPU.
//   blocking      read() blocks A until the data is in; the kernel copies it (copy) and A then does work and use.
//   non-blocking  the read with O_NONBLOCK starts the device and returns EAGAIN; A does `slice` µs of work between
//                 retries (each a system call); once the data is there a retry copies it. With its work done and
//                 still no data, A retries back to back: busy waiting.
//   asynchronous  aio_read starts the device and returns at once; A does its work; at completion the kernel copies
//                 the data in the interrupt and A's notification handler (notify) runs; if A finishes its work
//                 first it waits in aio_suspend.
//   S.IO.modes(o) -> {blocking, nonblocking, async}, each S.IO.mode(kind, o)
//   S.IO.mode(kind, o) -> {kind, name, lanes: {A, B, cpu, device}, finishA, finishB, end, cpu: {A, B, irq, idle},
//       syscalls, retries, steps}
//     lanes A and B: [{from, to, state: 'user'|'kernel'|'blocked'|'ready'|'done', label}]; cpu: [{from, to, who:
//     'A'|'B'|'irq'|'idle'}]; device: [{from, to, kind: 'busy'}]
//   o (µs): syscall 2, device 30, copy 3, work 20, use 10, slice 5, notify 2, other 40, irq 1
(function (S) {
  'use strict';
  const IO = (S.IO = S.IO || {});
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const NAMES = { blocking: 'Blocking I/O', nonblocking: 'Non-blocking I/O', async: 'Asynchronous I/O' };
  IO.ioModes = Object.keys(NAMES);
  IO.modeDefaults = { syscall: 2, device: 30, copy: 3, work: 20, use: 10, slice: 5, notify: 2, other: 40, irq: 1 };

  IO.mode = function (kind, o) {
    if (!NAMES[kind]) throw new Error('unknown I/O mode ' + kind);
    const a = Object.assign({}, IO.modeDefaults, o || {});
    const lanes = { A: [], B: [], cpu: [], device: [] }, steps = [];
    const put = (lane, from, to, f, v, label) => {
      if (to - from < 1e-9) return;
      const L = lanes[lane], last = L[L.length - 1];
      if (last && last[f] === v && last.label === label && v !== 'kernel' && !(lane === 'cpu' && /\(\)/.test(label || '')) && Math.abs(last.to - from) < 1e-9) { last.to = r3(to); return; }
      L.push({ from: r3(from), to: r3(to), [f]: v, label });
    };
    let t = 0, devEnd = null, devDone = false, workLeft = a.work, haveData = false, waiting = false, finishA = null, finishB = null, bLeft = a.other;
    let syscalls = 0, retries = 0;
    const q = [];
    const cpu = (mode, dur, label, onEnd) => ({ mode, dur, label, onEnd });
    const startDevice = () => { devEnd = t + a.device; lanes.device.push({ from: r3(t), to: r3(devEnd), kind: 'busy' }); };
    const sys = (label, onEnd) => cpu('kernel', a.syscall, label, () => { syscalls++; onEnd && onEnd(); });
    // A's program for each mode, as a queue refilled when it runs dry
    if (kind === 'blocking') {
      q.push(sys('read()', () => { startDevice(); steps.push({ kind: 'syscall', t: r3(t), say: `t = ${r3(t)}: A calls read(); the driver starts the device and A blocks.` }); }));
      q.push({ wait: true }, cpu('kernel', a.copy, 'copy to user', () => { haveData = true; }));
    } else if (kind === 'nonblocking') {
      q.push(sys('read() → EAGAIN', () => { startDevice(); steps.push({ kind: 'syscall', t: r3(t), say: `t = ${r3(t)}: A calls read() with O_NONBLOCK; the device starts and the call returns EAGAIN at once.` }); }));
    } else {
      q.push(sys('aio_read()', () => { startDevice(); steps.push({ kind: 'syscall', t: r3(t), say: `t = ${r3(t)}: A calls aio_read(); the device starts and A carries on.` }); }));
    }
    const refill = () => {
      if (kind === 'nonblocking' && !haveData) {
        if (workLeft > 0) { const s = Math.min(a.slice, workLeft); q.push(cpu('user', s, 'work', () => { workLeft -= s; })); }
        q.push(sys('read() retry', () => {
          if (devDone) { q.unshift(cpu('kernel', a.copy, 'copy to user', () => { haveData = true; steps.push({ kind: 'copy', t: r3(t), say: `t = ${r3(t)}: a retry finds the data; the kernel copies it to A after ${retries} EAGAIN${retries === 1 ? '' : 's'}.` }); })); }
          else { retries++; if (retries <= 3) steps.push({ kind: 'eagain', t: r3(t), say: `t = ${r3(t)}: A retries; no data yet, EAGAIN (${retries}).${workLeft > 0 ? '' : ' A has nothing else to do: busy waiting.'}` }); }
        }));
        return;
      }
      if (workLeft > 0) { const s = workLeft; q.push(cpu('user', s, 'work', () => { workLeft -= s; })); return; }
      if (kind === 'async' && !haveData) { q.push(sys('aio_suspend()', () => { if (!haveData) steps.push({ kind: 'suspend', t: r3(t), say: `t = ${r3(t)}: A's work is done before the data; it waits in aio_suspend().` }); }), { wait: true }); return; }
      if (!haveData) { q.push({ wait: true }); return; }
      if (a.use > 0 && !q.done) { q.done = true; q.push(cpu('user', a.use, 'use the data')); return; }
      q.push({ end: true });
    };
    let cur = null, guard = 0;
    const nextA = () => { if (!q.length) refill(); cur = q.shift(); if (cur && cur.dur !== undefined && cur.rem === undefined) cur.rem = cur.dur; };
    nextA();
    while (finishA === null || bLeft > 1e-9) {
      if (++guard > 100000) throw new Error('the I/O timeline does not finish');
      if (cur && cur.wait) { if (haveData || (kind === 'blocking' && devDone)) { nextA(); continue; } waiting = true; }
      if (cur && cur.end) { finishA = t; cur = null; steps.push({ kind: 'done-A', t: r3(t), say: `t = ${r3(t)}: A finishes.` }); continue; }
      const evt = devEnd !== null && !devDone ? devEnd : Infinity;
      if (t >= evt - 1e-9) {
        // the completion interrupt runs on whatever had the CPU
        let dur = a.irq;
        if (kind === 'async') dur += a.copy;
        put('cpu', t, t + dur, 'who', 'irq', kind === 'async' ? 'interrupt + copy' : 'interrupt');
        if (finishA === null) put('A', t, t + dur, 'state', waiting ? 'blocked' : 'ready', '');
        if (bLeft > 1e-9) put('B', t, t + dur, 'state', 'ready', '');
        t += dur; devDone = true;
        if (kind === 'async') { haveData = true; q.unshift(cpu('user', a.notify, 'notification handler')); if (cur && cur.dur !== undefined) { q.splice(1, 0, cur); } cur = null; nextA(); }
        steps.push({ kind: 'interrupt', t: r3(t - dur), say: `t = ${r3(t - dur)}: the device interrupts${kind === 'async' ? '; the kernel copies the data into A’s buffer and queues its notification' : kind === 'blocking' ? ' and A is woken' : '; the data waits in the kernel for A’s next retry'}.` });
        if (waiting) { waiting = false; if (cur && cur.wait) nextA(); }
        continue;
      }
      const runA = finishA === null && cur && cur.dur !== undefined && !waiting;
      if (runA) {
        const run = Math.min(cur.rem, evt - t);
        put('A', t, t + run, 'state', cur.mode, cur.label); put('cpu', t, t + run, 'who', 'A', cur.label);
        if (bLeft > 1e-9) put('B', t, t + run, 'state', 'ready', '');
        t += run; cur.rem -= run;
        if (cur.rem <= 1e-9) { const c = cur; cur = null; c.onEnd && c.onEnd(); nextA(); }
        continue;
      }
      const until = evt;
      if (bLeft > 1e-9) {
        const run = Math.min(bLeft, until - t);
        put('B', t, t + run, 'state', 'user', 'compute'); put('cpu', t, t + run, 'who', 'B', 'compute');
        if (finishA === null) put('A', t, t + run, 'state', 'blocked', '');
        t += run; bLeft -= run;
        if (bLeft <= 1e-9) { finishB = t; steps.push({ kind: 'done-B', t: r3(t), say: `t = ${r3(t)}: B finishes its ${a.other} µs of computing.` }); }
        continue;
      }
      if (until === Infinity) throw new Error('A waits for a device that never finishes');
      put('cpu', t, until, 'who', 'idle', ''); if (finishA === null) put('A', t, until, 'state', 'blocked', '');
      t = until;
    }
    if (finishB === null) finishB = 0;
    const sum = (who) => r3(lanes.cpu.filter((s) => s.who === who).reduce((n, s) => n + s.to - s.from, 0));
    const end = Math.max(finishA, finishB);
    const res = { kind, name: NAMES[kind], lanes, finishA: r3(finishA), finishB: r3(finishB), end: r3(end), cpu: { A: sum('A'), B: sum('B'), irq: sum('irq'), idle: sum('idle') }, syscalls, retries, steps };
    steps.push({ kind: 'summary', t: r3(end), say: `${NAMES[kind]}: A finishes at ${r3(finishA)} and B at ${r3(finishB)}; A used ${res.cpu.A} µs of CPU in ${syscalls} system call${syscalls === 1 ? '' : 's'}${retries === 1 ? ' (one of them a fruitless retry)' : retries ? ' (' + retries + ' of them fruitless retries)' : ''}, B ${res.cpu.B} µs, and the CPU sat idle ${res.cpu.idle} µs.` });
    return res;
  };
  IO.modes = (o) => ({ blocking: IO.mode('blocking', o), nonblocking: IO.mode('nonblocking', o), async: IO.mode('async', o) });
})(globalThis.Proses = globalThis.Proses || {});
