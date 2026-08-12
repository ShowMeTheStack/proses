// The Deadlock lab, part five: its setup (four modes, each with its own typed data and presets), the clicks that
// draw a graph on the stage, and its registration with the lab shell. The modes' runs are in parts two to four.
(function (S) {
  'use strict';
  const DL = S.DlLab;
  const row = (who, op, res, n) => ({ who, op, res: res || 'R0', n: n || 1 });
  const RES2 = [{ name: 'R0', units: 1 }, { name: 'R1', units: 1 }];
  const RES3 = [{ name: 'R0', units: 1 }, { name: 'R1', units: 1 }, { name: 'R2', units: 1 }];
  // our own scripts: who asks for what, in the order typed
  const SCRIPTS = {
    pair: { nproc: 2, res: [{ name: 'Scan', units: 1 }, { name: 'Plot', units: 1 }], script: [row('P0', 'req', 'Scan'), row('P1', 'req', 'Plot'), row('P0', 'req', 'Plot'), row('P1', 'req', 'Scan'), row('P0', 'rel', 'Plot'), row('P0', 'rel', 'Scan'), row('P1', 'rel', 'Scan'), row('P1', 'rel', 'Plot')] },
    ring3: { nproc: 3, res: RES3, script: [row('P0', 'req', 'R0'), row('P1', 'req', 'R1'), row('P2', 'req', 'R2'), row('P0', 'req', 'R1'), row('P1', 'req', 'R2'), row('P2', 'req', 'R0'), row('P0', 'rel', 'R1'), row('P0', 'rel', 'R0')] },
    spare: { nproc: 3, res: [{ name: 'Disk', units: 2 }, { name: 'Tape', units: 1 }], script: [row('P0', 'req', 'Disk'), row('P1', 'req', 'Tape'), row('P2', 'req', 'Disk'), row('P0', 'req', 'Tape'), row('P1', 'req', 'Disk'), row('P2', 'work'), row('P2', 'rel', 'Disk'), row('P1', 'rel', 'Disk'), row('P1', 'rel', 'Tape'), row('P0', 'rel', 'Tape'), row('P0', 'rel', 'Disk')] },
    pool: { nproc: 2, res: [{ name: 'Mem', units: 4 }], script: [row('P0', 'req', 'Mem', 2), row('P1', 'req', 'Mem', 1), row('P0', 'work'), row('P1', 'work'), row('P0', 'req', 'Mem', 2), row('P1', 'req', 'Mem', 2), row('P0', 'rel', 'Mem', 4), row('P1', 'rel', 'Mem', 3)] },
    ring4: { nproc: 4, res: [{ name: 'L0', units: 1 }, { name: 'L1', units: 1 }, { name: 'L2', units: 1 }, { name: 'L3', units: 1 }], script: [0, 1, 2, 3].flatMap((i) => [row('P' + i, 'req', 'L' + i), row('P' + i, 'work'), row('P' + i, 'req', 'L' + ((i + 1) % 4)), row('P' + i, 'rel', 'L' + ((i + 1) % 4)), row('P' + i, 'rel', 'L' + i)]) },
  };
  // our own banker's tables
  const BANK = { alloc: [[1, 0, 2], [0, 2, 1], [2, 1, 0], [0, 1, 1], [1, 1, 0]], max: [[4, 2, 3], [1, 3, 2], [3, 3, 2], [2, 2, 4], [3, 1, 1]], avail: [2, 1, 1] };
  const TIGHT = { alloc: [[2, 0, 1, 1], [0, 1, 0, 2], [1, 1, 1, 0], [0, 2, 1, 1]], max: [[3, 2, 2, 2], [1, 2, 3, 3], [2, 3, 2, 1], [1, 3, 2, 2]], avail: [1, 1, 1, 1] };
  const DET = { dAlloc: [[1, 0, 1], [0, 1, 0], [1, 1, 0], [0, 0, 1]], dReq: [[0, 1, 0], [1, 0, 0], [0, 0, 1], [1, 0, 0]], dAvail: [0, 0, 0], cost: [5, 2, 4, 3], ckpt: [[1, 0, 0], [0, 0, 0], [1, 0, 0], [0, 0, 0]] };
  const DEFAULT = Object.assign({ mode: 'rag', ragFrom: 'script', edges: 'R0>P0 P0>R1 R1>P1 P1>R2 R2>P2', bkind: 'request', who: 1, req: [1, 0, 1], recover: 'cheapest', penalty: 10, cMutex: true, cHold: true, cPreempt: true, cCirc: true, cSched: 'seed' }, SCRIPTS.pair, BANK, DET);

  const isG = (v) => v.mode === 'rag' || v.mode === 'cond';
  const MODES = [{ value: 'rag', label: 'Resource-allocation graph' }, { value: 'bank', label: 'The banker’s algorithm' }, { value: 'detect', label: 'Detection and recovery' }, { value: 'cond', label: 'The four conditions' }];
  const fields = [
    { id: 'mode', label: 'Mode', type: 'select', options: MODES, def: 'rag' },
    // processes, resources and scripts (graph and conditions modes)
    { id: 'nproc', label: 'Processes', type: 'number', min: 1, max: 6, def: DEFAULT.nproc, group: 'Processes and resources', show: isG, help: 'Named P0, P1, and so on.' },
    { id: 'ragFrom', label: 'The graph comes from', type: 'select', options: [{ value: 'script', label: 'a script of requests and releases' }, { value: 'graph', label: 'edges drawn on the stage, or typed' }], def: 'script', show: (v) => v.mode === 'rag' },
    { id: 'res', label: 'Resource types', type: 'table', def: DEFAULT.res, minRows: 1, maxRows: 4, show: isG, columns: [{ id: 'name', label: 'Name', type: 'text', pattern: '^[A-Za-z][A-Za-z0-9]{0,4}$', patternWhy: 'a letter, then up to 4 letters or digits', width: '90px' }, { id: 'units', label: 'Units', type: 'int', min: 1, max: 4, width: '64px' }], newRow: (i) => ({ name: 'R' + i, units: 1 }), check: (r, i, rows) => (rows.findIndex((x) => x.name === r.name) !== i ? { name: 'two resources are called ' + r.name } : /^P\d$/.test(r.name) ? { name: 'P and a digit names a process' } : null) },
    { id: 'script', label: 'Script, in order', type: 'table', def: DEFAULT.script, minRows: 1, maxRows: 20, show: (v) => v.mode === 'cond' || (v.mode === 'rag' && v.ragFrom !== 'graph'), columns: [{ id: 'who', label: 'Who', type: 'text', pattern: '^P[0-5]$', patternWhy: 'P0 to P5', width: '52px' }, { id: 'op', label: 'Does', type: 'select', options: [{ value: 'req', label: 'requests' }, { value: 'rel', label: 'releases' }, { value: 'work', label: 'works' }], width: '104px' }, { id: 'res', label: 'Resource', type: 'text', pattern: '^[A-Za-z][A-Za-z0-9]{0,4}$', patternWhy: 'a resource name', width: '84px' }, { id: 'n', label: 'Units', type: 'int', min: 1, max: 4, width: '58px' }], newRow: (i, rows) => Object.assign({}, rows[rows.length - 1] || row('P0', 'req', 'R0')), help: 'In the graph mode the lines run in this order; a blocked process\'s later lines wait for it. In the conditions mode each process runs its own lines in order, and a seeded schedule interleaves them.' },
    { id: 'edges', label: 'Edges (P0>R1 a request, R1>P0 a unit held)', type: 'text', def: DEFAULT.edges, placeholder: 'P0>R1 R1>P2', pattern: '^[A-Za-z0-9>→ ,;-]*$', patternWhy: 'edges like P0>R1 and R1>P0, separated by spaces', show: (v) => v.mode === 'rag' && v.ragFrom === 'graph', help: 'Or click on the stage: a process, then a resource, adds a request; a resource, then a process, an assignment. Click an edge to remove it.' },
    // the conditions
    { id: 'cMutex', label: 'Mutual exclusion', type: 'toggle', def: true, group: 'The four conditions (off breaks it)', show: (v) => v.mode === 'cond' },
    { id: 'cHold', label: 'Hold and wait', type: 'toggle', def: true, show: (v) => v.mode === 'cond' },
    { id: 'cPreempt', label: 'No preemption', type: 'toggle', def: true, show: (v) => v.mode === 'cond' },
    { id: 'cCirc', label: 'Circular wait', type: 'toggle', def: true, show: (v) => v.mode === 'cond' },
    { id: 'cSched', label: 'The run shown', type: 'select', options: [{ value: 'seed', label: 'a schedule drawn from the seed' }, { value: 'worst', label: 'the checker’s deadlocking schedule' }], def: 'seed', show: (v) => v.mode === 'cond' },
    // the banker
    { id: 'alloc', label: 'Allocation', type: 'matrix', def: BANK.alloc, max: 12, resize: true, group: 'The state', show: (v) => v.mode === 'bank' },
    { id: 'max', label: 'Max', type: 'matrix', def: BANK.max, max: 12, resize: true, show: (v) => v.mode === 'bank' },
    { id: 'avail', label: 'Available', type: 'list', def: BANK.avail, min: 0, max: 12, minLen: 1, maxLen: 4, names: (j) => DL.RES[j] || '?', show: (v) => v.mode === 'bank' },
    { id: 'bkind', label: 'Check', type: 'select', group: 'The request', options: [{ value: 'request', label: 'a request, granted or refused' }, { value: 'safety', label: 'no request: just the safety check' }], def: 'request', show: (v) => v.mode === 'bank' },
    { id: 'who', label: 'Process asking', type: 'number', min: 0, max: 5, def: 1, show: (v) => v.mode === 'bank' && v.bkind === 'request', help: 'P0 is 0.' },
    { id: 'req', label: 'It asks for', type: 'list', def: DEFAULT.req, min: 0, max: 12, minLen: 1, maxLen: 4, names: (j) => DL.RES[j] || '?', show: (v) => v.mode === 'bank' && v.bkind === 'request' },
    // detection and recovery
    { id: 'dAlloc', label: 'Allocation', type: 'matrix', def: DET.dAlloc, max: 9, resize: true, group: 'The state', show: (v) => v.mode === 'detect' },
    { id: 'dReq', label: 'Request (waiting for now)', type: 'matrix', def: DET.dReq, max: 9, resize: true, show: (v) => v.mode === 'detect' },
    { id: 'dAvail', label: 'Available', type: 'list', def: DET.dAvail, min: 0, max: 9, minLen: 1, maxLen: 4, names: (j) => DL.RES[j] || '?', show: (v) => v.mode === 'detect' },
    { id: 'recover', label: 'Then recover by', type: 'select', group: 'Recovery', options: [{ value: 'none', label: 'nothing: detection only' }, { value: 'cheapest', label: 'aborting the cheapest, one at a time' }, { value: 'all', label: 'aborting every deadlocked process' }, { value: 'rollback', label: 'preempting: roll back to checkpoints' }], def: 'cheapest', show: (v) => v.mode === 'detect' },
    { id: 'cost', label: 'Cost of each process', type: 'list', def: DET.cost, min: 1, max: 99, minLen: 1, maxLen: 6, names: (i) => 'P' + i, show: (v) => v.mode === 'detect' && v.recover !== 'none' },
    { id: 'ckpt', label: 'Checkpoints (held when saved)', type: 'matrix', def: DET.ckpt, max: 9, resize: true, show: (v) => v.mode === 'detect' && v.recover === 'rollback' },
    { id: 'penalty', label: 'Penalty per rollback', type: 'number', min: 0, max: 50, def: 10, show: (v) => v.mode === 'detect' && v.recover === 'rollback' },
  ];
  const shape = (a, n, m) => a.length === n && a.every((r) => r.length === m);
  function check(v) {
    if (v.mode === 'rag' || v.mode === 'cond') {
      if (v.mode === 'rag' && v.ragFrom === 'graph') { const e = DL.parseEdges(v.edges, v.nproc, DL.readRes(v)); return e.error ? 'Edges: ' + e.error : null; }
      return DL.scriptWhy(v);
    }
    if (v.mode === 'bank') {
      const n = v.alloc.length, m = (v.alloc[0] || []).length;
      if (n < 1 || n > 6 || m < 1 || m > 4) return 'Allocation: 1 to 6 processes and 1 to 4 resource types';
      if (!shape(v.max, n, m)) return 'Max must have the same shape as Allocation (' + n + ' × ' + m + ')';
      if (v.avail.length !== m) return 'Available needs one number for each of the ' + m + ' resource types';
      for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) if (v.alloc[i][j] > v.max[i][j]) return 'P' + i + ' holds more ' + DL.RES[j] + ' than its Max';
      if (v.bkind === 'request') {
        if (v.who >= n) return 'Process asking: 0 to ' + (n - 1);
        if (v.req.length !== m) return 'The request needs one number for each of the ' + m + ' resource types';
        if (v.req.every((x) => !x)) return 'The request asks for nothing: ask for at least one unit';
      }
      return null;
    }
    const n = v.dAlloc.length, m = (v.dAlloc[0] || []).length;
    if (n < 1 || n > 6 || m < 1 || m > 4) return 'Allocation: 1 to 6 processes and 1 to 4 resource types';
    if (!shape(v.dReq, n, m)) return 'Request must have the same shape as Allocation (' + n + ' × ' + m + ')';
    if (v.dAvail.length !== m) return 'Available needs one number for each of the ' + m + ' resource types';
    if (v.recover !== 'none' && v.cost.length !== n) return 'Cost: one number for each of the ' + n + ' processes';
    if (v.recover === 'rollback') {
      if (!shape(v.ckpt, n, m)) return 'Checkpoints must have the same shape as Allocation (' + n + ' × ' + m + ')';
      for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) if (v.ckpt[i][j] > v.dAlloc[i][j]) return 'P' + i + '\'s checkpoint holds more ' + DL.RES[j] + ' than it holds now';
    }
    return null;
  }
  const P = (label, values) => ({ label, values: Object.assign({}, DEFAULT, values) });
  const presets = [
    P('Graph: opposite orders', Object.assign({ mode: 'rag' }, SCRIPTS.pair)),
    P('Graph: a ring of three', Object.assign({ mode: 'rag' }, SCRIPTS.ring3)),
    P('Graph: a spare unit', Object.assign({ mode: 'rag' }, SCRIPTS.spare)),
    P('Graph: draw it yourself', { mode: 'rag', ragFrom: 'graph', nproc: 3, res: RES3, edges: 'R0>P0 P0>R1 R1>P1 P1>R2 R2>P2' }),
    P('Banker: a request granted', { mode: 'bank', who: 1, req: [1, 0, 1] }),
    P('Banker: free, but unsafe', { mode: 'bank', who: 3, req: [1, 1, 0] }),
    P('Banker: safety, four types', Object.assign({ mode: 'bank', bkind: 'safety' }, TIGHT)),
    P('Detect: abort the cheapest', { mode: 'detect', recover: 'cheapest' }),
    P('Detect: roll back', { mode: 'detect', recover: 'rollback' }),
    P('Conditions: all four on', Object.assign({ mode: 'cond', cSched: 'worst' }, SCRIPTS.ring4)),
    P('Conditions: circular wait off', Object.assign({ mode: 'cond', cCirc: false }, SCRIPTS.ring4)),
    P('Conditions: hold and wait off', Object.assign({ mode: 'cond', cHold: false }, SCRIPTS.pair)),
  ];
  DL.PRESETS = presets; DL.SCRIPTS = SCRIPTS; DL.DEFAULT = DEFAULT;

  // ---- drawing on the stage ----------------------------------------------------------------------------------------
  function hook(v) {
    setTimeout(() => {
      const P = S.app && S.app.page && S.app.page.lab;
      if (!P || !P.lab || P.lab.id !== 'deadlock' || !P.stage) return;
      P.stage.onPick = (key) => DL.pick(P, key);
      // the seed only draws the conditions mode's schedule: elsewhere its control is hidden
      if (P.root) P.root.classList.toggle('dl-noseed', v.mode !== 'cond');
    }, 0);
  }
  /** a click on a node or an edge while drawing: two nodes make an edge, an edge goes */
  DL.pick = async function (P, key) {
    const v = P.values;
    if (v.mode !== 'rag' || v.ragFrom !== 'graph') return;
    const res = DL.readRes(v), e = DL.parseEdges(v.edges, v.nproc, res);
    if (e.error) return;
    const g = { hold: e.hold, want: e.want };
    let m;
    let changed = false;
    if ((m = /^g:e([pr]\d+)>([pr]\d+)(?:#\d+)?$/.exec(key))) {
      const a = m[1], b = m[2];
      if (a[0] === 'p') g.want = g.want.filter(([p, r]) => !(p === +a.slice(1) && r === +b.slice(1)));
      else { const k = g.hold.findIndex(([p, r]) => p === +b.slice(1) && r === +a.slice(1)); if (k >= 0) g.hold.splice(k, 1); }
      DL.sel = null; changed = true;
    } else {
      const nd = (m = /^g:(p\d+)$/.exec(key)) ? m[1] : (m = /^g:(?:r|rn|u)(\d+)(?:_\d+)?$/.exec(key)) ? 'r' + m[1] : null;
      if (!nd) return;
      if (!DL.sel || DL.sel === nd || DL.sel[0] === nd[0]) DL.sel = DL.sel === nd ? null : nd;
      else {
        const p = +(DL.sel[0] === 'p' ? DL.sel : nd).slice(1), r = +(DL.sel[0] === 'r' ? DL.sel : nd).slice(1);
        if (DL.sel[0] === 'p') { if (!g.want.some(([a, b]) => a === p && b === r)) g.want.push([p, r]); }
        else if (g.hold.filter(([, b]) => b === r).length >= res[r].units) { S.UI.toast(res[r].name + ' has no free unit to assign: all ' + res[r].units + ' are held.', 'err', 2600); DL.sel = null; await P.runNow(false); return; }
        else g.hold.push([p, r]);
        DL.sel = null; changed = true;
      }
    }
    if (changed) { const nv = Object.assign({}, v, { edges: DL.edgesText(g, res) }); P.values = nv; P.setup.set(nv); P.save(); }
    await P.runNow(false);
  };

  S.Labs.add({
    id: 'deadlock', part: 'deadlock', icon: 'route', title: 'Deadlock lab',
    blurb: 'Processes and resources of your own: the allocation graph and the wait-for graph drawn live, the banker’s safety check row by row, detection and recovery step by step, and the four conditions switched off one at a time.',
    setup: { fields, presets, check },
    run(v, ctx) {
      if (v.mode !== 'rag' || v.ragFrom !== 'graph') DL.sel = null;
      hook(v);
      if (v.mode === 'bank') return DL.runBank(v, ctx);
      if (v.mode === 'detect') return DL.runDetect(v, ctx);
      if (v.mode === 'cond') return DL.runCond(v, ctx);
      return DL.runRag(v, ctx);
    },
  });

  if (S.Checks) {
    const clear = "try { localStorage.removeItem('proses.lab:deadlock'); } catch (e) {}";
    const preset = (k, at) => "const P = Proses.app.page.lab; document.querySelectorAll('.lab-presets .chip')[" + k + "].click(); for (let n = 0; n < 80 && !document.querySelectorAll('.lab-presets .chip')[" + k + "].classList.contains('on'); n++) await new Promise((r) => setTimeout(r, 50)); await new Promise((r) => setTimeout(r, 700)); P.go(" + at + ", true); P.stage.finish(); " + clear;
    presets.forEach((p, k) => S.Checks.push({ group: 'labs', name: 'deadlock lab: ' + p.label, hash: 'labs/deadlock', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: preset(k, 'P.frames.length - 1'), sel: '#main' }));
    S.Checks.push({ group: 'labs', name: 'deadlock lab: graph, mid-run', hash: 'labs/deadlock', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: preset(0, 4), sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'deadlock lab: banker, pretended state', hash: 'labs/deadlock', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: preset(5, 4), sel: '#main' });
    S.Checks.push({ group: 'labs', name: 'deadlock lab: conditions, mid-run', hash: 'labs/deadlock', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: preset(9, 6), sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
