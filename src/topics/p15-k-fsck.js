// Part 15, the order of updates and fsck: one operation changes a few blocks, written one at a time with no
// journal, in an order the student picks. The power can be cut after any write; then fsck (S.FS.fsck) reads the
// whole disk and reports what disagrees, and S.FS.repair puts it right where it can. Some damage fsck cannot see: a
// file that points at a block whose new data never arrived reads old bytes. The last frame tries every cut.
(function (S) {
  'use strict';
  const H = S.P15, F = () => S.FS;
  const GEO = { bs: 256, nblocks: 32, ninodes: 8, ndirect: 4, ps: 4 };
  const STALE = 'OLD BYTES OF A DELETED FILE. ';
  const DAY = 'Fog on the harbour until noon; the ferry ran late and the gulls followed it in. Mended the net by lamplight and slept early. Wind from the west by evening, the lamp lit at six, the boats all in before dark, and a quiet night after a long week. '.padEnd(256, '.').slice(0, 256);
  const ADD = 'Rain all morning; the tide tables came.';
  const OPS = {
    append: { label: 'append to /diary (a new block)', run: (img) => F().prepare(img, 'append', '/diary', ADD), what: { inode: 'the inode\'s new size and second pointer', dbm: 'the new block\'s bit', data: 'the new bytes' } },
    create: { label: 'create /notes', run: (img) => F().prepare(img, 'create', '/notes'), what: { inode: 'the new inode (type file, one link)', ibm: 'the new inode\'s bit', dir: 'the entry notes in /' } },
    unlink: { label: 'unlink /recipes', run: (img) => F().prepare(img, 'unlink', '/recipes'), what: { inode: 'the inode, now free', ibm: 'the inode\'s bit, cleared', dbm: 'its block\'s bit, cleared', dir: 'the entry recipes, removed' } },
    mkdir: { label: 'mkdir /box', run: (img) => F().prepare(img, 'mkdir', '/box'), what: { inode: 'an inode (the new directory, or the parent\'s link count)', ibm: 'the new inode\'s bit', dbm: 'the new directory block\'s bit', dir: 'a directory block (the new one holding \'.\' and \'..\', or the root\'s with the entry box)' } },
  };
  const ORDERS = {
    engine: { label: 'inodes, then bitmaps, then the rest', rank: ['super', 'inode', 'ibm', 'dbm', 'indirect', 'dir', 'data'] },
    data: { label: 'data first, inodes last', rank: ['data', 'dir', 'indirect', 'dbm', 'ibm', 'super', 'inode'] },
    bitmaps: { label: 'bitmaps first, then data, inodes last', rank: ['ibm', 'dbm', 'data', 'dir', 'indirect', 'super', 'inode'] },
  };
  function base() {
    const img = F().mkfs(GEO, STALE);
    F().apply(img, 'create', ['/diary']); F().apply(img, 'write', ['/diary', 0, DAY]);
    F().apply(img, 'create', ['/recipes']); F().apply(img, 'write', ['/recipes', 0, 'bread: flour, water, salt, time']);
    return img;
  }
  /** the writes of the operation in the chosen order */
  function plan(op, order) {
    const img = base(), tx = OPS[op].run(img), R = ORDERS[order].rank;
    return { img, writes: tx.writes().sort((a, b) => R.indexOf(a.kind) - R.indexOf(b.kind) || a.block - b.block), trace: tx.trace };
  }
  /** cut after k writes: fsck, the repair, and what the files read */
  function outcome(op, order, k) {
    const P = plan(op, order), img = F().clone(P.img);
    P.writes.slice(0, k).forEach((w) => F().block(img, w.block).set(w.bytes));
    const fsck = F().fsck(img, { disk: true });
    const look = files(img);
    const stale = op === 'append' && look.diary && look.diary.size > 256 && look.diary.tail !== ADD;
    const fixed = F().clone(img), steps = fsck.ok ? [] : F().repair(fixed).steps, after = F().fsck(fixed, { disk: true });
    return { k, n: P.writes.length, fsck, problems: fsck.problems.map((p) => Object.assign({}, p, { say: problemSay(p) })), look, stale, fixes: steps.map(fixSay), fixSteps: steps.map((x) => Object.assign({}, x, { say: undefined })), afterOk: after.ok, lookAfter: files(fixed) };
  }
  /** a directory block never written holds old bytes, which read as entries with garbage names: say so plainly */
  const KNOWN = /^(\.|\.\.|diary|recipes|notes|box)$/;
  function problemSay(p) { return p.kind === 'dangling-entry' && !KNOWN.test(p.entry) ? `Directory inode ${p.dir} has an entry with a garbage name naming inode ${p.target}, which is free.` : p.say; }
  function fixSay(x) { return x.kind === 'remove-entry' && !KNOWN.test(x.entry) ? `removed a garbage entry from directory inode ${x.dir}` : x.say; }
  function files(img) {
    const out = {};
    for (const name of ['diary', 'recipes', 'notes', 'box']) {
      try { const st = F().stat(img, '/' + name); out[name] = { size: st.size, nlink: st.nlink, tail: st.type === 'file' && st.size > 256 ? F().text(F().read(img, '/' + name, 256, st.size - 256)) : '' }; } catch (e) { /* not there */ }
    }
    return out;
  }
  const verdict = (o) => (!o.fsck.ok ? 'fsck: ' + o.problems.map((p) => p.kind).join(', ') : o.stale ? 'consistent, but stale data' : 'consistent');
  const KIND = { inode: 'inode', ibm: 'i-bitmap', dbm: 'd-bitmap', dir: 'directory', data: 'data', indirect: 'indirect', super: 'super' };

  S.topic({
    id: 'fsi-fsck', family: 'p15-crash', order: 10, title: 'The order of updates, and fsck',
    blurb: 'An operation changes several blocks, but the disk writes one block at a time. If the power fails in between, the disk holds part of the change. fsck reads the whole disk afterwards and checks that its parts agree: bitmaps against inodes, link counts against entries. Choose the operation and the order of its writes, cut the power anywhere, and see what fsck finds and what it cannot.',
    inputs: [
      { id: 'op', kind: 'choice', label: 'operation', def: 'append', options: Object.entries(OPS).map(([value, o]) => ({ value, label: o.label })) },
      { id: 'order', kind: 'choice', label: 'write order', def: 'engine', options: Object.entries(ORDERS).map(([value, o]) => ({ value, label: o.label })) },
      { id: 'crash', kind: 'number', label: 'power cut after write', def: 1, min: 0, max: 8 },
    ],
    presets: [
      { label: 'Append: inode first, cut after 1', values: { op: 'append', order: 'engine', crash: 1 } },
      { label: 'Append: data first, cut after 1', values: { op: 'append', order: 'data', crash: 1 } },
      { label: 'Append: bitmap first, cut after 1', values: { op: 'append', order: 'bitmaps', crash: 1 } },
      { label: 'Create: cut after 2', values: { op: 'create', order: 'engine', crash: 2 } },
      { label: 'Unlink: cut after 1', values: { op: 'unlink', order: 'engine', crash: 1 } },
      { label: 'mkdir, data first', values: { op: 'mkdir', order: 'data', crash: 3 } },
    ],
    counters: [{ id: 'done', label: 'writes done' }, { id: 'problems', label: 'fsck problems' }],
    run(inp) {
      const P = plan(inp.op, inp.order), n = P.writes.length, k = Math.min(inp.crash, n), Fr = new S.Frames(['done', 'problems']), g = P.img.g;
      const what = OPS[inp.op].what;
      const touched = new Set(P.writes.map((w) => w.block)), own = H.owners(P.img);
      const draw = (done, cur, cut, panel) => {
        const items = [];
        items.push(H.head('fk:wt', 0, 14, `${OPS[inp.op].label}: ${H.plural(n, 'write')}, ${ORDERS[inp.order].label}`));
        items.push(...H.writes({ prefix: 'fk:w', x: 0, y: 26, maxW: 860, list: P.writes.map((w, i) => ({ lines: [`${i + 1}. ${KIND[w.kind]}`, 'block ' + w.block], cls: i < done ? (i === cur ? 'act' : 'done') : cut !== null ? 'lost' : '' })), cw: 120, ch: 44, gap: 10, crashAfter: cut, size: 13 }).items);
        const m = S.Kit.disk.map({ prefix: 'fk:m', x: 0, y: 96, g, cols: 8, cw: 44, ch: 28, gap: 3, size: 13, used: (b) => own.has(b) || !F().isData(g, b), look: (b) => [!F().isData(g, b) ? 'meta' : '', cur >= 0 && P.writes.findIndex((w) => w.block === b) === cur ? 'act' : touched.has(b) ? 'seen' : ''].join(' ').trim() });
        items.push(...m.items);
        items.push(...S.Kit.disk.legend({ prefix: 'fk:lg', x: 0, y: 96 + m.h + 10, entries: [{ cls: 'dk meta', text: 'metadata' }, { cls: 'dk-data', text: 'data' }, { cls: 'dk-free seen', text: 'changed by the operation' }], maxW: m.w, size: 13 }).items);
        items.push(...panel(m.w + 30, 96));
        return items;
      };
      const textPanel = (title, lines, cls) => (X, Y) => [H.head('fk:pt', X, Y + 4, title)].concat(lines.slice(0, 6).map((l, i) => H.cell('fk:pl' + i, X, Y + 16 + i * 32, 470, 28, clip(l.text, 62), 'card oc ' + (l.cls || cls || ''), 13, { align: 'left' })));
      Fr.add({ items: draw(0, -1, null, textPanel('the writes, in order', P.writes.map((w, i) => ({ text: `${i + 1}. ${S.FS.blockName(w)}: ${what[w.kind] || w.kind}` })))), title: 'the plan', say: `${OPS[inp.op].label} changes ${H.plural(n, 'block')}, written one at a time in this order: ${P.writes.map((w) => S.FS.blockName(w)).join(', ')}. The power will fail after write ${k}${k === n ? ' (that is, after the last: no harm)' : ''}.`, meta: { phase: 'plan', n, k, blocks: P.writes.map((w) => w.block) } });
      for (let i = 1; i <= k; i++) {
        const w = P.writes[i - 1];
        Fr.set('done', i);
        Fr.add({ items: draw(i, i - 1, null, textPanel(`write ${i}`, [{ text: `${S.FS.blockName(w)}: ${what[w.kind] || w.kind}`, cls: 'new' }])), title: 'write ' + i, say: `Write ${i} of ${n}: the ${S.FS.blockName(w)} goes to the disk, with ${what[w.kind] || 'its new contents'}.`, meta: { phase: 'write', i, n, block: w.block } });
      }
      const O = outcome(inp.op, inp.order, k);
      Fr.set('problems', O.problems.length);
      if (k < n) Fr.add({ items: draw(k, -1, k, textPanel('power cut', [{ text: `writes ${H.range(k + 1, n)} never happen`, cls: 'stale' }])), title: 'power cut', say: `The power fails after write ${k}: ${n - k === 1 ? 'write ' + n + ' never happens' : 'writes ' + H.range(k + 1, n) + ' never happen'}. The disk now holds part of the change.`, meta: { phase: 'cut', k, n, from: k + 1 } });
      const lines = O.fsck.ok ? [{ text: 'every check passes', cls: 'new' }].concat(O.stale ? [{ text: `but /diary's new bytes read "${O.look.diary.tail.slice(0, 26)}…"`, cls: 'stale' }] : []) : O.problems.map((p) => ({ text: p.say, cls: 'stale' }));
      Fr.add({ items: draw(k, -1, k < n ? k : null, textPanel('fsck', lines)), title: 'fsck', say: O.fsck.ok ? (O.stale ? `fsck finds nothing wrong: the bitmaps and inodes agree. Yet /diary is ${O.look.diary.size} bytes and its new block holds old bytes from a deleted file, never overwritten: the inode was written, the data never was. fsck cannot see this.` : `fsck finds nothing wrong: ${k === 0 ? 'nothing was written' : k === n ? 'every write was done' : 'what was written leaves the disk consistent'}${k > 0 && k < n ? ', and the operation is simply lost' : ''}.`) : `fsck finds ${H.plural(O.problems.length, 'problem')}: ${O.problems.map((p) => p.say).join(' ')}`, meta: { phase: 'fsck', ok: O.fsck.ok, nprob: O.problems.length, problems: O.problems, stale: O.stale, size: O.look.diary ? O.look.diary.size : 0, k, n } });
      if (!O.fsck.ok) Fr.add({ items: draw(k, -1, k < n ? k : null, textPanel('repair', O.fixes.map((f) => ({ text: f, cls: 'new' })))), title: 'repair', say: `Repair: ${O.fixes.join('; ')}. fsck then finds ${O.afterOk ? 'the disk consistent' : 'problems still'}; ${repairNote(inp.op, O)}`, meta: { phase: 'repair', fixes: O.fixes, afterOk: O.afterOk, nfix: O.fixes.length, after: O.lookAfter, problems: O.problems } });
      // every cut
      const all = []; for (let c = 0; c <= n; c++) all.push(outcome(inp.op, inp.order, c));
      const bad = all.filter((o) => !o.fsck.ok || o.stale);
      Fr.add({ items: draw(n, -1, null, (X, Y) => [H.head('fk:at', X, Y + 4, 'every place the power could fail')].concat(all.map((o, i) => H.cell('fk:a' + i, X, Y + 16 + i * 30, 470, 26, clip(`${o.k === n ? 'no cut' : 'cut after ' + o.k}: ${verdict(o)}`, 62), 'card oc ' + (!o.fsck.ok || o.stale ? 'stale' : 'new') + (o.k === k ? ' act' : ''), 13, { align: 'left' })))), title: 'every cut', say: `Every cut point for this order: ${bad.length ? H.plural(bad.length, 'of them leaves', 'of them leave') + ' damage (' + bad.map((o) => 'after ' + o.k + ': ' + verdict(o)).join('; ') + ')' : 'none leaves damage'}. ${inp.order === 'data' ? 'Writing data before the pointers to it means a crash can only leak a block, never expose old data.' : inp.order === 'engine' ? 'Writing the inode first means a crash can leave it pointing at a block that was never filled or never marked.' : 'Marking blocks before using them means a crash leaks them at worst.'}`, meta: { phase: 'all', cuts: all.map((o) => ({ k: o.k, ok: o.fsck.ok, stale: o.stale, kinds: o.problems.map((p) => p.kind) })), nbad: bad.length, n } });
      return { frames: Fr.list, def: { sections: [{ id: 'eq', kind: 'math', title: 'What fsck checks', text: ['inode bitmap ↔ inodes in use', 'data bitmap ↔ blocks the inodes point to', 'each block owned once, inside the data region', 'sizes ↔ blocks mapped', 'directories: ., .., entries naming live inodes', 'link counts ↔ entries; every inode reachable'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'plan', pick: 'option', ask: 'After the cut, will fsck find a problem?', options: ['yes', 'no'], answer: (fr) => (fr.find((x) => x.meta.phase === 'fsck').meta.ok ? 'no' : 'yes'), explain: (fr) => fr.find((x) => x.meta.phase === 'fsck').say },
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'all', pick: 'option', ask: 'Of all the places the power could fail, how many leave damage (seen by fsck or not)?', options: (fr) => H.choices(fr[fr.length - 1].meta.nbad, [0, 1, 2, 3, 4]), answer: (fr) => String(fr[fr.length - 1].meta.nbad), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'The inode reaches the disk but the bitmap does not. fsck reports…', options: ['a block in use but free in the bitmap', 'nothing', 'a leaked block', 'a bad superblock'], answer: 0, why: 'The block would be handed out twice; fsck marks it used.' },
      { q: 'The bitmap reaches the disk but the inode does not. The result is…', options: ['a leak: a block marked used that nobody owns', 'a file of garbage', 'a lost directory', 'nothing at all'], answer: 0, why: 'fsck can free it; no data is exposed.' },
      { q: 'Which crash damage can fsck NOT detect?', options: ['an inode pointing at a block whose new data never arrived', 'a bitmap mismatch', 'a wrong link count', 'an unreachable inode'], answer: 0, why: 'The metadata all agree; only the contents are old.' },
      { q: 'Why is fsck slow on a big disk?', options: ['it must read every inode, bitmap and directory, however small the damage', 'it writes every block', 'it waits for the journal', 'it is single-threaded'], answer: 0, why: 'It has no record of what was in flight; journaling fixes that.' },
    ],
  });
  function repairNote(op, O) {
    const d = O.lookAfter.diary;
    if (op === 'append' && d && d.size > 256) return `/diary keeps its ${d.size} bytes, but the end of it is whatever the block held.`;
    if (op === 'append') return 'the append is undone.';
    return 'what remains is consistent, though the operation may be half there or gone.';
  }
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  S.P15.fsckOutcome = outcome;
})(globalThis.Proses = globalThis.Proses || {});
