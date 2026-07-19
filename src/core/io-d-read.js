// I/O systems, part 4: the life of a read() request, traced through the layers from the program to the disk and back.
//   S.IO.layers -> [{id, name, mode}]  in order, for drawing a layer stack: user, libc, syscall, vfs, cache, fs,
//       block, driver, controller, interrupt, scheduler
//   S.IO.lifeOfRead(o) -> {steps, total, blocks, misses, diskMs, say}
//     o: {file, fd, bytes, offset, blockSize, blocks: [disk block of each file block, by file block number; 5000 + b when missing], cached: bool | [bool per file
//        block], disk: options for S.Storage.disk (the head starts on cylinder 0), cost: {trap, libc, vfs, lookup,
//        fs, block, driver, irq, bottom, wake, sched, copyKiB, ret} in µs}
//     steps: [{kind: 'layer', layer, mode: 'user'|'kernel'|'device', proc: 'running'|'blocked'|'ready', t, dt, say}]
//     Cached blocks are copied straight from the page cache; the misses go down as one request to the block layer
//     (merged when their disk blocks are contiguous), the process sleeps, the disk works (its time from the disk
//     model when present), the controller's interrupt completes the request and wakes the process, which copies
//     the data to the user buffer and returns.
(function (S) {
  'use strict';
  const pl = (n, w, ws) => n + ' ' + (n === 1 ? w : ws || w + 's');
  const IO = (S.IO = S.IO || {});
  const r3 = (v) => Math.round(v * 1000) / 1000;
  IO.layers = [
    { id: 'user', name: 'program', mode: 'user' }, { id: 'libc', name: 'C library', mode: 'user' },
    { id: 'syscall', name: 'system call', mode: 'kernel' }, { id: 'vfs', name: 'VFS', mode: 'kernel' },
    { id: 'cache', name: 'page cache', mode: 'kernel' }, { id: 'fs', name: 'file system', mode: 'kernel' },
    { id: 'block', name: 'block layer', mode: 'kernel' }, { id: 'driver', name: 'device driver', mode: 'kernel' },
    { id: 'controller', name: 'disk controller', mode: 'device' }, { id: 'interrupt', name: 'interrupt handler', mode: 'kernel' },
    { id: 'scheduler', name: 'scheduler', mode: 'kernel' },
  ];
  IO.readCosts = { trap: 0.2, libc: 0.1, vfs: 0.3, lookup: 0.2, fs: 0.8, block: 1, driver: 1.5, irq: 1.5, bottom: 2, wake: 0.5, sched: 2, copyKiB: 0.25, ret: 0.2 };

  IO.lifeOfRead = function (o) {
    const a = Object.assign({ file: 'notes.txt', fd: 3, bytes: 4096, offset: 0, blockSize: 4096, blocks: null, cached: false, disk: null }, o || {});
    const c = Object.assign({}, IO.readCosts, a.cost || {});
    const first = Math.floor(a.offset / a.blockSize), last = Math.floor((a.offset + Math.max(1, a.bytes) - 1) / a.blockSize);
    const fileBlocks = []; for (let b = first; b <= last; b++) fileBlocks.push(b);
    const diskOf = (b) => (a.blocks && a.blocks[b] !== undefined ? a.blocks[b] : 5000 + b);
    const isCached = (b, i) => (Array.isArray(a.cached) ? !!a.cached[i] : !!a.cached);
    const misses = fileBlocks.filter((b, i) => !isCached(b, i)), hits = fileBlocks.filter((b, i) => isCached(b, i));
    const steps = [];
    let t = 0;
    const step = (layer, mode, proc, dt, say, extra) => { steps.push(Object.assign({ kind: 'layer', layer, mode, proc, t: r3(t), dt: r3(dt), say }, extra || {})); t += dt; };
    const kib = (n) => r3(n / 1024);
    step('user', 'user', 'running', 0, `The program calls read(${a.fd}, buf, ${a.bytes}) to read ${pl(a.bytes, 'byte')} of ${a.file} from offset ${a.offset}.`);
    step('libc', 'user', 'running', c.libc, `The C library wrapper puts the system-call number for read and its three arguments in registers and executes the trap instruction.`);
    step('syscall', 'kernel', 'running', c.trap, `The trap switches the CPU to kernel mode; the system-call table sends the call to the kernel's read.`);
    step('vfs', 'kernel', 'running', c.vfs, `VFS looks up descriptor ${a.fd} in the process's table, finds the open-file entry with offset ${a.offset}, and through it the inode of ${a.file}; the range covers file block${fileBlocks.length === 1 ? '' : 's'} ${fileBlocks.join(', ')}.`);
    step('cache', 'kernel', 'running', c.lookup * fileBlocks.length, hits.length === fileBlocks.length ? `Every block is in the page cache: no disk I/O is needed.` : hits.length ? `Block${hits.length === 1 ? '' : 's'} ${hits.join(', ')} ${hits.length === 1 ? 'is' : 'are'} in the page cache; block${misses.length === 1 ? '' : 's'} ${misses.join(', ')} ${misses.length === 1 ? 'is' : 'are'} not.` : `The page cache does not hold block${misses.length === 1 ? '' : 's'} ${misses.join(', ')}: a disk read is needed.`, { hits, misses });
    let diskMs = 0;
    if (misses.length) {
      const dblocks = misses.map(diskOf), contiguous = dblocks.every((d, i) => !i || d === dblocks[i - 1] + 1);
      step('fs', 'kernel', 'running', c.fs, `The file system maps file block${misses.length === 1 ? '' : 's'} ${misses.join(', ')} through the inode to disk block${dblocks.length === 1 ? '' : 's'} ${dblocks.join(', ')}, and allocates page-cache pages to receive ${misses.length === 1 ? 'it' : 'them'}.`, { disk: dblocks });
      step('block', 'kernel', 'running', c.block, `The block layer builds ${contiguous || dblocks.length === 1 ? 'one request' : dblocks.length + ' requests'} for ${pl(dblocks.length * (a.blockSize / 512), 'sector')}${contiguous && dblocks.length > 1 ? ' (contiguous blocks merge into one)' : ''} and queues it for the I/O scheduler.`);
      step('driver', 'kernel', 'running', c.driver, `The driver takes the request, sets up a DMA descriptor pointing at the cache pages, writes the sector number and count into the controller's registers, and starts it. The process sleeps: it is blocked.`);
      const sectors = a.blockSize / 512;
      if (S.Storage && S.Storage.disk) {
        const D = S.Storage.disk(Object.assign({ cylinders: 2000, heads: 4, spt: 200, rpm: 7200, settle: 1, knee: 200, kneeTime: 4, full: 12 }, a.disk || {}));
        let st = { cyl: 0, t: 0 };
        for (const d of dblocks) { const x = S.Storage.access(D, st, { lba: (d * sectors) % D.sectors, count: sectors }); diskMs += x.total; st = x.state; }
      } else diskMs = 8 * dblocks.length;
      step('controller', 'device', 'blocked', diskMs * 1000, `The disk seeks, waits for the sectors to come round and transfers them; DMA writes the data into memory: ${r3(diskMs)} ms, about ${Math.round((diskMs * 1000) / t)} times the ${r3(t)} µs the CPU spent getting this far. Meanwhile the CPU runs other processes.`, { diskMs: r3(diskMs) });
      step('interrupt', 'kernel', 'blocked', c.irq, `The controller raises an interrupt; the handler acknowledges it and marks the request done.`);
      step('interrupt', 'kernel', 'blocked', c.bottom, `The completion work marks the cache pages up to date and wakes every process sleeping on them.`);
      step('scheduler', 'kernel', 'ready', c.wake, `The process moves from blocked to ready and waits for the CPU.`);
      step('scheduler', 'kernel', 'running', c.sched, `The scheduler picks it; a context switch restores its kernel stack, and it resumes inside read.`);
    }
    step('cache', 'kernel', 'running', c.copyKiB * kib(a.bytes), `The kernel copies ${pl(a.bytes, 'byte')} from the page cache into the user buffer and advances the file offset to ${a.offset + a.bytes}.`);
    step('syscall', 'kernel', 'running', c.ret, `read returns ${a.bytes}; the return from the trap drops the CPU back to user mode.`);
    step('user', 'user', 'running', 0, `The program has its data after ${r3(t)} µs${misses.length ? ', almost all of it waiting for the disk' : ', without touching the disk'}.`);
    const total = t;
    return { steps, total: r3(total), blocks: fileBlocks, misses, diskMs: r3(diskMs), say: `A read of ${pl(a.bytes, 'byte')} took ${r3(total)} µs: ${misses.length ? r3(diskMs * 1000) + ' µs on the disk and ' + r3(total - diskMs * 1000) + ' µs in software' : 'all of it in software, from the page cache'}.` };
  };
  (S.engines = S.engines || []).push({ name: 'I/O systems' });
})(globalThis.Proses = globalThis.Proses || {});
