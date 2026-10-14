// Part 18, virtual machines and containers: the exercises of chapters 3 and 4 (virtualising I/O, containers). The
// exits, interrupts and copies of each I/O path, the crossings of one call, what a process inside a container can
// see and signal, and how control groups share the CPU and enforce a memory limit all come from the engines (S.Virt).
(function (S) {
  'use strict';
  const C = S.Content, V = S.Virt;
  if (!C || !V || C.exercises.has('vrt-x-io-emulated')) return;
  const list = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);

  // =========================================================================================================
  // Chapter 3: virtualising I/O
  // =========================================================================================================
  const EM = V.ioPath('emulated', { requests: 6, regs: 3 });
  C.exercise({ id: 'vrt-x-io-emulated', chapter: 'vrt-io', title: 'Exits of an emulated disk', level: 1, kind: 'number',
    text: ['A guest\'s unchanged disk driver touches 3 device registers for each request, and acknowledges each completion interrupt with one more register access. The device is emulated: every register access exits to the monitor. How many VM exits for 6 requests?'],
    answer: EM.exits, whyNot: { '18': 'Count the register access that acknowledges each completion, too.', '6': 'Every register access exits, not just one per request.', '*': 'Exits per request = register accesses + the acknowledgement.' },
    hints: ['Which guest actions exit? Every access to the imitated device\'s registers.', 'Per request: 3 accesses to start it, 1 to acknowledge its interrupt: ' + EM.perRequest + ' exits.', EM.perRequest + ' × 6 = ' + EM.exits + ' exits. ' + EM.steps[EM.steps.length - 1].say],
    solution: EM.exits, wrong: [18, 6] });

  const IO = { requests: 10, regs: 3, batch: 4, posted: true };
  const MODES = [['emulated', 'emulated'], ['paravirtual', 'paravirtual'], ['passthrough', 'passed through']];
  const iocells = {};
  for (const [m, name] of MODES) { const r = V.ioPath(m, IO); iocells[name + '|exits'] = r.exits; iocells[name + '|interrupts'] = r.injections; iocells[name + '|copies'] = r.copies; }
  const pv = V.ioPath('paravirtual', IO);
  C.exercise({ id: 'vrt-x-io-table', chapter: 'vrt-io', title: 'Three paths, counted', level: 3, kind: 'table',
    text: ['A guest makes ' + IO.requests + ' disk requests. Emulated: 3 register accesses per request plus 1 to acknowledge, each an exit; the device model copies the data in and out of guest memory (2 copies a request) and injects one interrupt per request. Paravirtual: the driver puts requests in a shared ring and notifies the host once per batch of ' + IO.batch + ' (an exit), the host injects one interrupt per batch, and the data is copied once per request. Passed through, with posted interrupts: the guest drives the device itself. Fill in the totals.'],
    rows: MODES.map((m) => m[1]), cols: ['exits', 'interrupts', 'copies'], corner: 'path', cells: iocells,
    hints: ['Emulated: everything goes through the monitor, request by request.', 'Paravirtual: the batches round up: ' + IO.requests + ' requests in batches of ' + IO.batch + ' make ' + pv.exits + ' notifications.', MODES.map(([, n]) => n + ': ' + iocells[n + '|exits'] + ' exits, ' + iocells[n + '|interrupts'] + ' interrupts, ' + iocells[n + '|copies'] + ' copies').join('; ') + '.'],
    solution: iocells, wrong: [Object.assign({}, iocells, { 'paravirtual|exits': 2, 'paravirtual|interrupts': 2 }), Object.assign({}, iocells, { 'emulated|exits': 30 })] });

  const PB = V.ioPath('paravirtual', { requests: 20, batch: 6 });
  C.exercise({ id: 'vrt-x-io-batch', chapter: 'vrt-io', title: 'Notifications in batches', level: 1, kind: 'number',
    text: ['A paravirtual network driver queues 20 packets in its ring and notifies the host once for every 6 queued (and once more for any left over at the end). How many VM exits?'],
    answer: PB.exits, whyNot: { '3': '20 / 6 is more than 3: the last 2 packets need a notification too.', '20': 'That is one exit per packet, as with no batching at all.', '*': 'Round 20 / 6 up.' },
    hints: ['One exit per notification.', '6 + 6 + 6 = 18 packets in three full batches, and 2 left over.', 'Four notifications: ' + PB.exits + ' exits.'],
    solution: PB.exits, wrong: [3, 20] });

  const PT = V.ioPath('passthrough', { requests: 6, posted: false });
  C.exercise({ id: 'vrt-x-posted', chapter: 'vrt-io', title: 'Passthrough without posted interrupts', level: 2, kind: 'number',
    text: ['A network card is passed through to a guest: its registers are mapped into the guest and its DMA goes through the IOMMU. But the machine cannot post interrupts straight into a guest, so each completion interrupt goes to the monitor first. How many VM exits for 6 requests?'],
    answer: PT.exits, whyNot: { '0': 'That needs posted interrupts; here each completion goes through the monitor.', '24': 'The guest touches the card\'s registers directly: those do not exit.', '*': 'Only the completion interrupts exit here.' },
    hints: ['Which part of a request still involves the monitor?', 'Not the registers, not the DMA: only the interrupt that says a request is done.', 'One exit per completion: ' + PT.exits + '. ' + PT.steps[PT.steps.length - 1].say],
    solution: PT.exits, wrong: [0, 24] });

  C.exercise({ id: 'vrt-x-io-price', chapter: 'vrt-io', title: 'What passthrough gives up', level: 2, kind: 'choice',
    text: ['A cloud provider gives each guest a network card passed through, to remove the monitor from the I/O path. What does it give up?'],
    options: ['The card serves one guest only, and a guest using it cannot easily be moved live to another machine', 'Protection: the guest\'s DMA can now reach any memory on the host', 'The guest needs a special paravirtual driver', 'Interrupts: the guest must poll the card'],
    answer: 0, whyNot: { 1: 'The IOMMU translates the card\'s DMA and stops it reaching memory outside the guest.', 2: 'It is the paravirtual path that needs a special driver; passthrough uses the card\'s ordinary one.', 3: 'Completions arrive as interrupts, posted straight into the guest where the hardware allows.' },
    hints: ['With passthrough, who owns the device?', 'The guest alone: the monitor no longer stands between them.', 'So the device cannot be shared, and its state lives in hardware the monitor does not control, which makes live migration hard.'],
    solution: 0, wrong: [1, 2] });

  const XV = V.crossings({ op: 'read', io: 'paravirtual', requests: 1 }).rows;
  C.exercise({ id: 'vrt-x-crossings', chapter: 'vrt-io', title: 'Kernels on the path', level: 1, kind: 'table',
    text: ['One `read()` of a file, from a native process, from a process in a container, and from a process in a virtual machine with a paravirtual disk. For each, how many kernels does the call pass through, and how many VM exits does it make?'],
    rows: XV.map((r) => r.setup), cols: ['kernels', 'VM exits'], corner: 'caller', cells: Object.fromEntries(XV.flatMap((r) => [[r.setup + '|kernels', r.kernels], [r.setup + '|VM exits', r.exits]])),
    hints: ['A container is ordinary processes on the host kernel, behind namespaces.', 'A virtual machine has a kernel of its own, and its driver reaches the host through the monitor.', XV.map((r) => r.say).join(' ')],
    solution: Object.fromEntries(XV.flatMap((r) => [[r.setup + '|kernels', String(r.kernels)], [r.setup + '|VM exits', String(r.exits)]])),
    wrong: [Object.fromEntries(XV.flatMap((r) => [[r.setup + '|kernels', '2'], [r.setup + '|VM exits', String(r.exits)]])), Object.fromEntries(XV.flatMap((r) => [[r.setup + '|kernels', String(r.kernels)], [r.setup + '|VM exits', r.setup === 'container' ? '1' : String(r.exits)]]))] });

  // =========================================================================================================
  // Chapter 4: containers
  // =========================================================================================================
  const SYS = V.containers();
  const byPid = (p) => SYS.procs.find((x) => x.pid === p);
  const who = (p) => byPid(p).name + ' (host pid ' + p + ')';
  const SYST = 'One kernel runs ' + SYS.procs.length + ' processes. On the host: ' + list(SYS.procs.filter((p) => !p.container).map((p) => who(p.pid))) + '. Container web: ' + list(SYS.procs.filter((p) => p.container === 'web').map((p) => who(p.pid))) + '. Container db: ' + list(SYS.procs.filter((p) => p.container === 'db').map((p) => who(p.pid))) + '. Each container has its own pid, mount, network and hostname namespaces.';
  const V8 = V.view(SYS, 8), seen8 = '{' + V8.pids.map((p) => p.hostPid).join(', ') + '}';
  C.exercise({ id: 'vrt-x-ns-see', chapter: 'vrt-cont', title: 'Who can the writer see?', level: 1, kind: 'set',
    text: [SYST, 'The db container\'s writer lists every process it can see. Which processes are they? Answer with their host pids, as a set like {1, 2}.'],
    answer: seen8, whyNot: 'A process in a pid namespace sees only the processes in that namespace (and below it), nothing on the host or in other containers.',
    hints: ['Which pid namespace is the writer in?', 'The db namespace, which holds only the db container\'s processes.', 'It sees ' + V8.pids.map((p) => p.name + ' as pid ' + p.seen + ' (host pid ' + p.hostPid + ')').join(' and ') + ': ' + seen8 + '.'],
    solution: seen8, wrong: ['{' + SYS.procs.map((p) => p.pid).join(', ') + '}', '{8}', '{1, 7, 8}'] });

  const self6 = V.view(SYS, 6).pids.find((p) => p.hostPid === 6).seen;
  C.exercise({ id: 'vrt-x-ns-pid', chapter: 'vrt-cont', title: 'Its own pid', level: 1, kind: 'number',
    text: [SYST, 'The second worker of the web container, host pid 6, calls `getpid()`. What does it get?'],
    answer: self6, whyNot: { '6': 'That is its pid in the host\'s namespace. getpid answers in the caller\'s own pid namespace.', '1': 'Pid 1 of the web namespace is its first process, nginx.', '*': 'Count the web namespace\'s processes in the order they were created.' },
    hints: ['A pid namespace numbers its own processes from 1.', 'In web: nginx is 1, the first worker 2.', 'The second worker is pid ' + self6 + ' inside web, and 6 on the host.'],
    solution: self6, wrong: [6, 1] });

  const K1 = V.signal(SYS, 8, 1), K2 = V.signal(SYS, 5, 7);
  C.exercise({ id: 'vrt-x-ns-kill', chapter: 'vrt-cont', title: 'kill() inside a namespace', level: 2, kind: 'choice',
    text: [SYST, 'The db writer calls `kill(1, SIGTERM)`, and the web container\'s first worker (host pid 5) calls `kill(7, SIGTERM)`. What happens?'],
    options: ['The writer signals dbserver (host pid 7); the worker\'s kill fails, since its namespace has no pid 7', 'The writer signals init, host pid 1; the worker signals dbserver', 'Both fail: a container may not send signals', 'The writer signals dbserver; the worker signals dbserver too'],
    answer: 0, whyNot: { 1: 'A pid is resolved in the sender\'s own pid namespace: the writer\'s pid 1 is its namespace\'s first process.', 2: 'Processes in a container signal each other as usual, within their namespace.', 3: 'Host pid 7 is in another namespace: the worker cannot even name it.' },
    hints: ['kill() reads the pid it is given in the caller\'s pid namespace.', 'In db, pid 1 is dbserver. In web there are only pids 1 to 3.', K1.say + ' ' + K2.say],
    solution: 0, wrong: [1, 3] });

  C.exercise({ id: 'vrt-x-ns-kinds', chapter: 'vrt-cont', title: 'Which namespace?', level: 2, kind: 'table',
    text: ['Name the namespace that gives a container each of these, from **pid**, **mount**, **network**, **uts** (hostname) or **user**.'],
    rows: ['its own pid 1', 'its own root file system', 'its own eth0 and IP address', 'its own hostname', 'root inside, an ordinary user outside'], cols: ['namespace'], corner: 'the container has', cellKind: 'text',
    cells: { 'its own pid 1|namespace': 'pid', 'its own root file system|namespace': 'mount', 'its own eth0 and IP address|namespace': 'network', 'its own hostname|namespace': 'uts', 'root inside, an ordinary user outside|namespace': 'user' },
    hints: ['Each namespace virtualises one kind of name the kernel hands out.', 'Process ids, mount points, network devices, the hostname, and user ids.', 'pid; mount; network; uts; user.'],
    solution: { 'its own pid 1|namespace': 'pid', 'its own root file system|namespace': 'mount', 'its own eth0 and IP address|namespace': 'network', 'its own hostname|namespace': 'uts', 'root inside, an ordinary user outside|namespace': 'user' },
    wrong: [{ 'its own pid 1|namespace': 'pid', 'its own root file system|namespace': 'mount', 'its own eth0 and IP address|namespace': 'network', 'its own hostname|namespace': 'network', 'root inside, an ordinary user outside|namespace': 'user' }, { 'its own pid 1|namespace': 'pid', 'its own root file system|namespace': 'mount', 'its own eth0 and IP address|namespace': 'network', 'its own hostname|namespace': 'uts', 'root inside, an ordinary user outside|namespace': 'pid' }] });

  // control groups
  const CGW = { groups: [{ name: 'ui', weight: 100 }, { name: 'build', weight: 300 }], procs: [{ name: 'shell', group: 'ui', work: Infinity }, { name: 'cc', group: 'build', work: Infinity }, { name: 'ld', group: 'build', work: Infinity }], period: 10, ticks: 16 };
  const RW = V.cgroups(CGW);
  const runs = (r, p) => r.segs.filter((s) => s.proc === p).length;
  const wcells = { 'ui|ticks': RW.groups.ui.cpu, 'build|ticks': RW.groups.build.cpu, 'shell|ticks': runs(RW, 'shell'), 'cc|ticks': runs(RW, 'cc'), 'ld|ticks': runs(RW, 'ld') };
  C.exercise({ id: 'vrt-x-cg-weights', chapter: 'vrt-cont', title: 'Weights 1 : 3', level: 2, kind: 'table',
    text: ['Two control groups compete for one CPU for 16 ticks: ui (weight 100) holds the process shell, build (weight 300) holds cc and ld. Every process always has work. Each tick goes to the group that has had least CPU for its weight (ties go to ui, listed first), and within a group to the process that has run least. How many ticks does each group, and each process, get?'],
    rows: ['ui', 'build', 'shell', 'cc', 'ld'], cols: ['ticks'], corner: 'who', cells: wcells,
    hints: ['Weights share the CPU in proportion when every group is busy: ui gets 1 part in 4.', 'ui: 16 / 4 = ' + RW.groups.ui.cpu + ' ticks; build: ' + RW.groups.build.cpu + '. Inside build, cc and ld take turns.', 'ui ' + RW.groups.ui.cpu + ' (shell ' + runs(RW, 'shell') + '); build ' + RW.groups.build.cpu + ' (cc ' + runs(RW, 'cc') + ', ld ' + runs(RW, 'ld') + '). The order: ' + RW.segs.map((s) => s.proc).join(' ') + '.'],
    solution: wcells, wrong: [Object.assign({}, wcells, { 'shell|ticks': 8, 'ui|ticks': 8 }), Object.assign({}, wcells, { 'cc|ticks': RW.groups.build.cpu, 'ld|ticks': 0 })] });

  const CGQ = { groups: [{ name: 'render', weight: 100, quota: 4 }], procs: [{ name: 'r1', group: 'render', work: Infinity }, { name: 'r2', group: 'render', work: Infinity }], period: 10, ticks: 30 };
  const RQ = V.cgroups(CGQ), idle = RQ.segs.filter((s) => s.group === null).length;
  C.exercise({ id: 'vrt-x-cg-quota', chapter: 'vrt-cont', title: 'A quota on an idle machine', level: 2, kind: 'number',
    text: ['The only busy group on a machine, render, holds two processes that always have work. Its quota is 4 ticks of CPU per period of 10 ticks. Over 30 ticks, how many ticks does the CPU sit idle?'],
    answer: idle, whyNot: { '0': 'A quota is a hard cap: once used up, the group waits for the next period even if nobody else wants the CPU.', '22': 'The quota is per group, not per process: r1 and r2 share 4 ticks a period.', '*': 'Count the ticks render may run in each period.' },
    hints: ['Unlike a weight, a quota limits a group even when the CPU would otherwise be free.', 'Each period render runs 4 ticks (r1 and r2 taking turns), then is throttled for 6.', '3 periods × 6 = ' + idle + ' idle ticks; render ran ' + RQ.groups.render.cpu + '.'],
    solution: idle, wrong: [0, 22] });

  const CGM = { groups: [{ name: 'app', weight: 100, memLimit: 16 }, { name: 'logs', weight: 100 }], procs: [{ name: 'api', group: 'app', work: Infinity, memPerTick: 1, mem: 2 }, { name: 'cache', group: 'app', work: Infinity, memPerTick: 3 }, { name: 'tail', group: 'logs', work: Infinity, memPerTick: 1 }], period: 10, ticks: 20 };
  const RM = V.cgroups(CGM), kill = RM.steps.find((s) => /out-of-memory/.test(s.say || ''));
  const appAt = (t) => RM.steps.find((s) => s.t === t).groups.find((g) => g.name === 'app').mem;
  C.exercise({ id: 'vrt-x-cg-oom', chapter: 'vrt-cont', title: 'Who the memory limit stops', level: 3, kind: 'choice',
    text: ['Two groups share a CPU for 20 ticks, equally weighted, ticks alternating app, logs, app, ... In app (memory limit 16) are api, which starts at 2 units and grows by 1 each tick it runs, and cache, which starts at 0 and grows by 3. In logs (no limit) is tail, growing by 1. Within app, api and cache take turns, api first. What happens, and when?'],
    options: ['At t = ' + kill.t + ' app reaches ' + (kill.say.match(/reaches (\d+)/) || [])[1] + ', over 16: the kernel ends ' + RM.groups.app.killed[0] + ', the largest process in app; tail is untouched', 'At t = ' + kill.t + ' the kernel ends tail, to make room for app', 'At t = ' + kill.t + ' the kernel ends api, the oldest process in app', 'At t = ' + (kill.t - 2) + ' the kernel ends ' + RM.groups.app.killed[0] + ', the largest process in app'],
    answer: 0, whyNot: { 1: 'A group\'s memory limit is enforced inside that group; logs has no limit and is never touched.', 2: 'The killer picks the largest process in the group that went over: api holds less than cache.', 3: 'At t = ' + (kill.t - 2) + ' app holds ' + appAt(kill.t - 2) + ', not over its limit of 16 yet.' },
    hints: ['Only app has a limit. Track app\'s total: api\'s memory plus cache\'s.', 'app runs at t = 0, 2, 4, ...: api, cache, api, cache, ... Each run adds 1 (api) or 3 (cache).', kill.say],
    solution: 0, wrong: [1, 2] });

  C.exercise({ id: 'vrt-x-vm-or-cont', chapter: 'vrt-cont', title: 'A container or a virtual machine?', level: 2, kind: 'choice',
    text: ['A hosting company runs code uploaded by many customers who do not trust each other, on shared machines. Which isolation suits it best, and why?'],
    options: ['A virtual machine per customer: each has its own kernel, so a flaw in one kernel does not expose the others', 'A container per customer: namespaces hide everything, so it is just as strong and cheaper', 'Ordinary processes under different user ids', 'One container for all customers, with a control group each'],
    answer: 0, whyNot: { 1: 'Containers share the host kernel: one kernel bug reachable from inside a container reaches every container on the machine.', 2: 'Processes of different users still share one kernel, one file system and one network view.', 3: 'Control groups limit how much each may use; they hide nothing.' },
    hints: ['What do all the containers on one machine have in common?', 'One kernel. Every system call from every container lands in it.', 'Untrusted neighbours call for a boundary that does not share a kernel: a virtual machine (or a container inside its own virtual machine). Containers are a fine choice among code that trusts each other.'],
    solution: 0, wrong: [1, 3] });

  C.exercise({ id: 'vrt-x-cg-or-ns', chapter: 'vrt-cont', title: 'Seeing against using', level: 1, kind: 'choice',
    text: ['A container must not see the host\'s other processes, and must not use more than 2 GiB of memory. Which kernel features provide these two properties?'],
    options: ['A pid namespace for the first, a memory control group for the second', 'A memory control group for the first, a pid namespace for the second', 'A virtual machine monitor for both', 'chroot for both'],
    answer: 0, whyNot: { 1: 'That is the wrong way round: namespaces decide what a process can see, control groups how much it may use.', 2: 'A container needs no monitor: both are features of the one host kernel.', 3: 'chroot only changes the root directory: processes and memory are untouched.' },
    hints: ['One property is about visibility, the other about amounts.', 'Namespaces give each container its own view of names; control groups account for and limit resources.', 'Hiding processes: a pid namespace. Capping memory: a memory control group.'],
    solution: 0, wrong: [1, 3] });
})(globalThis.Proses = globalThis.Proses || {});
