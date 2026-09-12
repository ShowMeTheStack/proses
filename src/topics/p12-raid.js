// Part 12, RAID (1): where every chunk goes on each level (striping, mirrors, parity on one disk or rotating, P and
// Q), where one logical chunk lands, and what the level gives: capacity, fault tolerance and throughput.
// Layouts and numbers come from the RAID engine (src/core/st-a-raid.js, st-c-raidcalc.js).
(function (S) {
  'use strict';
  const T = () => S.T12;
  const R = Math.round;
  const LEVELS = [{ value: '0', label: 'RAID 0: striping' }, { value: '1', label: 'RAID 1: mirroring' }, { value: '10', label: 'RAID 1+0: striped mirrors' }, { value: '4', label: 'RAID 4: one parity disk' }, { value: '5', label: 'RAID 5: rotating parity' }, { value: '6', label: 'RAID 6: P and Q' }];
  const LAYOUTS = [{ value: 'left-symmetric', label: 'left-symmetric' }, { value: 'left-asymmetric', label: 'left-asymmetric' }, { value: 'right-symmetric', label: 'right-symmetric' }, { value: 'right-asymmetric', label: 'right-asymmetric' }];
  const minDisks = { 0: 2, 1: 2, 10: 4, 4: 3, 5: 3, 6: 4 };
  S.T12.raidLevels = LEVELS;
  S.T12.raidMin = minDisks;

  /** the stripe grid with each cell's role: o {prefix, x, y, A, rows, cw, ch, upTo, act(s, d), lit(s, d), text(s, d, role)} */
  function grid(o) {
    const t = T(), Rd = S.Raid, tab = Rd.layoutTable(o.A), n = o.A.disk.length;
    return S.Kit.disk.grid({
      prefix: o.prefix, x: o.x, y: o.y, n, rows: o.rows, cw: o.cw, ch: o.ch, gap: o.gap || 6, rowHeadW: o.rhw || 78, size: 14,
      head: (d) => ({ text: (o.narrow ? 'd' : 'disk ') + d + (o.failed && o.failed.includes(d) ? ' ✕' : ''), cls: o.failed && o.failed.includes(d) ? 'dead' : 'strong' }),
      rowHead: (s) => 'stripe ' + s,
      cell: (s, d) => {
        const c = tab[s][d], role = c.role;
        if (s > o.upTo) return { lines: [' '], cls: 'rd-empty' };
        let cls = role === 'parity' ? 'rd-par' : role === 'q' ? 'rd-par q' : role === 'mirror' ? 'rd-data mirror' : 'rd-data';
        const text = o.text ? o.text(s, d, c) : role === 'parity' ? 'P' + s : role === 'q' ? 'Q' + s : role === 'mirror' ? 'D' + c.chunk + '′' : 'D' + c.chunk;
        if (o.lit && o.lit(s, d)) cls += ' src';
        if (o.act && o.act(s, d)) cls += ' act';
        return { lines: [].concat(text), cls };
      },
    });
  }
  S.T12.raidGrid = grid;

  // =================================================================================================================
  S.topic({
    id: 'raid-layout', family: 'p12-raid', order: 10, title: 'RAID levels: where each chunk goes',
    blurb: 'An array cuts its logical space into chunks and spreads them over the disks stripe by stripe. RAID 0 only stripes; RAID 1 keeps whole copies; RAID 1+0 stripes over mirrored pairs; RAID 4 adds a parity chunk to every stripe on one disk; RAID 5 rotates that parity round the disks; RAID 6 adds a second parity, Q, so any two disks may fail. Then count what each gives you.',
    inputs: [
      { id: 'level', kind: 'choice', label: 'level', def: '5', options: LEVELS },
      { id: 'disks', kind: 'number', label: 'disks', def: 5, min: 2, max: 8 },
      { id: 'layout', kind: 'choice', label: 'parity layout (RAID 5 and 6)', def: 'left-symmetric', options: LAYOUTS },
      { id: 'find', kind: 'number', label: 'find logical chunk', def: 9, min: 0, max: 63 },
      { id: 'size', kind: 'number', label: 'disk size (GB)', def: 4000, min: 1, max: 100000 },
      { id: 'seq', kind: 'number', label: 'one disk, sequential (MB/s)', def: 200, min: 1, max: 10000 },
      { id: 'iops', kind: 'number', label: 'one disk, random I/Os a second', def: 150, min: 1, max: 1000000 },
    ],
    check(inp) {
      const L = +inp.level;
      if (inp.disks < minDisks[L]) return 'disks: RAID ' + (L === 10 ? '1+0' : L) + ' needs at least ' + minDisks[L];
      if (L === 10 && inp.disks % 2) return 'disks: RAID 1+0 needs an even number';
      const A = S.Raid.create({ level: L, disks: inp.disks, chunk: 1, stripes: 6 });
      if (inp.find >= S.Raid.width(A) * 6) return 'find logical chunk: the six stripes drawn hold chunks 0 to ' + (S.Raid.width(A) * 6 - 1);
      return null;
    },
    presets: [
      { label: 'RAID 5 on five disks', values: { level: '5', disks: 5, layout: 'left-symmetric', find: 9 } },
      { label: 'RAID 0 on four disks', values: { level: '0', disks: 4, find: 9 } },
      { label: 'RAID 1, two mirrors', values: { level: '1', disks: 2, find: 3 } },
      { label: 'RAID 1+0 on six disks', values: { level: '10', disks: 6, find: 7 } },
      { label: 'RAID 4: one parity disk', values: { level: '4', disks: 4, find: 5 } },
      { label: 'RAID 5, right-asymmetric', values: { level: '5', disks: 4, layout: 'right-asymmetric', find: 7 } },
      { label: 'RAID 6 on six disks', values: { level: '6', disks: 6, layout: 'left-symmetric', find: 10 } },
      { label: 'Eight fast disks, RAID 6', values: { level: '6', disks: 8, layout: 'left-symmetric', find: 20, size: 16000, seq: 260, iops: 200 } },
    ],
    counters: [{ id: 'stripes', label: 'stripes laid out' }],
    run(inp) {
      const t = T(), Rd = S.Raid, L = +inp.level, A = Rd.create({ level: L, disks: inp.disks, chunk: 1, stripes: 6, layout: inp.layout }), n = inp.disks, w = Rd.width(A);
      const fm = Rd.formulas({ level: L, disks: n, size: inp.size, seq: inp.seq, iops: inp.iops, latency: 8 });
      const F = new S.Frames(['stripes']);
      const name = L === 10 ? 'RAID 1+0' : 'RAID ' + L, rows = 6, cw = Math.min(84, Math.floor(620 / n) - 6), GX = 20, GY = 0;
      const gh = 30 + rows * (40 + 6);
      const legend = t.legend('rl:lg', GX, GY + gh + 18, [{ cls: 'rd-data', text: 'data' }].concat(L === 1 || L === 10 ? [{ cls: 'rd-data mirror', text: 'mirror copy' }] : []).concat(L >= 4 ? [{ cls: 'rd-par', text: L === 6 ? 'parity P' : 'parity' }] : []).concat(L === 6 ? [{ cls: 'rd-par q', text: 'parity Q' }] : []), 600, 13).items;
      const g = (upTo, act, lit) => grid({ prefix: 'rl:g', x: GX, y: GY, A, rows, cw, ch: 40, upTo, act, lit }).items;
      const base = { n, w, level: L, rows, nm1: n - 1, nm2: n - 2, half: n / 2 };
      const roleSay = (s) => {
        // pair each chunk with its own disk: the data disks in chunk order, chunk s·w + k on dataDisks[k]
        const dd = L === 1 ? [0] : Rd.dataDisks(A, s), ch = dd.map((d, k) => String(s * w + k));
        const pairs = t.list(dd.map((d, k) => 'chunk ' + ch[k] + ' on disk ' + d));
        if (L === 0) return `Stripe ${s} holds ${pairs}, one a disk.`;
        if (L === 1) return `Stripe ${s} holds chunk ${s} on disk 0 and a copy on every other disk.`;
        if (L === 10) return `Stripe ${s} holds ${t.list(dd.map((d, k) => 'chunk ' + ch[k] + ' on disk ' + d + ' (copy on ' + (d + 1) + ')'))}.`;
        const p = Rd.parityDisk(A, s), q = Rd.qDisk(A, s);
        return `Stripe ${s} holds ${pairs}; its parity P is on disk ${p}${q >= 0 ? ` and Q on disk ${q}` : ''}.`;
      };
      F.add({ items: [...g(-1), ...legend], say: `${name} on ${t.plural(n, 'disk')}: every stripe holds ${t.plural(w, 'data chunk')}${L >= 4 ? ` and ${L === 6 ? 'two parity chunks' : 'one parity chunk'}` : L === 1 || L === 10 ? ' and their mirror copies' : ''}. The logical chunks 0, 1, 2 … are laid out stripe by stripe.`, meta: Object.assign({ phase: 'start' }, base) });
      for (let s = 0; s < rows; s++) { F.set('stripes', s + 1); F.add({ items: [...g(s, (s2) => s2 === s), ...legend], title: 'stripe ' + s, say: roleSay(s), meta: Object.assign({ phase: 'stripe', s, tab: Rd.layoutTable(A)[s], p: Rd.parityDisk(A, s), q: Rd.qDisk(A, s), dd: Rd.dataDisks(A, s) }, base) }); }
      const m = Rd.map(A, inp.find);
      F.add({ items: [...g(rows - 1, (s, d) => s === m.stripe && (d === m.disk || (m.copies || []).includes(d)), (s, d) => s === m.stripe && (d === m.parity || d === m.q)), ...legend], title: 'find chunk ' + inp.find, say: `Logical chunk ${inp.find}: ⌊${inp.find} / ${w}⌋ = ${m.stripe} and ${inp.find} mod ${w} = ${m.k}, so it is stripe ${m.stripe}, position ${m.k}, which this layout puts on disk ${m.disk}${m.copies && m.copies.length > 1 ? ` (copies on disks ${t.list(m.copies.map(String))})` : ''}${m.parity >= 0 ? `. Writing it also changes the parity on disk ${m.parity}${m.q >= 0 ? ' and Q on disk ' + m.q : ''}` : ''}.`, meta: Object.assign({ phase: 'find', m }, base) });
      // what the level gives
      const PX = GX, PY = GY + gh + 56;
      const lines = fm.lines.filter((l) => !/latency/.test(l.name));
      const fmt = (v) => (Math.abs(v) >= 1000 ? String(R(v)) : t.fix(v, 2));
      const panel = (k) => {
        const its = [t.title('rl:pt', PX, PY, `what ${name} gives with ${n} disks of ${inp.size} GB, ${inp.seq} MB/s, ${inp.iops} IOPS each`)];
        lines.slice(0, k + 1).forEach((l, i) => {
          const y = PY + 28 + i * 25, on = i === k;
          its.push(t.text('rl:n' + i, PX, y, l.name, on ? 'strong act-t' : 'tick', 13));
          its.push(t.text('rl:f' + i, PX + 170, y, l.formula, 'calc' + (on ? ' act' : ' muted'), 13));
          its.push(t.text('rl:v' + i, PX + 470, y, l.name === 'space efficiency' ? fmt(100 * l.value) + '%' : fmt(l.value) + ' ' + l.unit, 'calc' + (on ? ' act' : ''), 13, 'end'));
        });
        return its;
      };
      lines.forEach((l, k) => F.add({ items: [...g(rows - 1), ...legend, ...panel(k)], title: l.name, say: l.say, meta: Object.assign({ phase: 'formula', line: l, fm, size: inp.size, seq: inp.seq, iops: inp.iops, eff: t.r2(100 * fm.efficiency), penalty: fm.penalty }, base) }));
      return { frames: F.list, def: { sections: [{ id: 'm', kind: 'math', title: 'Chunk c', text: ['stripe = ⌊c / data chunks a stripe⌋', 'position = c mod data chunks a stripe', 'RAID 4: parity on the last disk', 'RAID 5 left-symmetric: P on disk N − 1 − (stripe mod N)', 'RAID 6: Q on the disk after P'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'stripe' && f.meta.s === 1 && (f.meta.level === 5 || f.meta.level === 6), pick: 'option', ask: 'On which disk will stripe 2’s parity P sit?', options: (fr, i) => [...Array(fr[i].meta.n).keys()].map((d) => 'disk ' + d), answer: (fr, i) => 'disk ' + fr[i + 1].meta.p, explain: (fr, i) => fr[i + 1].say },
      { at: (f) => f.meta.phase === 'stripe' && f.meta.s === 5, pick: 'option', ask: (fr, i, inp) => 'Which disk holds logical chunk ' + inp.find + '?', options: (fr, i) => [...Array(fr[i].meta.n).keys()].map((d) => 'disk ' + d), answer: (fr) => 'disk ' + fr.find((f) => f.meta.phase === 'find').meta.m.disk, explain: (fr) => fr.find((f) => f.meta.phase === 'find').say },
    ],
    quiz: [
      { q: 'Five 4 TB disks in RAID 5 give how much usable space?', options: ['16 TB', '20 TB', '12 TB', '4 TB'], answer: 0, why: 'One disk’s worth goes to parity: (5 − 1) × 4 TB.' },
      { q: 'Why does RAID 5 rotate the parity instead of keeping it on one disk as RAID 4 does?', options: ['every small write updates parity, and one parity disk would be the bottleneck', 'to tolerate two failures', 'to use less space', 'so reads need no parity'], answer: 0, why: 'In RAID 4 all small writes queue on the parity disk; rotating spreads that load.' },
      { q: 'RAID 0 on four disks survives how many disk failures?', options: ['none', 'one', 'two', 'three'], answer: 0, why: 'There is no redundancy: losing any disk loses every fourth chunk.' },
      { q: 'RAID 6 can lose any two disks because…', options: ['it keeps two independent parities, P and Q', 'it mirrors every disk twice', 'it stripes twice as wide', 'its disks never fail together'], answer: 0, why: 'Two equations, P and Q, can be solved for two unknown chunks.' },
      { q: 'A random small write on RAID 5 costs how many disk I/Os?', options: ['4: read old data and parity, write both', '1', '2', '5'], answer: 0, why: 'This is the small-write penalty of parity RAID.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
