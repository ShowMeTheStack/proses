// Part 11, demand paging. The page-fault path step by step (the page table with its valid bits, the frames, the
// disk, and each step's cost); the effective access time a fault rate gives; and a whole reference string under
// demand paging with every fault priced by its own path.
(function (S) {
  'use strict';
  const H = S.P10, V = () => S.VM, M = () => S.Mem, T = () => S.Kit.p11;
  /** a time in µs the way the engine says it: 0.5 µs, 8 ms */
  const us = (v) => (v >= 1000 ? H.f(v / 1000, 3) + ' ms' : H.f(v, 2) + ' µs');
  H.us = us;

  // ---- the process of the fault-path topic: eight pages, six of them in its memory map ----
  const REGION = ['code', 'code', 'data', 'heap', 'heap', 'stack', '—', '—'];
  /** the resident pages for a case: [page, frame, dirty] (frame 3 is free in the 'free' case) */
  const resident = (cs) => (cs === 'free' ? [[0, 0, 0], [2, 1, 1], [3, 2, 1]] : [[0, 0, 0], [2, 1, 1], [3, 2, 1], [5, 3, 1]]);
  const VICTIM = { clean: [0, 0, 0], dirty: [3, 2, 1] };

  S.topic({
    id: 'vmem-fault-path', family: 'p11-demand', order: 10, title: 'The page-fault path',
    blurb: 'With demand paging a page is loaded only when it is first touched. Its page-table entry starts with the valid bit clear, so the first access traps. The kernel checks that the address is legal, finds a frame (a free one, or a victim, written back first if it is dirty), reads the page in or fills it with zeros, sets the entry valid and restarts the instruction. Each step has a cost: the disk dwarfs everything else.',
    inputs: [
      { id: 'page', kind: 'number', label: 'Page touched', def: 4, min: 0, max: 7 },
      { id: 'access', kind: 'choice', label: 'Access', def: 'read', options: [{ value: 'read', label: 'a read' }, { value: 'write', label: 'a write' }] },
      { id: 'frame', kind: 'choice', label: 'Frames', def: 'dirty', options: [{ value: 'free', label: 'one frame is free' }, { value: 'clean', label: 'all full: a clean victim' }, { value: 'dirty', label: 'all full: a dirty victim' }] },
      { id: 'source', kind: 'choice', label: 'The page comes from', def: 'swap', options: [{ value: 'swap', label: 'swap' }, { value: 'file', label: 'its file' }, { value: 'zero', label: 'nowhere: zero-fill' }] },
      { id: 'diskMs', kind: 'number', label: 'Disk transfer (ms)', def: 8, min: 0.05, max: 20, integer: false },
    ],
    check(inp) {
      const r = resident(inp.frame).find((x) => x[0] === inp.page);
      if (r) return 'Page ' + inp.page + ' is already in frame ' + r[1] + ': pick a page that is not resident (' + H.list([0, 1, 2, 3, 4, 5, 6, 7].filter((p) => !resident(inp.frame).some((x) => x[0] === p))) + ')';
      return null;
    },
    presets: [
      { label: 'A heap page from swap, a dirty victim', values: {} },
      { label: 'Code from its file, a free frame', values: { page: 1, frame: 'free', source: 'file', access: 'read' } },
      { label: 'A new heap page: zero-fill, clean victim', values: { page: 4, frame: 'clean', source: 'zero', access: 'write' } },
      { label: 'An illegal address', values: { page: 6, frame: 'free' } },
      { label: 'On an SSD (0.1 ms)', values: { diskMs: 0.1 } },
    ],
    counters: [{ id: 'us', label: 'µs so far' }],
    run(inp) {
      const legal = REGION[inp.page] !== '—', cs = inp.frame, victimRow = cs === 'free' ? null : VICTIM[cs];
      const costs = { read: inp.diskMs * 1000, writeBack: inp.diskMs * 1000 };
      const p = V().faultPath({ page: inp.page, write: inp.access === 'write', legal, freeFrame: cs === 'free' ? 3 : null, victim: victimRow ? { page: victimRow[0], frame: victimRow[1], dirty: !!victimRow[2] } : null, source: inp.source, costs });
      const C = Object.assign({}, V().COSTS, costs);
      const F = new S.Frames(['us']), view = H.box(0, 0, 806, 470);
      const res = resident(cs);
      const draw = (k, st) => {
        // the state after step k (−1: before the fault)
        const kinds = p.steps.slice(0, k + 1).map((s) => s.kind);
        const evicted = victimRow && kinds.includes('frame'), loaded = kinds.includes('update');
        const items = [];
        const rows = [];
        for (let pg = 0; pg < 8; pg++) {
          const r = res.find((x) => x[0] === pg);
          let valid = r ? 1 : 0, frame = r ? 'f' + r[1] : '—', dirty = r ? r[2] : 0, cls = '';
          if (evicted && pg === victimRow[0]) { valid = 0; frame = '—'; dirty = 0; cls = 'hot'; }
          if (pg === inp.page) { cls = st.kind === 'kill' ? 'bad' : 'act'; if (loaded) { valid = 1; frame = 'f' + p.frame; dirty = inp.access === 'write' ? 1 : 0; cls = 'good'; } }
          rows.push({ key: 'p' + pg, cls, cells: [pg, { text: REGION[pg], cls: 'name' + (REGION[pg] === '—' ? ' muted' : '') }, { text: valid, cls: valid ? 'on' : 'off' }, frame, dirty] });
        }
        items.push(...T().table({ prefix: 'pt', x: 4, y: 58, title: 'page table', cols: [{ name: 'page', w: 48 }, { name: 'region', w: 72 }, { name: 'valid', w: 52 }, { name: 'frame', w: 56 }, { name: 'dirty', w: 52 }], rows }).items);
        const frows = [];
        for (let f = 0; f < 4; f++) {
          const r = res.find((x) => x[1] === f);
          let page = r ? 'page ' + r[0] : 'free', cls = r ? '' : 'muted';
          if (victimRow && f === victimRow[1] && evicted) { page = kinds.includes('read') || kinds.includes('zero') ? 'page ' + inp.page : kinds.includes('writeBack') ? 'writing ' + victimRow[0] : 'page ' + victimRow[0]; cls = 'hot'; }
          if (f === p.frame && (kinds.includes('read') || kinds.includes('zero'))) { page = 'page ' + inp.page; cls = 'good'; }
          else if (f === p.frame && kinds.includes('frame') && !victimRow) cls = 'act';
          frows.push({ key: 'f' + f, cls, cells: ['f' + f, page] });
        }
        items.push(...T().table({ prefix: 'fr', x: 326, y: 58, title: 'frames', cols: [{ name: 'frame', w: 50 }, { name: 'holds', w: 92 }], rows: frows }).items);
        // the disk, under the frames, with the transfer of this step
        const diskOn = st.kind === 'read' || st.kind === 'writeBack';
        items.push(H.cellL('disk', 326, 290, 142, 52, ['disk', inp.source === 'file' ? 'the file' : 'swap'], 'p10-box' + (diskOn ? ' act' : '')));
        if (st.kind === 'read') items.push(H.wire('w:disk', [[397, 290], [397, 222]], 'act'));
        else if (st.kind === 'writeBack') items.push(H.wire('w:disk', [[397, 222], [397, 290]], 'hot'));
        // the steps with their costs
        const srows = p.steps.map((s, j) => ({ key: 's' + j, cls: j === k ? (s.kind === 'kill' ? 'bad' : 'act') : j > k ? 'dim' : '', cells: [{ text: NAMES[s.kind], cls: 'name' }, us(s.cost), us(s.t)] }));
        items.push(...T().table({ prefix: 'st', x: 500, y: 58, title: 'the fault, step by step', cols: [{ name: 'step', w: 150 }, { name: 'cost', w: 70 }, { name: 'time', w: 86 }], rows: srows }).items);
        // where the time goes: the disk against all the rest
        const disk = p.steps.filter((s, j) => j <= k && (s.kind === 'read' || s.kind === 'writeBack')).reduce((a, s) => a + s.cost, 0), t = k >= 0 ? p.steps[k].t : 0, rest = t - disk;
        const bw = 304, dw = t ? Math.round((disk / t) * bw) : 0;
        items.push(H.title('tb', 500, 330, 'where the time goes'));
        items.push(H.cell('bar:disk', 500, 344, Math.max(dw, 1), 22, '', 'p11-bar disk'), H.cell('bar:rest', 500 + Math.max(dw, 1), 344, Math.max(bw - Math.max(dw, 1), 2), 22, '', 'p11-bar cpu'));
        items.push(H.text('tb:d', 500, 388, 'disk ' + us(disk), 'bad', 13), H.text('tb:r', 804, 388, 'kernel and CPU ' + us(rest), 'good', 13, 'end'));
        items.push(H.text('sum', 4, 24, st.line, 'p10-sum' + (st.kind === 'kill' ? ' bad' : st.kind === 'restart' ? ' good' : ''), 15));
        return { items, disk, rest };
      };
      const verb = inp.access === 'write' ? 'writes' : 'reads';
      const d0 = draw(-1, { kind: 'start', line: 'page ' + inp.page + ': valid bit 0' });
      F.add({ items: d0.items, say: `The process ${verb} page ${inp.page} (${REGION[inp.page] === '—' ? 'in no region of its memory map' : 'its ' + REGION[inp.page]}). The page-table entry's valid bit is 0, so the MMU cannot translate it. A memory access costs ${us(C.mem)}; watch what this one costs.`, meta: { phase: 'start', page: inp.page, mem: C.mem }, view, hl: { d: [0] } });
      p.steps.forEach((s, j) => {
        F.set('us', +s.t.toFixed(2));
        const d = draw(j, { kind: s.kind, line: NAMES[s.kind] + ': ' + us(s.cost) });
        F.add({ items: d.items, say: s.say + '.' + (j === p.steps.length - 1 && !p.killed ? ` In all ${us(s.t)}: ${us(d.disk)} on the disk and ${us(d.rest)} in the kernel, ${H.f(s.t / C.mem, 0)} times a memory access.` : ''), meta: { phase: s.kind, step: j, cost: s.cost, ms: s.cost / 1000, t: s.t, tms: s.t / 1000, page: inp.page, frame: p.frame, victim: victimRow ? victimRow[0] : null, vframe: victimRow ? victimRow[1] : null, disk: d.disk, dms: d.disk / 1000, rest: d.rest, ratio: +(s.t / C.mem).toFixed(0), writeBack: p.steps.some((x) => x.kind === 'writeBack'), killed: p.killed }, view, hl: { d: HL[s.kind] } });
      });
      return { frames: F.list, def: H.def('The page-fault path', ['1. trap: the valid bit is 0', '2. check the address against the memory map', '   illegal: kill the process', '3. find a frame: a free one, or a victim', '4. dirty victim: write it back first', '5. read the page in, or fill it with zeros', '6. set the PTE: frame, valid bit', '7. restart the instruction']) };
    },
    predict: [
      { at: (f) => f.meta.phase === 'trap' && !f.meta.killed && f.meta.victim !== null, once: true, pick: 'option', ask: 'Will the kernel have to write to the disk before it reads the page in?', options: ['yes: the victim is dirty', 'no: the victim is clean'], answer: (fr, i) => (fr[i].meta.writeBack ? 'yes: the victim is dirty' : 'no: the victim is clean'), explain: (fr) => fr.find((f) => f.meta.phase === 'frame').say },
      { at: (f) => f.meta.phase === 'check' && !f.meta.killed, once: true, pick: 'item', ask: 'Click the frame the page will go into.', answer: (fr, i) => 'fr:f' + fr[i].meta.frame + ':1', explain: (fr, i) => fr[i + 1].say },
      { at: (f) => f.meta.phase === 'trap' && f.meta.killed, once: true, pick: 'option', ask: 'This page is in no region of the memory map. What happens?', options: ['the process is killed', 'the page is zero-filled', 'the page is read from swap'], answer: 'the process is killed', explain: (fr, i) => fr[i + 2].say },
    ],
    quiz: [
      { q: 'A fault evicts a dirty page. How many disk transfers does it need?', options: ['two: the write-back and the read', 'one: the read', 'none', 'three'], answer: 0, why: 'The dirty victim must reach swap before its frame is reused, then the new page is read.' },
      { q: 'Which step costs the most?', options: ['the disk transfer', 'the trap', 'updating the PTE', 'restarting the instruction'], answer: 0, why: 'Milliseconds against microseconds: thousands of times more.' },
      { q: 'Why is the faulting instruction restarted rather than skipped?', options: ['it never completed: it must run again with the page present', 'to count the fault', 'to flush the TLB', 'the kernel cannot skip instructions'], answer: 0, why: 'The access that trapped did not happen; restarting it makes the fault invisible to the program.' },
      { q: 'A new heap page that was never written is touched. Where does its content come from?', options: ['nowhere: the frame is filled with zeros', 'from swap', 'from the program file', 'from the parent process'], answer: 0, why: 'Zero-fill on demand: there is nothing to read.' },
      { q: 'What does the process do while its page is read from the disk?', options: ['it sleeps, and another process runs', 'it spins on the CPU', 'it keeps running other instructions', 'it is killed'], answer: 0, why: 'The disk takes milliseconds; the CPU is given to someone else until the interrupt.' },
    ],
  });
  const NAMES = { trap: 'trap to the kernel', check: 'check the address', kill: 'kill the process', frame: 'find a frame', writeBack: 'write back the victim', read: 'read the page in', zero: 'fill with zeros', update: 'update the PTE', restart: 'restart the instruction' };
  const HL = { trap: [0], check: [1], kill: [2], frame: [3], writeBack: [4], read: [5], zero: [5], update: [6], restart: [7] };
})(globalThis.Proses = globalThis.Proses || {});
