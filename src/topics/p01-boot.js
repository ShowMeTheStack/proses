// Part 1, booting: from power-on in the firmware, through the boot loader, to the kernel setting itself up and
// starting init, the first user process, which starts the services. The four stages across the top, what sits
// where in memory, the mode bit, and the processes alive (a tree under init). From S.Os.boot.
(function (S) {
  'use strict';
  const H = S.PX;
  const STAGES = [['firmware', 'firmware', 'POST, boot order'], ['loader', 'boot loader', 'finds the kernel'], ['kernel', 'kernel', 'sets itself up'], ['init', 'init', 'first user process']];
  const DEV = ['usb', 'disk', 'cd'];
  const listOf = (v) => String(v).split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

  S.topic({
    id: 'p01-boot', family: 'p01-boot', order: 10, title: 'Booting, from firmware to init',
    blurb: 'At power-on there is no operating system, only firmware in read-only memory. It tests the machine, then tries the devices in its boot order until one holds a boot loader. The loader brings the kernel into memory and jumps to it. The kernel, in kernel mode from the start, builds its page tables and trap table, starts its drivers and the timer, mounts the root file system and creates the first process, init. From there everything else is a fork and an exec.',
    inputs: [
      { id: 'fw', kind: 'choice', label: 'Firmware', def: 'bios', options: [{ value: 'bios', label: 'BIOS (a boot sector)' }, { value: 'uefi', label: 'UEFI (a boot partition)' }] },
      { id: 'order', kind: 'text', label: 'Boot order (usb, disk, cd)', def: 'usb, disk', check: (v) => { const l = listOf(v); if (!l.length || l.length > 3) return 'Boot order: one to three devices'; const bad = l.find((d) => !DEV.includes(d)); return bad ? 'Boot order: ' + bad + ' is not one of ' + DEV.join(', ') : null; } },
      { id: 'devs', kind: 'text', label: 'Devices that hold a boot loader', def: 'disk', check: (v) => { const bad = listOf(v).find((d) => !DEV.includes(d)); return bad ? 'Devices: ' + bad + ' is not one of ' + DEV.join(', ') : null; } },
      { id: 'services', kind: 'text', label: 'Services init starts', def: 'syslogd, cron, sshd, getty', check: (v) => { const l = listOf(v); if (l.length > 5) return 'Services: at most 5'; return l.find((x) => !/^[a-z][\w-]{0,9}$/.test(x)) ? 'Services: short lower-case names' : null; } },
      { id: 'ramdisk', kind: 'choice', label: 'Initial RAM disk', def: 'yes', options: [{ value: 'yes', label: 'yes' }, { value: 'no', label: 'no' }] },
    ],
    presets: [
      { label: 'A PC with a BIOS, booting from disk', values: { fw: 'bios', order: 'usb, disk', devs: 'disk', services: 'syslogd, cron, sshd, getty', ramdisk: 'yes' } },
      { label: 'UEFI, booting from a USB stick', values: { fw: 'uefi', order: 'usb, disk', devs: 'usb, disk', services: 'getty', ramdisk: 'yes' } },
      { label: 'No bootable device', values: { fw: 'bios', order: 'cd, usb', devs: 'disk', services: 'getty', ramdisk: 'yes' } },
      { label: 'A small server', values: { fw: 'uefi', order: 'disk', devs: 'disk', services: 'logd, netd, dbd, webd, getty', ramdisk: 'no' } },
    ],
    counters: [{ id: 'procs', label: 'tasks (idle included)' }],
    run(inp) {
      const r = S.Os.boot({ firmware: inp.fw, bootOrder: listOf(inp.order), devices: listOf(inp.devs), services: listOf(inp.services), ramdisk: inp.ramdisk === 'yes' });
      const F = new S.Frames(['procs']);
      const SW = 196, SG = 18;
      r.steps.forEach((s) => {
        const items = [H.title('st', 0, 14, 'boot stages')];
        const si = STAGES.findIndex((x) => x[0] === s.stage);
        STAGES.forEach((x, k) => {
          items.push({ key: 'sg' + k, kind: 'state', x: k * (SW + SG) + SW / 2, y: 52, w: SW, h: 50, rx: 8, lines: [x[1], x[2]], cls: 'layer ' + (k < si ? 'done' : k === si ? 'act' : ''), size: 14 });
          if (k) items.push({ key: 'sa' + k, kind: 'edge', from: 'sg' + (k - 1), to: 'sg' + k, cls: k <= si ? 'act' : '' });
        });
        items.push(H.text('mbl', 0, 116, 'mode bit', 'title'), H.cell('mb', 84, 99, 92, 28, s.mode, 'modebit ' + (s.mode === 'kernel' ? 'kern' : 'user'), { size: 14 }));
        // memory: what is loaded where
        items.push(H.title('mt', 0, 160, 'loaded in memory'));
        if (!s.memory.length) items.push(H.text('mn', 0, 184, 'nothing yet', '', 13));
        s.memory.forEach((m, k) => {
          const fresh = !F.list.length || !F.last().meta.memory.some((x) => x.what === m.what);
          items.push(H.cell('ma' + k, 0, 170 + k * 32, 130, 28, m.at, 'vec mono' + (fresh ? ' act' : ''), { size: 13 }), H.cell('mw' + k, 134, 170 + k * 32, 230, 28, m.what, 'vec' + (fresh ? ' act' : ''), { size: 13 }));
        });
        // the processes
        items.push(H.title('pt', 410, 160, 'processes'));
        if (!s.pids.length) items.push(H.text('pn', 410, 184, 'none: only the kernel runs', '', 13));
        else {
          const nodes = s.pids.map((p) => ({ id: p.pid, parent: p.ppid, lines: [p.name, 'pid ' + p.pid], cls: p.pid === 0 ? 'kern s-ready' : (s.kind === 'service' && p.pid === s.pids[s.pids.length - 1].pid) || (s.kind === 'init' && p.pid === 1) ? 's-running act' : 's-ready' }));
          items.push(...S.Kit.proc.tree({ prefix: 'pt', x: 410, y: 176, w: 440, nodes, boxW: 80, boxH: 42, levelH: 64, gap: 8, size: 13 }).items);
        }
        F.set('procs', s.pids.length);
        F.add({ items, say: H.say(s.say), meta: { phase: s.kind, stage: s.stage, memory: s.memory, pids: s.pids, nprocs: s.pids.length - 1, sector: 512, reset: 0, devs: listOf(inp.devs) }, title: s.kind });
      });
      const def = { sections: [{ id: 'd', kind: 'math', title: 'Who runs at each stage', text: ['firmware: in ROM or flash', '  tests, then the boot order', 'boot loader: from the device', '  loads the kernel image', 'kernel: page tables, trap table,', '  drivers, timer, root fs', 'init (pid 1): the first', '  user process; forks the rest'].join('\n') }] };
      return { frames: F.list, def, result: { ok: r.ok } };
    },
    predict: [
      { at: (f, i, fr) => f.meta.phase === 'post', pick: 'option', ask: 'The firmware now tries the boot order. Which device will it boot from?', options: (fr, i, inp) => listOf(inp.order).concat(['none of them']), answer: (fr, i, inp) => listOf(inp.order).find((d) => listOf(inp.devs).includes(d)) || 'none of them', explain: (fr) => (fr.find((f) => f.meta.phase === 'loader' || f.meta.phase === 'fail') || fr[fr.length - 1]).say },
      { at: (f, i, fr) => f.meta.phase === 'idle', pick: 'option', ask: 'What is the first process to run in user mode?', options: ['init', 'the shell', 'the idle task', 'the boot loader'], answer: 'init', explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Which mode does the CPU start in at power-on?', options: ['its most privileged mode', 'user mode', 'whatever the last program left', 'no mode until the kernel sets one'], answer: 0, why: 'The firmware and the kernel need every instruction to set the machine up; user mode comes later, with init.' },
      { q: 'Why does the kernel fill the trap table before it starts any user process?', options: ['every interrupt, fault and system call goes through it; without it a trap would jump nowhere', 'to save memory', 'the firmware needs it', 'it does not need to'], answer: 0, why: 'User programs reach the kernel only through traps.' },
      { q: 'What is init\'s pid?', options: ['1', '0', '2', 'it varies'], answer: 0, why: 'pid 0 is the idle task; init is the first real process and the ancestor of all others.' },
      { q: 'How does every service after init get started?', options: ['init forks and execs it', 'the firmware loads it', 'the kernel loads each one directly', 'the boot loader starts it'], answer: 0, why: 'Once the kernel has started init, every new process is made by fork and exec.' },
      { q: 'What does a BIOS check before it runs a boot sector?', options: ['the 0x55AA signature at its end', 'a password', 'the kernel version', 'nothing'], answer: 0, why: 'Those two bytes mark a sector as bootable.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
