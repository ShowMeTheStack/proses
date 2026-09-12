// Part 12, hard disks: where a block number lands (cylinder, head, sector, with zones), and the platter and the
// stack of surfaces drawn to show it. Every number comes from the disk model (src/core/st-d-disk.js).
(function (S) {
  'use strict';
  const T = () => S.T12;
  const R = Math.round;

  /** the disk an input describes: uniform tracks, or three zones with fewer sectors a track further in */
  function diskOf(inp) {
    const o = { heads: inp.heads, rpm: inp.rpm || 7200 };
    if (inp.layout === 'zoned') {
      const c = inp.cylinders, a = Math.max(1, Math.round(c * 0.4)), b = Math.max(1, Math.round(c * 0.35)), z3 = c - a - b;
      const zs = [{ cyls: a, spt: inp.spt }, { cyls: b, spt: Math.max(2, Math.round(inp.spt * 0.75)) }];
      if (z3 > 0) zs.push({ cyls: z3, spt: Math.max(2, Math.round(inp.spt * 0.5)) });
      o.zones = zs;
    } else { o.cylinders = inp.cylinders; o.spt = inp.spt; }
    return S.Storage.disk(o);
  }
  S.T12.diskOf = diskOf;

  /**
   * a platter from above: rings for the tracks (every track when there are few, else the zone borders), the
   * chosen cylinder's track lit, sector boundaries on it and one sector filled. o: {prefix, cx, cy, R, r0, D, cyl,
   * sector, rot (turn fraction added to every angle), head: {angle} (draws the arm), lit: 'track'|'sector'|null}
   */
  function platter(o) {
    const t = T(), items = [], D = o.D, C = D.cylinders, Rr = o.R, r0 = o.r0;
    const band = (Rr - r0) / C, rad = (c) => Rr - (c + 0.5) * band;
    const P = o.prefix, rot = o.rot || 0;
    items.push({ key: P + ':disc', kind: 'path', d: t.circle(o.cx, o.cy, Rr), cls: 'pl-disc', audit: 'ignore', layer: 'back', box: { x: o.cx - Rr, y: o.cy - Rr, w: 2 * Rr, h: 2 * Rr } });
    items.push({ key: P + ':hub', kind: 'path', d: t.circle(o.cx, o.cy, r0 - 4), cls: 'pl-hub', audit: 'ignore', layer: 'back' });
    let d = '';
    if (C <= 28) for (let c = 0; c <= C; c++) d += t.circle(o.cx, o.cy, Rr - c * band) + ' ';
    else { d += t.circle(o.cx, o.cy, Rr) + ' ' + t.circle(o.cx, o.cy, r0) + ' '; }
    items.push({ key: P + ':rings', kind: 'path', d, cls: 'pl-ring', audit: 'ignore', layer: 'back' });
    if (D.zones.length > 1) {
      let zd = '';
      D.zones.forEach((z, i) => { if (i) zd += t.circle(o.cx, o.cy, Rr - z.from * band) + ' '; });
      items.push({ key: P + ':zones', kind: 'path', d: zd, cls: 'pl-zone', audit: 'ignore', layer: 'back' });
    }
    if (o.cyl !== undefined && o.cyl !== null && o.lit) {
      const z = D.zones.find((x) => o.cyl >= x.from && o.cyl <= x.to), spt = z.spt;
      const a = Rr - o.cyl * band, b = a - band, w = Math.max(band, 6), mid = (a + b) / 2;
      const ra = mid + w / 2, rb = mid - w / 2;
      items.push({ key: P + ':trk', kind: 'path', d: t.circle(o.cx, o.cy, ra) + ' ' + t.circle(o.cx, o.cy, rb), cls: 'pl-track', audit: 'ignore', layer: 'lines' });
      if (spt <= 96) {
        let sd = '';
        for (let k = 0; k < spt; k++) { const p1 = t.polar(o.cx, o.cy, rb - 3, k / spt + rot), p2 = t.polar(o.cx, o.cy, ra + 3, k / spt + rot); sd += `M${t.r1(p1[0])},${t.r1(p1[1])} L${t.r1(p2[0])},${t.r1(p2[1])} `; }
        items.push({ key: P + ':ticks', kind: 'path', d: sd, cls: 'pl-tick', audit: 'ignore', layer: 'lines' });
      }
      if (o.lit === 'sector' && o.sector !== undefined) {
        const n = Math.min(spt, o.span || 1), a0 = o.sector / spt + rot, a1 = Math.min(o.sector / spt + 0.999, (o.sector + n) / spt) + rot;
        items.push({ key: P + ':sec', kind: 'path', d: t.wedge(o.cx, o.cy, rb - 4, ra + 4, a0, Math.max(a1, a0 + 0.006)), cls: 'pl-sec ' + (o.secCls || ''), audit: 'ignore', layer: 'items' });
      }
      // sector 0's place, so the numbering has a start
      const m = t.polar(o.cx, o.cy, Rr + 10, rot);
      items.push({ key: P + ':s0', kind: 'dot', x: t.r1(m[0]), y: t.r1(m[1]), r: 4, cls: 'pl-mark', audit: 'ignore' });
    }
    if (o.head) {
      const hc = o.armCyl !== undefined ? o.armCyl : o.cyl, hr = hc === undefined || hc === null ? Rr - band * 0.5 : rad(hc), hp = t.polar(o.cx, o.cy, hr, o.head.angle);
      const pv = [o.cx + Rr + 44, o.cy + Rr - 6];
      items.push({ key: P + ':arm', kind: 'line', x1: R(pv[0]), y1: R(pv[1]), x2: t.r1(hp[0]), y2: t.r1(hp[1]), cls: 'pl-arm', audit: 'ignore', layer: 'top' });
      items.push({ key: P + ':pivot', kind: 'dot', x: R(pv[0]), y: R(pv[1]), r: 9, cls: 'pl-pivot', audit: 'ignore', layer: 'top' });
      items.push({ key: P + ':head', kind: 'dot', x: t.r1(hp[0]), y: t.r1(hp[1]), r: 5.5, cls: 'pl-headdot', audit: 'ignore', layer: 'top' });
    }
    return { items, rad };
  }
  S.T12.platter = platter;

  /** the stack of platters from the side: surfaces named by head, the comb of heads at the chosen cylinder (the
   * reading one lit) and that cylinder as a pair of dashed lines through every surface */
  function stack(o) {
    const t = T(), items = [], D = o.D, H = D.heads, np = Math.ceil(H / 2), P = o.prefix;
    const pitch = o.pitch || 56, w = o.w, x = o.x, y = o.y, cx = x + w / 2, half = w / 2;
    const f = o.cyl === undefined || o.cyl === null ? 0.5 : 1 - (o.cyl + 0.5) / D.cylinders, dx = 14 + f * (half - 22);
    items.push({ key: P + ':spindle', kind: 'cell', x: R(cx - 7), y: R(y - 12), w: 14, h: R(np * pitch + 2), rx: 3, text: '', cls: 'pl-spindle', audit: 'ignore' });
    for (let p = 0; p < np; p++) {
      const py = y + p * pitch + pitch / 2 - 5;
      items.push({ key: P + ':pl' + p, kind: 'cell', x: R(x), y: R(py), w: R(w), h: 10, rx: 3, text: '', cls: 'pl-side', audit: 'ignore' });
      for (const side of [0, 1]) {
        const h = 2 * p + side;
        if (h >= H) continue;
        const on = h === o.head && o.lit;
        items.push(t.text(P + ':hl' + h, x - 12, side ? py + 26 : py - 6, 'head ' + h, on ? 'strong act-t' : 'tick', 13, 'end'));
        items.push({ key: P + ':hm' + h, kind: 'cell', x: R(cx + dx - 7), y: R(side ? py + 11 : py - 9), w: 14, h: 8, rx: 2, text: '', cls: 'pl-headbox' + (on ? '' : ' off'), audit: 'ignore', layer: 'top' });
      }
    }
    if (o.lit) for (const sgn of [-1, 1]) items.push({ key: P + ':cy' + (sgn < 0 ? 'l' : 'r'), kind: 'line', x1: R(cx + sgn * dx), y1: R(y - 18), x2: R(cx + sgn * dx), y2: R(y + np * pitch + 6), cls: 'pl-cyl', audit: 'ignore', layer: 'lines' });
    return { items, h: np * pitch };
  }
  S.T12.stack = stack;

  // =================================================================================================================
  S.topic({
    id: 'disk-geometry', family: 'p12-disk', order: 10, title: 'Where a block lives: cylinder, head and sector',
    blurb: 'A disk numbers its sectors 0, 1, 2 … (the logical block address), but the sector sits on one track of one surface. The numbering fills a whole track, then the same track on the next surface, then moves the arm in by one cylinder. Divide by the sectors in a cylinder and in a track to find it; with zones, the outer tracks hold more sectors.',
    inputs: [
      { id: 'layout', kind: 'choice', label: 'tracks', def: 'uniform', options: [{ value: 'uniform', label: 'every track the same' }, { value: 'zoned', label: 'zoned (outer tracks longer)' }] },
      { id: 'cylinders', kind: 'number', label: 'cylinders', def: 6, min: 3, max: 200000 },
      { id: 'heads', kind: 'number', label: 'heads (surfaces)', def: 4, min: 1, max: 16 },
      { id: 'spt', kind: 'number', label: 'sectors a track (outer)', def: 12, min: 4, max: 2000 },
      { id: 'lba', kind: 'number', label: 'block (LBA)', def: 137, min: 0, max: 1e9 },
    ],
    check(inp) { try { const D = diskOf(inp); if (inp.lba >= D.sectors) return 'block (LBA): this disk has only ' + D.sectors + ' sectors, 0 to ' + (D.sectors - 1); } catch (e) { return e.message; } return null; },
    presets: [
      { label: 'A small disk, block 137', values: { layout: 'uniform', cylinders: 6, heads: 4, spt: 12, lba: 137 } },
      { label: 'Block 0 and its neighbour', values: { layout: 'uniform', cylinders: 6, heads: 4, spt: 12, lba: 0 } },
      { label: 'The last sector of a track', values: { layout: 'uniform', cylinders: 8, heads: 2, spt: 16, lba: 47 } },
      { label: 'Zoned: three zones', values: { layout: 'zoned', cylinders: 10, heads: 2, spt: 24, lba: 300 } },
      { label: 'A real drive (zoned)', values: { layout: 'zoned', cylinders: 150000, heads: 8, spt: 1600, lba: 987654321 } },
    ],
    counters: [{ id: 'cyl', label: 'cylinder' }, { id: 'head', label: 'head' }, { id: 'sector', label: 'sector' }],
    run(inp) {
      const t = T(), D = diskOf(inp), c = S.Storage.chs(D, inp.lba), z = D.zones[c.zone], per = D.heads * z.spt, off = inp.lba - z.firstLba;
      const back = S.Storage.lba(D, c), nxt = inp.lba + 1 < D.sectors ? S.Storage.chs(D, inp.lba + 1) : null;
      const F = new S.Frames(['cyl', 'head', 'sector']);
      const PL = { cx: 180, cy: 200, R: 165, r0: 42 }, SX = { x: 480, y: 56, w: 230 }, CX = 20, CY = 420;
      const zoned = D.zones.length > 1, gb = D.capacity / 1e9;
      const base = { D: D.zones.map((q) => ({ from: q.from, to: q.to, spt: q.spt, firstLba: q.firstLba })), heads: D.heads, cylinders: D.cylinders, sectors: D.sectors, capacity: D.capacity, gb: t.r2(gb), lba: inp.lba, per, off, chs: c, spt: z.spt, back, zone: c.zone + 1, nzones: D.zones.length, first: z.firstLba, sectorBytes: D.sectorBytes, mb: t.r3(D.capacity / 1e6), inCyl: c.cyl - z.from, lba1: inp.lba + 1 };
      const lines = [];
      const calc = (upTo, act) => {
        const its = [t.title('dg:ct', CX, CY, 'block ' + inp.lba)];
        lines.slice(0, upTo).forEach((l, i) => its.push(t.text('dg:c' + i, CX, CY + 32 + i * 28, l, 'calc' + (i === act ? ' act' : ''), 14)));
        return its;
      };
      if (zoned) lines.push(`zone ${c.zone + 1}: blocks from ${z.firstLba}`, `offset in zone = ${inp.lba} − ${z.firstLba} = ${off}`);
      lines.push(`per cylinder = ${D.heads} × ${z.spt} = ${per}`, `cylinder = ${z.from ? z.from + ' + ' : ''}⌊${off} / ${per}⌋ = ${c.cyl}`, `head = ⌊${off % per} / ${z.spt}⌋ = ${c.head}`, `sector = ${off % per} mod ${z.spt} = ${c.sector}`);
      const L0 = zoned ? 2 : 0;
      const backText = `(${c.cyl - z.from} × ${D.heads} + ${c.head}) × ${z.spt} + ${c.sector}${zoned ? ' + ' + z.firstLba : ''} = ${back}`;
      const RX = Math.max(430, CX + 36 + Math.max(...lines.concat([backText]).map((l) => t.tw(l, 14, { mono: true, bold: true }))));
      const FX = RX + 16 + Math.max(...['cylinder ' + c.cyl, 'head ' + c.head, 'sector ' + c.sector].map((l) => t.tw(l, 14, { bold: true })));
      const pic = (lit, nCalc, act, extra) => {
        const p = platter(Object.assign({ prefix: 'dg:p', D, cyl: c.cyl, sector: c.sector, lit }, PL));
        const s = stack({ prefix: 'dg:s', D, x: SX.x, y: SX.y, w: SX.w, cyl: c.cyl, head: c.head, lit: lit ? lit : null, pitch: 56 });
        const its = [...p.items, ...s.items, t.text('dg:pt', PL.cx, 16, 'one surface, from above', 'tick', 13, 'middle'), t.text('dg:st', SX.x + SX.w / 2, 16, 'the surfaces, from the side', 'tick', 13, 'middle'), ...calc(nCalc, act)];
        if (zoned) D.zones.forEach((q, i) => its.push(t.text('dg:z' + i, RX, CY + 32 + i * 28, `zone ${i + 1}: cylinders ${q.from}–${q.to}, ${q.spt} a track`, 'tick' + (i === c.zone && lit ? ' act-t' : ''), 13)));
        const fy = CY + 32 + (zoned ? D.zones.length * 28 + 14 : 0), lv = { track: 1, sector: 3 }[lit] || 0;
        const facts = [['cylinder ' + c.cyl, 'where the arm stops'], ['head ' + c.head, 'which surface is read'], ['sector ' + c.sector, 'when it passes the head']];
        const shown = lit === 'sector' ? 3 : lit === 'track' ? Math.max(1, nCalc - L0 - 1) : 0;
        facts.slice(0, Math.min(3, shown)).forEach((f, i) => { its.push(t.text('dg:fa' + i, RX, fy + i * 28, f[0], 'strong', 14), t.text('dg:fb' + i, FX, fy + i * 28, f[1], 'tick', 13)); });
        return its.concat(extra || []);
      };
      const cap = gb >= 1 ? t.fix(gb, 2) + ' GB' : t.fix(D.capacity / 1e6, 3) + ' MB';
      F.add({ items: pic(null, 0, -1), say: `This disk has ${t.plural(D.cylinders, 'cylinder')} and ${t.plural(D.heads, 'surface')} with a head each${zoned ? `, in ${D.zones.length} zones of ${t.list(D.zones.map((q) => String(q.spt)))} sectors a track` : `, and ${z.spt} sectors a track`}: ${D.sectors} sectors of 512 bytes, ${cap}. Block ${inp.lba} is one of them; where is it?`, meta: Object.assign({ phase: 'disk' }, base) });
      if (zoned) {
        F.add({ items: pic('track', 2, 1), title: 'the zone', say: `Zone ${c.zone + 1} starts at block ${z.firstLba}${c.zone + 1 < D.zones.length ? ` and the next at ${D.zones[c.zone + 1].firstLba}` : ''}, so block ${inp.lba} is in zone ${c.zone + 1}, ${off} blocks in. Its tracks hold ${z.spt} sectors.`, meta: Object.assign({ phase: 'zone', next: c.zone + 1 < D.zones.length ? D.zones[c.zone + 1].firstLba : null }, base) });
      }
      F.set('cyl', c.cyl);
      F.add({ items: pic('track', L0 + 2, L0 + 1), title: 'the cylinder', say: `A cylinder holds ${t.plural(D.heads, 'track')} of ${z.spt}, ${per} sectors, all reachable without moving the arm. ${off} / ${per} rounds down to ${c.cyl - z.from}, so the block is on cylinder ${c.cyl}${z.from ? ` (zone ${c.zone + 1} starts at cylinder ${z.from})` : ''}.`, meta: Object.assign({ phase: 'cyl', inCyl: c.cyl - z.from }, base) });
      F.set('head', c.head);
      F.add({ items: pic('track', L0 + 3, L0 + 2), title: 'the head', say: `${t.cap(t.plural(off % per, 'sector'))} into that cylinder, and each surface's track holds ${z.spt}: ⌊${off % per} / ${z.spt}⌋ = ${c.head}, so head ${c.head} reads it.`, meta: Object.assign({ phase: 'head', rem: off % per }, base) });
      F.set('sector', c.sector);
      F.add({ items: pic('sector', L0 + 4, L0 + 3), title: 'the sector', say: `What is left, ${off % per} mod ${z.spt} = ${c.sector}, is the sector on the track, counted round from sector 0 (the dot). Block ${inp.lba} is cylinder ${c.cyl}, head ${c.head}, sector ${c.sector}.`, meta: Object.assign({ phase: 'sector', rem: off % per }, base) });
      let nsay;
      if (!nxt) nsay = `Back the other way, ${zoned ? z.firstLba + ' + ' : ''}(${c.cyl - z.from} × ${D.heads} + ${c.head}) × ${z.spt} + ${c.sector} = ${back}. It is the last sector on the disk.`;
      else {
        const how = nxt.cyl !== c.cyl ? `the next cylinder, ${nxt.cyl}: the arm must move` : nxt.head !== c.head ? `head ${nxt.head} on the same cylinder: a head switch, no seek` : `the next sector of the same track: no seek and no wait`;
        nsay = `Back the other way, ${zoned ? z.firstLba + ' + ' : ''}(${c.cyl - z.from} × ${D.heads} + ${c.head}) × ${z.spt} + ${c.sector} = ${back}. Block ${inp.lba + 1} is on ${how}. That is why consecutive blocks are fast to read.`;
      }
      F.add({ items: pic('sector', lines.length, -1, [t.text('dg:back', CX, CY + 32 + lines.length * 28 + 6, backText, 'calc good', 14)]), title: 'and back', say: nsay, meta: Object.assign({ phase: 'back', nxt }, base) });
      return { frames: F.list, def: { sections: [{ id: 'f', kind: 'math', title: 'Block number to place', text: ['per cylinder = heads × sectors a track', 'cylinder = ⌊LBA / per cylinder⌋', 'head = ⌊(LBA mod per cylinder) / sectors a track⌋', 'sector = LBA mod sectors a track', 'LBA = (cylinder × heads + head) × sectors a track + sector', 'zoned: work within the block’s zone'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'cyl', pick: 'option', ask: (fr, i) => 'Block ' + fr[i].meta.lba + ' + 1: what must the disk do to read it after this one?', options: ['nothing: it is the next sector of the track', 'switch to another head', 'move the arm to the next cylinder'], answer: (fr, i) => { const m = fr[fr.length - 1].meta; if (!m.nxt) return null; return m.nxt.cyl !== m.chs.cyl ? 'move the arm to the next cylinder' : m.nxt.head !== m.chs.head ? 'switch to another head' : 'nothing: it is the next sector of the track'; }, explain: (fr) => fr[fr.length - 1].say },
      { at: (f) => f.meta.phase === 'disk' || f.meta.phase === 'zone', once: true, pick: 'option', ask: 'Which part of the block’s place do you work out first?', options: ['the cylinder: divide by the sectors in a cylinder', 'the sector: divide by the sectors in a track', 'the head: divide by the number of heads'], answer: 'the cylinder: divide by the sectors in a cylinder', explain: 'The numbering fills a whole cylinder before the arm moves, so the cylinder is the largest unit: divide by heads × sectors a track first.' },
    ],
    quiz: [
      { q: 'A disk has 4 heads and 50 sectors a track. Which cylinder holds block 1234?', options: ['6', '24', '12', '4'], answer: 0, why: 'A cylinder holds 4 × 50 = 200 blocks, and ⌊1234 / 200⌋ = 6.' },
      { q: 'Why does the numbering fill every surface of a cylinder before moving on?', options: ['switching heads is electronic and fast; moving the arm is slow', 'the outer tracks are longer', 'the heads cannot read at the same time', 'it saves space on the platter'], answer: 0, why: 'All the tracks of a cylinder are under the heads at once, so reading on needs no seek.' },
      { q: 'In a zoned disk the outer tracks…', options: ['hold more sectors, so they transfer faster', 'hold fewer sectors', 'spin faster', 'are kept empty'], answer: 0, why: 'The outer tracks are longer, so more sectors fit at the same bit density, and more pass the head each turn.' },
      { q: 'Which is a cylinder?', options: ['the same track on every surface', 'one ring on one surface', 'one sector on every track', 'the whole of one platter'], answer: 0, why: 'All the heads move together, so the tracks at one arm position form a cylinder.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
