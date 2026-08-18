// The File-system lab, part seven: the copy-on-write workbench (S.FS.cow on a real image). Commands change a tree of
// blocks: new data blocks, a new inode block, a new inode map, then one write to an uberblock flips the root. The tree
// is drawn after each command (every pointer with the CRC-32 of the block it names), the disk beside it (live, kept by
// a snapshot, free), the power can be cut between any two writes of the last command, a bit can be flipped silently
// and a read or a scrub catches it.
//   FL.parseCow(text) -> {cmds, error}      FL.cowRun(v, ctx)
(function (S) {
  'use strict';
  const FL = S.FsLab, C = () => S.FS.cow;
  const R = Math.round;
  const ARGS = { create: 1, write: 3, append: 2, delete: 1, rename: 2, snapshot: 0, drop: 1, read: 1, corrupt: 1, scrub: 0 };
  FL.COW_WRITES = new Set(['create', 'write', 'append', 'delete', 'rename', 'snapshot', 'drop']);
  FL.parseCow = function (text) {
    const cmds = [], src = String(text || '').split('\n');
    const bad = (line, msg) => ({ cmds, error: { line, col: 1, msg, hint: 'create NAME · write NAME OFFSET TEXT · append NAME TEXT · delete NAME · rename A B · snapshot · drop GEN · read NAME · corrupt BLOCK · scrub' } });
    for (let i = 0; i < src.length; i++) {
      const t = src[i].replace(/#.*$/, '').trim();
      if (!t) continue;
      const line = i + 1, w = t.split(/\s+/), op = w[0];
      if (ARGS[op] === undefined) return bad(line, `unknown command "${op}"`);
      const need = ARGS[op];
      if (w.length - 1 < need) return bad(line, `${op} needs ${need} argument${need === 1 ? '' : 's'}`);
      let args;
      const nameOk = (s) => /^[A-Za-z0-9._-]{1,27}$/.test(s);
      if (op === 'write') { if (!/^\d+$/.test(w[2])) return bad(line, 'write NAME OFFSET TEXT: the offset is a number'); args = [w[1], +w[2], t.replace(/^\S+\s+\S+\s+\S+\s/, '')]; }
      else if (op === 'append') args = [w[1], t.replace(/^\S+\s+\S+\s/, '')];
      else if (op === 'drop' || op === 'corrupt') { if (!/^\d+$/.test(w[1])) return bad(line, op + ' takes a number'); args = [+w[1]]; }
      else args = w.slice(1, 1 + need);
      if (['create', 'write', 'append', 'delete', 'rename', 'read'].includes(op) && !nameOk(args[0])) return bad(line, 'a name is 1 to 27 letters, digits, dots, dashes or underscores (one flat directory)');
      if (op === 'rename' && !nameOk(args[1])) return bad(line, 'a name is 1 to 27 letters, digits, dots, dashes or underscores');
      const sz = (op === 'write' || op === 'append') && /^\[\s*(\d+)\s*(bytes?|b)?\s*\]$/i.exec(args[args.length - 1].trim());
      if (sz) { if (+sz[1] > 2000) return bad(line, 'at most 2000 bytes at once here'); args[args.length - 1] = FL.filler(+sz[1], i * 3); }
      cmds.push({ line, text: t.replace(/\s+/g, ' '), op, args });
    }
    if (!cmds.length) return bad(1, 'type at least one command');
    if (cmds.length > 16) return bad(cmds[16].line, 'at most 16 commands');
    return { cmds, error: null };
  };
  const hex4 = (c) => (c >>> 0).toString(16).padStart(8, '0').slice(0, 4);

  /** the live tree as boxes for S.Kit.tree; many data blocks of one file fold into one box */
  function treeOf(img, lit, maxLeaves, narrowTree) {
    const t = C().tree(img), m = C().mount(img);
    const root = { id: 'u' + m.slot, lines: ['uberblock ' + m.slot, 'gen ' + t.gen], cls: 'dk dk-sb' + (lit.has(m.slot) ? ' act' : ''), kids: [] };
    const imap = { id: 'b' + t.root, lines: ['inode map', 'blk ' + t.root], cls: 'dk dk-ibm' + (lit.has(t.root) ? ' act' : ''), edge: hex4(m.rootCrc), kids: [] };
    root.kids.push(imap);
    const inos = [...t.inodes].sort((a, b) => a[0] - b[0]);
    const leaves = inos.reduce((a, [, n]) => a + Math.max(1, n.ptrs.length), 0), fold = leaves > maxLeaves;
    for (const [ino, n] of inos) {
      const node = { id: 'b' + n.block, lines: [ino === 1 ? 'directory' : 'inode ' + ino, 'blk ' + n.block], cls: 'dk dk-it' + (lit.has(n.block) ? ' act' : ''), edge: hex4(n.crc), kids: [] };
      if (fold && n.ptrs.length > 1) {
        const bl = n.ptrs.map((p) => p.block);
        node.kids.push({ id: 'f' + ino, lines: [n.ptrs.length + ' blocks', FL.fit(FL.runs(bl), 80, 12)], cls: 'dk ' + (ino === 1 ? 'dk-data fl-dir' : 'dk-data') + (bl.some((b) => lit.has(b)) ? ' act' : ''), kids: [] });
      } else n.ptrs.forEach((p) => node.kids.push({ id: 'b' + p.block, lines: [ino === 1 ? 'entries' : 'data', 'blk ' + p.block], cls: 'dk ' + (ino === 1 ? 'dk-data fl-dir' : 'dk-data') + (lit.has(p.block) ? ' act' : ''), edge: fold || narrowTree ? undefined : hex4(p.crc), kids: [] }));
      imap.kids.push(node);
    }
    return { root, t, m };
  }

  FL.cowRun = function (v, ctx) {
    const narrow = ctx.narrow, P = FL.parseCow(FL.fromRows(v.ccmds, 'cmd'));
    if (P.error) return { error: P.error, frames: [] };
    const img = C().mkfs({ bs: v.cbs, nblocks: v.cblocks });
    const lastW = P.cmds.map((c) => FL.COW_WRITES.has(c.op)).lastIndexOf(true);
    const frames = [], trace = [];
    const W = narrow ? 376 : 560, boxH = 42, levelH = narrow ? 84 : 100;
    const paint = (im, lit, bad, right, note) => {
      const items = [];
      let T;
      try { T = treeOf(im, lit, narrow ? 6 : 10, narrow); } catch (e) { T = null; }
      let y = 0;
      if (T) {
        const nLeaves = (function count(n) { return n.kids.length ? n.kids.reduce((a, k) => a + count(k), 0) : 1; })(T.root);
        const bw = Math.max(narrow ? 52 : 64, Math.min(92, Math.floor((W - (nLeaves - 1) * 12) / nLeaves)));
        const gapX = nLeaves > 1 ? Math.max(12, Math.min(narrow ? 40 : 70, Math.floor((W - nLeaves * bw) / (nLeaves - 1)))) : 12;
        const tw = nLeaves * bw + (nLeaves - 1) * gapX;
        S.Kit.tree.layout(T.root, { x: narrow ? 0 : Math.max(0, Math.round((W - tw) / 2)), y: 46, levelH, boxW: bw, boxH, gapX });
        items.push(FL.head('cw:tt', 0, 14, `the live tree: generation ${T.t.gen}${T.t.snaps.length ? ', snapshots of ' + T.t.snaps.map((s) => s.gen).join(', ') : ''}`));
        const tr = S.Kit.tree.draw(T.root, { prefix: 'cw:tr', boxW: bw, boxH, size: bw >= 76 ? 13 : 12, edgeSize: 13 });
        items.push(...(S.P15 && S.P15.treeLabels ? S.P15.treeLabels(tr, T.root, { prefix: 'cw:tr', boxH }) : tr));
        const b = S.Kit.tree.bounds(T.root, bw, boxH);
        y = narrow ? b.y + b.h + 30 : 0;
      } else { items.push(FL.text('cw:tt', 0, 14, 'no valid tree: mount fails', 'bad strong', 14)); y = 40; }
      // the disk
      const live = T ? new Set(T.t.blocks.keys()) : new Set(), all = (() => { try { return C().inUse(im); } catch (e) { return new Set(); } })();
      const cols = 8, cw = narrow ? 44 : 44, ch = 26, gap = 3, MX = narrow ? 0 : 600;
      items.push(FL.head('cw:mt', MX, y + 4, `the disk: ${im.g.nblocks} blocks of ${im.g.bs} bytes`));
      for (let blk = 0; blk < im.g.nblocks; blk++) {
        const what = blk < 2 ? 'dk-sb' : live.has(blk) ? (T.t.blocks.get(blk) === 'inode map' ? 'dk-ibm' : /^inode/.test(T.t.blocks.get(blk)) ? 'dk-it' : 'dk-data') : all.has(blk) ? 'fl-old' : 'dk-free';
        items.push(FL.cell('cw:m' + blk, MX + (blk % cols) * (cw + gap), y + 16 + Math.floor(blk / cols) * (ch + gap), cw, ch, String(blk), 'dk ' + what + (bad.has(blk) ? ' fl-bad' : lit.has(blk) ? ' act' : ''), 12, { rx: 3 }));
      }
      const mh = Math.ceil(im.g.nblocks / cols) * (ch + gap);
      const lg = FL.legend('cw:lg', MX, y + 16 + mh + 8, [{ cls: 'dk-sb', text: 'uberblocks' }, { cls: 'dk-ibm', text: 'inode map' }, { cls: 'dk-it', text: 'inodes' }, { cls: 'dk-data', text: 'data' }, { cls: 'dk fl-old', text: 'kept by a snapshot' }, { cls: 'dk-free', text: 'free' }].concat(lit.size ? [{ cls: 'dk act', text: 'just written' }] : []).concat(bad.size ? [{ cls: 'dk fl-bad', text: 'a flipped bit' }] : []), cols * (cw + gap));
      items.push(...lg.items);
      if (right) {
        const X = narrow ? 0 : MX, Y = y + 16 + mh + 8 + lg.h + 20, RW = narrow ? 376 : 400;
        items.push(...right(X, Y, RW).items);
      }
      void note;
      return items;
    };
    const tablesOf = (im) => {
      let rows = [];
      try { rows = C().list(im).map((e) => [e.name, String(e.ino), String(e.size)]); } catch (e) { rows = [['–', '–', e.message]]; }
      return [{ title: 'Files in the live tree', cols: ['name', 'inode', 'size'], rows }];
    };
    const metricsOf = (im) => { let gen = '–', used = 0, snaps = 0; try { const t = C().tree(im); gen = t.gen; snaps = t.snaps.length; used = C().inUse(im).size; } catch (e) { /* no tree */ } return [{ label: 'Live generation', value: gen }, { label: 'Blocks in use', value: used + ' of ' + im.g.nblocks }, { label: 'Snapshots', value: snaps }]; };
    const push = (f, step) => { trace.push(step); frames.push(Object.assign({ at: trace.length - 1 }, f)); };
    const t0 = C().tree(img);
    push({ items: paint(img, new Set([0, t0.root]), new Set()), title: 'mkfs', marks: [], say: `A fresh copy-on-write disk of ${img.g.nblocks} blocks: uberblock 0 says generation ${t0.gen}, whose inode map at block ${t0.root} names one empty directory. Blocks 0 and 1 are the two uberblocks, written in turn.`, tables: tablesOf(img), metrics: metricsOf(img) }, { kind: 'mkfs', say: 'mkfs' });
    const bad = new Set();
    P.cmds.forEach((c, i) => {
      const mark = [{ line: c.line, tag: '▶', cls: 'p0', act: true }];
      if (c.op === 'read' || c.op === 'scrub' || c.op === 'corrupt') {
        let say, cls = 'new', panelRows = [];
        if (c.op === 'corrupt') {
          const b = c.args[0];
          if (b >= img.g.nblocks) say = `corrupt ${b}: there is no block ${b} on a disk of ${img.g.nblocks}.`;
          else { C().corrupt(img, b, 5, 3); bad.add(b); say = `corrupt ${b}: one bit of block ${b} flips, silently: the disk reports nothing. ${b < 2 ? 'It is an uberblock; its own checksum will no longer hold.' : 'Its parent still holds the checksum of what it used to be.'}`; panelRows = [{ text: 'bit 3 of byte 5 in block ' + b + ' flipped', cls: 'stale' }]; }
        } else if (c.op === 'read') {
          try { const s = C().read(img, c.args[0]); say = `read ${c.args[0]}: every block on the way matches the checksum its parent holds; it reads ${s.length} bytes: "${FL.clip(s, 50)}".`; panelRows = [{ text: '"' + FL.clip(s, 120) + '"', cls: 'new' }]; } catch (e) { say = `read ${c.args[0]}: ${e.code || 'error'}, ${e.message}. The error is reported; wrong data is never returned.`; cls = 'stale'; panelRows = [{ text: e.message, cls: 'stale' }]; }
        } else {
          const sc = C().scrub(img);
          say = sc.steps.map((s) => s.say).join(' ');
          panelRows = sc.bad.length ? sc.bad.map((x) => ({ text: `block ${x.block}: ${x.what} (generation ${x.gen})`, cls: 'stale' })) : [{ text: 'every block of every tree matches its checksum', cls: 'new' }];
        }
        void cls;
        push({ items: paint(img, new Set(), bad, FL.sayPanel([{ title: c.text, rows: panelRows, max: 6 }])), title: c.op, marks: mark, say, tables: tablesOf(img), metrics: metricsOf(img) }, { kind: c.op, say });
        return;
      }
      let plan;
      try { plan = C().prepare(img, c.op === 'drop' ? 'dropSnapshot' : c.op, ...c.args); } catch (e) {
        const say = `${c.text}: ${e.code || 'error'}, ${e.message}. Nothing is written.`;
        push({ items: paint(img, new Set(), bad, FL.sayPanel([{ title: c.text, rows: [{ text: e.message, cls: 'stale' }] }])), title: c.op, marks: mark, say, tables: tablesOf(img), metrics: metricsOf(img) }, { kind: 'error', say });
        return;
      }
      const n = plan.writes.length, cut = v.ccrash && i === lastW ? Math.min(v.ccut, n) : null;
      const writesRows = (done) => plan.writes.map((w, j) => ({ text: `${j + 1}. block ${w.block}: ${w.say}`, cls: j < done ? (w.kind === 'uber' ? 'new' : 'old') : 'stale' }));
      if (cut === null) {
        C().commit(img, plan);
        const lit = new Set(plan.writes.map((w) => w.block));
        const say = `${c.text}: ${plan.steps.map((s) => s.say).join(' ')} ${FL.plural(n, 'write')}: ${FL.list(plan.writes.map((w) => w.kind === 'uber' ? 'the uberblock ' + w.block + ' last' : (w.kind || 'block') + ' ' + w.block))}. Nothing live was overwritten; generation ${plan.gen} is now the live tree.`;
        push({ items: paint(img, lit, bad, FL.sayPanel([{ title: c.text + ': its writes', rows: writesRows(n), max: 7 }])), title: c.op, marks: mark, say, tables: tablesOf(img).concat([{ title: 'Its writes', cols: ['#', 'block', 'what'], rows: plan.writes.map((w, j) => [String(j + 1), String(w.block), w.say]) }]), metrics: metricsOf(img) }, { kind: c.op, say });
        return;
      }
      // the last command, write by write, cut
      for (let j = 0; j <= cut; j++) {
        if (j) C().commit({ g: img.g, bytes: img.bytes }, { writes: [plan.writes[j - 1]] });
        const w = j ? plan.writes[j - 1] : null;
        const say = !w ? `${c.text}: ${plan.steps.map((s) => s.say).join(' ')} It takes ${FL.plural(n, 'write')}, the uberblock last; the power will fail after write ${cut}.` : `Write ${j} of ${n}: ${w.say}`;
        push({ items: paint(img, w ? new Set([w.block]) : new Set(), bad, FL.sayPanel([{ title: c.text + ': its writes', rows: writesRows(j), max: 7 }])), title: w ? 'write ' + j : 'the plan', marks: mark, say, tables: tablesOf(img), metrics: metricsOf(img) }, { kind: w ? 'write' : 'plan', say });
      }
      if (cut < n) {
        const m = C().mount(img);
        const say = `The power fails after write ${cut} of ${n}. Mount reads both uberblocks and takes the valid one with the highest generation: ${m.gen}, the old tree, whole. The ${FL.plural(cut, 'block')} written are reachable from no tree, so they are simply free space again. No fsck, no journal.`;
        push({ items: paint(img, new Set(), bad, FL.sayPanel([{ title: 'mount after the crash', rows: m.steps.map((s) => ({ text: s.say, cls: s.kind === 'mount' ? 'new' : 'old' })) }])), title: 'power cut', marks: mark, say, tables: tablesOf(img), metrics: metricsOf(img) }, { kind: 'crash', say });
      }
    });
    const last = frames[frames.length - 1];
    void R;
    return { frames, trace, tables: last.tables, metrics: last.metrics };
  };
})(globalThis.Proses = globalThis.Proses || {});
