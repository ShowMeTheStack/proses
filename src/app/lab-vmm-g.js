// The VM lab, registered: six workbenches behind one Workbench select. The 2-D walk: guest and host levels and a
// guest-virtual address, walked read by read under nested paging, then through a shadow table. Shadow against nested:
// a stream of guest events and what keeping a shadow table in sync costs. The CPU: a guest kernel's instructions
// under trap-and-emulate, binary translation and hardware support, with the cycle costs. I/O: emulated, paravirtual
// and passthrough paths. Namespaces: one process table seen from inside and outside containers. Control groups:
// weights, quotas and memory limits on a toy scheduler. The diagram checks cover every preset.
(function (S) {
  'use strict';
  const VX = S.VmmLab;
  const on = (m) => (v) => v.mode === m;
  const opt = (pairs) => pairs.map(([value, label]) => ({ value, label }));
  const E = (op, arg) => ({ op, arg: String(arg) });
  const I = (op, arg) => ({ op, arg: arg === undefined ? '' : String(arg) });
  const EV_MIX = [E('access', 1), E('access', 2), E('access', 1), E('map', 3), E('access', 3), E('switch', 'Q'), E('access', 1), E('access', 5), E('switch', 'P'), E('access', 2)];
  const EV_MAPPER = [E('map', 3), E('map', 4), E('map', 5), E('access', 3), E('access', 4), E('access', 5), E('unmap', 3), E('map', 6), E('access', 6)];
  const EV_SWITCHY = [E('access', 1), E('switch', 'Q'), E('access', 1), E('switch', 'P'), E('access', 1), E('switch', 'Q'), E('access', 1), E('switch', 'P'), E('access', 2)];
  const EV_HOT = [E('access', 1), E('access', 2), E('access', 1), E('access', 2), E('access', 1), E('access', 2), E('access', 1), E('access', 2)];
  const PROG_ENTRY = [I('add'), I('cli'), I('store'), I('popf', 1), I('pushf'), I('sgdt'), I('lcr3', '0x3000'), I('out')];
  const PROG_IRQ = [I('cli'), I('load'), I('in'), I('store'), I('add'), I('sti'), I('hlt')];
  const PROG_SWITCH = [I('pushf'), I('cli'), I('lcr3', '0x4000'), I('popf', 0), I('add'), I('sti')];
  const PROG_LOOP = [I('load'), I('add'), I('cli'), I('store'), I('add'), I('sti'), I('load'), I('add')];
  const CONT = [{ name: 'web', procs: 'nginx worker worker', hostname: 'web-1', net: 'own' }, { name: 'db', procs: 'dbserver writer', hostname: 'db-1', net: 'own' }];
  const GROUPS = [{ name: 'web', weight: 200, quota: 0, mem: 0 }, { name: 'batch', weight: 100, quota: 2, mem: 0 }, { name: 'db', weight: 100, quota: 0, mem: 12 }];
  const PROCS = [{ name: 'nginx', group: 'web', work: 0, grow: 0, mem: 0 }, { name: 'job', group: 'batch', work: 0, grow: 0, mem: 0 }, { name: 'dbserver', group: 'db', work: 0, grow: 2, mem: 0 }, { name: 'cache', group: 'db', work: 0, grow: 3, mem: 0 }];
  const NAME = '^[a-z][a-z0-9-]{0,11}$', NAMEWHY = 'a short lower-case name: letters, digits and -';

  const fields = [
    { id: 'mode', label: 'Workbench', type: 'select', group: 'Workbench', def: 'walk', options: opt([['walk', 'The 2-D page walk'], ['sync', 'Shadow tables against nested paging'], ['cpu', 'The CPU: trap, translate, or hardware'], ['io', 'I/O: emulated, paravirtual, passthrough'], ['ns', 'Containers: namespaces'], ['cg', 'Containers: control groups']]) },
    // ---- walk
    { id: 'wG', label: 'Guest page-table levels', type: 'number', group: 'Two page tables', def: 4, min: 1, max: 5, show: on('walk'), help: '4 KiB pages and 9 index bits a level on both sides, so g levels translate 12 + 9g address bits' },
    { id: 'wH', label: 'Host page-table levels', type: 'number', def: 4, min: 1, max: 5, show: on('walk') },
    { id: 'wAddr', label: 'Guest-virtual address', type: 'text', def: '0x7f3a_c0de_1234', maxLen: 24, pattern: '^(0x[0-9a-fA-F_]+|[0-9]+)$', patternWhy: 'a hex address like 0x7f3a_c0de_1234', show: on('walk'), help: 'where the guest\'s tables and pages sit in host memory comes from the seed' },
    { id: 'wShadow', label: 'Then walk the shadow table', type: 'toggle', def: true, show: on('walk') },
    // ---- sync
    { id: 'sEvents', label: 'What the guest does', type: 'table', group: 'The guest', def: EV_MIX, minRows: 1, maxRows: 16, show: on('sync'),
      columns: [{ id: 'op', label: 'Event', type: 'select', options: opt([['access', 'touch'], ['map', 'map'], ['unmap', 'unmap'], ['switch', 'switch to']]), width: '110px' }, { id: 'arg', label: 'Page or process', type: 'text', pattern: '^([0-9]{1,2}|[A-Z])$', patternWhy: 'a page (0 to 99) or a process (one capital letter)' }],
      newRow: (i) => E('access', 1 + (i % 4)),
      check: (r) => (r.op === 'switch' ? (/^[A-Z]$/.test(r.arg) ? null : { arg: 'switch to a process: one capital letter' }) : /^[0-9]{1,2}$/.test(r.arg) ? null : { arg: 'a page number from 0 to 99' }),
      help: 'P starts with pages 1 and 2 mapped, Q with page 1; P runs first' },
    { id: 'sG', label: 'Guest levels', type: 'number', group: 'The machine', def: 4, min: 1, max: 5, show: on('sync') },
    { id: 'sH', label: 'Host levels', type: 'number', def: 4, min: 1, max: 5, show: on('sync') },
    { id: 'sTlb', label: 'A TLB', type: 'toggle', def: true, show: on('sync') },
    { id: 'sExit', label: 'A VM exit costs as much as', type: 'number', def: 10, min: 1, max: 500, unit: 'table reads', show: on('sync'), help: 'an assumption for weighing the two designs; real ratios depend on the hardware' },
    // ---- cpu
    { id: 'cProg', label: 'Guest kernel code', type: 'table', group: 'The guest kernel', def: PROG_ENTRY, minRows: 1, maxRows: 12, show: on('cpu'),
      columns: [{ id: 'op', label: 'Instruction', type: 'select', options: Object.keys((S.Virt && S.Virt.INSTR) || {}).map((k) => ({ value: k, label: k })), width: '120px' }, { id: 'arg', label: 'Operand', type: 'text', required: false, pattern: '^(|0|1|0x[0-9a-fA-F]{1,6}|[0-9]{1,7})$', patternWhy: 'popf: 0 or 1 (the flag); lcr3: a table base like 0x3000' }],
      newRow: () => I('add'), help: 'sensitive: cli, sti, popf, pushf, smsw, sgdt, lcr3, out, in, hlt; ordinary: add, load, store' },
    { id: 'cArch', label: 'Processor', type: 'select', group: 'The machine', def: 'x86', options: opt([['x86', '32-bit x86 before hardware support'], ['classic', 'a classically virtualisable machine']]), show: on('cpu'), help: 'on old x86, popf, pushf, smsw and sgdt are sensitive but do not trap in user mode' },
    { id: 'cTE', label: 'Trap-and-emulate', type: 'toggle', group: 'Techniques (side by side)', def: true, show: on('cpu') },
    { id: 'cBT', label: 'Binary translation', type: 'toggle', def: true, show: on('cpu') },
    { id: 'cHW', label: 'Hardware support', type: 'toggle', def: true, show: on('cpu') },
    { id: 'cEpt', label: 'Hardware: nested paging (lcr3 needs no exit)', type: 'toggle', def: true, show: (v) => v.mode === 'cpu' && v.cHW },
    { id: 'cRepeat', label: 'Run the code', type: 'select', def: 1, options: [1, 2, 3, 4].map((n) => ({ value: n, label: n === 1 ? 'once' : n + ' times' })), show: on('cpu'), help: 'binary translation translates once and reuses the cached block' },
    { id: 'cNative', label: 'Cycles: a native instruction', type: 'number', group: 'Costs (cycles)', def: 1, min: 1, max: 100, show: on('cpu') },
    { id: 'cTrap', label: 'Cycles: a trap and its emulation', type: 'number', def: 500, min: 1, max: 100000, show: on('cpu') },
    { id: 'cExit', label: 'Cycles: a VM exit and entry', type: 'number', def: 300, min: 1, max: 100000, show: on('cpu') },
    { id: 'cCall', label: 'Cycles: a translated call', type: 'number', def: 20, min: 1, max: 10000, show: on('cpu') },
    { id: 'cTranslate', label: 'Cycles: translating an instruction', type: 'number', def: 50, min: 0, max: 10000, show: on('cpu') },
    // ---- io
    { id: 'ioReq', label: 'Requests', type: 'number', group: 'The I/O', def: 8, min: 1, max: 64, show: on('io') },
    { id: 'ioRegs', label: 'Emulated: register accesses a request', type: 'number', def: 4, min: 1, max: 16, show: on('io') },
    { id: 'ioBatch', label: 'Paravirtual: requests a notification', type: 'number', def: 8, min: 1, max: 64, show: on('io') },
    { id: 'ioPosted', label: 'Passthrough: posted interrupts', type: 'toggle', def: true, show: on('io'), help: 'off: each completion interrupt goes through the VMM, one exit each' },
    { id: 'ioCross', label: 'Then compare a process, a container and a VM', type: 'toggle', group: 'Crossings', def: true, show: on('io') },
    { id: 'ioOp', label: 'The call', type: 'select', def: 'read', options: opt([['read', 'read()'], ['write', 'write()']]), show: (v) => v.mode === 'io' && v.ioCross },
    { id: 'ioXMode', label: 'The VM’s I/O', type: 'select', def: 'paravirtual', options: opt([['emulated', 'emulated'], ['paravirtual', 'paravirtual'], ['passthrough', 'passthrough']]), show: (v) => v.mode === 'io' && v.ioCross },
    // ---- namespaces
    { id: 'nsHost', label: 'Host processes', type: 'list', kind: 'text', group: 'One kernel', def: ['init', 'sshd', 'containerd'], minLen: 1, maxLen: 5, show: on('ns'), help: 'pid 1 first; the third, if any, starts the containers', check: (x) => (x.every((w) => new RegExp(NAME).test(w)) ? null : 'Host processes: ' + NAMEWHY) },
    { id: 'nsCont', label: 'Containers', type: 'table', def: CONT, minRows: 1, maxRows: 3, show: on('ns'),
      columns: [{ id: 'name', label: 'Name', type: 'text', pattern: NAME, patternWhy: NAMEWHY, width: '70px' }, { id: 'procs', label: 'Processes', type: 'text', pattern: '^[a-z][a-z0-9-]{0,11}( +[a-z][a-z0-9-]{0,11}){0,4}$', patternWhy: 'one to five lower-case names, spaces between' }, { id: 'hostname', label: 'Hostname', type: 'text', pattern: '^[a-z][a-z0-9-]{0,15}$', patternWhy: 'a lower-case hostname', width: '76px' }, { id: 'net', label: 'Network', type: 'select', options: opt([['own', 'its own'], ['host', 'the host’s']]), width: '84px' }],
      newRow: (i) => ({ name: 'app' + (i + 1), procs: 'server', hostname: 'app-' + (i + 1), net: 'own' }),
      check: (r, i, rows) => (r.name === 'host' ? { name: '"host" is the host’s own namespace' } : rows.findIndex((x) => x.name === r.name) !== i ? { name: 'two containers are called ' + r.name } : null) },
    { id: 'nsViewers', label: 'Look from host pids', type: 'list', kind: 'int', group: 'Looking around', def: [2, 5, 7], min: 1, max: 30, minLen: 1, maxLen: 4, show: on('ns') },
    { id: 'nsFrom', label: 'kill() from host pid', type: 'number', def: 5, min: 1, max: 30, show: on('ns') },
    { id: 'nsTo', label: '…to the pid it names', type: 'number', def: 1, min: 1, max: 99, show: on('ns'), help: 'the pid as the sender\'s own pid namespace numbers it' },
    // ---- cgroups
    { id: 'cgGroups', label: 'Control groups', type: 'table', group: 'Groups and processes', def: GROUPS, minRows: 1, maxRows: 4, show: on('cg'),
      columns: [{ id: 'name', label: 'Group', type: 'text', pattern: NAME, patternWhy: NAMEWHY, width: '74px' }, { id: 'weight', label: 'Weight', type: 'int', min: 1, max: 1000 }, { id: 'quota', label: 'Quota', type: 'int', min: 0, max: 30, title: 'CPU ticks a period; 0: none' }, { id: 'mem', label: 'Mem limit', type: 'int', min: 0, max: 999, title: 'memory units; 0: none' }],
      newRow: (i) => ({ name: 'g' + (i + 1), weight: 100, quota: 0, mem: 0 }),
      check: (r, i, rows) => (rows.findIndex((x) => x.name === r.name) !== i ? { name: 'two groups are called ' + r.name } : null), help: 'quota: CPU ticks a period (0: none); mem limit: units (0: none)' },
    { id: 'cgProcs', label: 'Processes', type: 'table', def: PROCS, minRows: 1, maxRows: 8, show: on('cg'),
      columns: [{ id: 'name', label: 'Process', type: 'text', pattern: NAME, patternWhy: NAMEWHY, width: '78px' }, { id: 'group', label: 'Group', type: 'text', pattern: NAME, patternWhy: NAMEWHY, width: '64px' }, { id: 'work', label: 'Work', type: 'int', min: 0, max: 999, title: 'ticks of CPU it needs; 0: never finishes' }, { id: 'grow', label: 'Grows', type: 'int', min: 0, max: 20, title: 'memory units a tick it runs' }, { id: 'mem', label: 'Mem', type: 'int', min: 0, max: 200, title: 'memory at the start' }],
      newRow: (i, rows) => ({ name: 'p' + (i + 1), group: rows.length ? rows[0].group : 'web', work: 0, grow: 0, mem: 0 }),
      help: 'work: CPU ticks needed (0: forever); grows: memory a tick it runs' },
    { id: 'cgPeriod', label: 'Quota period', type: 'number', group: 'The scheduler', def: 10, min: 1, max: 30, unit: 'ticks', show: on('cg') },
    { id: 'cgTicks', label: 'Run for', type: 'number', def: 30, min: 5, max: 60, unit: 'ticks', show: on('cg') },
  ];

  const P = (label, values) => ({ label, values });
  const presets = [
    P('2-D walk: four levels on four', { mode: 'walk' }),
    P('2-D walk: two on two, small enough to follow', { mode: 'walk', wG: 2, wH: 2, wAddr: '0x2f_a123' }),
    P('2-D walk: a five-level guest', { mode: 'walk', wG: 5, wH: 4, wAddr: '0x1_2345_6789_abcd' }),
    P('Shadow or nested: a mix', { mode: 'sync' }),
    P('Shadow or nested: a guest editing its tables', { mode: 'sync', sEvents: EV_MAPPER }),
    P('Shadow or nested: many process switches', { mode: 'sync', sEvents: EV_SWITCHY }),
    P('Shadow or nested: no TLB', { mode: 'sync', sEvents: EV_HOT, sTlb: false }),
    P('CPU: kernel entry on old x86', { mode: 'cpu' }),
    P('CPU: a classically virtualisable machine', { mode: 'cpu', cArch: 'classic' }),
    P('CPU: a loop run 4 times, translation pays off', { mode: 'cpu', cProg: PROG_LOOP, cRepeat: 4, cHW: false }),
    P('CPU: hardware without nested paging', { mode: 'cpu', cProg: PROG_SWITCH, cEpt: false, cTE: false, cBT: false }),
    P('CPU: an interrupt handler', { mode: 'cpu', cProg: PROG_IRQ, cArch: 'classic' }),
    P('I/O: three paths', { mode: 'io' }),
    P('I/O: one request at a time', { mode: 'io', ioReq: 4, ioBatch: 1, ioPosted: false, ioXMode: 'emulated' }),
    P('Namespaces: two containers', { mode: 'ns' }),
    P('Namespaces: sharing the host’s network', { mode: 'ns', nsCont: [CONT[0], Object.assign({}, CONT[1], { net: 'host' })], nsViewers: [7, 1], nsFrom: 7, nsTo: 4 }),
    P('Control groups: weight, quota, memory limit', { mode: 'cg' }),
    P('Control groups: a leak killed, the rest run on', { mode: 'cg', cgGroups: [{ name: 'api', weight: 100, quota: 0, mem: 20 }, { name: 'ml', weight: 300, quota: 6, mem: 0 }], cgProcs: [{ name: 'api', group: 'api', work: 0, grow: 1, mem: 4 }, { name: 'leaky', group: 'api', work: 0, grow: 4, mem: 2 }, { name: 'train', group: 'ml', work: 0, grow: 0, mem: 8 }, { name: 'eval', group: 'ml', work: 6, grow: 0, mem: 2 }], cgTicks: 40, cgPeriod: 8 }),
  ];

  function check(v) {
    if (v.mode === 'walk') {
      const a = VX.parseHex(v.wAddr);
      if (a === null) return 'Guest-virtual address: write it in hex, like 0x7f3a_c0de_1234';
      const bits = VX.vaBits(v.wG);
      if (a >> BigInt(bits)) return 'Guest-virtual address: ' + v.wG + ' guest level' + (v.wG > 1 ? 's' : '') + ' translate ' + bits + ' bits, so the address must be below 0x' + (1n << BigInt(bits)).toString(16);
      return null;
    }
    if (v.mode === 'cpu') {
      if (!VX.techsOn(v).length) return 'Techniques: turn on at least one';
      return null;
    }
    if (v.mode === 'ns') {
      const total = v.nsHost.length + v.nsCont.reduce((a, c) => a + c.procs.trim().split(/\s+/).length, 0);
      if (total > 18) return 'Containers: at most 18 processes in all, so the table stays readable (this has ' + total + ')';
      for (const p of v.nsViewers) if (p > total) return 'Look from host pids: there is no pid ' + p + ' (the kernel has ' + total + ' processes)';
      if (v.nsFrom > total) return 'kill() from host pid: there is no pid ' + v.nsFrom;
      return null;
    }
    if (v.mode === 'cg') {
      for (const [i, p] of v.cgProcs.entries()) if (!v.cgGroups.some((g) => g.name === p.group)) return 'Processes, row ' + (i + 1) + ': there is no group called ' + p.group;
      if (v.cgProcs.some((p, i) => v.cgProcs.findIndex((q) => q.name === p.name) !== i)) return 'Processes: two are called the same';
      for (const g of v.cgGroups) if (g.quota > v.cgPeriod) return 'Control groups: ' + g.name + '’s quota of ' + g.quota + ' is more than the period of ' + v.cgPeriod;
      return null;
    }
    return null;
  }

  S.Labs.add({
    id: 'vmm', part: 'virtualisation', title: 'VM lab',
    blurb: 'Six workbenches. A guest page table on a host page table, walked read by read under nested paging and through a shadow table; what keeping a shadow table in sync costs; a guest kernel\'s instructions under trap-and-emulate, binary translation and hardware support, cycles and exits counted; three I/O paths; and containers: one process table seen through namespaces, and control groups capping CPU and memory.',
    setup: { fields, presets, check },
    run(v, ctx) {
      if (v.mode === 'sync') return VX.syncRun(v, ctx);
      if (v.mode === 'cpu') return VX.cpuRun(v, ctx);
      if (v.mode === 'io') return VX.ioRun(v, ctx);
      if (v.mode === 'ns') return VX.nsRun(v, ctx);
      if (v.mode === 'cg') return VX.cgRun(v, ctx);
      return VX.walkRun(v, ctx);
    },
  });
  VX.presets = presets;

  if (S.Checks) {
    const pick = (k, at) => "const P = Proses.app.page.lab; document.querySelectorAll('.lab-presets .chip')[" + k + "].click(); for (let i = 0; i < 40 && !(P.res && P.frames.length); i++) await new Promise((r) => setTimeout(r, 100)); await new Promise((r) => setTimeout(r, 500)); P.go(" + at + ', true); P.stage.finish(); try { localStorage.removeItem(\'proses.lab:vmm\'); } catch (e) {}';
    S.Checks.push({ group: 'labs', name: 'vmm lab', hash: 'labs/vmm', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: "try { localStorage.removeItem('proses.lab:vmm'); } catch (e) {} const P = Proses.app.page.lab; P.go(9, true); P.stage.finish();", sel: '#main' });
    presets.forEach((p, k) => S.Checks.push({ group: 'labs', name: 'vmm lab: ' + p.label, hash: 'labs/vmm', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: pick(k, 'Math.max(0, P.frames.length - 2)'), sel: '#main' }));
    presets.forEach((p, k) => S.Checks.push({ group: 'labs', name: 'vmm lab: ' + p.label + ', midway', hash: 'labs/vmm', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: pick(k, 'Math.floor(P.frames.length / 2)'), sel: '#main' }));
    S.Checks.push({ group: 'labs', name: 'vmm lab: CPU totals, metrics', hash: 'labs/vmm', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: pick(7, 'P.frames.length - 1') + " P.showTab('metrics');", sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'vmm lab: namespaces, tables', hash: 'labs/vmm', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: pick(14, 'P.frames.length - 1') + " P.showTab('tables');", sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
