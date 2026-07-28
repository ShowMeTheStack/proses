// A crash in the middle of an append, and what recovery makes of it. Appending to /diary needs three blocks
// changed: the inode (a new size and a second pointer), the data bitmap (the new block marked used) and the new
// data block. With the metadata journal the writes are: the data block in place, the begin block, the logged inode
// and bitmap, the commit block, the checkpoint of both, and the journal superblock marking it done. The power is cut after the
// write the student picks; then either fsck checks the image (no journal) or the journal is replayed. Both
// outcomes are worked out by the file-system engine (src/core/fs-*.js) on a real image.
(function (S) {
  'use strict';
  const D = S.Demo, box = D.box;
  const GEO = { bs: 128, nblocks: 32, ninodes: 8, ndirect: 4, ps: 4, jblocks: 8 };
  const DAY1 = ('Day 1. Fog on the harbour until noon; the ferry ran late and the gulls followed it in. ' + 'Mended the net by lamplight and slept early.').slice(0, 128);
  const ADD = 'Day 2. Rain all morning.';
  const STALE = 'OLD DRAFT, DELETED LONG AGO: lorem of a former file. ';
  const KNOBS = { crash: 4, journal: 1 };
  const SHORT = { data: 'data', TxB: 'begin', log: 'log', TxE: 'commit', inode: 'inode', dbm: 'bitmap', ibm: 'i-bitmap', jsb: 'free log' };

  function base() {
    const F = S.FS, img = F.mkfs(GEO, STALE);
    F.apply(img, 'create', ['/diary']); F.apply(img, 'write', ['/diary', 0, DAY1]);
    F.apply(img, 'create', ['/recipes']); F.apply(img, 'write', ['/recipes', 0, 'bread: flour, water, salt, time']);
    return img;
  }
  /** what the picture shows of an image: the inode, the new block's bit, the new block's bytes, the journal */
  function look(img, ino, nb) {
    const F = S.FS, g = img.g, n = F.readInode(img, ino), u = F.block(img, nb);
    return { size: n.size, ptrs: n.direct.slice(), bit: F.getBit(F.block(img, g.dbmStart), nb - g.dataStart), text: F.text(u.subarray(0, ADD.length)), j: F.journalState(img) };
  }
  /** one run: the writes, the image after each, the crash, the recovery and what the file reads */
  function run(crash, journal) {
    const F = S.FS, img = base(), ino = F.lookup(img, '/diary').ino;
    const tx = F.prepare(img, 'append', '/diary', ADD), nb = tx.trace.find((t) => t.kind === 'alloc-block').block;
    const all = F.commit(F.clone(img), F.prepare(img, 'append', '/diary', ADD), { journal }).writes;
    const k = Math.min(crash, all.length), states = [look(img, ino, nb)];
    for (let i = 1; i <= k; i++) { const c = F.clone(img); F.commit(c, F.prepare(c, 'append', '/diary', ADD), { journal, crashAfter: i }); states.push(look(c, ino, nb)); }
    const c = F.clone(img); F.commit(c, F.prepare(c, 'append', '/diary', ADD), { journal, crashAfter: k });
    const rep = journal ? F.replay(c) : null, fsck = F.fsck(c), after = look(c, ino, nb), size = F.readInode(c, ino).size;
    const tail = size > 128 ? F.text(F.read(c, '/diary', 128, size - 128)) : '';
    return { journal, all, k, crashed: k < all.length, states, rep, fsck, after, size, tail, nb, ino, g: img.g, used: new Set(F.fsck(img).owners.keys()) };
  }

  function frames(narrow, knobs) {
    const kn = Object.assign({}, KNOBS, knobs || {}), journal = !!kn.journal;
    const X = D.once('journal:' + kn.crash + '/' + journal, () => run(kn.crash, journal));
    const Y = D.once('journal:' + kn.crash + '/' + !journal, () => run(kn.crash, !journal));
    const KD = S.Kit.disk, g = X.g, nb = X.nb, it = S.FS.inodeAt(g, X.ino).block;
    const W = narrow ? 396 : 1200;
    const L = narrow
      ? { view: box(-4, -6, 404, 0), map: { cols: 8, cw: 46, ch: 24 } }
      : { view: box(-10, -8, 1220, 0), map: { cols: 32, cw: 34, ch: 30 } };
    const out = [];
    const clean = (s) => s.replace(/[^\x20-\x7e]/g, '·');
    const quote = (s) => '‘' + s.replace(/[^\x20-\x7e]/g, '·') + '’';
    /** the picture for one moment: st (what the disk holds), cur (the block just written), chips (their classes) */
    function scene(st, cur, chipCls, cut, panels) {
      const items = [];
      items.push({ key: 'jr:mt', kind: 'text', x: 0, y: 14, text: `the disk: ${g.nblocks} blocks of ${g.bs} bytes`, size: 14, cls: 'strong' });
      const map = KD.map({ prefix: 'jr:m', x: 0, y: 26, g, cols: L.map.cols, cw: L.map.cw, ch: L.map.ch, gap: narrow ? 3 : 3, used: (b) => X.used.has(b) || (b === nb && st.bit), look: (b) => (b === cur ? 'act' : [it, g.dbmStart, nb].includes(b) ? 'seen' : ''), size: 12 });
      items.push(...map.items);
      const lg = KD.legend({ prefix: 'jr:lg', x: 0, y: 26 + map.h + 12, entries: KD.layoutLegend(g), maxW: W, size: 13 });
      items.push(...lg.items);
      let y = 26 + map.h + 12 + lg.h + 24;
      // on a phone an outcome panel takes the place of the writes, and two take the place of the blocks too
      if (!(narrow && panels && panels.length > 1)) {
      // the three home blocks
      const cards = [
        { b: it, title: `inode ${X.ino} (block ${it})`, lines: [`size ${st.size}`, 'blocks ' + st.ptrs.map((p) => p || '—').join(' ')], isNew: st.size > 128 },
        { b: g.dbmStart, title: `data bitmap (block ${g.dbmStart})`, lines: [`bit of block ${nb}:`, String(st.bit)], isNew: !!st.bit },
        { b: nb, title: `data block ${nb}`, lines: [clean(st.text.slice(0, 12)), clean(st.text.slice(12, 24))], isNew: st.text === ADD },
      ];
      const cw = narrow ? W : 186, cg = narrow ? 0 : 14;
      items.push({ key: 'jr:ht', kind: 'text', x: 0, y: y + 14, text: 'home blocks', size: 14, cls: 'strong' });
      cards.forEach((c, i) => {
        const x = narrow ? 0 : i * (cw + cg), yy = narrow ? y + 26 + i * 44 : y + 26;
        const stale = !c.isNew && c.b === nb && st.size > 128;
        if (narrow) items.push({ key: 'jr:c' + i, kind: 'cell', x, y: yy, w: cw, h: 38, rx: 6, text: c.title + ':  ' + c.lines.join(c.b === nb ? '' : ' '), size: 13, align: 'left', cls: 'dk card ' + (stale ? 'stale' : c.isNew ? 'new' : 'old') + (c.b === cur ? ' act' : '') });
        else {
          items.push({ key: 'jr:ct' + i, kind: 'text', x, y: yy + 12, text: c.title, size: 13, cls: 'dk-leg' });
          items.push({ key: 'jr:c' + i, kind: 'cell', x, y: yy + 22, w: cw, h: 52, rx: 6, lines: c.lines, size: 13, cls: 'dk card ' + (stale ? 'stale' : c.isNew ? 'new' : 'old') + (c.b === cur ? ' act' : '') });
        }
      });
      // the journal
      const jx = narrow ? 0 : 620, jy = narrow ? y + 26 + 3 * 44 + 10 : y, jw = narrow ? 93 : 66, jper = narrow ? 4 : 8;
      items.push({ key: 'jr:jt', kind: 'text', x: jx, y: jy + 14, text: `the journal (blocks ${g.jStart}–${g.jStart + g.jblocks - 1})`, size: 14, cls: 'strong' });
      const jcells = [{ lines: ['JSB', 'done ' + st.j.done], cls: 'jb' }].concat(st.j.log.map((e, i) => {
        if (e.kind === 'TxB') return { lines: [e.label, '→' + e.homes.join(',')], cls: 'jb txb' };
        if (e.kind === 'TxE') return { lines: [e.label], cls: 'jb txe' };
        if (e.kind === 'data') { const t = st.j.log[0].kind === 'TxB' ? st.j.log[0].homes[i - 1] : '?'; return { lines: ['copy', 'of ' + t], cls: 'jb logged' }; }
        return { lines: ['—'], cls: 'jb empty' };
      }));
      jcells.forEach((c, i) => {
        const b = g.jStart + i, x = jx + (i % jper) * (jw + 6), yy = jy + 26 + Math.floor(i / jper) * 58 + (narrow ? 0 : 22);
        items.push({ key: 'jr:j' + i, kind: 'cell', x, y: yy, w: jw, h: 52, rx: 5, lines: c.lines, size: 13, cls: 'dk ' + c.cls + (b === cur ? ' act' : '') });
      });
      if (!narrow) items.push({ key: 'jr:jn', kind: 'text', x: jx, y: jy + 38, text: 'block ' + g.jStart + ' is the journal superblock; the log follows', size: 13, cls: 'dk-leg' });
      // the writes, in order
      y = narrow ? jy + 26 + 2 * 58 + 18 : y + 26 + 22 + 52 + 34;
      if (!(narrow && panels)) {
      items.push({ key: 'jr:wt', kind: 'text', x: 0, y: y + 14, text: X.journal ? 'the writes, with the journal' : 'the writes, without a journal', size: 14, cls: 'strong' });
      const wr = KD.writes({ prefix: 'jr:w', x: 0, y: y + 28, maxW: W, list: X.all.map((w, i) => ({ lines: [String(i + 1) + '. ' + SHORT[w.kind], w.kind === 'log' ? 'of ' + w.home + ', blk ' + w.block : 'block ' + w.block], cls: chipCls(i) })), cw: narrow ? 93 : 138, ch: 46, gap: narrow ? 8 : 9, crashAfter: cut, size: 13 });
      items.push(...wr.items);
      y = y + 28 + wr.h + 26;
      }
      }
      // the outcome panels
      if (panels) {
        const pw = narrow ? W : (W - 20) / 2;
        let py = y;
        panels.forEach((p, i) => {
          const px = narrow ? 0 : i * (pw + 20), top = narrow ? py : y, sub = [];
          let hh = 0;
          if (p.text) { const para = KD.para({ prefix: 'jr:pp' + i, x: px + 14, y: top + 34, maxW: pw - 28, size: 13, text: p.text }); sub.push(...para.items); hh = para.h; }
          (p.rows || []).forEach((r, j) => {
            const lines = KD.wrap(r.text, pw - 48, 13), rh = lines.length * 18 + 10;
            sub.push({ key: 'jr:pq' + i + '.' + j, kind: 'cell', x: px + 12, y: top + 36 + hh, w: pw - 24, h: rh, rx: 4, lines, size: 13, align: 'left', cls: 'dk card oc ' + (r.good ? 'new' : 'stale') + (r.act ? ' act' : '') });
            hh += rh + 6;
          });
          const h = 44 + hh + 4;
          items.push({ key: 'jr:pr' + i, kind: 'region', x: px, y: top, w: pw, h, rx: 8, text: '', cls: 'outcome ' + (p.good === undefined ? '' : p.good ? 'good' : 'bad') });
          items.push({ key: 'jr:pt' + i, kind: 'text', x: px + 14, y: top + 22, text: p.title, size: 14, cls: p.good === undefined ? 'strong' : p.good ? 'good' : 'bad' });
          items.push(...sub);
          py += h + 14;
        });
      }
      return items;
    }
    const pending = () => '';
    const n = X.all.length, k = X.k;
    const viewFix = (h) => { L.view.h = Math.max(L.view.h, h); };
    // 0: before
    out.push({ items: scene(X.states[0], -1, pending, null, null), title: 'before', say: `/diary fills block ${S.FS.readInode(base(), X.ino).direct[0]} exactly (${DAY1.length} bytes). Appending ${ADD.length} more needs a new data block, ${nb}: its bit in the data bitmap, the inode's new size and second pointer, and the bytes themselves.` });
    // 1: the plan
    out.push({ items: scene(X.states[0], -1, pending, null, null), title: 'the plan', say: X.journal ? `With the journal the append is ${n} writes: the data block first, then the begin block, the logged inode and bitmap, the commit block, the checkpoint, and freeing the log.` : `Without a journal the append is ${n} writes, straight to their homes: the inode, the data bitmap, then the data block.` });
    // each write that happens
    for (let i = 1; i <= k; i++) {
      const w = X.all[i - 1];
      out.push({ items: scene(X.states[i], w.block, (j) => (j < i - 1 ? 'done' : j === i - 1 ? 'act' : ''), null, null), title: 'write ' + i, say: `Write ${i} of ${n}: ${w.say}` });
    }
    // the crash
    if (X.crashed) {
      const lost = X.all.slice(k).map((w, j) => k + j + 1);
      out.push({ items: scene(X.states[k], -1, (j) => (j < k ? 'done' : 'lost'), k, null), title: 'power cut', say: `The power fails after write ${k}${k ? '' : ' (before any)'}: write${lost.length === 1 ? '' : 's'} ${lost.join(', ')} never reach${lost.length === 1 ? 'es' : ''} the disk.` });
    }
    // recovery, then both outcomes
    const outcome = (R) => {
      const okText = R.fsck.ok ? 'fsck finds the image consistent.' : 'fsck finds: ' + R.fsck.problems.map((p) => p.say).join(' ');
      const file = R.size > 128 ? (R.tail === ADD ? `/diary is ${R.size} bytes and ends ${quote(ADD)}.` : `/diary is ${R.size} bytes, but its new bytes read ${quote(R.tail.slice(0, 22))}: stale data, which fsck cannot see.`) : `/diary is still ${R.size} bytes: the append is lost, cleanly.`;
      const where = R.crashed ? `Cut after write ${R.k} of ${R.all.length}.` : `All ${R.all.length} writes done.`;
      const rep = R.rep ? R.rep.steps.map((s) => s.say).join(' ') + ' ' : '';
      const good = R.fsck.ok && (R.size === 128 || R.tail === ADD);
      return { title: R.journal ? 'with the journal: replay' : 'without a journal: fsck', text: [where, rep + okText, file].join(' '), good };
    };
    const me = outcome(X);
    const fileSay = me.text.slice(me.text.lastIndexOf('/diary'));
    out.push({ items: scene(X.after, -1, (j) => (j < k ? 'done' : 'lost'), X.crashed ? k : null, [me]), title: X.journal ? 'replay' : 'fsck', say: (X.journal ? X.rep.steps.map((s) => s.say).join(' ') + ' ' : '') + (X.fsck.ok ? 'fsck then finds nothing wrong. ' : `fsck finds ${X.fsck.problems.length} problem${X.fsck.problems.length === 1 ? '' : 's'}: ${X.fsck.problems.map((p) => p.say).join(' ')} `) + fileSay });
    // every cut point, both ways, with like outcomes grouped
    const table = (jr) => {
      const n2 = D.once('journal:n/' + jr, () => run(99, jr).all.length), rows = [];
      for (let c = 0; c <= n2; c++) {
        const R = D.once('journal:' + c + '/' + jr, () => run(c, jr)), f = R.fsck.problems[0];
        let text, good;
        if (f) { text = 'fsck: ' + (f.kind === 'used-but-free' ? `block ${f.block} in use but free in the bitmap` : f.kind === 'leak' ? `block ${f.block} marked used, owned by nobody` : f.say); good = false; }
        else if (R.size > 128 && R.tail !== ADD) { text = 'consistent, but the new bytes are stale data'; good = false; }
        else if (jr) { const st = R.rep.steps[R.rep.steps.length - 1].kind; text = (st === 'replay-done' ? 'committed: replayed, ' : st === 'replay-discard' ? 'no commit block: thrown away, ' : 'nothing to replay, ') + (R.size > 128 ? 'the new file' : 'the old file'); good = true; }
        else { text = R.size > 128 ? 'all written: the new file' : 'nothing written: the old file'; good = true; }
        const last = rows[rows.length - 1];
        if (last && last.text === text) { last.to = c; continue; }
        rows.push({ from: c, to: c, text, good });
      }
      return rows.map((r) => ({ text: (r.from === r.to ? (r.from === n2 ? 'no cut' : 'cut after ' + r.from) : `cut after ${r.from}–${r.to}`) + ': ' + r.text, good: r.good, act: (jr === X.journal) && k >= r.from && k <= r.to }));
    };
    const tNo = table(false), tJ = table(true);
    const both = [{ title: 'without a journal, every cut', rows: tNo }, { title: 'with the journal, every cut', rows: tJ }];
    const badNo = tNo.filter((r) => !r.good).length;
    out.push({ items: scene(X.after, -1, (j) => (j < k ? 'done' : 'lost'), X.crashed ? k : null, both), title: 'both outcomes', say: `Every cut point, both ways: without a journal, ${badNo} of the outcomes are damage (fsck sees one kind, not the other); with the journal, every cut ends with the old file or the new one, never something in between.` });
    // one view for every frame: tall enough for the tallest
    let h = 0;
    for (const f of out) { const b = S.stageBounds(f.items); h = Math.max(h, b.y + b.h); }
    viewFix(h + 14);
    out.forEach((f) => { f.view = L.view; });
    return out;
  }

  D.add({
    id: 'journal-replay', order: 130, tag: 'File systems · journaling', short: 'Journal replay', title: 'A crash during an append, with and without a journal',
    blurb: 'An append changes three blocks. Cut the power between any two writes: without a journal, fsck has to find the damage (and some it cannot see); with a journal, replay either finishes a committed transaction or throws an uncommitted one away.',
    knobs: [
      { id: 'crash', label: 'power cut', type: 'select', value: KNOBS.crash, options: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((v) => ({ value: v, label: v === 0 ? 'before any write' : v === 8 ? 'none (no crash)' : 'after write ' + v })) },
      { id: 'journal', label: 'journal', type: 'toggle', value: KNOBS.journal, on: 1, off: 0 },
    ],
    frames({ narrow, knobs }) { return frames(narrow, knobs); },
    run(crash, journal) { return run(crash, journal); },
  });
})(globalThis.Proses = globalThis.Proses || {});
