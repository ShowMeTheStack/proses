// Part 15, commands and the blocks they change: a script of commands (mkdir, create, write, append, link,
// symlink, unlink, rmdir, rename, truncate) run one at a time on a real image (S.FS.prepare and S.FS.commit). After
// each, the blocks it changed light up on the map, listed by what they are, and the namespace is shown as it now
// stands. A command that fails changes nothing and says why.
(function (S) {
  'use strict';
  const H = S.P15, F = () => S.FS;
  const OPS = { mkdir: 1, create: 1, write: 3, append: 2, link: 2, symlink: 2, unlink: 1, rmdir: 1, rename: 2, truncate: 2 };
  const SCRIPTS = {
    basic: 'mkdir /notes\ncreate /notes/todo\nwrite /notes/todo 0 buy lamp oil; fix the gate\nappend /notes/todo  and call the ferry office\nlink /notes/todo /urgent\nunlink /notes/todo\nunlink /urgent',
    grow: 'create /log\nwrite /log 0 ' + 'tide at six. '.repeat(10) + '\nappend /log ' + 'wind from the west, '.repeat(16) + '\nappend /log ' + 'calm by evening. '.repeat(14) + '\ntruncate /log 100',
    tree: 'mkdir /a\nmkdir /a/b\ncreate /a/b/c\nsymlink /a/b/c /short\nrename /a/b/c /a/c\nrmdir /a/b\nrmdir /a',
    errors: 'create /x\ncreate /x\nmkdir /x/y\nunlink /nothere\nrmdir /\nmkdir /d\ncreate /d/f\nrmdir /d',
  };
  /** one command line: {op, args} or {error} */
  function parse(line) {
    const w = line.trim().split(/\s+/), op = w[0];
    if (!OPS[op]) return { error: `unknown command "${op}" (use ${Object.keys(OPS).join(', ')})` };
    if (op === 'write') { const rest = line.trim().replace(/^\S+\s+\S+\s+\S+\s?/, ''); if (w.length < 4 || !/^\d+$/.test(w[2])) return { error: 'write needs a path, an offset and text' }; return { op, args: [w[1], +w[2], rest] }; }
    if (op === 'append') { const rest = line.trim().replace(/^\S+\s+\S+\s?/, ''); if (w.length < 3) return { error: 'append needs a path and text' }; return { op, args: [w[1], rest] }; }
    if (op === 'truncate') { if (!/^\d+$/.test(w[2] || '')) return { error: 'truncate needs a path and a size' }; return { op, args: [w[1], +w[2]] }; }
    if (w.length - 1 < OPS[op]) return { error: `${op} needs ${OPS[op]} path${OPS[op] === 1 ? '' : 's'}` };
    return { op, args: w.slice(1, 1 + OPS[op]) };
  }
  const lines = (txt) => String(txt).split('\n').map((l) => l.trim()).filter(Boolean);
  const show = (cmd) => (cmd = cmd.replace(/\s+/g, ' ')).length > 46 ? cmd.slice(0, 43) + '…' : cmd;
  /** the namespace, depth first: [{path, ino, type, size, nlink, depth}] */
  function tree(img) {
    const out = [];
    const walk = (path, depth) => {
      for (const e of F().list(img, path)) {
        if (e.name === '.' || e.name === '..') continue;
        const p = (path === '/' ? '' : path) + '/' + e.name, st = F().stat(img, p, { nofollow: true });
        out.push({ path: p, name: e.name, ino: e.ino, type: st.type, size: st.size, nlink: st.nlink, depth });
        if (st.type === 'directory') walk(p, depth + 1);
      }
    };
    walk('/', 0);
    return out;
  }

  S.topic({
    id: 'fsi-commands', family: 'p15-layout', order: 20, title: 'Commands and the blocks they change',
    blurb: 'Every command is a handful of block writes. Creating a file marks an inode used in the inode bitmap, fills in the inode, and adds a name to a directory block; writing data marks blocks in the data bitmap, fills them and updates the inode\'s size and pointers. Type commands, run them one at a time, and watch exactly which blocks change.',
    inputs: [
      { id: 'script', kind: 'program', label: 'commands, one a line', def: SCRIPTS.basic, check: (v) => { const ls = lines(v); if (!ls.length) return 'type at least one command'; if (ls.length > 12) return 'at most 12 commands, so every step can be shown'; const bad = ls.map(parse).find((p) => p.error); return bad ? bad.error : null; } },
      { id: 'bs', kind: 'choice', label: 'block size', def: '128', options: [{ value: '64', label: '64 bytes' }, { value: '128', label: '128 bytes' }, { value: '256', label: '256 bytes' }] },
      { id: 'ndirect', kind: 'number', label: 'direct pointers', def: 4, min: 1, max: 8 },
    ],
    presets: [
      { label: 'Notes: create, write, link, unlink', values: { script: SCRIPTS.basic, bs: '128', ndirect: 4 } },
      { label: 'A log that grows into its indirect block', values: { script: SCRIPTS.grow, bs: '64', ndirect: 4 } },
      { label: 'Directories, a symlink and a rename', values: { script: SCRIPTS.tree, bs: '128', ndirect: 4 } },
      { label: 'Commands that fail', values: { script: SCRIPTS.errors, bs: '128', ndirect: 4 } },
    ],
    counters: [{ id: 'writes', label: 'blocks written' }, { id: 'freeI', label: 'free inodes' }, { id: 'freeB', label: 'free data blocks' }],
    run(inp) {
      const img = F().mkfs({ bs: +inp.bs, nblocks: 64, ninodes: 16, ndirect: inp.ndirect, ps: 4 }), g = img.g;
      const Fr = new S.Frames(['writes', 'freeI', 'freeB']), cmds = lines(inp.script).map((l) => Object.assign(parse(l), { line: l }));
      const counts = () => { const tx = new (F().Tx)(img); let fi = 0; for (let i = 1; i < g.ninodes; i++) if (!tx.inode(i).type) fi++; return { fi, fb: F().countFree(tx) }; };
      const draw = (lit, cur, changed) => {
        const items = [], own = H.owners(img);
        items.push(H.head('cm:t', 0, 14, `the disk: ${g.nblocks} blocks of ${g.bs} bytes`));
        const m = H.map({ prefix: 'cm:m', x: 0, y: 26, cols: 8, cw: 48, ch: 30, img, owners: own, byFile: true, look: (b) => (lit.has(b) ? 'act' : ''), extra: [{ cls: 'dk act', text: 'just written' }] });
        items.push(...m.items);
        const X = m.w + 32;
        items.push(H.head('cm:ct', X, 14, cur === null ? 'commands' : `command ${cur + 1} of ${cmds.length}`));
        cmds.forEach((c, i) => items.push(H.cell('cm:c' + i, X, 26 + i * 27, 400, 24, show(c.line), 'cmd mono ' + (i === cur ? 'act' : i < (cur === null ? 0 : cur) ? 'done' : 'todo'), 13, { align: 'left' })));
        let y = 26 + cmds.length * 27 + 22;
        if (changed && changed.length) {
          items.push(H.head('cm:wt', X, y, 'blocks written'));
          changed.slice(0, 8).forEach((w, i) => items.push(H.cell('cm:w' + i, X + (i % 2) * 202, y + 12 + Math.floor(i / 2) * 30, 196, 26, `${w.block}: ${short(w)}`, 'wr act', 13)));
          y += 12 + Math.ceil(Math.min(8, changed.length) / 2) * 30 + 22;
        }
        const tr = tree(img);
        items.push(H.head('cm:nt', X, y, 'the namespace'));
        const shown = tr.slice(0, 7);
        shown.forEach((e, i) => {
          const xx = X + 4 + 18 * e.depth, yy = y + 12 + i * 22;
          items.push(H.cell('cm:ns' + e.path, xx, yy + 3, 14, 14, '', 'swatch ' + H.fileCls(e.ino), 12, { audit: 'ignore' }));
          items.push(H.text('cm:n' + e.path, xx + 22, yy + 15, `${e.name}${e.type === 'directory' ? '/' : e.type === 'symlink' ? ' →' : ''}  (inode ${e.ino}${e.type === 'file' ? ', ' + e.size + ' B, ' + H.plural(e.nlink, 'link') : ''})`, 'mono', 13));
        });
        if (!tr.length) items.push(H.text('cm:n0', X + 4, y + 27, '/ is empty', 'tick', 13));
        if (tr.length > 7) items.push(H.text('cm:nmore', X + 4, y + 27 + 7 * 22, `… ${tr.length - 7} more`, 'tick', 13));
        return { items, own };
      };
      let c0 = counts();
      Fr.set('freeI', c0.fi).set('freeB', c0.fb);
      const d0 = draw(new Set(), null, null);
      Fr.add({ items: d0.items, title: 'mkfs', say: `A fresh file system: ${g.nblocks} blocks of ${g.bs} bytes, ${c0.fi} free inodes and ${c0.fb} free data blocks. Only the root directory exists, inode ${F().ROOT}. ${H.plural(cmds.length, 'command')} to run.`, meta: { phase: 'start', fi: c0.fi, fb: c0.fb, root: F().ROOT, n: cmds.length, g: { nblocks: g.nblocks, bs: g.bs } } });
      cmds.forEach((c, i) => {
        let tx = null, err = null;
        try { tx = F().prepare(img, c.op, ...c.args); } catch (e) { err = e; }
        if (err) {
          const d = draw(new Set(), i, null);
          Fr.add({ items: d.items, title: c.op, say: `${c.line.replace(/\s+/g, ' ')}: ${err.code ? err.code + ', ' : ''}${err.message}. Nothing on the disk changes.`, meta: { phase: 'error', i, code: err.code || '', cmd: c, nchanged: 0 } });
          return;
        }
        const changed = tx.writes().map((w) => ({ block: w.block, kind: w.kind, ino: w.kind === 'inode' ? inodesIn(g, w.block, tx) : null }));
        const alloc = tx.trace.filter((s) => s.kind === 'alloc-block').map((s) => s.block), allocI = tx.trace.filter((s) => s.kind === 'alloc-inode').map((s) => s.ino);
        F().commit(img, tx, { mode: 'none' });
        const c1 = counts();
        Fr.count('writes', changed.length).set('freeI', c1.fi).set('freeB', c1.fb);
        const d = draw(new Set(changed.map((w) => w.block)), i, changed);
        const main = tx.trace.filter((s) => !/^(alloc|lookup)/.test(s.kind)).map((s) => s.say).join(' ');
        const ln = c.line.replace(/\s+/g, ' '), say = `${ln.length > 60 ? ln.slice(0, 57) + '…' : ln}: ${main} ${H.plural(changed.length, 'block')} written: ${H.list(changed.map((w) => describe(w)))}.`;
        const stepData = tx.trace.map((s) => Object.assign({}, s, { say: undefined }));
        let stat = null; try { stat = F().stat(img, c.op === 'rename' || c.op === 'link' || c.op === 'symlink' ? c.args[1] : c.args[0], { nofollow: true }); } catch (e) { stat = null; }
        Fr.add({ items: d.items, title: c.op, say, meta: { phase: 'op', i, op: c.op, changed: changed.map((w) => w.block), kinds: changed.map((w) => w.kind), nchanged: changed.length, alloc, allocI, steps: stepData, stat: stat && { ino: stat.ino, size: stat.size, nlink: stat.nlink, blocks: stat.blocks }, fi: c1.fi, fb: c1.fb, freedCount: stepData.reduce((a, s) => a + (s.freed ? s.freed.length : 0), 0) } });
      });
      return { frames: Fr.list, def: { sections: [{ id: 'eq', kind: 'math', title: 'What each command writes', text: ['create: inode bitmap, the inode, a directory block', 'mkdir: the same, a new directory block, the parent inode', 'write: data bitmap, data blocks, the inode (size, pointers)', 'link: a directory block, the inode (link count)', 'unlink: a directory block, the inode; at 0 links both bitmaps', 'rename: directory blocks only'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'op' && fr[i + 1].meta.alloc.length === 1 && fr[i + 1].meta.allocI.length === 0, pick: 'item', ask: 'Which block will the next command take for its new data? Click it on the map.', answer: (fr, i) => 'cm:m:b' + fr[i + 1].meta.alloc[0], explain: (fr, i) => `Block ${fr[i + 1].meta.alloc[0]}: the first free block at or after the goal, the block after the file's last one or the start of the data region.` },
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'op' && fr[i + 1].meta.op === 'create', pick: 'option', ask: 'How many blocks will this create write?', options: (fr, i) => H.choices(fr[i + 1].meta.nchanged, [1, 2, 3, 4, 5]), answer: (fr, i) => String(fr[i + 1].meta.nchanged), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Which blocks does creating an empty file change?', options: ['the inode bitmap, an inode-table block and a directory block', 'the data bitmap and a data block', 'only the superblock', 'only a directory block'], answer: 0, why: 'A new inode is marked used and filled in, and its name goes into the parent directory. No data block is needed yet.' },
      { q: 'rename /a/x /a/y inside one directory writes…', options: ['one directory block', 'the inode and its data', 'the bitmaps', 'nothing'], answer: 0, why: 'The name lives in the directory; the inode does not know its own name.' },
      { q: 'unlink of a file with two hard links…', options: ['removes one entry and lowers the link count; nothing is freed', 'frees the inode', 'frees the data blocks', 'fails'], answer: 0, why: 'Blocks are freed only when the count reaches 0 (and no one has the file open).' },
      { q: 'Appending one byte to a file whose last block is full writes at least…', options: ['the data bitmap, a new data block and the inode', 'only the data block', 'only the inode', 'the superblock'], answer: 0, why: 'A new block must be marked used, filled, and pointed to by the inode, whose size changes too.' },
    ],
  });
  /** the inode numbers held in an inode-table block */
  function inodesIn(g, b, tx) { const per = g.bs / g.isz, first = (b - g.itStart) * per, out = []; for (let k = 0; k < per; k++) out.push(first + k); return out.filter((i) => i > 0 && i < g.ninodes); }
  function short(w) { return { super: 'superblock', inode: 'inode table', ibm: 'inode bitmap', dbm: 'data bitmap', indirect: 'indirect', dir: 'directory', link: 'symlink', data: 'data' }[w.kind] || w.kind; }
  function describe(w) { return S.FS.blockName(w); }
})(globalThis.Proses = globalThis.Proses || {});
