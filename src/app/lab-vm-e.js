// The Virtual memory lab, registered. One process: a reference string typed, generated with locality from the seed,
// or traced from a C program in the editor; a frame count; up to three policies stepped side by side; then faults
// against frames (Belady flagged), the working set over time and what the faults cost. Several processes: each with
// its own references, the frames shared globally or by quota, the fault totals both ways, and CPU utilisation against
// the number of processes.
(function (S) {
  'use strict';
  const VL = S.VMLab;
  const M = () => S.Mem;
  const one = (v) => v.mode !== 'multi', multi = (v) => v.mode === 'multi';
  const POLS = ['opt', 'lru', 'fifo', 'clock', 'second', 'eclock', 'lfu', 'mfu', 'aging', 'nru'];
  const NAMES = { opt: 'OPT', lru: 'LRU', fifo: 'FIFO', clock: 'Clock', second: 'Second chance', eclock: 'Enhanced clock', lfu: 'LFU', mfu: 'MFU', aging: 'Aging', nru: 'NRU' };
  const polOpts = (none) => (none ? [{ value: 'none', label: '(none)' }] : []).concat(POLS.map((p) => ({ value: p, label: NAMES[p] })));
  const REFS = '2 6 2 1 6w 2 3 6 2 1w 7 2 6 1 2 3w 6 2'.split(' ');
  const BELADY = '2 6 5 4 2 6 3 2 1 6 5 3 5'.split(' ');
  const PROCS = [
    { name: 'A', kind: 'loop', pages: 4, length: 24, refs: '-' },
    { name: 'B', kind: 'phases', pages: 8, length: 24, refs: '-' },
    { name: 'C', kind: 'typed', pages: 3, length: 12, refs: '1 2 1 2 1 3 1 2 1 2 1 3' },
  ];
  const uses = (v, p) => [v.pol1, v.pol2, v.pol3].includes(p);

  const fields = [
    { id: 'mode', label: 'Workbench', type: 'select', group: 'Workbench', def: 'one', options: [{ value: 'one', label: 'One process: policies compared' }, { value: 'multi', label: 'Several processes: sharing frames' }] },
    // ---- one process
    { id: 'source', label: 'References from', type: 'select', group: 'Reference string', def: 'typed', options: [{ value: 'typed', label: 'typed' }, { value: 'gen', label: 'generated with locality' }, { value: 'c', label: 'a C program, traced' }], show: one },
    { id: 'refs', label: 'References (w after a page: a write)', type: 'list', kind: 'text', def: REFS, minLen: 1, maxLen: 60, show: (v) => one(v) && v.source === 'typed', check: (x) => { try { VL.parseRefs(x); return null; } catch (e) { return e.message; } } },
    { id: 'gen', label: 'Pattern', type: 'select', def: 'phases', options: [{ value: 'phases', label: 'phases of locality' }, { value: 'loop', label: 'a loop' }, { value: 'walk', label: 'a random walk' }, { value: 'random', label: 'random (no locality)' }], show: (v) => one(v) && v.source === 'gen', help: 'drawn from the seed below the stage' },
    { id: 'length', label: 'Length', type: 'number', def: 36, min: 8, max: 80, show: (v) => one(v) && v.source === 'gen' },
    { id: 'pages', label: 'Pages', type: 'number', def: 9, min: 2, max: 16, show: (v) => one(v) && v.source === 'gen' },
    { id: 'loopLen', label: 'Loop length', type: 'number', def: 4, min: 2, max: 16, show: (v) => one(v) && v.source === 'gen' && v.gen === 'loop' },
    { id: 'setSize', label: 'Pages a phase', type: 'number', def: 3, min: 1, max: 16, show: (v) => one(v) && v.source === 'gen' && v.gen === 'phases' },
    { id: 'writes', label: 'Share of writes', type: 'number', def: 0.2, min: 0, max: 1, integer: false, show: (v) => one(v) && v.source === 'gen' },
    { id: 'src', label: 'Program', type: 'code', def: VL.PROGS[0].src, examples: VL.PROGS, files: 'vm-lab', minLines: 10, maxHeight: 340, show: (v) => one(v) && v.source === 'c' },
    { id: 'pageBytes', label: 'Page size', type: 'select', def: 128, options: [64, 128, 256, 512].map((b) => ({ value: b, label: b + ' bytes' })), show: (v) => one(v) && v.source === 'c' },
    { id: 'maxRefs', label: 'References kept', type: 'number', def: 40, min: 4, max: 80, show: (v) => one(v) && v.source === 'c', help: 'the first ones the run makes' },
    { id: 'stack', label: 'Count the stack (locals)', type: 'toggle', def: false, show: (v) => one(v) && v.source === 'c' },
    { id: 'frames', label: 'Frames', type: 'number', group: 'Frames and policies', def: 3, min: 1, max: 8, show: one },
    { id: 'pol1', label: 'Policy', type: 'select', def: 'lru', options: polOpts(false), show: one },
    { id: 'pol2', label: 'Compare with', type: 'select', def: 'fifo', options: polOpts(true), show: one },
    { id: 'pol3', label: 'And with', type: 'select', def: 'opt', options: polOpts(true), show: one },
    { id: 'agingBits', label: 'Aging: register bits', type: 'number', def: 8, min: 2, max: 16, show: (v) => one(v) && uses(v, 'aging') },
    { id: 'nruReset', label: 'NRU: clear use bits every', type: 'number', def: 4, min: 1, max: 40, unit: 'refs', show: (v) => one(v) && uses(v, 'nru') },
    { id: 'delta', label: 'Working-set window Δ', type: 'number', group: 'Views and costs', def: 4, min: 1, max: 30 },
    { id: 'sweepMax', label: 'Sweep frames up to', type: 'number', def: 7, min: 2, max: 12, show: one },
    { id: 'memNs', label: 'Memory access', type: 'number', def: 100, min: 10, max: 1000, unit: 'ns', show: one },
    { id: 'diskMs', label: 'Disk transfer', type: 'number', def: 8, min: 0.01, max: 50, integer: false, unit: 'ms', show: one, help: 'a page read, and a dirty page’s write-back' },
    // ---- several processes
    { id: 'procs', label: 'Processes', type: 'table', group: 'Processes', def: PROCS, minRows: 1, maxRows: 6, show: multi,
      columns: [{ id: 'name', label: 'Name', type: 'text', pattern: '^[A-Z][A-Za-z0-9]{0,2}$', patternWhy: 'a capital and up to two more', width: '56px' },
        { id: 'kind', label: 'References', type: 'select', options: [{ value: 'loop', label: 'loop' }, { value: 'phases', label: 'phases' }, { value: 'walk', label: 'walk' }, { value: 'random', label: 'random' }, { value: 'typed', label: 'typed' }], width: '92px' },
        { id: 'pages', label: 'Pages', type: 'int', min: 2, max: 16, width: '58px' }, { id: 'length', label: 'Length', type: 'int', min: 4, max: 60, width: '62px' },
        { id: 'refs', label: 'Typed', type: 'text', pattern: '^(-|\\d{1,2}([\\s,]+\\d{1,2})*)$', patternWhy: 'pages like 1 2 1 3, or -' }],
      newRow: (i) => ({ name: String.fromCharCode(65 + i), kind: 'loop', pages: 3 + i, length: 20, refs: '-' }),
      check: (row, i, rows) => (rows.findIndex((x) => x.name === row.name) !== i ? { name: 'two processes are called ' + row.name } : row.kind === 'typed' && row.refs === '-' ? { refs: 'type the pages, or choose a pattern' } : null) },
    { id: 'mframes', label: 'Frames', type: 'number', group: 'Sharing', def: 9, min: 2, max: 48, show: multi },
    { id: 'mode2', label: 'Replacement', type: 'select', def: 'global', options: [{ value: 'global', label: 'global: any frame' }, { value: 'local', label: 'local: within a quota' }], show: multi },
    { id: 'scheme', label: 'Quotas', type: 'select', def: 'proportional', options: [{ value: 'equal', label: 'equal' }, { value: 'proportional', label: 'in proportion to pages' }], show: multi },
    { id: 'mpolicy', label: 'Victim', type: 'select', def: 'lru', options: [{ value: 'lru', label: 'LRU' }, { value: 'fifo', label: 'FIFO' }], show: multi },
    { id: 'quantum', label: 'References a turn', type: 'number', def: 3, min: 1, max: 12, show: multi },
    { id: 'lifetime', label: 'Work between faults', type: 'number', group: 'CPU-utilisation model', def: 20, min: 1, max: 200, unit: 'ms', show: multi, help: 'with its whole working set in memory' },
    { id: 'diskMs2', label: 'A fault takes', type: 'number', def: 10, min: 1, max: 100, unit: 'ms', show: multi },
    { id: 'maxN', label: 'Up to processes', type: 'number', def: 16, min: 4, max: 30, show: multi },
  ];

  const presets = [
    { label: 'LRU, FIFO and OPT on a typed string', values: { mode: 'one', source: 'typed', refs: REFS, frames: 3, pol1: 'lru', pol2: 'fifo', pol3: 'opt' } },
    { label: 'The clock: its hand and use bits', values: { mode: 'one', source: 'typed', refs: '3 8 3 5 1 8 4 3 5 8 2 3 1 8 5'.split(' '), frames: 4, pol1: 'clock', pol2: 'none', pol3: 'none', delta: 5 } },
    { label: 'Belady’s anomaly under FIFO', values: { mode: 'one', source: 'typed', refs: BELADY, frames: 3, pol1: 'fifo', pol2: 'lru', pol3: 'none', sweepMax: 6 } },
    { label: 'Writes: enhanced clock saves write-backs', values: { mode: 'one', source: 'typed', refs: '1w 4 2w 6 1 3 4 5w 2 6 1 4 3 2w'.split(' '), frames: 3, pol1: 'clock', pol2: 'eclock', pol3: 'none' } },
    { label: 'Generated: phases of locality', values: { mode: 'one', source: 'gen', gen: 'phases', length: 40, pages: 10, setSize: 3, writes: 0.2, frames: 4, pol1: 'lru', pol2: 'clock', pol3: 'aging', delta: 6 } },
    { label: 'Generated: a loop one page too long', values: { mode: 'one', source: 'gen', gen: 'loop', length: 20, pages: 5, loopLen: 5, writes: 0, frames: 4, pol1: 'lru', pol2: 'fifo', pol3: 'opt', delta: 5 } },
    { label: 'Traced from C: a transpose', values: { mode: 'one', source: 'c', src: VL.PROGS[0].src, pageBytes: 64, maxRefs: 40, frames: 3, pol1: 'lru', pol2: 'fifo', pol3: 'opt' } },
    { label: 'Several processes, global replacement', values: { mode: 'multi', procs: PROCS, mframes: 9, mode2: 'global', scheme: 'proportional', mpolicy: 'lru', quantum: 3 } },
    { label: 'Several processes, local quotas', values: { mode: 'multi', procs: PROCS, mframes: 9, mode2: 'local', scheme: 'proportional', mpolicy: 'lru', quantum: 3 } },
    { label: 'Thrashing: five processes in ten frames', values: { mode: 'multi', procs: [{ name: 'A', kind: 'loop', pages: 4, length: 18, refs: '-' }, { name: 'B', kind: 'loop', pages: 4, length: 18, refs: '-' }, { name: 'C', kind: 'phases', pages: 6, length: 18, refs: '-' }, { name: 'D', kind: 'loop', pages: 3, length: 18, refs: '-' }, { name: 'E', kind: 'walk', pages: 6, length: 18, refs: '-' }], mframes: 10, mode2: 'global', mpolicy: 'lru', quantum: 2, maxN: 12 } },
  ];

  function oneRun(v, ctx) {
    const src = VL.refs(v, ctx.seed);
    if (src.error) return { error: src.error };
    const refs = src.refs;
    if (!refs.length) return { error: { msg: 'the program made no references' + (v.stack ? '' : ' outside the stack') } };
    const runs = VL.runs(v, refs), narrow = ctx.narrow;
    const frames = VL.stepFrames(v, refs, runs, narrow);
    const fv = VL.fit(frames, 10);
    frames.forEach((f) => { f.view = fv; });
    const sw = VL.sweepFrame(v, refs, narrow), ws = VL.wsFrame(v, refs, runs, narrow), ea = VL.eatFrame(v, refs, narrow);
    for (const f of [sw.frame, ws, ea]) { f.view = VL.fit([f], 10); frames.push(f); }
    const trace = [];
    refs.forEach((r, i) => trace.push({ kind: 'ref', i, page: r.page, write: r.write, say: frames[i].say, faults: runs.map((x) => x.steps[i].faults) }));
    trace.push({ kind: 'sweep', say: sw.frame.say }, { kind: 'ws', say: ws.say }, { kind: 'eat', say: ea.say });
    sw.frame.at = trace.length - 3; ws.at = trace.length - 2; ea.at = trace.length - 1;
    const tables = [{ title: 'Totals, ' + v.frames + ' frame' + (v.frames === 1 ? '' : 's'), cols: ['Policy', 'Faults', 'Hits', 'Write-backs'], rows: runs.map((r) => [r.name, String(r.faults), String(r.hits), String(r.writeBacks)]) }, sw.frame.tables[0]];
    const best = Math.min(...runs.map((r) => r.faults));
    const metrics = runs.map((r) => ({ label: r.name + ' faults', value: r.faults, note: r.writeBacks + ' write-backs', cls: r.faults === best ? 'good' : '' })).concat([{ label: 'References', value: refs.length, note: src.source === 'c' ? 'of ' + src.all + ' the program made' : '' }, { label: 'Distinct pages', value: new Set(refs.map((r) => r.page)).size }]).concat(ea.metrics);
    sw.frame.tables = tables.slice().reverse(); ea.tables = tables; ws.tables = [ws.tables[0]];
    // the lines of the program each reference came from, tagged in the editor
    if (src.source === 'c') refs.forEach((r, i) => { const ln = src.lines[i]; if (ln > 0) frames[i].marks = [{ line: ln, tag: 'page ' + r.page, cls: 'p1', act: true, title: 'reference ' + (i + 1) + (r.write ? ', a write' : ', a read') + ' of page ' + r.page }]; });
    return { frames, trace, tables, metrics, runs, refs, src };
  }

  S.Labs.add({
    id: 'vm', part: 'vm', title: 'Virtual memory lab',
    blurb: 'A reference string you type, generate with locality or trace from a C program; a frame count; policies side by side, every fault and victim explained. Then faults against frames with Belady’s anomaly flagged, the working set, and what the faults cost. Or share the frames among several processes, global against local, and watch thrashing set in.',
    setup: {
      fields, presets,
      check(v) {
        if (v.mode === 'multi') {
          const total = v.procs.reduce((a, p) => a + (p.kind === 'typed' ? String(p.refs).split(/[\s,]+/).filter(Boolean).length : p.length), 0);
          if (total > 160) return 'Processes: ' + total + ' references in all; at most 160, so every step can be drawn';
          if (v.procs.length > v.mframes) return 'Frames: at least one for each of the ' + v.procs.length + ' processes';
          return null;
        }
        const np = VL.policies(v).length;
        if (np * v.frames > 16) return 'Frames: with ' + np + ' policies side by side, at most ' + Math.floor(16 / np) + ' frames (or compare fewer policies)';
        if (v.source === 'gen' && v.gen === 'loop' && v.loopLen > v.pages) return 'Loop length: at most the ' + v.pages + ' pages';
        if (v.source === 'gen' && v.gen === 'phases' && v.setSize > v.pages) return 'Pages a phase: at most the ' + v.pages + ' pages';
        return null;
      },
    },
    run(v, ctx) { return v.mode === 'multi' ? VL.multi(v, ctx) : oneRun(v, ctx); },
  });

  if (S.Checks) {
    const pick = (k, at) => "const P = Proses.app.page.lab; document.querySelectorAll('.lab-presets .chip')[" + k + "].click(); await new Promise((r) => setTimeout(r, 900)); P.go(" + at + ", true); P.stage.finish(); try { localStorage.removeItem('proses.lab:vm'); } catch (e) {}";
    S.Checks.push({ group: 'labs', name: 'virtual memory lab', hash: 'labs/vm', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: "try { localStorage.removeItem('proses.lab:vm'); } catch (e) {} const P = Proses.app.page.lab; P.go(9, true); P.stage.finish();", sel: '#main' });
    ['P.frames.length - 3', 'P.frames.length - 2', 'P.frames.length - 1'].forEach((at, j) => S.Checks.push({ group: 'labs', name: 'virtual memory lab: ' + ['faults against frames', 'working set', 'fault cost'][j], hash: 'labs/vm', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: "const P = Proses.app.page.lab; P.go(" + at + ", true); P.showTab('" + ['tables', 'metrics', 'trace'][j] + "'); P.stage.finish();", sel: '#main' }));
    presets.forEach((p, k) => { if (k > 0) S.Checks.push({ group: 'labs', name: 'virtual memory lab: ' + p.label, hash: 'labs/vm', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: pick(k, p.values.mode === 'multi' ? 'P.frames.length - ' + (k === 9 ? 1 : 20) : 'Math.min(12, P.frames.length - 4)'), sel: '#main' }); });
    S.Checks.push({ group: 'labs', name: 'virtual memory lab: thrashing, global against local', hash: 'labs/vm', fresh: true, ready: "document.querySelector('#labView svg .it')", setup: pick(9, 'P.frames.length - 2'), sel: '#main' });
  }
})(globalThis.Proses = globalThis.Proses || {});
