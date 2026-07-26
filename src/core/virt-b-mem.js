// Virtual machines, part 2: memory virtualisation. A guest page table maps guest-virtual to guest-physical
// addresses, and the host's maps guest-physical to host-physical. With nested (two-dimensional) paging the
// hardware walks both: every guest table's address is itself guest-physical, so each guest level costs a whole
// host walk plus the read of the guest entry, and the final guest-physical address needs one more host walk:
// (g + 1)(h + 1) − 1 table reads for g guest and h host levels (24 for 4 and 4). With shadow page tables the VMM
// keeps one combined table per guest process, guest-virtual straight to host-physical, so a TLB miss costs g
// reads, but every change the guest makes to its own tables must trap so the VMM can copy it.
//   S.Virt.count2d(g, h) -> (g + 1)(h + 1) − 1
//   S.Virt.walk2d({guestLevels: 4, hostLevels: 4, seed}) -> {steps, accesses (table reads), total (with the
//       data), grid: [[kind per cell]], gva, gpa, hpa, guest, host}
//       Built on S.Mem (config, build, translate): the guest table is a real S.Mem table whose frames are
//       guest-physical; the host table maps each of those frames (and the data page) to host frames. Steps are
//       {kind: 'host-read' | 'guest-read' | 'data', row, col, say, addr}: row = the guest level
//       (g for the data's own translation), col = the host level (h for the guest entry itself), so a view can
//       draw the (g + 1) × (h + 1) grid cell by cell.
//   S.Virt.memVirt({technique: 'shadow' | 'nested', events: [{op: 'access' | 'map' | 'unmap', page} |
//                   {op: 'switch', to}], guestLevels, hostLevels, tlb: true})
//       -> {steps, exits, walkReads, tlbMisses, faults, technique}
(function (S) {
  'use strict';
  const V = (S.Virt = S.Virt || {});
  V.count2d = (g, h) => (g + 1) * (h + 1) - 1;

  V.walk2d = function (o) {
    o = o || {};
    const M = S.Mem, g = Math.max(1, Math.min(5, o.guestLevels || 4)), h = Math.max(1, Math.min(5, o.hostLevels || 4));
    const rand = S.Os.rng(o.seed === undefined ? 3 : o.seed), B = BigInt;
    const gcfg = M.config({ vaBits: 12 + 9 * g, pageBytes: 4096, levels: g, pteBytes: 8 });
    const hcfg = M.config({ vaBits: 12 + 9 * h, pageBytes: 4096, levels: h, pteBytes: 8 });
    const gvpn = B(Math.floor(rand() * 2 ** Math.min(30, gcfg.vpnBits)));
    const gdata = B(0x40 + Math.floor(rand() * 0x40));
    const guest = M.build(gcfg, [[gvpn, gdata]], { tableFrame: 0x100 });
    const gframes = guest.tables.map((t) => t.frame).concat([gdata]);
    const used = new Set(), hmap = [];
    for (const f of gframes) { let x; do x = 0x2000 + Math.floor(rand() * 0x2000); while (used.has(x)); used.add(x); hmap.push([f, B(x)]); }
    const host = M.build(hcfg, hmap, { tableFrame: 0x300 });
    const off = B(Math.floor(rand() * 4096));
    const gva = M.addr(gcfg, gvpn, off);
    const gw = M.translate(guest, gva);
    const hx = (v) => M.hex(v, 0, false);
    const steps = [], grid = Array.from({ length: g + 1 }, () => Array(h + 1).fill(null));
    let accesses = 0;
    steps.push({ kind: 'start', row: -1, col: -1, say: 'Guest-virtual address ' + hx(gva) + ': the guest has ' + V.plural(g, 'level') + ', the host ' + h + '. The guest\'s root table is at guest-physical ' + hx(M.tableBase(guest, guest.tables[0])) + ', which the hardware must itself translate.' });
    const hostWalk = (gpa, row, what) => {
      const hw = M.translate(host, gpa);
      let col = 0;
      for (const s of hw.steps) {
        if (s.kind !== 'read') continue;
        accesses++; grid[row][col] = 'host';
        steps.push({ kind: 'host-read', row, col, addr: s.entryAddr, accesses, say: 'Read ' + accesses + ': host level ' + (col + 1) + ' for ' + what + ' (guest-physical ' + hx(gpa) + '), entry at host ' + hx(s.entryAddr) + '.' });
        col++;
      }
      return hw.pa;
    };
    let row = 0;
    for (const s of gw.steps) {
      if (s.kind !== 'read') continue;
      const hpa = hostWalk(s.entryAddr, row, 'the guest level-' + (row + 1) + ' entry');
      accesses++; grid[row][h] = 'guest';
      steps.push({ kind: 'guest-read', row, col: h, addr: hpa, accesses, say: 'Read ' + accesses + ': the guest level-' + (row + 1) + ' entry itself, at host ' + hx(hpa) + ', gives guest frame ' + hx(s.next) + (s.leaf ? ', the data page.' : ', the next guest table.') });
      row++;
    }
    const hpaData = hostWalk(gw.pa, g, 'the data page');
    const tableReads = accesses;
    grid[g][h] = 'data';
    steps.push({ kind: 'data', row: g, col: h, addr: hpaData, accesses: accesses + 1, say: 'The data itself is read at host ' + hx(hpaData) + '. ' + V.plural(tableReads, 'table read') + ' in all: ' + V.plural(g, 'guest level') + ' each needing ' + V.plural(h, 'host read') + ' plus the entry, and ' + h + ' more for the data, (' + g + ' + 1)(' + h + ' + 1) − 1 = ' + V.count2d(g, h) + '. Natively it would be ' + g + '.' });
    return { steps, accesses: tableReads, total: tableReads + 1, grid, gva, gpa: gw.pa, hpa: hpaData, guest, host, g, h };
  };

  V.memVirt = function (o) {
    o = o || {};
    const tech = o.technique || 'shadow', g = o.guestLevels || 4, h = o.hostLevels || 4, useTlb = o.tlb !== false;
    const events = o.events || [{ op: 'access', page: 1 }, { op: 'access', page: 2 }, { op: 'access', page: 1 }, { op: 'map', page: 3 }, { op: 'access', page: 3 }, { op: 'switch', to: 'Q' }, { op: 'access', page: 1 }, { op: 'access', page: 5 }, { op: 'switch', to: 'P' }, { op: 'access', page: 2 }];
    const procs = { P: new Set([1, 2]), Q: new Set([1]) };
    const shadowBuilt = new Set(['P']);
    let cur = 'P', exits = 0, walkReads = 0, tlbMisses = 0, faults = 0;
    const tlb = new Set(), steps = [];
    const missCost = tech === 'shadow' ? g : V.count2d(g, h);
    const add = (kind, say, ev) => steps.push({ kind, say, ev, proc: cur, exits, walkReads, tlb: Array.from(tlb).sort((a, b) => a - b), mapped: Array.from(procs[cur]).sort((a, b) => a - b) });
    add('start', (tech === 'shadow' ? 'Shadow paging: the VMM keeps a shadow table for each guest process mapping guest-virtual pages straight to host frames, and write-protects the guest\'s own tables.' : 'Nested paging: the hardware walks the guest\'s table and the host\'s together; the guest edits its tables freely.') + ' A TLB miss costs ' + V.plural(missCost, 'read') + '.');
    const map = (page, ev, why) => {
      procs[cur].add(page);
      if (tech === 'shadow') { exits++; add('map', why + 'The guest writes page ' + page + '\'s entry into its own table; the table is write-protected, so the write traps: a VM exit, and the VMM fills the shadow entry too.', ev); }
      else add('map', why + 'The guest writes page ' + page + '\'s entry into its own table: an ordinary memory write, no exit.', ev);
    };
    for (const ev of events) {
      if (ev.op === 'switch') {
        procs[ev.to] = procs[ev.to] || new Set();
        cur = ev.to; tlb.clear();
        if (tech === 'shadow') {
          exits++;
          const built = shadowBuilt.has(cur); shadowBuilt.add(cur);
          add('switch', 'The guest loads ' + cur + '\'s page-table base: in shadow paging that traps (a VM exit) so the VMM can switch to ' + cur + '\'s shadow table' + (built ? ', which it kept' : ', which it must build first') + '; the TLB is flushed.', ev);
        } else add('switch', 'The guest loads ' + cur + '\'s page-table base itself, with no exit; the TLB is flushed.', ev);
        continue;
      }
      if (ev.op === 'map') { map(ev.page, ev, ''); continue; }
      if (ev.op === 'unmap') {
        procs[cur].delete(ev.page); tlb.delete(ev.page);
        if (tech === 'shadow') { exits++; add('unmap', 'The guest clears page ' + ev.page + '\'s entry: the write traps, the VMM clears the shadow entry, and the TLB entry goes.', ev); }
        else add('unmap', 'The guest clears page ' + ev.page + '\'s entry and flushes that TLB entry, with no exit.', ev);
        continue;
      }
      // access
      if (useTlb && tlb.has(ev.page)) { add('hit', cur + ' touches page ' + ev.page + ': a TLB hit, no walk at all, in either design.', ev); continue; }
      tlbMisses++;
      if (!procs[cur].has(ev.page)) {
        faults++;
        if (tech === 'shadow') { exits++; add('fault', cur + ' touches page ' + ev.page + ', which its guest table does not map: the fault goes to the VMM first (a VM exit), which finds the guest\'s own table empty too and passes the fault into the guest kernel.', ev); }
        else add('fault', cur + ' touches page ' + ev.page + ', which its guest table does not map: the page fault goes straight to the guest kernel, with no exit.', ev);
        map(ev.page, ev, 'The guest kernel handles its fault. ');
      }
      walkReads += missCost; tlb.add(ev.page);
      add('walk', cur + ' touches page ' + ev.page + ': a TLB miss, so the hardware walks ' + (tech === 'shadow' ? 'the shadow table, ' + V.plural(g, 'read') : 'both tables, ' + V.plural(missCost, 'read')) + ', and caches the translation.', ev);
    }
    add('end', (tech === 'shadow' ? 'Shadow' : 'Nested') + ' paging: ' + exits + ' VM exit' + (exits === 1 ? '' : 's') + ', ' + tlbMisses + ' TLB miss' + (tlbMisses === 1 ? '' : 'es') + ' costing ' + V.plural(walkReads, 'table read') + ', ' + faults + ' guest page fault' + (faults === 1 ? '' : 's') + '.', null);
    return { steps, exits, walkReads, tlbMisses, faults, technique: tech };
  };
})(globalThis.Proses = globalThis.Proses || {});
