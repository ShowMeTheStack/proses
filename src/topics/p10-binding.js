// Part 10, addresses and the MMU. Base and bounds: the CPU issues a logical address, the MMU compares it with the
// limit register and adds the base register, or traps; a context switch loads the other process's pair. Swapping:
// whole processes go out to the backing store and come back, maybe somewhere else, which the base register hides.
(function (S) {
  'use strict';
  const H = S.P10, M = () => S.Mem;
  const MEM = 65536, OS = 8192;

  /** the memory map: the kernel, two partitions and the holes between them */
  function memRuns(procs, cur) {
    const runs = [{ key: 'os', start: 0, size: OS, cls: 'os', text: 'kernel', sub: '0–' + (OS - 1) }];
    const ps = procs.map((p, i) => ({ p, i })).sort((a, b) => a.p.base - b.p.base);
    let at = OS;
    for (const { p, i } of ps) {
      if (p.base > at) runs.push({ key: 'h' + at, start: at, size: p.base - at, cls: 'free', text: 'free' });
      runs.push({ key: 'pr' + i, start: p.base, size: p.limit, cls: H.pc(i) + (i === cur ? ' act' : ''), text: p.name, sub: p.limit + ' B' });
      at = p.base + p.limit;
    }
    if (at < MEM) runs.push({ key: 'h' + at, start: at, size: MEM - at, cls: 'free', text: 'free' });
    return runs;
  }

  S.topic({
    id: 'mem-base-bounds', family: 'p10-binding', order: 10, title: 'Base and bounds',
    blurb: 'A program is compiled as if it owned memory from address 0. Binding those logical addresses to physical ones at run time is the MMU\'s job, and the simplest MMU has two registers. The limit (bounds) register holds the size of the process: an address at or past it traps. The base (relocation) register is added to every address that passes. A context switch loads the next process\'s pair, so the same logical address lands on different bytes, and no process can reach another\'s memory.',
    inputs: [
      { id: 'base1', kind: 'number', label: 'P1 base', def: 20480, min: OS, max: MEM - 1 },
      { id: 'limit1', kind: 'number', label: 'P1 limit', def: 6144, min: 1, max: MEM - OS },
      { id: 'base2', kind: 'number', label: 'P2 base', def: 40960, min: OS, max: MEM - 1 },
      { id: 'limit2', kind: 'number', label: 'P2 limit', def: 12288, min: 1, max: MEM - OS },
      { id: 'refs', kind: 'list', label: 'Addresses (P1 or P2 switches)', def: ['0', '1200', '6143', '6144', 'P2', '1200', '9000', 'P1', '-4'], min: 1, max: 12,
        check: (v) => { for (const x of v) if (!/^P[12]$/.test(x) && !/^-?\d+$/.test(x)) return 'Addresses: whole numbers, or P1 or P2 to switch process ("' + x + '" is neither)'; return null; } },
    ],
    check(inp) {
      const ps = [[inp.base1, inp.limit1, 'P1'], [inp.base2, inp.limit2, 'P2']];
      for (const [b, l, n] of ps) if (b + l > MEM) return n + ' ends at ' + (b + l) + ', past the ' + MEM + ' bytes of memory';
      if (inp.base1 < inp.base2 + inp.limit2 && inp.base2 < inp.base1 + inp.limit1) return 'P1 and P2 overlap: give them separate ranges';
      return null;
    },
    presets: [
      { label: 'In bounds, out of bounds, then P2', values: {} },
      { label: 'One address, two processes', values: { refs: ['500', 'P2', '500', 'P1', '500'] } },
      { label: 'The edges of P1: 0, limit − 1, limit', values: { refs: ['0', '6143', '6144', '6145'] } },
      { label: 'A large P2 high in memory', values: { base1: 9216, limit1: 4096, base2: 32768, limit2: 30720, refs: ['P2', '30000', '30720', 'P1', '4095', '4096'] } },
      { label: 'Small partitions side by side', values: { base1: 16384, limit1: 2048, base2: 18432, limit2: 2048, refs: ['2047', '2048', 'P2', '0', '2047'] } },
    ],
    counters: [{ id: 'ok', label: 'translated' }, { id: 'faults', label: 'protection faults' }],
    run(inp) {
      const procs = [{ name: 'P1', base: inp.base1, limit: inp.limit1 }, { name: 'P2', base: inp.base2, limit: inp.limit2 }];
      const F = new S.Frames(['ok', 'faults']), view = H.box(0, 0, 760, 470);
      let cur = 0;
      const bar = (cur, mark) => S.Kit.p10.vbar({ prefix: 'mm', x: 580, y: 40, w: 120, h: 420, total: MEM, runs: memRuns(procs, cur), ticks: [0, OS, MEM].concat(procs.flatMap((p) => [p.base, p.base + p.limit])), tickSide: 'right', minGap: 15 });
      // the machine at one moment: st 'idle' | 'compare' | 'relocate' | 'fault' | 'switch'
      const draw = (st) => {
        const p = procs[cur], b = bar(cur), items = [...b.items];
        const cmpCls = st.k === 'compare' ? 'act' : st.k === 'fault' ? 'bad' : st.k === 'relocate' ? 'good' : '';
        items.push(H.cellL('cpu', 4, 198, 98, 60, ['CPU', 'runs ' + p.name], 'p10-box ' + H.pc(cur)));
        items.push({ key: 'mmu', kind: 'region', x: 124, y: 60, w: 364, h: 356, rx: 8, text: 'MMU', cls: 'p10-unit', layer: 'back' });
        items.push(H.cellL('lim', 148, 92, 144, 52, ['limit register', String(p.limit)], 'p10-box' + (st.k === 'switch' ? ' act' : st.k === 'compare' ? ' act' : '')));
        items.push(H.cellL('base', 320, 92, 144, 52, ['base register', String(p.base)], 'p10-box' + (st.k === 'switch' || st.k === 'relocate' ? ' act' : '')));
        items.push({ key: 'cmp', kind: 'state', x: 220, y: 228, r: 28, text: '<', cls: 'p10-cmp ' + cmpCls });
        items.push({ key: 'add', kind: 'op', x: 392, y: 228, r: 17, op: 'add', cls: st.k === 'relocate' ? 'act' : '' });
        items.push(H.cellL('trap', 146, 336, 148, 56, ['trap to the kernel', 'protection fault'], 'p10-box' + (st.k === 'fault' ? ' bad' : ' ghost')));
        const on = (k) => (st.k === k ? ' act' : '');
        items.push(H.wire('w:in', [[102, 228], [192, 228]], st.k === 'compare' ? 'act' : ''));
        items.push(H.wire('w:lim', [[220, 144], [220, 200]], on('compare')));
        items.push(H.wire('w:yes', [[248, 228], [375, 228]], on('relocate')));
        items.push(H.text('l:yes', 312, 218, 'yes', st.k === 'relocate' ? 'good' : 'tick', 13, 'middle'));
        items.push(H.wire('w:base', [[392, 144], [392, 211]], on('relocate')));
        items.push(H.wire('w:no', [[220, 256], [220, 336]], st.k === 'fault' ? 'hot' : ''));
        items.push(H.text('l:no', 230, 300, 'no', st.k === 'fault' ? 'bad' : 'tick', 13));
        if (st.k === 'compare' || st.k === 'relocate' || st.k === 'fault') items.push({ key: 'la', kind: 'chip', x: 147, y: 228, text: String(st.addr), cls: 'p10-addr' + (st.k === 'fault' ? ' bad' : '') });
        items.push(H.text('l:la', 147, 204, 'logical', 'tick', 12, 'middle'));
        if (st.k === 'relocate') {
          const y = Math.round(b.Y(st.pa) + 0.5);
          items.push(H.wire('w:out', [[409, 228], [530, 228], [530, y], [576, y]], 'act'));
          items.push({ key: 'pa', kind: 'chip', x: 466, y: 228, text: String(st.pa), cls: 'p10-addr good' });
          items.push(H.text('l:pa', 466, 204, 'physical', 'tick', 12, 'middle'));
        } else items.push(H.wire('w:out', [[409, 228], [530, 228]], 'faint', false));
        // where an illegal address would have landed, had nothing checked it
        if (st.k === 'fault' && st.addr >= 0 && p.base + st.addr < MEM) { const y = Math.round(b.Y(p.base + st.addr)); items.push({ key: 'would', kind: 'line', x1: 580, y1: y, x2: 700, y2: y, cls: 'p10-mark bad dash', audit: 'ignore', layer: 'top' }); }
        items.push(H.text('sum', 4, 26, st.line || '', 'p10-sum' + (st.k === 'fault' ? ' bad' : st.k === 'relocate' ? ' good' : ''), 15));
        return items;
      };
      const p0 = procs[0];
      F.add({ items: draw({ k: 'idle', line: 'P1 runs: base ' + p0.base + ', limit ' + p0.limit }), say: `P1 is loaded at physical ${p0.base} and is ${p0.limit} bytes long, so the kernel puts base ${p0.base} and limit ${p0.limit} in the MMU. P1's logical addresses run from 0 to ${p0.limit - 1}; P2 sits at ${procs[1].base}, ${procs[1].limit} bytes long.`, meta: { phase: 'start', base: p0.base, limit: p0.limit, last: p0.limit - 1, other: [procs[1].base, procs[1].limit] }, view, hl: { d: [2] } });
      for (const x of inp.refs) {
        if (/^P[12]$/.test(x)) {
          const to = x === 'P1' ? 0 : 1, p = procs[to];
          if (to === cur) {
            F.add({ items: draw({ k: 'idle', line: p.name + ' already runs' }), say: `${p.name} is already running, so the registers stay as they are.`, meta: { phase: 'same', proc: p.name }, view });
            continue;
          }
          cur = to;
          F.add({ items: draw({ k: 'switch', line: 'switch to ' + p.name + ': base ' + p.base + ', limit ' + p.limit }), say: `A context switch to ${p.name}: in kernel mode the dispatcher loads base ${p.base} and limit ${p.limit}. Loading these registers is a privileged instruction, so a user program cannot widen its own window.`, meta: { phase: 'switch', proc: p.name, base: p.base, limit: p.limit }, view, hl: { d: [2, 3] } });
          continue;
        }
        const a = Number(x), p = procs[cur], r = M().baseBounds({ base: p.base, limit: p.limit }, a);
        F.add({ items: draw({ k: 'compare', addr: a, line: p.name + ' issues ' + a }), say: `${p.name} issues logical address ${a}. ` + r.steps[0].say, meta: { phase: 'compare', proc: p.name, addr: a, limit: p.limit, base: p.base, ok: r.ok, pa: r.pa }, view, hl: { d: [0, 1] } });
        if (r.ok) {
          F.count('ok');
          F.add({ items: draw({ k: 'relocate', addr: a, pa: r.pa, line: a + ' + ' + p.base + ' = ' + r.pa }), say: r.steps[1].say + ` That byte is inside ${p.name}'s partition, ${p.base} to ${p.base + p.limit - 1}.`, meta: { phase: 'relocate', proc: p.name, addr: a, base: p.base, limit: p.limit, pa: r.pa, end: p.base + p.limit - 1 }, view, hl: { d: [0] } });
        } else {
          F.count('faults');
          F.add({ items: draw({ k: 'fault', addr: a, line: a + ' is outside 0..' + (p.limit - 1) }), say: r.steps[1].say + (a < 0 ? ' A negative address is just as illegal.' : ` Without the check it would have reached ${p.base + a}` + (p.base + a >= MEM ? ', past the end of memory.' : ', which is not ' + p.name + '\'s.')), meta: { phase: 'fault', proc: p.name, addr: a, limit: p.limit, base: p.base, would: p.base + a }, view, hl: { d: [1] } });
        }
      }
      const c = F.counts;
      F.add({ items: draw({ k: 'idle', line: c.ok + ' translated, ' + c.faults + ' trapped' }), say: `${H.plural(c.ok, 'address', 'addresses')} relocated and ${H.plural(c.faults, 'protection fault')}. Each translation cost one compare and one add, done in hardware on every access; the kernel was entered only for the switches and the faults.`, meta: { phase: 'end', ok: c.ok, faults: c.faults }, view });
      return { frames: F.list, def: H.def('Base and bounds', ['if 0 ≤ a < limit: physical = base + a', 'else: trap (protection fault)', 'two registers, set by the kernel', 'context switch: load the next process\'s pair']) };
    },
    predict: [
      { at: (f) => f.meta.phase === 'compare', pick: 'option', ask: (fr, i) => `Will ${fr[i].meta.proc}'s address ${fr[i].meta.addr} pass the limit check?`, options: ['yes: it is relocated', 'no: a protection fault'], answer: (fr, i) => (fr[i].meta.ok ? 'yes: it is relocated' : 'no: a protection fault'), explain: (fr, i) => fr[i + 1].say },
      {
        at: (f) => f.meta.phase === 'compare' && f.meta.ok, once: true, pick: 'option', ask: (fr, i) => `Which physical address does ${fr[i].meta.addr} become?`,
        options: (fr, i) => { const m = fr[i].meta; return [...new Set([m.pa, m.addr, m.base, m.base + m.limit + m.addr])].map(String); },
        answer: (fr, i) => String(fr[i].meta.pa), explain: (fr, i) => fr[i + 1].say,
      },
    ],
    quiz: [
      { q: 'Base 30000, limit 5000. The process issues address 4999. What happens?', options: ['it becomes 34999', 'a protection fault', 'it becomes 4999', 'it becomes 25001'], answer: 0, why: '4999 < 5000, so the base is added: 30000 + 4999.' },
      { q: 'Same registers, address 5000?', options: ['a protection fault', 'it becomes 35000', 'it becomes 5000', 'it wraps to 30000'], answer: 0, why: 'The legal addresses are 0 to 4999; 5000 is at the limit, not below it.' },
      { q: 'Why must loading the base and limit registers be privileged?', options: ['otherwise a program could point them at any memory', 'they are too slow to load in user mode', 'the compiler sets them', 'they hold the program counter'], answer: 0, why: 'Protection rests on the program being unable to change its own window.' },
      { q: 'A process is moved to a new place in memory. What has to change for it to keep running?', options: ['only its base register', 'every address in its code', 'its limit register only', 'nothing: the hardware finds it'], answer: 0, why: 'Binding happens at run time, so relocating the process is just a new base.' },
      { q: 'Binding addresses at compile time requires…', options: ['knowing where the program will be loaded', 'a TLB', 'a limit register', 'paging hardware'], answer: 0, why: 'Absolute code only works at the address it was compiled for; load-time and run-time binding lift that.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
