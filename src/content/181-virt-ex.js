// Part 18, virtual machines and containers: the exercises of chapters 1 and 2 (virtualising the CPU, virtualising
// memory). Every number in a text, an answer or a hint is worked out here by the engines (S.Virt): which
// instructions trap, what each technique does with each one, the cycles it charges, the reads of a two-dimensional
// walk, and what shadow and nested paging pay for one stream of guest events. Nothing is typed from memory.
(function (S) {
  'use strict';
  const C = S.Content, V = S.Virt;
  if (!C || !V || C.exercises.has('vrt-x-sensitive')) return;
  const I = (op, arg) => (arg === undefined ? { op } : { op, arg });
  const insText = (x) => x.op + (x.arg !== undefined ? ' ' + (x.op === 'lcr3' ? '0x' + x.arg.toString(16) : x.arg) : '');
  const listing = (prog) => '`' + prog.map(insText).join('; ') + '`';
  const list = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
  const run = (program, technique, o) => V.run(Object.assign({ program, technique, arch: 'x86', repeat: 1, ept: true }, o || {}));
  /** what happened to each instruction of one pass: native, trap, wrong, call or exit */
  const fates = (r) => r.steps.filter((s) => s.op && s.kind !== 'translate').map((s) => s.kind);
  const COST = V.COST;

  // =========================================================================================================
  // Chapter 1: which instructions break trap-and-emulate
  // =========================================================================================================
  const PG = V.popekGoldberg('x86'), PGc = V.popekGoldberg('classic');
  const ALL = Object.keys(V.INSTR);
  C.exercise({ id: 'vrt-x-sensitive', chapter: 'vrt-cpu', title: 'Sensitive, but no trap', level: 1, kind: 'set',
    text: ['A guest kernel may use these instructions: ' + list(ALL.map((o) => '`' + o + '`')) + '. On 32-bit x86 before hardware support, the privileged ones are ' + list(V.ARCH.x86.privileged.map((o) => '`' + o + '`')) + ': only they trap in user mode. Which instructions are sensitive (they read or change privileged state) but do not trap? Answer as a set, like {add, load}.'],
    answer: '{' + PG.violators.join(', ') + '}',
    hints: ['First list the sensitive ones: everything that touches the interrupt flag, the mode, the descriptor tables, the page-table base, devices or halting.', 'Sensitive here: ' + list(PG.sensitive) + '. Now take away the ones that trap.', 'Sensitive but not privileged: {' + PG.violators.join(', ') + '}. ' + PG.say],
    solution: '{' + PG.violators.join(', ') + '}', wrong: ['{' + PG.sensitive.join(', ') + '}', '{popf, pushf}', '{' + V.ARCH.x86.privileged.join(', ') + '}'],
    whyNot: 'The set is the sensitive instructions minus the privileged ones: those run in user mode without a trap, so the monitor never sees them.' });

  C.exercise({ id: 'vrt-x-pg-rule', chapter: 'vrt-cpu', title: 'When trap-and-emulate works', level: 1, kind: 'choice',
    text: ['A monitor runs a guest kernel in user mode and emulates whatever traps. On which machine is that enough to virtualise the guest correctly?'],
    options: ['One where every sensitive instruction is privileged', 'One where every privileged instruction is sensitive', 'One with more privileged than sensitive instructions', 'Any machine with a user mode and a kernel mode'],
    answer: 0, whyNot: { 1: 'That is the wrong way round: what matters is that nothing sensitive escapes the trap.', 2: 'Counting is not the test: one sensitive instruction that does not trap is enough to break it.', 3: '32-bit x86 has both modes, yet ' + list(PG.violators) + ' run without a trap.' },
    hints: ['The monitor only gets control when an instruction traps.', 'Which instructions must the monitor see? The ones that touch privileged state: the sensitive ones.', 'Every sensitive instruction must trap, so sensitive ⊆ privileged. On the classic machine here all ' + PGc.sensitive.length + ' are privileged; on old x86, ' + PG.violators.length + ' are not.'],
    solution: 0, wrong: [1, 3] });

  C.exercise({ id: 'vrt-x-guest-mode', chapter: 'vrt-cpu', title: 'Where the guest kernel really runs', level: 1, kind: 'choice',
    text: ['Under trap-and-emulate, a guest kernel executes `cli` and believes interrupts are now off. In which mode is the real CPU, and what does the monitor change?'],
    options: ['User mode; the monitor clears the virtual interrupt flag of the guest\'s virtual CPU', 'Kernel mode; the real interrupt flag is cleared', 'User mode; the real interrupt flag is cleared', 'Kernel mode; nothing is changed'],
    answer: 0, whyNot: { 1: 'A guest kernel in real kernel mode could do anything to the host: the monitor deprivileges it.', 2: 'The host still needs its interrupts; only the guest\'s view changes.', 3: 'Then the guest would keep running with interrupts it thinks are off.' },
    hints: ['If the guest kernel ran in real kernel mode, would cli trap?', 'It runs in user mode, so the privileged cli traps to the monitor.', run([I('cli')], 'trap-emulate').steps.find((s) => s.op === 'cli').say],
    solution: 0, wrong: [1, 2] });

  C.exercise({ id: 'vrt-x-popf', chapter: 'vrt-cpu', title: 'A silent popf', level: 2, kind: 'choice',
    text: ['On old x86 under trap-and-emulate, the guest kernel\'s virtual interrupt flag is 0 and it runs `popf` to set it back to 1. What happens?'],
    options: ['popf runs without a trap and the CPU ignores the change in user mode: the virtual flag stays 0 and the monitor never knows', 'popf traps and the monitor sets the virtual flag to 1', 'popf turns the real interrupts on for the whole machine', 'The CPU raises a general protection fault and the guest crashes'],
    answer: 0, whyNot: { 1: 'That is what happens on a classically virtualisable machine, where popf is privileged.', 2: 'In user mode popf may not change the real interrupt flag.', 3: 'popf is not privileged on old x86: no fault, no trap.' },
    hints: ['Is popf privileged on old x86?', 'It is not, so it runs natively in user mode, where the interrupt-flag part of the write is dropped.', run([I('cli'), I('popf', 1)], 'trap-emulate').steps.find((s) => s.op === 'popf').say],
    solution: 0, wrong: [1, 3] });

  // the fate of each instruction under each technique
  const FP = [I('load'), I('cli'), I('in'), I('pushf'), I('sti'), I('smsw'), I('hlt')];
  const TECH = [['trap-emulate', 'trap and emulate'], ['binary-translation', 'translate'], ['hardware', 'hardware']];
  const FR = Object.fromEntries(TECH.map(([t]) => [t, run(FP, t)]));
  const fcells = {};
  FP.forEach((x, i) => TECH.forEach(([t, name]) => { fcells[x.op + '|' + name] = fates(FR[t])[i]; }));
  const fwrong1 = Object.assign({}, fcells, { 'pushf|trap and emulate': 'trap', 'smsw|trap and emulate': 'trap' });
  const fwrong2 = Object.assign({}, fcells, { 'cli|hardware': 'exit', 'sti|hardware': 'exit' });
  C.exercise({ id: 'vrt-x-fate-table', chapter: 'vrt-cpu', title: 'Three techniques, one handler', level: 3, kind: 'table',
    text: ['A guest kernel\'s interrupt handler runs once on old 32-bit x86: ' + listing(FP) + '. For each instruction and each technique (trap and emulate; translate, for binary translation; hardware, for hardware support with nested paging on), write what happens: **native** (runs directly), **trap** (traps and is emulated), **wrong** (runs without a trap and acts on the real machine), **call** (rewritten into a call to the monitor), or **exit** (a VM exit).'],
    rows: FP.map((x) => x.op), cols: TECH.map((t) => t[1]), corner: 'code', cellKind: 'text', cells: fcells,
    hints: ['load is not sensitive: it runs natively everywhere. The rest are sensitive; ' + list(PG.violators.filter((o) => FP.some((x) => x.op === o))) + ' are not privileged on old x86.', 'Binary translation rewrites every sensitive instruction of the block into a call. Hardware support runs most of them in guest mode on the guest\'s own state, and exits only for I/O and hlt.', 'Trap-and-emulate: ' + fates(FR['trap-emulate']).join(', ') + '. Binary translation: ' + fates(FR['binary-translation']).join(', ') + '. Hardware: ' + fates(FR.hardware).join(', ') + '.'],
    solution: fcells, wrong: [fwrong1, fwrong2] });

  const TE = run(FP, 'trap-emulate');
  C.exercise({ id: 'vrt-x-wrong-count', chapter: 'vrt-cpu', title: 'How many go wrong?', level: 1, kind: 'number',
    text: ['The same handler, ' + listing(FP) + ', runs once under trap-and-emulate on old x86. How many of its instructions do the wrong thing without a trap?'],
    answer: TE.wrong.length, whyNot: { [String(TE.traps)]: 'Those are the instructions that trap; they are emulated correctly.', [String(TE.traps + TE.wrong.length)]: 'That counts every sensitive instruction; the privileged ones trap and are fine.', '*': 'Count the sensitive instructions that are not privileged on old x86.' },
    hints: ['Only a sensitive instruction that does not trap can go wrong.', 'Among the instructions here, the ones that are sensitive but unprivileged on old x86 are ' + list(PG.violators) + '.', 'In this handler: ' + TE.wrong.map((w) => w.op + ' (' + w.why + ')').join('; ') + '. That is ' + TE.wrong.length + '.'],
    solution: TE.wrong.length, wrong: [TE.traps, TE.traps + TE.wrong.length] });

  // cycle counts
  const CP = [I('add'), I('cli'), I('load'), I('lcr3', 0x5000), I('store'), I('sti'), I('add'), I('add')];
  const TEc = run(CP, 'trap-emulate', { arch: 'classic' });
  C.exercise({ id: 'vrt-x-te-cycles', chapter: 'vrt-cpu', title: 'The price of trapping', level: 2, kind: 'number',
    text: ['On a classically virtualisable machine, a guest kernel runs ' + listing(CP) + ' once under trap-and-emulate. The model charges ' + COST.native + ' cycle for an instruction that runs natively and ' + COST.trap + ' cycles for a trap and its emulation. How many cycles in all?'],
    answer: TEc.cycles, whyNot: { [String(CP.length)]: 'That is the cost if nothing trapped.', [String(TEc.traps * COST.trap)]: 'Add the instructions that ran natively, one cycle each.', '*': 'Count the traps and the native instructions separately.' },
    hints: ['Which of these are sensitive? On this machine every sensitive one traps.', TEc.traps + ' traps (cli, lcr3, sti) and ' + TEc.native + ' native instructions.', TEc.traps + ' × ' + COST.trap + ' + ' + TEc.native + ' × ' + COST.native + ' = ' + TEc.cycles + ' cycles.'],
    solution: TEc.cycles, wrong: [CP.length, TEc.traps * COST.trap] });

  const BT3 = run(CP, 'binary-translation', { repeat: 3 }), BT1 = run(CP, 'binary-translation');
  const btCalls = fates(BT1).filter((k) => k === 'call').length, btNat = fates(BT1).filter((k) => k === 'native').length;
  C.exercise({ id: 'vrt-x-bt-cycles', chapter: 'vrt-cpu', title: 'Translate once, run three times', level: 2, kind: 'number',
    text: ['The same block, ' + listing(CP) + ', runs 3 times under binary translation. Before the first run the monitor translates the block, at ' + COST.translate + ' cycles per instruction, and caches it. Each sensitive instruction becomes a call costing ' + COST.call + ' cycles; the others run natively at ' + COST.native + ' cycle. How many cycles for the 3 runs?'],
    answer: BT3.cycles, whyNot: { [String(3 * BT1.cycles)]: 'The translated block is cached: the translation is paid once, not on every run.', [String(3 * (btCalls * COST.call + btNat * COST.native))]: 'Add the one translation of the block before the first run.', '*': 'Translation once, then calls and native instructions on every run.' },
    hints: ['Translation: every instruction of the block, once.', CP.length + ' × ' + COST.translate + ' = ' + CP.length * COST.translate + ' cycles to translate. Each run: ' + btCalls + ' calls and ' + btNat + ' native instructions.', CP.length * COST.translate + ' + 3 × (' + btCalls + ' × ' + COST.call + ' + ' + btNat + ' × ' + COST.native + ') = ' + BT3.cycles + ' cycles.'],
    solution: BT3.cycles, wrong: [3 * BT1.cycles, 3 * (btCalls * COST.call + btNat * COST.native)] });

  const HWn = run(CP, 'hardware', { ept: false }), HWy = run(CP, 'hardware', { ept: true });
  C.exercise({ id: 'vrt-x-hw-exits', chapter: 'vrt-cpu', title: 'Exits without nested paging', level: 2, kind: 'number',
    text: ['Under hardware support, the CPU exits to the monitor only on what the monitor asked to see: I/O, hlt, and, when there is no nested paging, loads of the page-table base. The block ' + listing(CP) + ' runs 4 times without nested paging. How many VM exits?'],
    answer: 4 * HWn.exits, whyNot: { [String(HWn.exits)]: 'That is one run; the block runs 4 times.', '0': 'Without nested paging, lcr3 must exit so the monitor can switch to its own table for that process.', '*': 'Find what exits in one run, then multiply.' },
    hints: ['cli and sti run in guest mode on the guest\'s own state.', 'Without nested paging, lcr3 exits: ' + HWn.exits + ' exit a run. With nested paging it would be ' + HWy.exits + '.', HWn.exits + ' × 4 = ' + 4 * HWn.exits + ' exits.'],
    solution: 4 * HWn.exits, wrong: [HWn.exits, 0] });

  // when does translation pay off against hardware without nested paging?
  const cost = (t, n, ept) => run(CP, t, { repeat: n, ept }).cycles;
  let even = 1;
  while (even < 50 && cost('binary-translation', even) >= cost('hardware', even, false)) even++;
  C.exercise({ id: 'vrt-x-break-even', chapter: 'vrt-cpu', title: 'When translation pays', level: 3, kind: 'number',
    text: ['Compare binary translation with hardware support without nested paging on the block ' + listing(CP) + ', run n times. Costs: native ' + COST.native + ', translated call ' + COST.call + ', translation ' + COST.translate + ' per instruction (once), VM exit ' + COST.exit + '. What is the smallest n for which binary translation costs fewer cycles in total?'],
    answer: even, whyNot: { '1': 'Once: translation costs ' + cost('binary-translation', 1) + ' cycles against ' + cost('hardware', 1, false) + ' for hardware.', [String(even + 1)]: 'Check one run fewer: ' + even + ' runs already favour translation.', '*': 'Write both totals as a function of n and compare.' },
    hints: ['Binary translation: a fixed translation cost, then a small cost per run. Hardware without nested paging: no fixed cost, but an exit per run for lcr3.', 'Translation: ' + CP.length * COST.translate + ' + ' + (cost('binary-translation', 2) - cost('binary-translation', 1)) + 'n. Hardware: ' + cost('hardware', 1, false) + 'n.', 'n = ' + (even - 1) + ': ' + cost('binary-translation', even - 1) + ' against ' + cost('hardware', even - 1, false) + '; n = ' + even + ': ' + cost('binary-translation', even) + ' against ' + cost('hardware', even, false) + '. So n = ' + even + '.'],
    solution: even, wrong: [1, even + 1] });

  C.exercise({ id: 'vrt-x-bt-why', chapter: 'vrt-cpu', title: 'Why translation is correct', level: 2, kind: 'choice',
    text: ['Binary translation runs a guest kernel correctly on old x86, where ' + list(PG.violators) + ' do not trap. How?'],
    options: ['Before a block of guest kernel code runs, the monitor rewrites every sensitive instruction into a call to its own emulation', 'It runs the guest kernel in real kernel mode, so nothing needs to trap', 'It interprets every guest instruction, one at a time, in software', 'It changes the processor so those instructions trap'],
    answer: 0, whyNot: { 1: 'Then the guest kernel could change the host\'s real state.', 2: 'Only sensitive instructions are rewritten; the rest run natively, which is why it is fast.', 3: 'Software cannot change which instructions the processor makes privileged; that came later, with hardware support.' },
    hints: ['The problem is instructions the monitor never sees. When could it see them, if not at run time?', 'Before the code runs: the monitor scans each block of guest kernel code first.', 'Each sensitive instruction is replaced by a call into the monitor; the translated block is cached, and ordinary instructions still run at full speed.'],
    solution: 0, wrong: [2, 1] });

  // =========================================================================================================
  // Chapter 2: the two-dimensional walk; shadow against nested paging
  // =========================================================================================================
  const c45 = V.count2d(4, 5);
  C.exercise({ id: 'vrt-x-2d-count', chapter: 'vrt-mem', title: 'A walk on a walk', level: 1, kind: 'number',
    text: ['A guest with a 4-level page table runs on a host whose table has 5 levels. With nested paging, how many page-table reads does one TLB miss cost, before the data itself is read?'],
    answer: c45, whyNot: { '9': 'That adds the levels; but every guest table\'s address must itself be walked on the host.', '20': 'That multiplies the levels, but forgets the guest entries themselves and the final host walk for the data.', '4': 'That is the native walk of the guest\'s own table.', '*': 'Count (g + 1)(h + 1) − 1.' },
    hints: ['Each guest level needs its table\'s guest-physical address translated: a whole host walk, then the guest entry itself.', 'That is 4 × (5 + 1) reads for the guest levels, then one more host walk of 5 for the data page.', '4 × 6 + 5 = (4 + 1)(5 + 1) − 1 = ' + c45 + ' reads.'],
    solution: c45, wrong: [9, 20, 4] });

  const PAIRS = [[1, 1], [2, 2], [4, 4], [5, 4]];
  const pcells = {};
  PAIRS.forEach(([g, h]) => { const r = g + ' on ' + h; pcells[r + '|nested'] = V.count2d(g, h); pcells[r + '|shadow'] = g; });
  C.exercise({ id: 'vrt-x-2d-table', chapter: 'vrt-mem', title: 'Reads per TLB miss', level: 2, kind: 'table',
    text: ['For each pair of guest and host levels ("g on h"), how many page-table reads does one TLB miss cost with nested paging, and with a shadow page table that maps guest-virtual pages straight to host frames?'],
    rows: PAIRS.map(([g, h]) => g + ' on ' + h), cols: ['nested', 'shadow'], corner: 'levels', cells: pcells,
    hints: ['Nested: (g + 1)(h + 1) − 1. Shadow: the shadow table has the guest\'s shape, so g reads.', 'For 4 on 4: (5)(5) − 1 = ' + V.count2d(4, 4) + ' nested, 4 shadow.', PAIRS.map(([g, h]) => g + ' on ' + h + ': ' + V.count2d(g, h) + ' and ' + g).join('; ') + '.'],
    solution: pcells, wrong: [Object.assign({}, pcells, { '4 on 4|nested': 16, '5 on 4|nested': 20 }), Object.assign({}, pcells, { '4 on 4|shadow': V.count2d(4, 4), '2 on 2|shadow': V.count2d(2, 2) })] });

  const W34 = V.walk2d({ guestLevels: 3, hostLevels: 4, seed: 2 });
  const reads34 = W34.steps.filter((s) => s.kind === 'host-read' || s.kind === 'guest-read' || s.kind === 'data');
  const g2at = reads34.findIndex((s) => s.kind === 'guest-read' && s.row === 1) + 1;
  C.exercise({ id: 'vrt-x-2d-order', chapter: 'vrt-mem', title: 'Which read is it?', level: 2, kind: 'number',
    text: ['A nested walk with 3 guest levels on 4 host levels reads the tables in a fixed order: for each guest level, the 4 host reads that translate the guest table\'s address, then the guest entry itself; then 4 host reads for the data page. Counting from read 1, which read fetches the guest\'s level-2 entry?'],
    answer: g2at, whyNot: { '2': 'Each guest level is preceded by a whole host walk of its table\'s address.', [String(g2at - 1)]: 'That is the last host read before it, for the level-2 table\'s address.', '*': 'Each guest level takes h + 1 reads.' },
    hints: ['Guest level 1 takes 4 host reads and then its entry: reads 1 to 5.', 'Guest level 2 takes reads 6 to 9 for the host walk.', 'Its entry is read ' + g2at + ': ' + reads34[g2at - 1].say],
    solution: g2at, wrong: [2, g2at - 1] });

  // one stream of guest events under both designs
  const EV = [{ op: 'access', page: 1 }, { op: 'map', page: 2 }, { op: 'access', page: 2 }, { op: 'switch', to: 'Q' }, { op: 'access', page: 1 }, { op: 'map', page: 4 }, { op: 'access', page: 4 }, { op: 'switch', to: 'P' }, { op: 'access', page: 2 }, { op: 'access', page: 1 }];
  const evText = (e) => (e.op === 'access' ? 'touch ' + e.page : e.op === 'map' ? 'map ' + e.page : e.op === 'unmap' ? 'unmap ' + e.page : 'switch to ' + e.to);
  const EVT = 'The guest starts in process P. Its events, in order: `' + EV.map(evText).join(', ') + '`. Guest and host tables have 4 levels each, and each process starts with an empty TLB; a switch flushes the TLB.';
  const SH = V.memVirt({ technique: 'shadow', events: EV, guestLevels: 4, hostLevels: 4 }), NE = V.memVirt({ technique: 'nested', events: EV, guestLevels: 4, hostLevels: 4 });
  const mcells = { 'VM exits|shadow': SH.exits, 'VM exits|nested': NE.exits, 'TLB misses|shadow': SH.tlbMisses, 'TLB misses|nested': NE.tlbMisses, 'table reads|shadow': SH.walkReads, 'table reads|nested': NE.walkReads };
  C.exercise({ id: 'vrt-x-sync-table', chapter: 'vrt-mem', title: 'Shadow against nested, event by event', level: 2, kind: 'table',
    text: [EVT, 'Under shadow paging the guest\'s own tables are write-protected, so every map traps, and every switch of page-table base traps too. Fill in the totals for each design.'],
    rows: ['VM exits', 'TLB misses', 'table reads'], cols: ['shadow', 'nested'], corner: 'total', cells: mcells,
    hints: ['Both designs miss the TLB on the same touches: the first touch of each page after a flush.', 'A miss costs 4 reads with a shadow table and ' + V.count2d(4, 4) + ' with nested paging. Only shadow paging exits: on each map and each switch.', 'Shadow: ' + SH.exits + ' exits, ' + SH.tlbMisses + ' misses, ' + SH.walkReads + ' reads. Nested: ' + NE.exits + ' exits, ' + NE.tlbMisses + ' misses, ' + NE.walkReads + ' reads.'],
    solution: mcells, wrong: [Object.assign({}, mcells, { 'VM exits|nested': NE.exits + 2 }), Object.assign({}, mcells, { 'table reads|nested': NE.tlbMisses * 8 })] });

  const tie = (NE.walkReads - SH.walkReads) / SH.exits;
  C.exercise({ id: 'vrt-x-sync-tie', chapter: 'vrt-mem', title: 'What an exit must cost', level: 3, kind: 'number',
    text: [EVT, 'Shadow paging pays ' + SH.exits + ' VM exits and ' + SH.walkReads + ' table reads; nested paging pays ' + NE.exits + ' exits and ' + NE.walkReads + ' reads. If one VM exit costs as much as x table reads, at what x do the two designs cost the same?'],
    answer: tie, tolerance: 0.01, whyNot: { '10': 'That is only the weight the topic assumes; here the question is where the two totals meet.', [String(NE.walkReads - SH.walkReads)]: 'That is the difference in reads; share it among the exits.', '*': 'Solve ' + SH.walkReads + ' + ' + SH.exits + 'x = ' + NE.walkReads + '.' },
    hints: ['Shadow costs ' + SH.walkReads + ' + ' + SH.exits + 'x; nested costs ' + NE.walkReads + '.', 'Set them equal and solve for x.', 'x = (' + NE.walkReads + ' − ' + SH.walkReads + ') / ' + SH.exits + ' = ' + tie + '. Above it nested paging wins; below it shadow tables do.'],
    solution: tie, wrong: [10, NE.walkReads - SH.walkReads] });

  C.exercise({ id: 'vrt-x-which-design', chapter: 'vrt-mem', title: 'Which guest favours nested paging?', level: 2, kind: 'choice',
    text: ['Which guest workload gains most from nested paging over shadow page tables?'],
    options: ['A guest that starts many short processes, editing page tables and switching between processes all the time', 'A guest running one long computation over the same few pages', 'A guest whose working set fits in the TLB', 'Every workload gains equally'],
    answer: 0, whyNot: { 1: 'Few edits and few switches: shadow paging rarely exits, and its walks are shorter.', 2: 'With hardly any TLB misses, neither design walks much, and shadow tables cost nothing extra.', 3: 'Nested paging trades exits for longer walks: it depends on how often each happens.' },
    hints: ['What does shadow paging pay that nested paging does not?', 'An exit on every edit of a guest table and every switch of page-table base. Nested paging pays instead with longer walks on each TLB miss.', 'A guest that edits tables and switches often makes shadow paging exit constantly: nested paging wins there.'],
    solution: 0, wrong: [1, 2] });
})(globalThis.Proses = globalThis.Proses || {});
