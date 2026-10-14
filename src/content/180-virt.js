// Part 18, virtual machines and containers: the chapters, and the lessons of chapters 1 and 2 (virtualising the CPU,
// virtualising memory). The lessons of chapters 3 and 4 are in 180-virt2.js; the exercises in 181-virt-ex.js and
// 181-virt-ex2.js; the tour, the course and the pages the diagram checker looks at in 182-virt-ch.js. Each lesson
// opens with a question, runs the topic that shows the idea at a chosen frame, asks for a prediction, sums up and
// leads to its exercises. Every value quoted is what the topics' own engine (S.Virt) says on the inputs given.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.chapters.some((c) => c.id === 'vrt-cpu')) return;

  C.chapter({ id: 'vrt-cpu', part: 'virtualisation', n: 1, title: 'Virtualising the CPU', blurb: 'The virtual machine monitor, trap-and-emulate and the instructions that break it, binary translation, hardware support, and what each technique costs.' });
  C.chapter({ id: 'vrt-mem', part: 'virtualisation', n: 2, title: 'Virtualising memory', blurb: 'Two page tables at once: the two-dimensional walk counted read by read, and shadow page tables against nested paging.' });
  C.chapter({ id: 'vrt-io', part: 'virtualisation', n: 3, title: 'Virtualising I/O', blurb: 'Emulated devices, paravirtual rings and devices passed straight through, with their exits, interrupts and copies counted.' });
  C.chapter({ id: 'vrt-cont', part: 'virtualisation', n: 4, title: 'Containers', blurb: 'One kernel, many views: namespaces decide what a process can see, control groups how much it may use, and when a virtual machine is the better wall.' });
  const X = (id) => ({ exercise: id });
  const I = (op, arg) => ({ op, arg: arg === undefined ? '' : String(arg) });
  const vmm = (title, text, setup) => ({ lab: 'vmm', title, text, setup });

  // =========================================================================================================
  // Chapter 1: virtualising the CPU
  // =========================================================================================================
  C.lesson({
    id: 'vrt-vmm', chapter: 'vrt-cpu', title: 'The monitor and trap-and-emulate', minutes: 8,
    summary: 'A virtual machine monitor runs a whole operating system as a guest. The guest kernel cannot be allowed real kernel mode, so the monitor runs it deprivileged, in user mode, and keeps a virtual CPU for it: a virtual mode, interrupt flag and page-table base. Ordinary instructions run directly at full speed; a privileged one traps, and the monitor carries it out on the virtual CPU, then resumes the guest.',
    blocks: [
      'A machine has one CPU, one set of page tables and one interrupt flag. Yet a laptop can run a second operating system in a window, whose kernel turns interrupts off, loads page tables and talks to disks, all while the first operating system keeps running. Whose interrupts does the guest turn off, and how is the host kept safe?',
      { def: 'virtual machine monitor', text: 'the software (also called a hypervisor) that runs guest operating systems, each in a virtual machine: a copy of the real machine that behaves the same, runs mostly at native speed, and is fully under the monitor\'s control.' },
      { def: 'trap-and-emulate', text: 'run the guest kernel in user mode; when it uses a privileged instruction, the CPU traps to the monitor, which performs the instruction\'s effect on the guest\'s virtual CPU and resumes the guest.' },
      { topic: 'virt-trap-emulate', input: { arch: 'classic' }, frame: 0, caption: 'The guest kernel is deprivileged: the real CPU is in user mode, while the virtual CPU the monitor keeps says kernel mode.' },
      { topic: 'virt-trap-emulate', input: { arch: 'classic' }, frame: 2, caption: 'cli is privileged, so in user mode it traps; the monitor sets the virtual interrupt flag to 0. The host\'s real interrupts stay on.' },
      { predict: { q: 'The next instruction is `store`, an ordinary write to memory. What does the monitor do?', options: ['Nothing: it runs directly on the CPU', 'It traps and the monitor checks the address', 'The monitor translates it first'], answer: 0, explain: 'store is not sensitive: it touches only the guest\'s own memory, which the page tables already confine. It runs at full speed with no trap. That is why a virtual machine can be nearly as fast as the real one.' } },
      { topic: 'virt-trap-emulate', input: { arch: 'classic' }, frame: 7, caption: 'lcr3 traps too: the monitor records the guest page-table base 0x3000 and switches the real one to a table it manages itself.' },
      { topic: 'virt-trap-emulate', input: { arch: 'classic' }, frame: 9, caption: 'Every sensitive instruction trapped and was emulated: correct, at 6 traps, 3002 cycles in this model.' },
      vmm('The CPU workbench of the VM lab', 'The guest kernel\'s entry code on a classically virtualisable machine, under trap-and-emulate alone. Edit the instructions and watch each one\'s fate.', { mode: 'cpu', cArch: 'classic', cTE: true, cBT: false, cHW: false }),
      { h: 'Recap' },
      { list: ['The guest kernel runs in real user mode; the monitor keeps its virtual mode, interrupt flag and page-table base.', 'Ordinary instructions run natively; privileged ones trap and are emulated on the virtual CPU.', 'Each trap costs hundreds of cycles: correctness is free only for the instructions that do not trap.'] },
      X('vrt-x-guest-mode'), X('vrt-x-te-cycles'),
    ],
  });

  C.lesson({
    id: 'vrt-popek', chapter: 'vrt-cpu', title: 'Instructions that do not trap', minutes: 8,
    summary: 'An instruction is sensitive if it reads or changes privileged state: the interrupt flag, the mode, the descriptor tables, the page-table base, devices. Trap-and-emulate works only if every sensitive instruction is privileged, so that it traps in user mode. On 32-bit x86 before hardware support, some seventeen instructions were sensitive but not privileged; popf, pushf, smsw and sgdt are four of them. They run in user mode without a trap and act on the real machine, so the guest silently goes wrong.',
    blocks: [
      'The monitor only gets control when the guest traps. What if an instruction reads or changes privileged state, and does not trap when the guest kernel runs it in user mode?',
      { def: 'sensitive instruction', text: 'one whose behaviour depends on, or changes, the machine\'s privileged state. A privileged instruction is one that traps when run in user mode.' },
      { tip: 'The condition for trap-and-emulate to work is that the sensitive instructions are a subset of the privileged ones: then the monitor sees every one.' },
      { topic: 'virt-popek-goldberg', frame: 4, caption: 'cli is sensitive and privileged: in user mode it traps, and the monitor can emulate it.' },
      { topic: 'virt-popek-goldberg', frame: 6, caption: 'popf is sensitive but not privileged on old x86: in user mode it does not trap, so the monitor never sees it.' },
      { predict: { q: 'Of the 13 instructions listed, how many are sensitive but not privileged on old x86?', options: ['None', '2', '4', '10'], answer: 2, explain: 'popf, pushf, smsw and sgdt: four. The other six sensitive ones (cli, sti, lcr3, out, in, hlt) trap.' } },
      { topic: 'virt-popek-goldberg', frame: 14, caption: 'popf, pushf, smsw and sgdt are sensitive but not privileged, four of some seventeen such instructions on the real chip: trap-and-emulate alone cannot work on this processor.' },
      { h: 'What going wrong looks like' },
      { topic: 'virt-trap-emulate', frame: 4, caption: 'The guest wanted IF = 1; in user mode the CPU silently drops the change, the virtual IF stays 0, and no trap tells the monitor.' },
      { topic: 'virt-trap-emulate', frame: 5, caption: 'pushf pushes the real flags: the guest sees the real interrupt flag (1) rather than its virtual one (0).' },
      { topic: 'virt-trap-emulate', frame: 9, caption: '3 instructions (popf, pushf, sgdt) went wrong without a trap: this guest is not virtualised correctly.' },
      { table: [['Instruction', 'Sensitive', 'Traps on old x86', 'Under trap-and-emulate'], ['add, load, store', 'no', 'no', 'runs natively, correct'], ['cli, sti, lcr3, out, in, hlt', 'yes', 'yes', 'traps, emulated, correct'], ['popf, pushf, smsw, sgdt', 'yes', 'no', 'runs natively, wrong']], caption: 'Three kinds of instruction on 32-bit x86 before hardware support.' },
      { h: 'Recap' },
      { list: ['Sensitive: touches privileged state. Privileged: traps in user mode.', 'Trap-and-emulate needs every sensitive instruction to be privileged.', 'Old x86 broke the rule with popf, pushf, smsw, sgdt and a dozen or so others, so its monitors needed another technique.'] },
      X('vrt-x-sensitive'), X('vrt-x-pg-rule'), X('vrt-x-popf'), X('vrt-x-wrong-count'),
    ],
  });

  C.lesson({
    id: 'vrt-bt', chapter: 'vrt-cpu', title: 'Binary translation', minutes: 7,
    summary: 'If some sensitive instructions will not trap, the monitor can find them before they run. Binary translation scans each block of guest kernel code before its first run and rewrites every sensitive instruction into a call into the monitor, which emulates it on the virtual CPU. The translated block is cached, so later runs pay only for the calls; ordinary instructions still run natively.',
    blocks: [
      'On old x86 the processor will not tell the monitor when the guest runs popf. The monitor cannot change the processor. Can it change the guest\'s code instead?',
      { def: 'binary translation', text: 'the monitor reads a block of guest kernel code before it runs, copies it into a cache with every sensitive instruction replaced by a call to the monitor, and runs the copy. User-mode guest code, which has nothing sensitive to hide, can still run directly.' },
      { topic: 'virt-bt-hw', frame: 1, caption: 'First run: the monitor translates the block\'s 8 instructions, rewriting 6 sensitive ones (cli, popf, pushf, sgdt, lcr3, out) into calls, and caches the result.' },
      { topic: 'virt-bt-hw', frame: 5, caption: 'popf now goes to the monitor, which loads the virtual flags: the virtual interrupt flag becomes 1. No trap, and correct.' },
      { predict: { q: 'The same block runs a second time. What does the monitor have to do first?', options: ['Translate it again', 'Nothing: the translated block is in the cache', 'Trap on every sensitive instruction'], answer: 1, explain: 'The translated block is cached; the second run starts at once and pays only for the calls.' } },
      { topic: 'virt-bt-hw', frame: 10, caption: 'Pass 2: the translated block is in the cache, so it runs at once.' },
      { topic: 'virt-bt-hw', frame: 19, caption: 'Correct: 6 sensitive instructions translated into calls, no traps. 644 cycles for two runs in this model.' },
      { tip: 'A call into the monitor is far cheaper than a trap: no change of privilege level, no saving of the whole state. Binary translation can beat trap-and-emulate even where trap-and-emulate works.' },
      { h: 'Recap' },
      { list: ['Translate each guest kernel block before it first runs; replace sensitive instructions with calls.', 'Correct on old x86, with no traps at all.', 'The translation is paid once per block; the cached copy runs again cheaply.'] },
      X('vrt-x-bt-why'), X('vrt-x-bt-cycles'),
    ],
  });

  C.lesson({
    id: 'vrt-hw', chapter: 'vrt-cpu', title: 'Hardware support, and what each technique costs', minutes: 8,
    summary: 'Processors later gained a guest mode: the guest kernel runs at its own kernel level on the guest\'s own state, and the CPU exits to the monitor only on the events the monitor chose, such as I/O and hlt (and loads of the page-table base, unless nested paging handles them). Each technique has its own cost shape: trap-and-emulate pays a trap at every sensitive instruction on every run; translation pays once to translate and a little per call; hardware pays an exit only on the chosen events.',
    blocks: [
      'Binary translation works, but it is intricate: a monitor that rewrites machine code must get every corner of the instruction set right. What if the processor itself could keep a guest\'s privileged state apart from the host\'s?',
      { def: 'hardware-assisted virtualisation', text: 'a guest mode of the CPU with its own privilege levels and its own copy of the sensitive state. In guest mode, cli, popf and their kin act on the guest\'s state; a VM exit hands control to the monitor only on the events it asked for, and a VM entry resumes the guest.' },
      { topic: 'virt-bt-hw', input: { tech: 'hardware', prog: 'entry', repeat: 1, ept: 'yes' }, frame: 4, caption: 'popf runs in guest mode on the guest\'s own state: the guest\'s interrupt flag becomes 1, with no exit.' },
      { topic: 'virt-bt-hw', input: { tech: 'hardware', prog: 'entry', repeat: 1, ept: 'yes' }, frame: 8, caption: 'out causes a VM exit: the CPU saves the guest state, the monitor passes the write to its model of the device, and a VM entry resumes the guest.' },
      { predict: { q: 'Without nested paging, which instruction of a guest context switch (pushf, cli, lcr3, popf, add, sti) must still exit?', options: ['cli', 'lcr3', 'popf', 'none'], answer: 1, explain: 'Without nested paging the monitor must switch the real page-table base to its own table for that guest process, so loading the page-table base exits.' } },
      { topic: 'virt-bt-hw', input: { tech: 'hardware', prog: 'sched', repeat: 1, ept: 'no' }, frame: 3, caption: 'lcr3 causes a VM exit: the monitor records the guest page-table base 0x4000 and switches the real one to the matching table it manages.' },
      { h: 'The cost of each technique' },
      { topic: 'virt-cpu-cost', frame: 1, caption: 'Trap-and-emulate: 3002 cycles for one run, 24016 for 8. It pays a trap at every sensitive instruction, every time.' },
      { topic: 'virt-cpu-cost', frame: 2, caption: 'Binary translation: 522 cycles for one run, 1376 for 8. The first run pays for the translation; the rest only for the calls.' },
      { topic: 'virt-cpu-cost', frame: 4, caption: 'After 8 runs the cheapest here is binary translation (1376 cycles); hardware support needed 2456, because this code uses I/O, which always exits.' },
      { topic: 'virt-cpu-cost', input: { prog: 'sched', runs: 20 }, frame: 4, caption: 'A guest context switch, with nested paging: hardware support costs 120 cycles for 20 runs; nothing exits.' },
      vmm('Translation against hardware in the VM lab', 'A loop of guest kernel code run 4 times: translation pays for itself. Change the costs of an exit or a translation and see which technique wins.', { mode: 'cpu', cProg: [I('load'), I('add'), I('cli'), I('store'), I('add'), I('sti'), I('load'), I('add')], cRepeat: 4, cHW: true, cTE: true, cBT: true }),
      { h: 'Recap' },
      { list: ['Hardware support: a guest mode with the guest\'s own sensitive state; exits only on chosen events.', 'Trap-and-emulate pays per sensitive instruction per run; translation once per block plus cheap calls; hardware per exit.', 'Which is cheapest depends on the code: I/O always exits, a context switch may not.'] },
      X('vrt-x-fate-table'), X('vrt-x-hw-exits'), X('vrt-x-break-even'),
    ],
  });

  // =========================================================================================================
  // Chapter 2: virtualising memory
  // =========================================================================================================
  C.lesson({
    id: 'vrt-2d', chapter: 'vrt-mem', title: 'The two-dimensional walk', minutes: 9,
    summary: 'A guest page table maps guest-virtual addresses to guest-physical ones, and the host\'s maps guest-physical to host-physical. With nested paging the hardware walks both. Every guest table\'s address is itself guest-physical, so each guest level costs a whole host walk plus the read of the guest entry, and the final guest-physical address needs one more host walk: (g + 1)(h + 1) − 1 table reads for g guest levels and h host levels, 24 for four and four, against 4 natively.',
    blocks: [
      'The guest kernel builds page tables, as any kernel does, and the frames it writes in them are the frames of its own virtual machine. But those are not real frames: the host decides where each guest frame really lives. On a TLB miss, how many tables must the hardware read to find one byte?',
      { def: 'guest-physical address', text: 'an address in the memory the guest believes it has. The guest\'s table maps guest-virtual to guest-physical; the host\'s (nested, or extended) table maps guest-physical to host-physical.' },
      { topic: 'virt-walk-2d', input: { g: 2, h: 2, seed: 5 }, frame: 0, caption: 'Two guest levels on two host levels. The guest\'s root table is at a guest-physical address, which the hardware must itself translate first.' },
      { topic: 'virt-walk-2d', input: { g: 2, h: 2, seed: 5 }, frame: 3, caption: 'Reads 1 and 2 walk the host table to find where the guest\'s root table really is; read 3 is the guest level-1 entry itself.' },
      { predict: { q: 'With 2 guest levels and 2 host levels, how many table reads in all before the data?', options: ['4', '6', '8', '9'], answer: 2, explain: 'Each of the 2 guest levels costs 2 host reads plus the entry (3 each, 6), then 2 more host reads translate the data page: 8 = (2 + 1)(2 + 1) − 1.' } },
      { topic: 'virt-walk-2d', input: { g: 2, h: 2, seed: 5 }, frame: 9, caption: '8 table reads in all: 2 guest levels each needing 2 host reads plus the entry, and 2 more for the data. Natively it would be 2.' },
      { topic: 'virt-walk-2d', frame: 25, caption: 'Four and four, as on x86-64: 24 table reads for one TLB miss, against 4 natively. The grid fills row by row.' },
      { math: 'reads = g × (h + 1) + h = (g + 1)(h + 1) − 1\n4 on 4: 24     5 on 4: 29     2 on 2: 8' },
      { tip: 'This is why TLBs matter even more inside a virtual machine, and why large pages on the host (fewer host levels) help guests so much.' },
      vmm('Your own address in the VM lab', 'Two guest levels on two host levels: type a guest-virtual address and watch the grid fill read by read, then the same address through a shadow table.', { mode: 'walk', wG: 2, wH: 2, wAddr: '0x2f_a123', wShadow: true }),
      { h: 'Recap' },
      { list: ['Two tables: guest-virtual to guest-physical, and guest-physical to host-physical.', 'Each guest level needs a host walk of its table\'s address, plus the entry.', '(g + 1)(h + 1) − 1 reads per TLB miss: 24 for four on four.'] },
      X('vrt-x-2d-count'), X('vrt-x-2d-order'), X('vrt-x-2d-table'),
    ],
  });

  C.lesson({
    id: 'vrt-shadow', chapter: 'vrt-mem', title: 'Shadow page tables against nested paging', minutes: 9,
    summary: 'Before nested paging, a monitor kept a shadow page table for each guest process, mapping guest-virtual pages straight to host frames, and pointed the real MMU at it: a TLB miss cost only g reads. But the guest\'s own tables must then be write-protected so that every edit traps and the monitor can copy it, and every switch of page-table base must trap too. Nested paging removes those exits and pays with longer walks. Which is cheaper depends on how often the guest edits its tables and switches processes.',
    blocks: [
      'The two-dimensional walk is long. A monitor could instead build one combined table for each guest process, guest-virtual straight to host-physical, and let the hardware walk that. What does it then have to watch for?',
      { def: 'shadow page table', text: 'a table the monitor builds and the real MMU uses, combining the guest\'s mapping with the host\'s. It must be kept in step with the guest\'s own table, which the guest edits freely as far as it knows.' },
      { topic: 'virt-shadow-nested', frame: 1, caption: 'A TLB miss: 4 reads through the shadow table, 24 with nested paging.' },
      { topic: 'virt-shadow-nested', frame: 4, caption: 'The guest maps page 3. Shadow: its table is write-protected, so the write traps, a VM exit, and the monitor fills the shadow entry too. Nested: an ordinary write, no exit.' },
      { predict: { q: 'Next the guest switches from process P to process Q. Which design takes a VM exit?', options: ['Shadow paging', 'Nested paging', 'Both', 'Neither'], answer: 0, explain: 'With shadow paging the monitor must switch to Q\'s shadow table, so loading the page-table base traps. With nested paging the guest loads it itself.' } },
      { topic: 'virt-shadow-nested', frame: 6, caption: 'Shadow: loading Q\'s page-table base traps so the monitor can switch to Q\'s shadow table, which it must build first.' },
      { topic: 'virt-shadow-nested', frame: 13, caption: 'Shadow: 5 exits and 24 table reads. Nested: no exits and 144 reads. Counting an exit as 10 reads, shadow tables win here, 74 against 144; at 24 reads an exit, they would tie.' },
      { topic: 'virt-shadow-nested', input: { events: 'switchy' }, frame: 10, caption: 'Many process switches: shadow paging takes 4 exits for 5 misses; the margin narrows to 60 against 120.' },
      { table: [['', 'Shadow page tables', 'Nested paging'], ['TLB miss', 'g reads', '(g + 1)(h + 1) − 1 reads'], ['Guest edits its table', 'a VM exit', 'nothing'], ['Guest switches process', 'a VM exit', 'nothing'], ['Monitor\'s work', 'keep every shadow in step', 'keep one host table']], caption: 'What each design pays, and when.' },
      vmm('Weigh an exit yourself', 'A guest that keeps editing its tables. Change what a VM exit costs in table reads, and see where the two designs cross.', { mode: 'sync', sEvents: [{ op: 'map', arg: '3' }, { op: 'map', arg: '4' }, { op: 'access', arg: '3' }, { op: 'access', arg: '4' }, { op: 'switch', arg: 'Q' }, { op: 'access', arg: '1' }, { op: 'switch', arg: 'P' }, { op: 'access', arg: '3' }], sExit: 20 }),
      { h: 'Recap' },
      { list: ['Shadow tables: short walks, but every guest table edit and every switch traps.', 'Nested paging: no exits for tables, but long walks on every TLB miss.', 'Many edits and switches favour nested paging; a stable working set favours shadow tables.'] },
      X('vrt-x-sync-table'), X('vrt-x-which-design'), X('vrt-x-sync-tie'),
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
