// Part 15, journaling in three modes, with the power cut at every point (S.FS.commit, S.FS.replay, S.FS.fsck on a
// real image with a journal). writeback logs only metadata and writes data home whenever; ordered writes data home
// before the metadata commits; data journaling logs everything. An append (a new block) or an overwrite across two
// blocks is written, the power fails after the write chosen, the journal is replayed, and what the file reads is
// judged: the old version, the new one, stale bytes, or a mix of the two. The last frame tries every mode and cut.
(function (S) {
  'use strict';
  const H = S.P15, F = () => S.FS;
  const GEO = { bs: 256, nblocks: 40, ninodes: 8, ndirect: 4, ps: 4, jblocks: 8 };
  const STALE = 'OLD BYTES OF A DELETED FILE. ';
  const OLD = 'The harbour log, first page: fog until noon, the ferry late, the nets mended. '.repeat(7).slice(0, 512);
  const ADD = 'Second day: rain all morning, the tide tables came by the noon boat.';
  const NEW = 'REWRITTEN: the storm moved the moorings; all boats counted and safe; the lamp relit at dusk; nobody hurt. ';
  const MODES = [{ value: 'writeback', label: 'writeback (metadata only)' }, { value: 'ordered', label: 'ordered (data home first)' }, { value: 'data', label: 'data journaling' }];
  const MNAME = { none: 'no journal', writeback: 'writeback', ordered: 'ordered', data: 'data' };
  const OPS = { append: 'append a block to /log', overwrite: 'overwrite across two blocks of /log' };
  const AT = 200;

  function base() {
    const img = F().mkfs(GEO, STALE);
    F().apply(img, 'create', ['/log'], { mode: 'ordered' }); F().apply(img, 'write', ['/log', 0, OLD], { mode: 'ordered' });
    F().crash(img);
    return img;
  }
  const prepare = (img, op) => (op === 'append' ? F().prepare(img, 'append', '/log', ADD) : F().prepare(img, 'write', '/log', AT, NEW));
  /** what /log holds: 'old', 'new', 'stale', 'torn', with the size */
  function judge(img, op) {
    let st;
    try { st = F().stat(img, '/log'); } catch (e) { return { what: 'gone', size: 0 }; }
    if (op === 'append') {
      if (st.size === 512) return { what: F().text(F().read(img, '/log')) === OLD ? 'old' : 'torn', size: st.size };
      const tail = F().text(F().read(img, '/log', 512, st.size - 512));
      return { what: tail === ADD ? 'new' : 'stale', size: st.size, tail };
    }
    const all = F().text(F().read(img, '/log')), seg = all.slice(AT, AT + NEW.length), a = seg.slice(0, 256 - AT), b = seg.slice(256 - AT);
    const oa = OLD.slice(AT, 256) === a, ob = OLD.slice(256, AT + NEW.length) === b, na = NEW.slice(0, 256 - AT) === a, nb = NEW.slice(256 - AT) === b;
    return { what: oa && ob ? 'old' : na && nb ? 'new' : (oa || na) && (ob || nb) ? 'torn' : 'stale', size: st.size };
  }
  /** one run: the plan, the disk after k writes, replay, fsck, and the verdict */
  function run(mode, op, k) {
    const img0 = base(), tx = prepare(img0, op);
    const all = F().commit(F().cloneLive(img0), prepare(img0, op), { mode, checkpoint: 'eager' }).writes;
    const kk = Math.min(k, all.length), c = F().cloneLive(img0);
    F().commit(c, prepare(c, op), { mode, checkpoint: 'eager', crashAfter: kk });
    const before = { j: F().journalState(c), look: judge(c, op) };
    const rep = mode === 'none' ? null : F().replay(c);
    const fsck = F().fsck(c, { disk: true }), look = judge(c, op);
    void tx;
    const inoAfter = F().readInode(c, F().lookup(c, '/log').ino), jAfter = F().journalState(c);
    return { mode, op, k: kk, n: all.length, all, before, rep, fsck, look, inoAfter, jAfter, ok: fsck.ok && (look.what === 'old' || look.what === 'new') };
  }
  /** the disk after each of the first k writes (journal and home blocks), for the pictures */
  function states(mode, op, k) {
    const out = [];
    for (let i = 0; i <= k; i++) { const img0 = base(), c = F().cloneLive(img0); F().commit(c, prepare(c, op), { mode, checkpoint: 'eager', crashAfter: i }); out.push({ j: F().journalState(c), look: judge(c, op), ino: F().readInode(c, F().lookup(c, '/log').ino) }); }
    return out;
  }
  const verdict = (R) => (!R.fsck.ok ? 'fsck: ' + R.fsck.problems.map((p) => p.kind).join(', ') : { old: 'the old version', new: 'the new version', stale: 'stale bytes', torn: 'half old, half new', gone: 'the file is gone' }[R.look.what]);
  const PH = { data: 'data', log: 'log', commit: 'commit', checkpoint: 'checkpoint', free: 'free', home: 'home' };

  S.topic({
    id: 'fsi-journal', family: 'p15-crash', order: 20, title: 'Journaling in three modes',
    blurb: 'A journal writes what an operation will change to a log first, then a commit block, and only then the blocks in their homes. After a crash, committed transactions are replayed and uncommitted ones thrown away. The modes differ over file data: writeback logs only metadata, so data may arrive late; ordered writes the data home before committing; data journaling logs the data too, so even an overwrite is all or nothing.',
    inputs: [
      { id: 'mode', kind: 'choice', label: 'mode', def: 'ordered', options: MODES },
      { id: 'op', kind: 'choice', label: 'operation', def: 'append', options: Object.entries(OPS).map(([value, label]) => ({ value, label })) },
      { id: 'crash', kind: 'number', label: 'power cut after write', def: 3, min: 0, max: 14 },
    ],
    presets: [
      { label: 'Ordered append, cut before the commit', values: { mode: 'ordered', op: 'append', crash: 3 } },
      { label: 'Writeback append, cut after the commit', values: { mode: 'writeback', op: 'append', crash: 4 } },
      { label: 'Ordered overwrite: torn', values: { mode: 'ordered', op: 'overwrite', crash: 1 } },
      { label: 'Data journaling overwrite: all or nothing', values: { mode: 'data', op: 'overwrite', crash: 3 } },
      { label: 'Data journaling append, cut mid-checkpoint', values: { mode: 'data', op: 'append', crash: 6 } },
    ],
    counters: [{ id: 'done', label: 'writes done' }],
    run(inp) {
      const R = run(inp.mode, inp.op, inp.crash), n = R.n, k = R.k, ST = states(inp.mode, inp.op, k), g = GEO, Fr = new S.Frames(['done']);
      const home = R.all.filter((w) => w.phase !== 'log' && w.phase !== 'commit' && !isBegin(w.kind) && w.kind !== 'jsb').map((w) => w.block);
      const draw = (i, cut, panel, post) => {
        const items = [], st = post || ST[Math.min(i, ST.length - 1)];
        items.push(H.head('jn:wt', 0, 14, `${OPS[inp.op]}, ${MNAME[inp.mode]} mode: ${H.plural(n, 'write')}`));
        items.push(...H.writes({ prefix: 'jn:w', x: 0, y: 26, maxW: 880, list: R.all.map((w, j) => ({ lines: [`${j + 1}. ${w.kind === 'log' ? 'log' : w.kind === 'jsb' ? 'free' : isBegin(w.kind) ? 'begin' : isCommit(w.kind) ? 'commit' : w.kind}`, w.phase === 'checkpoint' ? '→ ' + w.block : 'blk ' + w.block], cls: (j < i ? (j === i - 1 && cut === null ? 'act' : 'done') : cut !== null ? 'lost' : '') + ' ph-' + PH[w.phase] })), cw: Math.min(92, Math.floor(880 / n) - 6), ch: 44, gap: 6, crashAfter: cut, size: 13 }).items);
        // the journal
        const jy = 104;
        const G = F().geometry(Object.assign({}, GEO));
        items.push(H.head('jn:jt', 0, jy, `the journal, blocks ${G.jStart}–${G.jStart + G.jblocks - 1}: its superblock, then the log`));
        const cells = [{ lines: ['JSB', 'done ' + st.j.done], cls: 'jb' }].concat(st.j.log.map((e) => (isBegin(e.kind) ? { lines: ['begin ' + e.seq, '→ ' + e.homes.join(',')], cls: 'jb txb' } : isCommit(e.kind) ? { lines: ['commit ' + e.seq], cls: 'jb txe' } : e.kind === 'data' ? { lines: ['copy', ''], cls: 'jb logged' } : { lines: ['—'], cls: 'jb empty' })));
        cells.forEach((c, j) => items.push(H.cell('jn:j' + j, j * 66, jy + 12, 62, 46, c.lines, 'dk ' + c.cls, 13)));
        // the home blocks
        const hx = 560, look = st.look;
        items.push(H.head('jn:ht', hx, jy, post ? '/log at home, after replay' : '/log at home'));
        items.push(H.cell('jn:h0', hx, jy + 12, 320, 30, `inode: size ${st.ino.size}, blocks ${st.ino.direct.filter(Boolean).join(' ')}`, 'card ' + (st.ino.size !== 512 ? 'new' : 'old'), 13, { align: 'left' }));
        items.push(H.cell('jn:h1', hx, jy + 46, 320, 30, `contents: ${look.what === 'new' ? 'the new version' : look.what === 'old' ? 'the old version' : look.what === 'torn' ? 'half old, half new' : 'stale bytes at the end'}`, 'card ' + (look.what === 'new' ? 'new' : look.what === 'old' ? 'old' : 'stale'), 13, { align: 'left' }));
        if (panel) items.push(...panel(0, jy + 92));
        return items;
      };
      const rows = (title, list) => (X, Y) => [H.head('jn:pt', X, Y + 4, title)].concat(list.slice(0, 7).map((l, j) => H.cell('jn:p' + j, X, Y + 16 + j * 30, 880, 26, clip(l.text, 120), 'card oc ' + (l.cls || ''), 13, { align: 'left' })));
      Fr.add({ items: draw(0, null, rows('the plan', [{ text: S.FS.GUARANTEE[inp.mode] }])), title: 'the plan', say: `${OPS[inp.op]} in ${MNAME[inp.mode]} mode takes ${H.plural(n, 'write')}: ${R.all.map((w, j) => (j + 1) + ' ' + (w.phase === 'log' ? 'log' : w.phase)).join(', ')}. ${S.FS.GUARANTEE[inp.mode]}`, meta: { phase: 'plan', n, k, idx: R.all.map((_, j) => j + 1) } });
      for (let i = 1; i <= k; i++) { const w = R.all[i - 1]; Fr.set('done', i); Fr.add({ items: draw(i, null, null), title: 'write ' + i, say: `Write ${i} of ${n}: ${w.say[0].toLowerCase() + w.say.slice(1)}`, meta: { phase: 'write', i, n, w: { block: w.block, seq: w.seq, home: w.home }, jStart: F().geometry(Object.assign({}, GEO)).jStart, homes: (ST[i].j.log.find((e) => isBegin(e.kind)) || { homes: [] }).homes, done: ST[i].j.done, size: ST[i].ino.size } }); }
      if (k < n) Fr.add({ items: draw(k, k, null), title: 'power cut', say: `The power fails after write ${k}: ${n - k === 1 ? 'write ' + n + ' never happens' : 'writes ' + H.range(k + 1, n) + ' never happen'}. Memory is lost; the disk is as drawn.`, meta: { phase: 'cut', k, n, from: k + 1 } });
      const repSay = R.rep.steps.map((s) => s.say).join(' ');
      Fr.add({ items: draw(k, k < n ? k : null, rows('replay, then fsck', R.rep.steps.map((s) => ({ text: s.say, cls: /discard|none/.test(s.kind) ? '' : 'new' })).concat([{ text: R.fsck.ok ? 'fsck: consistent' : 'fsck: ' + R.fsck.problems.map((p) => p.say).join(' '), cls: R.fsck.ok ? 'new' : 'stale' }, { text: '/log now reads ' + verdict(R) + ` (${R.look.size} bytes)`, cls: R.ok ? 'new' : 'stale' }])), { j: R.jAfter, look: R.look, ino: R.inoAfter }), title: 'replay', say: `${repSay} fsck then ${R.fsck.ok ? 'finds the disk consistent' : 'finds: ' + R.fsck.problems.map((p) => p.say).join(' ')}. /log is ${R.look.size} bytes and reads ${verdict(R)}${R.ok ? '.' : R.look.what === 'stale' ? ': the metadata was replayed, but the data block it points to never got its bytes.' : R.look.what === 'torn' ? ': one block was overwritten in place, the other was not.' : '.'}`, meta: { phase: 'replay', steps: R.rep.steps.map((s) => Object.assign({}, s, { say: undefined })), next: R.rep.steps.filter((s) => s.done !== undefined).map((s) => s.done + 1), ok: R.ok, what: R.look.what, size: R.look.size, fsckOk: R.fsck.ok, problems: R.fsck.problems } });
      // every mode, every cut
      const modes = ['none', 'writeback', 'ordered', 'data'], grid = modes.map((m) => { const N = run(m, inp.op, 99).n, list = []; for (let c = 0; c <= N; c++) list.push(run(m, inp.op, c)); return { mode: m, list }; });
      const gi = [];
      gi.push(H.head('jn:gt', 0, 14, `${OPS[inp.op]}: every mode, every cut (green: old or new version, pink: damage)`));
      grid.forEach((G, r) => {
        gi.push(H.text('jn:gm' + r, 0, 52 + r * 40, MNAME[G.mode], 'strong', 14));
        G.list.forEach((R2, c) => gi.push(H.cell('jn:g' + r + '.' + c, 100 + c * 52, 34 + r * 40, 48, 32, R2.k === R2.n ? 'none' : String(R2.k), 'card ' + (R2.ok ? 'new' : 'stale') + (G.mode === inp.mode && R2.k === k ? ' act' : ''), 13)));
      });
      gi.push(H.text('jn:gx', 100, 34 + modes.length * 40 + 18, 'the number is the write after which the power fails; none: every write done', 'tick', 13));
      const bad = grid.map((G) => ({ mode: G.mode, bad: G.list.filter((x) => !x.ok).length, n: G.list.length, kinds: [...new Set(G.list.filter((x) => !x.ok).map((x) => (x.fsck.ok ? x.look.what : 'fsck')))] }));
      Fr.add({ items: gi, title: 'every cut', say: `Every place the power could fail, in every mode: ${bad.map((b) => `${MNAME[b.mode]}, ${b.bad} of ${b.n} bad${b.bad ? ' (' + b.kinds.join(', ') + ')' : ''}`).join('; ')}. ${inp.op === 'append' ? 'Writeback can leave the file pointing at a block whose data never arrived; ordered and data journaling cannot.' : 'An overwrite does not change the metadata much, so only data journaling makes it all or nothing; the others can leave it torn.'}`, meta: { phase: 'grid', bad, cut: k } });
      return { frames: Fr.list, def: { sections: [{ id: 'eq', kind: 'math', title: 'The modes', text: ['writeback: log metadata; data home any time', 'ordered: data home, then log metadata, commit', 'data: log data and metadata, commit', 'then checkpoint: write the logged blocks home', 'replay: redo every committed transaction', 'no commit block: the transaction is thrown away'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'plan', pick: 'option', ask: 'After the cut and the replay, what will /log read?', options: ['the old version', 'the new version', 'stale bytes', 'half old, half new'], answer: (fr) => { const m = fr.find((x) => x.meta.phase === 'replay').meta; return { old: 'the old version', new: 'the new version', stale: 'stale bytes', torn: 'half old, half new' }[m.what]; }, explain: (fr) => fr.find((x) => x.meta.phase === 'replay').say },
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'grid', pick: 'option', ask: 'Which mode never leaves this operation damaged, wherever the power fails?', options: ['writeback', 'ordered', 'data', 'none of them'], answer: (fr) => { const b = fr[fr.length - 1].meta.bad.filter((x) => x.mode !== 'none' && !x.bad).map((x) => x.mode); return b.length ? b : 'none of them'; }, explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'The log holds a begin block but no commit block when the power fails. Replay…', options: ['throws the transaction away: it never committed', 'copies its blocks home', 'runs fsck', 'waits'], answer: 0, why: 'Only a committed transaction (its commit block written) is replayed.' },
      { q: 'Why does ordered mode write the data home before the commit?', options: ['so committed metadata never points at a block whose data did not arrive', 'it is faster', 'to save log space', 'to avoid a checkpoint'], answer: 0, why: 'After the commit the metadata is permanent; the data must already be there.' },
      { q: 'What does data journaling cost?', options: ['every data block is written twice: to the log and home', 'nothing', 'it disables the cache', 'reads become slower'], answer: 0, why: 'All-or-nothing data means logging it.' },
      { q: 'After a crash, how long does journal recovery take compared with fsck?', options: ['time proportional to the log, not the disk', 'the same', 'longer', 'it needs fsck as well, always'], answer: 0, why: 'Only the transactions in the log are looked at.' },
      { q: 'Replaying a transaction that the checkpoint had half written home is safe because…', options: ['replay writes the logged copies again; doing it twice gives the same result', 'the checkpoint undoes itself', 'the bitmaps prevent it', 'it is not safe'], answer: 0, why: 'Redo of whole blocks is idempotent.' },
    ],
  });
  /** the journal's begin and commit blocks, whatever the engine calls their kinds */
  const isBegin = (k) => /^(txb|begin)/i.test(String(k)), isCommit = (k) => /^(txe|commit)/i.test(String(k));
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  S.P15.journalRun = run;
})(globalThis.Proses = globalThis.Proses || {});
