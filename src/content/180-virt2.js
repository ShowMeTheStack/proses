// Part 18, virtual machines and containers: the lessons of chapters 3 and 4 (virtualising I/O, containers). The
// chapters themselves are declared in 180-virt.js. Every value quoted is what the topics' own engine (S.Virt) says
// on the inputs given.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.lessons.has('vrt-io-paths')) return;
  const X = (id) => ({ exercise: id });
  const vmm = (title, text, setup) => ({ lab: 'vmm', title, text, setup });

  // =========================================================================================================
  // Chapter 3: virtualising I/O
  // =========================================================================================================
  C.lesson({
    id: 'vrt-io-paths', chapter: 'vrt-io', title: 'Emulated, paravirtual, passed through', minutes: 9,
    summary: 'A guest can reach a device three ways. An emulated device imitates real hardware, so the guest\'s ordinary driver works unchanged, but every register access exits to the monitor. A paravirtual driver knows it is in a virtual machine and puts requests in a ring shared with the host, notifying it once per batch. A device passed through belongs to the guest, which drives it directly; the IOMMU keeps its DMA inside the guest\'s memory. Each step removes the monitor from more of the path, and gives something up.',
    blocks: [
      'A guest\'s disk driver was written for a real disk controller: it writes a few device registers to start a request, then waits for an interrupt. But inside a virtual machine there is no such controller. Where do those register writes go, and what does each one cost?',
      { def: 'emulated device', text: 'a device model in the monitor that behaves like a real piece of hardware. Every access the guest makes to the imitated registers exits to the model.' },
      { topic: 'virt-io-paths', frame: 2, caption: 'Every register access exits to the monitor\'s device model: 4 exits per request.' },
      { topic: 'virt-io-paths', frame: 5, caption: 'Emulated I/O, 8 requests: 40 VM exits (5 per request, counting the acknowledgement), 8 injected interrupts, 16 data copies.' },
      { def: 'paravirtual driver', text: 'a driver written for a virtual machine: instead of imitating hardware, it shares a ring of request descriptors with the host and notifies it only when there is work.' },
      { predict: { q: 'The same 8 requests go through a paravirtual ring that notifies the host once per 8 requests. How many VM exits?', options: ['0', '1', '8', '40'], answer: 1, explain: 'Writing descriptors into the shared ring is an ordinary memory write. Only the notification exits: one for the batch of 8.' } },
      { topic: 'virt-io-paths', input: { mode: 'paravirtual' }, frame: 5, caption: 'Paravirtual I/O, 8 requests: 1 VM exit, 1 injected interrupt, 8 data copies.' },
      { def: 'device passthrough', text: 'a real device given to one guest. Its registers are mapped into the guest; its DMA goes through the IOMMU, which translates guest-physical addresses and stops the device reaching any other memory.' },
      { topic: 'virt-io-paths', input: { mode: 'passthrough' }, frame: 2, caption: 'The device writes into guest memory by DMA; the IOMMU translates its guest-physical addresses and confines it to this guest.' },
      { topic: 'virt-io-paths', input: { mode: 'passthrough' }, frame: 4, caption: 'The price: the device cannot be shared, or easily moved with the guest to another machine.' },
      { topic: 'virt-io-compare', frame: 4, caption: '16 requests: from 80 exits (emulated) to 2 (paravirtual) to 0 (passed through).' },
      vmm('Count the exits in the VM lab', 'Four requests sent one at a time, with no posted interrupts: change the batch size and the register accesses and watch the three paths.', { mode: 'io', ioReq: 4, ioBatch: 1, ioPosted: false, ioRegs: 4, ioCross: false }),
      { h: 'Recap' },
      { list: ['Emulated: any driver works; every register access exits.', 'Paravirtual: a shared ring, one exit per batch; the guest needs a special driver.', 'Passthrough: no exits, IOMMU-confined DMA; the device serves one guest and is hard to migrate.'] },
      X('vrt-x-io-emulated'), X('vrt-x-io-batch'), X('vrt-x-io-table'), X('vrt-x-posted'), X('vrt-x-io-price'),
    ],
  });

  C.lesson({
    id: 'vrt-vm-cont', chapter: 'vrt-io', title: 'A virtual machine against a container', minutes: 7,
    summary: 'A container is not a machine: it is a group of ordinary processes on the host\'s own kernel, given their own view of names (namespaces) and their own limits (control groups). A system call from a container costs what it costs from any process. A virtual machine has its own kernel on top of the monitor: two kernels on every I/O path, and exits to cross between them, but a far smaller surface shared with its neighbours.',
    blocks: [
      'Two ways to give an application a box of its own: a virtual machine, or a container. Both look like a separate computer from inside. What does one `read()` cost in each, and what do neighbours share?',
      { topic: 'virt-vm-container', frame: 1, caption: 'A native process: read() traps into the kernel and returns, 2 mode switches.' },
      { predict: { q: 'The same read() from a process in a container. What does it cost?', options: ['The same 2 mode switches: it is the same kernel', 'One VM exit more', 'Twice as much: two kernels'], answer: 0, explain: 'A container\'s processes run on the host kernel directly; namespaces change only what they can see.' } },
      { topic: 'virt-vm-container', frame: 2, caption: 'A container: the same host kernel, the same 2 mode switches.' },
      { topic: 'virt-vm-container', frame: 3, caption: 'A virtual machine: read() traps into the guest kernel, whose paravirtual driver then reaches the host with 1 VM exit: two kernels on the path.' },
      { topic: 'virt-vm-container', input: { io: 'emulated', n: 4 }, frame: 3, caption: 'With an emulated disk, four reads take 20 VM exits.' },
      { topic: 'virt-vm-container', frame: 4, caption: 'Containers cost no more than native processes, but share one kernel, so a kernel flaw reaches them all; a virtual machine has its own kernel, stronger isolation, and pays for it in exits.' },
      { warn: 'The choice is about trust as much as speed. Code from parties who do not trust each other is safer behind separate kernels; many providers run containers inside small virtual machines to get both.' },
      { h: 'Recap' },
      { list: ['Container: host kernel, native cost, isolation by namespaces and control groups.', 'Virtual machine: its own kernel, exits on the way to devices, a narrower shared surface.', 'Choose by who must be kept apart from whom.'] },
      X('vrt-x-crossings'), X('vrt-x-vm-or-cont'),
    ],
  });

  // =========================================================================================================
  // Chapter 4: containers
  // =========================================================================================================
  C.lesson({
    id: 'vrt-ns', chapter: 'vrt-cont', title: 'Namespaces: one kernel, many views', minutes: 8,
    summary: 'A namespace gives a group of processes their own copy of one kind of name: process ids (pid), mount points (mount), network devices and addresses (network), the hostname (uts), user ids (user). A process in a container\'s pid namespace sees only that namespace\'s processes, numbered from 1, and kill() resolves a pid inside the sender\'s own namespace, so processes outside cannot even be named. All of it is one kernel\'s data, shown through different namespaces.',
    blocks: [
      'Inside a container, `ps` shows three processes and the first is pid 1, as if the machine had just booted. On the host, the same processes are pids 4, 5 and 6 among many others. Which is true?',
      { def: 'namespace', text: 'a kernel feature that wraps one global resource (process ids, mounts, network stack, hostname, user ids) so that processes inside see their own instance of it.' },
      { topic: 'virt-namespaces', frame: 0, caption: 'One kernel runs 8 processes: init, sshd and containerd on the host, and two containers. We look from worker, host pid 5, in the web namespaces.' },
      { predict: { q: 'How many processes can worker (host pid 5) see?', options: ['2', '3', '8'], answer: 1, explain: 'Its pid namespace, web, holds only nginx and the two workers.' } },
      { topic: 'virt-namespaces', frame: 1, caption: 'worker lists processes: its pid namespace holds only 3, numbered 1, 2, 3, and it sees itself as pid 2.' },
      { topic: 'virt-namespaces', frame: 3, caption: 'Its network namespace has lo and eth0 10.1.0.2: not the host\'s interfaces.' },
      { topic: 'virt-namespaces', input: { viewer: '2', target: 7 }, frame: 1, caption: 'From the host\'s sshd, in the host\'s pid namespace: all 8 processes, with their host pids. Both answers to the opening question are true.' },
      { topic: 'virt-namespaces', input: { viewer: '8', target: 3 }, frame: 5, caption: 'A kill() names a pid in the sender\'s own namespace: the db writer\'s pid 3 does not exist there.' },
      vmm('Namespaces in the VM lab', 'Two containers, the db one sharing the host\'s network: look from different processes and send a kill() across.', { mode: 'ns', nsCont: [{ name: 'web', procs: 'nginx worker worker', hostname: 'web-1', net: 'own' }, { name: 'db', procs: 'dbserver writer', hostname: 'db-1', net: 'host' }], nsViewers: [7, 1], nsFrom: 7, nsTo: 4 }),
      { h: 'Recap' },
      { list: ['pid, mount, network, uts and user namespaces each give their own view of one kind of name.', 'A container\'s first process is pid 1 inside, and an ordinary pid outside.', 'Signals are resolved in the sender\'s namespace: what cannot be named cannot be signalled.'] },
      X('vrt-x-ns-see'), X('vrt-x-ns-pid'), X('vrt-x-ns-kill'), X('vrt-x-ns-kinds'),
    ],
  });

  C.lesson({
    id: 'vrt-cg', chapter: 'vrt-cont', title: 'Control groups: shares, quotas, memory limits', minutes: 8,
    summary: 'A control group gathers processes so the kernel can account for them and limit them together. Weights share the CPU in proportion when groups compete. A quota caps a group\'s CPU per period, even when the CPU would otherwise sit idle. A memory limit is enforced inside the group: when the group goes over, the out-of-memory killer ends the group\'s largest process, and no other group is touched.',
    blocks: [
      'Namespaces hide the neighbours, but they do not stop a container from taking every CPU cycle and every byte of memory on the machine. What does?',
      { def: 'control group', text: 'a set of processes that the kernel accounts for and limits as one: a CPU weight, a CPU quota per period, a memory limit, and more.' },
      { topic: 'virt-cgroups', input: { cfg: 'weights' }, frame: 31, caption: 'Weights 3 : 2 : 1 with every group busy: gold ran 15 of 30 ticks, silver 10, bronze 5.' },
      { topic: 'virt-cgroups', frame: 7, caption: 'batch has used its quota of 2 ticks for this period: it waits for the next period, and db runs instead.' },
      { predict: { q: 'A single busy group has a quota of 3 ticks per period of 5. Over 20 ticks, with nobody else on the machine, how many ticks does it run?', options: ['20', '12', '3'], answer: 1, explain: '3 ticks in each of the 4 periods: 12, and the CPU sits idle for the other 8. A quota is a cap, not a share.' } },
      { topic: 'virt-cgroups', input: { cfg: 'quota', ticks: 20, period: 5 }, frame: 21, caption: 'capped ran 12 of 20 ticks and was throttled for 8.' },
      { topic: 'virt-cgroups', frame: 23, caption: 'db\'s memory reaches 15, over its limit 12: the out-of-memory killer ends cache, the largest process in that group only.' },
      { topic: 'virt-cgroups', frame: 31, caption: 'After 30 ticks: web ran 16, batch 6 (throttled 18), db 8, having lost cache. Shares of the busy ticks: 53%, 20% and 27%.' },
      vmm('Control groups in the VM lab', 'A leaky process in a group with a memory limit, beside a group with a quota: change the limits and see who is stopped.', { mode: 'cg', cgGroups: [{ name: 'api', weight: 100, quota: 0, mem: 20 }, { name: 'ml', weight: 300, quota: 6, mem: 0 }], cgProcs: [{ name: 'api', group: 'api', work: 0, grow: 1, mem: 4 }, { name: 'leaky', group: 'api', work: 0, grow: 4, mem: 2 }, { name: 'train', group: 'ml', work: 0, grow: 0, mem: 8 }, { name: 'eval', group: 'ml', work: 6, grow: 0, mem: 2 }], cgTicks: 40, cgPeriod: 8 }),
      { table: [['', 'Namespaces', 'Control groups'], ['Answer the question', 'what can I see?', 'how much may I use?'], ['Examples', 'pid, mount, network, uts, user', 'CPU weight and quota, memory limit'], ['Without it', 'a container sees the host\'s processes and files', 'a container can starve its neighbours']], caption: 'The two halves of a container.' },
      { h: 'Recap' },
      { list: ['Weights share the CPU in proportion among groups that want it.', 'A quota caps a group per period, even on an idle machine.', 'A memory limit is enforced inside the group: the killer picks the group\'s largest process.', 'A container = namespaces (seeing) + control groups (using), on one shared kernel.'] },
      X('vrt-x-cg-weights'), X('vrt-x-cg-quota'), X('vrt-x-cg-oom'), X('vrt-x-cg-or-ns'),
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
