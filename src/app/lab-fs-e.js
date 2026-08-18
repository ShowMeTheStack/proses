// The File-system lab, part five: the walk to byte N drawn (the file block and offset worked out, what each part of
// an indexed inode reaches, the steps so far, and the chain inode → indirect blocks → data block with the index taken
// at each), and the Inspect tab: click a block on the map, or an inode in the list, and see what it holds, decoded
// from the image as it stood at that step.
//   FL.walkPanel(g, W, j, ino, v, size) -> (X, Y, RW) -> {items, h}       FL.inspectView: {id, label, render}
(function (S) {
  'use strict';
  const FL = S.FsLab, F = () => S.FS;
  const R = Math.round;

  FL.walkPanel = function (g, W, j, ino, v, size) {
    return (X, Y, RW) => {
      const items = [], pay = F().payload(g), N = v.walkN;
      items.push(FL.text('wk:h', X, Y + 14, FL.fit(`byte ${FL.grp(N)} of ${v.walkPath} (inode ${ino}, ${FL.grp(size)} bytes)`, RW, 14, { bold: true }), 'strong', 14));
      items.push(FL.text('wk:f1', X, Y + 40, FL.fit(`file block = ⌊${FL.grp(N)} ÷ ${pay}⌋ = ${FL.grp(W.fb)},  offset = ${FL.grp(N)} mod ${pay} = ${W.off}`, RW, 13, { mono: true }), 'mono', 13));
      let y = Y + 54;
      if (g.alloc === 'indexed' && RW > 400) {
        const reach = F().reach(g), lvl = W.loc.level, cws = [76, 220, Math.max(90, RW - 296)];
        ['part', 'file blocks', 'bytes'].forEach((t, q) => items.push(FL.cell('wk:th' + q, X + cws.slice(0, q).reduce((a, b) => a + b, 0), y + 6, cws[q], 22, t, 'dk slot-l', 12)));
        reach.concat([{ part: 'largest', from: -1, bytes: F().maxFileSize(g) }]).forEach((r, q) => {
          const vals = [r.part, r.from < 0 ? `bs·(d${g.levels >= 1 ? ' + P' : ''}${g.levels >= 2 ? ' + P²' : ''}${g.levels >= 3 ? ' + P³' : ''})` : FL.grp(r.from) + ' – ' + FL.grp(r.from + r.blocks - 1), FL.bytes(r.bytes)];
          vals.forEach((t, c) => items.push(FL.cell('wk:t' + q + '.' + c, X + cws.slice(0, c).reduce((a, b) => a + b, 0), y + 28 + q * 22, cws[c], 22, FL.fit(t, cws[c] - 10, 12), 'dk slot-v ' + (c ? 'mono ' : '') + (q === lvl && j >= 1 ? 'act' : r.from < 0 ? 'none' : ''), 12)));
        });
        y += 28 + (reach.length + 1) * 22 + 10;
      }
      items.push(FL.head('wk:sh', X, y + 16, 'the steps'));
      y += 26;
      W.steps.slice(0, j + 1).forEach((s, q) => {
        if (RW < 400 && q < j - 1) return;
        const lines = S.Kit.disk.wrap(s.say, RW - 20, 13).slice(0, 2), h = lines.length * 18 + 10;
        items.push(FL.cell('wk:s' + q, X, y, RW, h, lines.length > 1 ? lines : lines[0], 'card oc ' + (q === j ? 'act' : 'old'), 13, { align: 'left' }));
        y += h + 5;
      });
      // the chain, for an indexed inode, wide enough to draw
      const chain = [];
      if (g.alloc === 'indexed' && RW > 450) {
        const sI = W.steps.find((s) => s.kind === 'inode'), idx = W.steps.filter((s) => s.kind === 'index'), sD = W.steps.find((s) => s.kind === 'data');
        const upto = (s) => W.steps.indexOf(s) <= j;
        if (sI && upto(sI)) chain.push({ lines: ['inode ' + ino, (typeof sI.slot === 'number' ? 'd' + sI.slot : sI.slot) + ' → ' + (sI.ptr || '—')], cls: 'dk dk-it' });
        for (const s of idx) if (upto(s)) chain.push({ lines: ['blk ' + s.block, '[' + s.idx + '] → ' + (s.ptr || '—')], cls: 'dk dk-data fl-ind' });
        if (sD && upto(sD)) chain.push({ lines: [sD.block ? 'data ' + sD.block : 'a hole', 'byte ' + sD.off + ': ' + (sD.byte >= 32 && sD.byte < 127 ? '"' + String.fromCharCode(sD.byte) + '"' : sD.byte)], cls: 'dk dk-data' });
      }
      if (chain.length) {
        const bw = 100, gap = 16;
        y += 10;
        chain.forEach((c, q) => {
          const x = X + q * (bw + gap);
          items.push(FL.cell('wk:c' + q, x, y, bw, 44, c.lines, c.cls + (q === chain.length - 1 ? ' act' : ''), 12));
          if (q) items.push({ key: 'wk:a' + q, kind: 'wire', pts: [[x - gap, y + 22], [x, y + 22]], head: true, cls: q === chain.length - 1 ? 'act' : '' });
        });
        y += 50;
      }
      return { items, h: y - Y };
    };
  };

  // ---- the Inspect tab -------------------------------------------------------------------------------------------
  FL.sel = { block: null, ino: null, dev: 0 };
  /** hook the stage's clicks: a block on the map goes to the Inspect tab */
  FL.hookPick = function () {
    if (typeof document === 'undefined') return;
    setTimeout(() => {
      const P = S.app && S.app.page && S.app.page.lab;
      if (!P || !P.stage || P.lab.id !== 'fs') return;
      P.stage.onPick = (key) => {
        const m = /^dm:m:b(\d+)$/.exec(key || '');
        if (!m) return;
        const f = P.frames[P.i] || {};
        FL.sel = { block: +m[1], ino: null, dev: f.fsi ? f.fsi.dev : 0 };
        P.pause();
        P.showTab('inspect');
      };
    }, 0);
  };
  const hexRow = (u, from, n) => { let s = ''; for (let i = from; i < Math.min(u.length, from + n); i++) s += (u[i] < 16 ? '0' : '') + u[i].toString(16) + ' '; return s.trim(); };
  /** what one block holds, as tables */
  FL.blockTables = function (sn, b) {
    const img = FL.live(sn), g = sn.g, u = F().readBlock(img, b), r = F().region(g, b), lk = FL.look(sn), out = [];
    const owner = lk.owner.get(b), kind = lk.kind.get(b);
    const head = [['block', String(b)], ['region', FL.KNAME[r] || r], ['owner', owner ? 'inode ' + owner + ' (' + (kind === 'indirect' ? 'indirect block' : kind) + ')' : r === 'data' ? 'nobody: free' : '–'], ['in memory', sn.mem.has(b) ? 'a newer copy is dirty in memory; this is that copy' : 'no']];
    out.push({ title: 'Block ' + b, cols: ['', ''], rows: head });
    if (r === 'super') {
      const s = F().decodeSuper(u);
      out.push({ title: 'Superblock fields', cols: ['field', 'value'], rows: [['magic', '0x' + s.magic.toString(16)]].concat(F().SB_FIELDS.map((k) => [k, String(s[k])])).concat([['orphan list', F().orphans(img).join(', ') || 'empty']]) });
    } else if (r === 'ibm' || r === 'dbm') {
      const G = g.grp.find((x) => x[r] === b) || g.grp[0], n = r === 'ibm' ? G.nino : G.ndata, rows = [];
      for (let i = 0; i < n; i++) if (F().getBit(u, i)) rows.push([String(i), r === 'ibm' ? 'inode ' + (G.ino0 + i) : 'block ' + (G.data + i)]);
      out.push({ title: (r === 'ibm' ? 'Inode' : 'Data') + ' bitmap: the bits set (' + rows.length + ' of ' + n + ')', cols: ['bit', 'means in use'], rows });
    } else if (r === 'fat') {
      const per = g.bs / g.ps, j0 = (b - g.dbmStart) * per, rows = [];
      for (let k = 0; k < per; k++) { const y = F().getPtr(u, k * g.ps, g.ps), blk = g.dataStart + j0 + k; if (y && blk < g.nblocks) rows.push(['FAT[' + blk + ']', y === g.EOC ? 'end of chain' : String(y)]); }
      out.push({ title: 'FAT entries in use', cols: ['entry', 'next block'], rows });
    } else if (r === 'itable') {
      const per = g.bs / g.isz, G = g.grp.find((x) => b >= x.it && b < x.it + x.itBlocks) || g.grp[0], rows = [];
      for (let k = 0; k < per; k++) { const ino = G.ino0 + (b - G.it) * per + k; if (ino >= g.ninodes) continue; const n = F().decodeInode(g, u, k * g.isz); rows.push([String(ino), ['free', 'file', 'dir', 'symlink'][n.type] || '?', String(n.nlink), String(n.size), n.type ? FL.slotNames(g).map((x, i) => (F().slot(g, n, i) ? x + ' ' + F().slot(g, n, i) : '')).filter(Boolean).join(', ') || '–' : '–']); }
      out.push({ title: 'The inodes in this block', cols: ['inode', 'type', 'links', 'size', 'pointers'], rows });
    } else if (r === 'journal') {
      const js = F().journalState(FL.disk(sn)), k = b - g.jStart;
      out.push({ title: 'The journal', cols: ['', ''], rows: k === 0 ? [['journal superblock', ''], ['last transaction done', String(js.done)], ['log head', String(js.head)]] : [['log block', String(k)], ['holds', (() => { const e = js.log[k - 1]; return e.kind === 'TxB' ? 'the begin block of transaction ' + e.seq + ', homes ' + e.homes.join(', ') : e.kind === 'TxE' ? 'the commit block of transaction ' + e.seq : e.kind === 'data' ? 'a logged copy of a block' : 'nothing'; })()]] });
    } else if (kind === 'dir') {
      const rows = [];
      for (let off = 0; off + F().DIRENT <= g.bs; off += F().DIRENT) { const e = F().decodeDirent(u, off); if (e.ino) rows.push([String(off / F().DIRENT), e.name, String(e.ino)]); }
      out.push({ title: 'Directory entries (32 bytes each)', cols: ['slot', 'name', 'inode'], rows });
    } else if (kind === 'indirect' && g.alloc === 'indexed') {
      const rows = [];
      for (let k = 0; k < g.P; k++) { const p = F().getPtr(u, k * g.ps, g.ps); if (p) rows.push(['[' + k + ']', String(p)]); }
      out.push({ title: 'Pointers in use (' + rows.length + ' of ' + g.P + ')', cols: ['entry', 'block'], rows });
    }
    if (r === 'data' && kind !== 'dir' && !(kind === 'indirect' && g.alloc === 'indexed')) {
      const rows = [];
      for (let i = 0; i < Math.min(g.bs, 128); i += 16) rows.push([String(i), hexRow(u, i, 16), FL.show(u.subarray(i, i + 16))]);
      out.push({ title: 'The bytes' + (g.bs > 128 ? ' (the first 128)' : ''), cols: ['at', 'hex', 'text'], rows });
    }
    return out;
  };
  /** what one inode holds */
  FL.inodeTables = function (sn, ino, names) {
    const img = FL.live(sn), g = sn.g, n = F().readInode(img, ino), a = F().inodeAt(g, ino), out = [];
    const rows = [['inode', String(ino)], ['name', names.get((sn.dev || 0) + ':' + ino) || '(none)'], ['lives in', 'inode-table block ' + a.block + ', byte ' + a.off], ['type', ['free', 'file', 'directory', 'symlink'][n.type]], ['links', String(n.nlink)], ['mode', F().modeString(n.mode) + ' (' + n.mode.toString(8) + ')'], ['owner', 'uid ' + n.uid + ', gid ' + n.gid], ['size', FL.grp(n.size) + ' bytes']];
    FL.slotNames(g).forEach((x, i) => rows.push([x, String(F().slot(g, n, i) || '—')]));
    out.push({ title: 'Inode ' + ino, cols: ['field', 'value'], rows });
    let owned = [];
    try { owned = F().ownedBlocks(img, n); } catch (e) { owned = []; }
    if (owned.length) out.push({ title: 'The blocks it owns', cols: ['block', 'as', 'file block'], rows: owned.slice(0, 64).map((x) => [String(x.block), x.kind, x.fb === undefined ? '–' : String(x.fb)]) });
    if (n.type === F().T_DIR) { const tx = new (F().Tx)(img); out.push({ title: 'Its entries', cols: ['name', 'inode'], rows: F().dirEntries(tx, ino).filter((e) => e.ino).map((e) => [e.name, String(e.ino)]) }); }
    if (n.type === F().T_LINK) { const tx = new (F().Tx)(img); out.push({ title: 'The target it holds', cols: ['path'], rows: [[F().readLinkTx(tx, ino)]] }); }
    if (n.type === F().T_FILE && n.size) { const t = F().text(F().read(img, ino, 0, Math.min(n.size, 96))); out.push({ title: 'Its first bytes', cols: ['text'], rows: [[FL.show(Uint8Array.from(t, (c) => c.charCodeAt(0) & 255))]] }); }
    return out;
  };

  FL.inspectView = {
    id: 'inspect', label: 'Inspect',
    render(host, ctx) {
      const { h } = S.UI, f = ctx.frame || {}, fi = f.fsi;
      if (!fi || !fi.devs) { host.appendChild(S.UI.empty('search', 'Nothing to inspect here', 'The disk workbench keeps its image at every step: click a block on the map, or an inode below.')); return; }
      const sel = FL.sel, dev = Math.min(sel.dev || 0, fi.devs.length - 1), sn = fi.devs[dev] || fi.devs[0], names = FL.names(fi.devs), lk = FL.look(sn);
      if (sel.block !== null && sel.block >= sn.g.nblocks) sel.block = null;
      const bar = h('div.fl-insp-bar');
      if (fi.devs.length > 1) {
        const s = h('select', { 'aria-label': 'Device' }, ...fi.devs.map((d, k) => h('option', { value: String(k) }, 'device ' + k + (d.at && d.at !== '/' ? ' (' + d.at + ')' : ''))));
        s.value = String(dev);
        s.addEventListener('change', () => { FL.sel = { block: null, ino: null, dev: +s.value }; host.innerHTML = ''; FL.inspectView.render(host, ctx); });
        bar.appendChild(s);
      }
      const inoBtns = h('div.fl-insp-inos', h('span.fl-insp-l', 'Inodes:'), ...[...lk.inodes.keys()].map((ino) => {
        const b = h('button.chip' + (sel.ino === ino ? '.on' : ''), { type: 'button', title: names.get(dev + ':' + ino) || '' }, String(ino) + ' ' + (names.get(dev + ':' + ino) || '').split('/').pop());
        b.addEventListener('click', () => { FL.sel = { block: null, ino, dev }; host.innerHTML = ''; FL.inspectView.render(host, ctx); });
        return b;
      }));
      bar.appendChild(inoBtns);
      host.appendChild(bar);
      let tables;
      if (sel.ino && lk.inodes.has(sel.ino)) tables = FL.inodeTables(sn, sel.ino, names);
      else if (sel.block !== null) tables = FL.blockTables(sn, sel.block);
      else { host.appendChild(h('p.lab-help', 'Click a block on the map, or an inode above, to see what it holds at this step.')); return; }
      S.LabViews.tables(host, tables);
    },
  };
})(globalThis.Proses = globalThis.Proses || {});
