// Part 15, the journal over time: several transactions committed with lazy checkpointing (S.FS.commit with
// checkpoint 'lazy'), so committed blocks wait in the log and in memory until the log fills; then the oldest are
// checkpointed home and their space reused, round the circular log. The power is cut at a write the student picks;
// replay (S.FS.replay) redoes every committed transaction after the last one marked done, in order, and skips a
// block a later transaction revoked (reused for data written in place).
(function (S) {
  'use strict';
  const H = S.P15, F = () => S.FS;
  const WORK = {
    steady: { label: 'six small operations', ops: [['mkdir', '/pier'], ['create', '/pier/tide'], ['write', '/pier/tide', 0, 'high at six'], ['create', '/pier/wind'], ['write', '/pier/wind', 0, 'west, rising'], ['create', '/pier/boats']] },
    revoke: { label: 'a freed directory block reused for data', ops: [['mkdir', '/old'], ['rmdir', '/old'], ['create', '/new'], ['write', '/new', 0, 'D'.repeat(200)]] },
  };
  const OPN = (o) => o.slice(0, o[0] === 'write' ? 2 : 3).join(' ');

  /** every transaction with its writes, numbered across the whole run, and the state after each */
  function play(work, jblocks, revoke, cut) {
    const img = F().mkfs({ bs: 256, nblocks: 40, ninodes: 8, ndirect: 4, ps: 4, jblocks }, 'OLD BYTES OF SOMETHING DELETED. ');
    const txs = [], opts = { mode: 'ordered', checkpoint: 'lazy', revoke };
    let at = 0, crashed = false;
    for (const o of WORK[work].ops) {
      if (crashed) break;
      const tx = F().prepare(img, o[0], ...o.slice(1));
      const left = cut === null ? null : cut - at;
      const c = F().commit(img, tx, Object.assign({}, opts, left !== null && left < 1e9 ? { crashAfter: left } : {}));
      const ws = c.writes.map((w, j) => ({ n: at + j + 1, block: w.block, kind: w.kind, phase: w.phase, seq: w.seq, home: w.home, say: w.say, done: j < c.applied }));
      txs.push({ op: OPN(o), seq: c.seq, writes: ws, revokes: c.revokes || [], j: F().journalState(img), mem: img.overlay ? [...img.overlay.keys()].sort((a, b) => a - b) : [], applied: c.applied });
      at += c.writes.length;
      if (c.crashed) crashed = true;
    }
    // a cut at or past the last write: everything was written, then the power failed
    if (cut !== null && !crashed) { F().crash(img); crashed = true; }
    return { img, txs, total: at, crashed };
  }

  S.topic({
    id: 'fsi-checkpoint', family: 'p15-crash', order: 30, title: 'Checkpoint and replay, round the log',
    blurb: 'Writing every committed block home at once doubles the writes at the worst moment. With lazy checkpointing, committed blocks stay in the log (and in memory) and go home later, when the log fills or the system is idle; the journal superblock records which transaction was the last one done. After a crash, replay redoes every committed transaction after that one, in order. A block freed and reused for data is revoked, so replay does not write old metadata over it.',
    inputs: [
      { id: 'work', kind: 'choice', label: 'operations', def: 'steady', options: Object.entries(WORK).map(([value, w]) => ({ value, label: w.label })) },
      { id: 'jblocks', kind: 'number', label: 'journal blocks', def: 9, min: 6, max: 24 },
      { id: 'crash', kind: 'number', label: 'power cut after write (0 none)', def: 0, min: 0, max: 60 },
      { id: 'revoke', kind: 'choice', label: 'revoke records', def: 'on', options: [{ value: 'on', label: 'on' }, { value: 'off', label: 'off (unsafe)' }] },
    ],
    presets: [
      { label: 'Six operations, the log wraps', values: { work: 'steady', jblocks: 9, crash: 0, revoke: 'on' } },
      { label: 'Cut with three transactions unchecked', values: { work: 'steady', jblocks: 12, crash: 14, revoke: 'on' } },
      { label: 'Revoke: a freed block reused', values: { work: 'revoke', jblocks: 24, crash: 60, revoke: 'on' } },
      { label: 'Without revoke, replay clobbers the data', values: { work: 'revoke', jblocks: 24, crash: 60, revoke: 'off' } },
    ],
    counters: [{ id: 'writes', label: 'writes' }, { id: 'mem', label: 'blocks waiting in memory' }],
    run(inp) {
      const cut = inp.crash || null, P = play(inp.work, inp.jblocks, inp.revoke === 'on', cut), Fr = new S.Frames(['writes', 'mem']), g = P.img.g;
      const draw = (k, extra) => {
        const items = [], T = P.txs[k] || null, st = T ? T.j : F().journalState(F().mkfs({ bs: 256, nblocks: 40, ninodes: 8, ndirect: 4, ps: 4, jblocks: inp.jblocks }));
        items.push(H.head('cp:tt', 0, 14, 'transactions'));
        P.txs.forEach((t, i) => {
          if (i > k) return;
          const phases = {}; t.writes.forEach((w) => { phases[w.phase] = (phases[w.phase] || 0) + 1; });
          const lost = t.writes.some((w) => !w.done);
          items.push(H.cell('cp:t' + i, 0, 24 + i * 30, 430, 26, clip(`T${t.seq} ${t.op}: ${Object.entries(phases).map(([p, c]) => c + ' ' + p).join(', ')}`, 52), 'cmd ' + (i === k ? 'act' : 'done') + (lost ? ' gone' : ''), 13, { align: 'left' }));
        });
        // the journal: its superblock and the circular log, on the right
        const JX = 470, jy = 0;
        items.push(H.head('cp:jt', JX, jy + 14, `the journal: superblock (T${st.done} done), log of ${g.jblocks - 1}`));
        const cells = st.log.map((e) => (isBegin(e.kind) ? { lines: ['begin ' + e.seq, e.revokes.length ? 'rev ' + e.revokes.join(',') : H.plural(e.homes.length, 'blk')], cls: 'jb txb' } : isCommit(e.kind) ? { lines: ['commit', String(e.seq)], cls: 'jb txe' } : e.kind === 'data' ? { lines: ['copy'], cls: 'jb logged' } : { lines: ['—'], cls: 'jb empty' }));
        const per = 7, at = (j) => ({ x: JX + (j % per) * 58, y: jy + 26 + Math.floor(j / per) * 50 });
        cells.forEach((c, j) => { const p = at(j); items.push(H.cell('cp:j' + j, p.x, p.y, 54, 44, c.lines, 'dk ' + c.cls + (j === st.head ? ' start' : ''), 13)); });
        const mem = T ? T.mem : [];
        const by = Math.max(24 + Math.max(1, P.txs.length) * 30, jy + 26 + Math.ceil(cells.length / per) * 50) + 12;
        items.push(H.text('cp:mm', 0, by + 8, `committed, waiting in memory (not yet home): ${mem.length ? mem.join(', ') : 'none'}`, 'mono', 13));
        if (extra) items.push(...extra(0, by + 32));
        return items;
      };
      Fr.add({ items: draw(-1), title: 'start', say: `An ordered journal of ${inp.jblocks} blocks: a superblock and a circular log of ${inp.jblocks - 1}. Checkpointing is lazy: a committed transaction stays in the log, its blocks waiting in memory, until the log needs the space. ${H.plural(WORK[inp.work].ops.length, 'operation')} follow, each one transaction${cut ? '; the power fails after ' + (cut >= P.total ? 'the last write, ' + P.total : 'write ' + cut) : ''}.`, meta: { phase: 'start', jblocks: inp.jblocks, log: inp.jblocks - 1, n: WORK[inp.work].ops.length, cut, total: P.total } });
      let writes = 0;
      P.txs.forEach((t, i) => {
        const done = t.writes.filter((w) => w.done), ck = done.filter((w) => w.phase === 'checkpoint'), freed = done.find((w) => w.kind === 'jsb');
        writes += done.length;
        Fr.set('writes', writes).set('mem', t.mem.length);
        let say = `T${t.seq}, ${t.op}: ${H.plural(done.length, 'write')}${done.length < t.writes.length ? ' of ' + t.writes.length + ' before the power fails' : ''}.`;
        if (ck.length) say += ` The log had no room, so older transactions are checkpointed first: ${H.plural(ck.length, 'block')} (${ck.map((w) => w.block).join(', ')}) written home${freed ? ', and the superblock marks them done' : ''}.`;
        if (t.revokes.length) say += ` Block ${t.revokes.join(', ')}, logged earlier as metadata, is now data written in place: the begin block revokes it.`;
        if (done.some((w) => w.phase === 'commit')) say += ` The commit block commits T${t.seq}; its ${H.plural(t.mem.length, 'block')} now ${t.mem.length === 1 ? 'waits' : 'wait'} in memory and in the log, not yet home.`;
        Fr.add({ items: draw(i), title: 'T' + t.seq, say, meta: { phase: 'tx', seq: t.seq, done: done.length, total: t.writes.length, ck: ck.map((w) => w.block), nck: ck.length, mem: t.mem, nmem: t.mem.length, revokes: t.revokes, jdone: t.j.done } });
      });
      if (P.crashed) {
        const j0 = F().journalState(P.img), rep = F().replay(P.img), fsck = F().fsck(P.img, { disk: true });
        const files = F().list(P.img, '/').filter((e) => e.name !== '.' && e.name !== '..').map((e) => e.name);
        let check = '';
        if (inp.work === 'revoke') { try { const t = F().text(F().read(P.img, '/new')); check = t === 'D'.repeat(200) ? '/new reads its 200 bytes intact.' : `/new reads "${t.slice(0, 18).replace(/[^\x21-\x7e]+/g, '·')}…" instead of its 200 bytes: its data block was overwritten by the old directory block replayed from the log.`; } catch (e) { check = '/new is not there.'; } }
        const rrows = rep.steps.filter((s) => !/^replay-(txb|begin)/.test(s.kind)).map((s) => ({ text: s.kind === 'replay-copy' ? `T${s.seq}: committed, redone: ${s.homes.join(', ')} copied home${s.skipped.length ? '; ' + s.skipped.join(', ') + ' skipped (revoked)' : ''}` : s.kind === 'replay-discard' ? `T${s.seq}: no commit block, thrown away` : s.kind === 'replay-done' ? `superblock: T${s.seq} now done` : clip(s.say, 110), cls: s.kind === 'replay-discard' || s.kind === 'replay-none' ? 'old' : 'new' }));
        if (check) rrows.push({ text: check, cls: /intact/.test(check) ? 'new' : 'stale' });
        const items = draw(P.txs.length - 1, (X, Y) => [H.head('cp:rt', X, Y, 'after the crash: replay')].concat(rrows.slice(0, 6).map((r, j) => H.cell('cp:r' + j, X, Y + 12 + j * 30, 880, 26, clip(r.text, 115), 'card oc ' + r.cls, 13, { align: 'left' }))));
        Fr.add({ items, title: 'replay', say: `The power fails after write ${Math.min(cut, P.total)}${cut >= P.total ? ', the last one' : ''}. Memory is lost, the blocks waiting in it too. The journal superblock says T${j0.done} was the last one done, so replay starts after it. ${rep.steps.map((s) => s.say).join(' ')} fsck: ${fsck.ok ? 'consistent' : fsck.problems.map((p) => p.say).join(' ')}. ${[files.length ? 'The root holds ' + H.list(files) + '.' : '', check].filter(Boolean).join(' ')}`.trim(), meta: { phase: 'replay', cut: Math.min(cut, P.total), done: j0.done, counts: rep.steps.map((s) => (s.homes ? s.homes.length : 0)), len: 200, steps: rep.steps.map((s) => Object.assign({}, s, { say: undefined })), ok: fsck.ok, files } });
      } else {
        const c = F().checkpoint(P.img);
        Fr.set('mem', 0).set('writes', writes + c.applied);
        Fr.add({ items: draw(P.txs.length - 1, (X, Y) => [H.head('cp:ct', X, Y, 'a final checkpoint'), ...H.para('cp:cp', X, Y + 12, `${H.plural(c.writes.length, 'write')}: ${c.writes.map((w) => w.block).join(', ')}. The log is free again.`, 880, 13, 'strong').items]), title: 'checkpoint', say: `No crash. At the end a checkpoint writes the blocks still waiting home and marks their transactions done: ${H.plural(c.writes.length, 'write')} (${c.writes.map((w) => w.block).join(', ')}). In all ${writes + c.applied} writes, where checkpointing every transaction at once would have written each home block every time it changed.`, meta: { phase: 'final', n: c.writes.length, blocks: c.writes.map((w) => w.block), total: writes + c.applied } });
      }
      return { frames: Fr.list, def: { sections: [{ id: 'eq', kind: 'math', title: 'The log', text: ['a transaction: begin block, the blocks, commit block', 'lazy checkpoint: home later, when space is needed', 'superblock: the last transaction done, the head', 'replay: every committed transaction after it', 'revoke: a reused block is not replayed', 'a begin block with no commit block: thrown away'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'replay', pick: 'option', ask: 'How many transactions will replay redo?', options: (fr) => H.choices(fr[fr.length - 1].meta.steps.filter((s) => s.kind === 'replay-copy').length, [0, 1, 2, 3, 4]), answer: (fr) => String(fr[fr.length - 1].meta.steps.filter((s) => s.kind === 'replay-copy').length), explain: (fr) => fr[fr.length - 1].say },
      { at: (f, i, fr) => f.meta.phase === 'start' && fr.some((x) => x.meta.nck), pick: 'option', ask: 'Will some transaction find the log full and have to checkpoint older ones first?', options: ['yes', 'no'], answer: 'yes', explain: (fr) => fr.find((x) => x.meta.nck).say },
      { at: (f, i, fr) => f.meta.phase === 'start' && !fr.some((x) => x.meta.nck), pick: 'option', ask: 'Will some transaction find the log full and have to checkpoint older ones first?', options: ['yes', 'no'], answer: 'no', explain: 'The log is big enough for every transaction here.' },
    ],
    quiz: [
      { q: 'Why checkpoint lazily?', options: ['a block changed by many transactions is written home once, and at a quiet time', 'it is safer', 'it uses less log', 'replay is faster'], answer: 0, why: 'The log already makes the change durable; going home can wait.' },
      { q: 'Where does replay start?', options: ['after the last transaction the journal superblock marks done', 'at the start of the disk', 'at the newest commit block', 'at block 0 of the log'], answer: 0, why: 'Everything before it is already home.' },
      { q: 'What goes wrong without revoke records?', options: ['replay can copy old metadata over a block since reused for data', 'nothing', 'the log overflows', 'fsck cannot run'], answer: 0, why: 'The log still holds the old copy; only a revoke says it is obsolete.' },
      { q: 'The log is circular. What must happen before it wraps onto a transaction?', options: ['that transaction must be checkpointed home and marked done', 'nothing', 'fsck', 'a reboot'], answer: 0, why: 'Its log copy is the only safe one until its blocks are home.' },
    ],
  });
  const isBegin = (k) => /^(txb|begin)/i.test(String(k)), isCommit = (k) => /^(txe|commit)/i.test(String(k));
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  S.P15.checkpointPlay = play;
})(globalThis.Proses = globalThis.Proses || {});
