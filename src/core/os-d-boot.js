// The hardware boundary, part 4: the boot sequence, and OS structures as the path one request takes.
//   S.Os.boot({firmware: 'bios' | 'uefi', bootOrder: ['usb', 'disk'], devices: ['disk'], services: [..],
//              ramdisk: true})
//       -> {steps: [{kind, say, stage, mode, pids: [{pid, name, ppid}], memory: [{at, what}]}], stages}
//       stages: firmware, loader, kernel, init. Every step snapshots the mode, the processes alive and what is
//       loaded where in memory.
//   S.Os.STRUCTURES                 {monolithic, layered, microkernel, modules, hybrid}: each {name, blurb, parts:
//                                    [{name, space: 'user' | 'kernel', via?: 'module'}], messages: bool}
//   S.Os.request(structure | {name, parts, messages}, {op: 'read'})
//       -> {hops: [{from, to, how, modeSwitches, messages, spaceSwitch}], modeSwitches, messages, calls,
//           spaceSwitches, steps}
//       The request goes down the parts in order and the reply comes back up. Between two parts:
//         kernel to kernel: a function call (an indirect call for a module), no crossing;
//         user to kernel: a system call, 1 mode switch (and 1 back on the reply);
//         kernel to user: an upcall message to a server process, 1 mode switch and 1 message each way;
//         user to user: a message through the kernel's IPC, 2 mode switches (trap in, deliver out) and 1 message.
(function (S) {
  'use strict';
  const O = (S.Os = S.Os || {});

  O.boot = function (o) {
    o = o || {};
    const fw = o.firmware || 'bios', order = o.bootOrder || ['usb', 'disk'], devs = o.devices || ['disk'];
    const services = o.services || ['syslogd', 'cron', 'sshd', 'getty'];
    const steps = [], pids = [], memory = [];
    let mode = 'kernel', stage = 'firmware';
    const add = (kind, say) => steps.push({ kind, say, stage, mode, pids: pids.map((p) => Object.assign({}, p)), memory: memory.map((m) => Object.assign({}, m)) });
    add('power', 'Power on: every CPU register is reset and the CPU starts in its most privileged mode at the reset vector ' + (fw === 'bios' ? '0xFFFFFFF0, in read-only firmware' : 'in the UEFI firmware\'s flash') + '. There is no OS yet.');
    memory.push({ at: 'flash', what: fw === 'uefi' ? 'UEFI firmware' : 'BIOS firmware' });
    add('post', 'The firmware runs its power-on self test: it counts the memory, checks the CPU and finds the devices on the buses.');
    const found = order.find((d) => devs.includes(d));
    for (const d of order) {
      if (d === found) break;
      add('probe', 'Boot order: the firmware tries ' + d + ', finds nothing bootable there, and moves on.');
    }
    if (!found) { add('fail', 'No device in the boot order (' + order.join(', ') + ') holds a boot loader, so the firmware stops with "no bootable device".'); return { steps, ok: false }; }
    stage = 'loader';
    if (fw === 'bios') {
      memory.push({ at: '0x7C00', what: 'boot sector (512 bytes)' });
      add('loader', 'The BIOS reads the first 512-byte sector of the ' + found + ', checks its 0x55AA signature, copies it to 0x7C00 and jumps there: a tiny first-stage loader.');
      add('loader', 'The first stage loads the full boot loader from the following sectors, which can read the file system.');
    } else {
      memory.push({ at: 'EFI partition', what: 'boot loader program' });
      add('loader', 'UEFI reads the EFI system partition of the ' + found + ' (a small FAT file system), checks the boot loader\'s signature if secure boot is on, and starts it.');
    }
    memory.push({ at: '0x00100000', what: 'kernel image' });
    if (o.ramdisk !== false) memory.push({ at: 'high memory', what: 'initial RAM disk' });
    add('load', 'The boot loader finds the kernel image' + (o.ramdisk !== false ? ' and an initial RAM disk' : '') + ' on the ' + found + ', loads ' + (o.ramdisk !== false ? 'them' : 'it') + ' into memory, passes the kernel its command line and the memory map, and jumps to its entry point.');
    stage = 'kernel';
    add('kernel', 'The kernel takes over, still in kernel mode: it switches the CPU to its full mode and sets up its own stack.');
    memory.push({ at: 'kernel', what: 'page tables' });
    add('paging', 'It builds its page tables and turns on paging, so from now on every address is translated.');
    memory.push({ at: 'kernel', what: 'trap table' });
    add('traps', 'It fills the trap table, one handler per exception, interrupt and the system-call entry, and loads its base with a privileged instruction.');
    add('memory', 'It starts its memory allocator with the free frames from the memory map, and its own data structures: the process table, the file table, the caches.');
    add('drivers', 'It starts a driver for each device it finds' + (o.ramdisk !== false ? ', using modules from the initial RAM disk where it needs them' : '') + ': ' + O.list(devs.concat(['timer', 'console'])) + '.');
    add('timer', 'It programs the timer interrupt and turns interrupts on: from now on the kernel gets the CPU back every tick.');
    add('mount', 'It mounts the root file system from the ' + found + ', read-only at first.');
    pids.push({ pid: 0, name: 'idle', ppid: -1 });
    add('idle', 'The boot thread becomes the idle task, pid 0, which runs only when nothing else is ready.');
    stage = 'init';
    pids.push({ pid: 1, name: 'init', ppid: 0 });
    add('init', 'The kernel creates pid 1, loads /sbin/init into it, and runs return-from-trap: the first switch to user mode. init is the ancestor of every other process.');
    mode = 'user';
    add('user', 'init, in user mode, checks and remounts the root file system read-write and mounts the others.');
    let pid = 2;
    for (const s of services) {
      pids.push({ pid, name: s, ppid: 1 });
      add('service', 'init forks and execs ' + s + ' as pid ' + pid + '.');
      pid++;
    }
    add('ready', 'Boot is complete: ' + O.plural(pids.length - 1, 'process', 'processes') + ' in user mode, and the kernel runs only on traps, interrupts and system calls. init stays to reap orphans.');
    return { steps, ok: true, stages: ['firmware', 'loader', 'kernel', 'init'] };
  };

  O.STRUCTURES = {
    monolithic: { name: 'Monolithic', blurb: 'every service in one kernel address space, called directly', messages: false, parts: [
      { name: 'app', space: 'user' }, { name: 'system-call layer', space: 'kernel' }, { name: 'VFS', space: 'kernel' }, { name: 'file system', space: 'kernel' }, { name: 'block layer', space: 'kernel' }, { name: 'disk driver', space: 'kernel' }] },
    layered: { name: 'Layered', blurb: 'each layer uses only the one below it', messages: false, parts: [
      { name: 'app', space: 'user' }, { name: 'L5 user interface', space: 'kernel' }, { name: 'L4 files', space: 'kernel' }, { name: 'L3 buffers', space: 'kernel' }, { name: 'L2 I/O', space: 'kernel' }, { name: 'L1 memory', space: 'kernel' }, { name: 'L0 hardware', space: 'kernel' }] },
    microkernel: { name: 'Microkernel', blurb: 'a small kernel passes messages; services are user processes', messages: true, parts: [
      { name: 'app', space: 'user' }, { name: 'file server', space: 'user' }, { name: 'disk driver', space: 'user' }] },
    modules: { name: 'Modules', blurb: 'a core kernel with loadable modules linked in at run time', messages: false, parts: [
      { name: 'app', space: 'user' }, { name: 'core kernel', space: 'kernel' }, { name: 'file-system module', space: 'kernel', via: 'module' }, { name: 'block layer', space: 'kernel' }, { name: 'driver module', space: 'kernel', via: 'module' }] },
    hybrid: { name: 'Hybrid', blurb: 'a kernel with most services inside, and some drivers as user processes', messages: true, parts: [
      { name: 'app', space: 'user' }, { name: 'kernel (files)', space: 'kernel' }, { name: 'user-space driver', space: 'user' }] },
  };

  O.request = function (st, o) {
    o = o || {};
    const def = typeof st === 'string' ? O.STRUCTURES[st] : st;
    if (!def) throw new Error('unknown structure ' + st);
    const op = o.op || 'read', parts = def.parts, hops = [], steps = [];
    let modeSwitches = 0, messages = 0, calls = 0, spaceSwitches = 0, lastUser = parts[0].name;
    const hop = (a, b, dir) => {
      const h = { from: a.name, to: b.name, dir, modeSwitches: 0, messages: 0, spaceSwitch: false };
      if (a.space === 'kernel' && b.space === 'kernel') { h.how = b.via === 'module' || a.via === 'module' ? 'indirect call' : 'call'; calls++; }
      else if (a.space === 'user' && b.space === 'kernel') { h.how = dir === 'down' ? 'system call' : 'reply message'; h.modeSwitches = 1; if (dir === 'up') h.messages = 1; }
      else if (a.space === 'kernel' && b.space === 'user') { h.how = dir === 'down' ? 'message' : 'return to user'; h.modeSwitches = 1; if (dir === 'down') h.messages = 1; }
      else { h.how = 'message'; h.modeSwitches = 2; h.messages = 1; }
      // the address space changes only when a different user process runs next (the kernel runs in the caller's)
      if (b.space === 'user' && b.name !== lastUser) h.spaceSwitch = true;
      if (b.space === 'user') lastUser = b.name;
      modeSwitches += h.modeSwitches; messages += h.messages; if (h.spaceSwitch) spaceSwitches++;
      hops.push(h);
      const what = h.how === 'call' || h.how === 'indirect call' ? 'a plain ' + h.how + (h.how === 'indirect call' ? ' through the module\'s table of operations' : '') + ' inside the kernel: no crossing'
        : h.how === 'system call' ? 'a system call: user to kernel mode, 1 switch'
          : h.how === 'return to user' ? 'return-from-trap: kernel to user mode, 1 switch'
            : h.modeSwitches === 2 ? 'a message through the kernel: a trap in to send and a switch out to deliver, 2 mode switches and 1 message'
              : 'a message ' + (a.space === 'kernel' ? 'from the kernel to a user process' : 'back into the kernel') + ': 1 mode switch and 1 message';
      steps.push({ kind: 'hop', say: (dir === 'down' ? 'Request' : 'Reply') + ' ' + a.name + ' to ' + b.name + ': ' + what + '. Running total: ' + modeSwitches + ' mode switch' + (modeSwitches === 1 ? '' : 'es') + ', ' + O.plural(messages, 'message') + '.', hop: h, at: b.name, modeSwitches, messages });
    };
    steps.push({ kind: 'start', say: def.name + ' (' + def.blurb + '): the app calls ' + op + '(), which must reach the ' + parts[parts.length - 1].name + ' and come back.', at: parts[0].name, modeSwitches: 0, messages: 0 });
    for (let i = 0; i + 1 < parts.length; i++) hop(parts[i], parts[i + 1], 'down');
    steps.push({ kind: 'device', say: 'The ' + parts[parts.length - 1].name + ' gets the block from the disk.', at: parts[parts.length - 1].name, modeSwitches, messages });
    for (let i = parts.length - 1; i > 0; i--) hop(parts[i], parts[i - 1], 'up');
    steps.push({ kind: 'total', say: def.name + ': one ' + op + ' took ' + O.plural(modeSwitches, 'mode switch', 'mode switches') + ', ' + O.plural(messages, 'message') + ', ' + O.plural(calls, 'in-kernel call') + ' and ' + O.plural(spaceSwitches, 'address-space switch', 'address-space switches') + '.', at: parts[0].name, modeSwitches, messages });
    return { name: def.name, hops, modeSwitches, messages, calls, spaceSwitches, steps };
  };
  /** every structure's counts for one request, for a side-by-side table */
  O.compareStructures = (o) => Object.keys(O.STRUCTURES).map((k) => { const r = O.request(k, o); return { id: k, name: r.name, modeSwitches: r.modeSwitches, messages: r.messages, calls: r.calls, spaceSwitches: r.spaceSwitches }; });
})(globalThis.Proses = globalThis.Proses || {});
