// Part 18, virtual machines and containers: the families, and the instruction programs the CPU topics share.
(function (S) {
  'use strict';
  const fam = (id, order, title, blurb) => S.family({ id, part: 'virtualisation', order, title, blurb });
  fam('p18-cpu', 10, 'Virtualising the CPU', 'The virtual machine monitor, trap-and-emulate and the instructions that break it, binary translation and hardware support, and what each costs.');
  fam('p18-memory', 20, 'Virtualising memory', 'Two page tables at once: the two-dimensional walk counted read by read, and shadow page tables against nested paging.');
  fam('p18-io', 30, 'Virtualising I/O', 'Emulated devices, paravirtual rings and devices passed straight through, and a virtual machine against a container counted in crossings.');
  fam('p18-containers', 40, 'Containers', 'One kernel, many views: namespaces decide what a process can see, control groups how much it may use.');

  const P18 = (S.P18 = S.P18 || {});
  const I = (op, arg) => (arg === undefined ? { op } : { op, arg });
  P18.PROGS = {
    entry: { label: 'Guest kernel entry: flags, tables, a device', program: [I('add'), I('cli'), I('store'), I('popf', 1), I('pushf'), I('sgdt'), I('lcr3', 0x3000), I('out')] },
    irq: { label: 'An interrupt handler', program: [I('cli'), I('load'), I('in'), I('store'), I('sti'), I('hlt')] },
    sched: { label: 'A context switch in the guest', program: [I('pushf'), I('cli'), I('lcr3', 0x4000), I('popf', 0), I('add'), I('sti')] },
    plain: { label: 'Arithmetic and memory only', program: [I('add'), I('load'), I('store'), I('add'), I('load')] },
  };
  P18.progOptions = () => Object.entries(P18.PROGS).map(([value, p]) => ({ value, label: p.label }));
  P18.insText = (x) => x.op + (x.arg !== undefined ? ' ' + (x.op === 'lcr3' ? '0x' + x.arg.toString(16) : x.arg) : '');
})(globalThis.Proses = globalThis.Proses || {});
