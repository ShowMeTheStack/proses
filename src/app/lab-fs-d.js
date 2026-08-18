// The File-system lab, part four: the disk workbench's run. mkfs, then one frame per command with the blocks it
// changed; the last command that writes can be cut by a power failure after any of its writes, and then the frames
// follow its writes one by one, the cut, the journal's replay, fsck and the repair; last, the walk to byte N of a
// file. Every frame carries the devices as they stood (for the Inspect tab) and its own tables and metrics.
//   FL.diskRun(v, ctx) -> the lab's result
(function (S) {
  'use strict';
  const FL = S.FsLab, F = () => S.FS;

  /** free inodes and free data blocks as the bitmaps (or the FAT) say, on a snapshot as mounted */
  FL.counts = function (sn) {
    const img = FL.live(sn), tx = new (F().Tx)(img);
    let fi = 0;
    for (const G of img.g.grp) fi += F().freeInodesIn(tx, G);
    return { fi, fb: F().countFree(tx) };
  };
  function inodeTable(sn, names) {
    const lk = FL.look(sn), g = sn.g, rows = [];
    for (const [ino, n] of lk.inodes) {
      const blocks = [...lk.owner].filter(([, i]) => i === ino).map(([b]) => b);
      rows.push([String(ino), names.get((sn.dev || 0) + ':' + ino) || '(no name)', ['free', 'file', 'dir', 'symlink'][n.type], String(n.nlink), FL.grp(n.size), F().modeString(n.mode), n.uid + ':' + n.gid, blocks.length ? FL.runs(blocks) : '–']);
    }
    void g;
    return { title: 'Inodes in use' + (sn.dev ? ' (device ' + sn.dev + ')' : ''), cols: ['inode', 'name', 'type', 'links', 'size', 'mode', 'owner', 'blocks'], rows };
  }

  FL.diskRun = function (v, ctx) {
    const narrow = ctx.narrow, P = FL.parse(v.src);
    if (P.error) return { error: P.error, frames: [] };
    const geo = FL.geo(v);
    let g0;
    try { g0 = F().geometry(Object.assign({}, geo)); } catch (e) { return { frames: [], error: { msg: e.message } }; }
    const B = FL.bench(v, P.cmds, { cutAt: v.crash ? v.cutAfter : null });
    const frames = [], trace = [];
    let totalIO = { reads: 0, writes: 0, hits: 0 };
    const metricsOf = (sn, rec) => {
      const c = FL.counts(sn), out = [];
      if (rec) out.push({ label: 'This command: disk reads', value: rec.io.reads }, { label: 'This command: disk writes', value: rec.io.writes });
      if (rec && v.cache !== 'none') out.push({ label: 'This command: cache hits', value: rec.io.hits, cls: rec.io.hits ? 'good' : '' });
      out.push({ label: 'All commands: reads, writes', value: totalIO.reads + ', ' + totalIO.writes }, { label: 'Free inodes', value: c.fi + ' of ' + (sn.g.ninodes - 1) }, { label: 'Free data blocks', value: c.fb + ' of ' + sn.g.ndata }, { label: 'Largest file', value: FL.bytes(F().maxFileSize(sn.g)) });
      if (sn.g.jblocks) { const js = F().journalState(FL.disk(sn)); out.push({ label: 'Journal: last transaction done', value: js ? js.done : 0 }); }
      if (sn.mem.size) out.push({ label: 'Blocks newer in memory', value: sn.mem.size, cls: 'act' });
      return out;
    };
    const push = (f, step) => { trace.push(step); frames.push(Object.assign({ at: trace.length - 1 }, f)); };
    const mark = (line) => (line ? [{ line, tag: '▶', cls: 'p0', act: true, title: 'this command' }] : []);
    const devTitle = (sn, extra) => `device ${sn.dev || 0}${sn.at && sn.at !== '/' ? ' (on ' + sn.at + ')' : ''}: ${sn.g.nblocks} blocks of ${sn.g.bs} bytes${extra || ''}`;

    // ---- mkfs
    const d0 = B.first.devs, sn0 = d0[0], c0 = FL.counts(sn0);
    const names0 = FL.names(d0);
    push({
      items: FL.diskPaint({ sn: sn0, devs: d0, narrow, mapTitle: devTitle(sn0), right: FL.layoutPanel(sn0.g) }).items,
      title: 'mkfs', marks: [], fsi: { devs: d0, dev: 0 },
      say: `mkfs lays out ${g0.nblocks} blocks of ${g0.bs} bytes: the superblock (block 0), the inode bitmap, the ${g0.fat ? 'FAT' : 'data bitmap'}, an inode table of ${g0.ninodes} inodes of ${g0.isz} bytes${g0.jblocks ? ', a journal of ' + g0.jblocks + ' blocks' : ''} and ${g0.ndata} data blocks from block ${g0.dataStart}. Only the root directory exists, inode ${F().ROOT}: \`${c0.fi}\` inodes and \`${c0.fb}\` data blocks are free. The largest file this geometry allows is \`${FL.bytes(F().maxFileSize(g0))}\`.`,
      tables: [inodeTable(sn0, names0)], metrics: metricsOf(sn0, null),
    }, { kind: 'mkfs', say: 'mkfs: a fresh file system.' });

    // ---- the commands
    B.recs.forEach((rec, i) => {
      totalIO = rec.io.total || totalIO;
      const prevDevs = i ? B.recs[i - 1].devs : B.first.devs;
      const cap = rec.caps[rec.caps.length - 1];
      const devIdx = cap ? cap.dev : rec.readDev !== undefined ? rec.readDev : 0;
      const names = FL.names(rec.devs);
      // the data blocks a read went through
      if (rec.got !== undefined) {
        const sn = rec.devs[devIdx] || rec.devs[0], lk = FL.look(sn), path = FL.where(rec.devs, rec.cmd.args[0]).path;
        try {
          const ino = F().lookup(FL.live(sn), path).ino, pay = F().payload(sn.g), off = rec.cmd.args[1] || 0, end = off + rec.got.length;
          rec.readBlocks = F().ownedBlocks(FL.live(sn), F().readInode(FL.live(sn), ino)).filter((x) => x.kind === 'data' && x.fb * pay < end && (x.fb + 1) * pay > off).map((x) => x.block);
        } catch (e) { rec.readBlocks = []; }
        void lk;
      }
      const engineSay = rec.steps.filter((s) => !/^(alloc|lookup|dir-read|namei|access)/.test(s.kind) && s.say).map((s) => s.say).join(' ');
      if (rec.cut !== null && rec.cut !== undefined && cap) { cutFrames(rec, cap, prevDevs, names, engineSay); return; }
      const sn = rec.devs[devIdx] || rec.devs[0];
      const lit = new Set(), jlit = new Set();
      for (const c of rec.caps) {
        for (const w of c.commit.writes.slice(0, c.commit.applied)) (w.phase === 'log' || w.phase === 'commit' || w.kind === 'jsb' ? jlit : lit).add(w.block);
        if (c.deferred) for (const w of c.writes) lit.add(w.block);
      }
      if (rec.cmd.op === 'sync') for (const b of rec.reads) lit.add(b);
      const rd = new Set(rec.readBlocks || []);
      const ex = rec.caps.flatMap((c) => FL.explain(c, names));
      const nW = new Set(rec.caps.flatMap((c) => c.writes.map((w) => w.block))).size;
      let say;
      if (!rec.ok) say = `${rec.cmd.text}: ${rec.err.code}, ${rec.err.message}. Nothing on the disk changes.`;
      else if (rec.cmd.op === 'mkfs' || rec.cmd.op === 'user') say = `${rec.cmd.text}: ${engineSay}`;
      else {
        const parts = [`${rec.cmd.text}: ${engineSay || 'done.'}`];
        if (nW) parts.push(`${FL.plural(nW, 'block')} change${nW === 1 ? 's' : ''}: ${FL.list(ex.slice(0, 6).map((r) => (FL.KNAME[r.kind] || r.kind) + ' ' + r.block))}${ex.length > 6 ? ' and more' : ''}.`);
        if (rec.caps.some((c) => c.deferred)) parts.push(`With a write-back cache none of them reaches the disk yet: \`${rec.caps.reduce((a, c) => a + c.writes.length, 0)}\` blocks are dirty in memory.`);
        else if (rec.caps.length && rec.caps[0].mode !== 'none') parts.push(`The journal (${rec.caps[0].mode} mode) took \`${rec.io.writes}\` disk writes in all${rec.caps[0].checkpoint === 'lazy' ? '; the home copies wait in memory for a checkpoint' : ', the checkpoint included'}.`);
        if (rec.got !== undefined) parts.push(`It read \`${rec.got.length}\` bytes: "${FL.clip(rec.got, 50)}".`);
        if (v.cache !== 'none' && (rec.io.reads || rec.io.hits)) parts.push(`Reads: \`${rec.io.reads}\` from the disk, \`${rec.io.hits}\` from the cache.`);
        say = parts.join(' ');
      }
      const tables = [{ title: 'Blocks this command changed', cols: ['block', 'what', 'change'], rows: ex.map((r) => [String(r.block), FL.KNAME[r.kind] || r.kind, r.detail]) }];
      for (const c of rec.caps) { const jr = FL.journalRows(c); if (jr.length) tables.push({ title: 'The journal', cols: ['blocks', 'step', 'what'], rows: jr.map((j) => [j.blocks.length ? FL.runs(j.blocks) : '–', j.title, j.detail]) }); }
      tables.push(inodeTable(sn, names));
      if (v.cache !== 'none') tables.push({ title: `The cache (${v.cache}, ${v.cacheBlocks} blocks), least recent first`, cols: ['block', 'kind', 'state'], rows: rec.cacheSnap.map((c) => [String(c.key), c.kind || '', c.dirty ? { text: 'dirty', cls: 'bad' } : 'clean']) });
      const nsAct = new Set(rec.caps.flatMap((c) => c.trace.filter((s) => s.ino).map((s) => c.dev + ':' + s.ino)));
      push({
        items: FL.diskPaint({ sn, devs: rec.devs, narrow, lit, jlit, rd, nsAct, mapTitle: devTitle(sn), right: FL.changePanel(rec, names, { hits: v.cache !== 'none' }) }).items,
        title: rec.cmd.op, marks: mark(rec.cmd.line), fsi: { devs: rec.devs, dev: devIdx }, say, tables, metrics: metricsOf(sn, rec),
      }, { kind: rec.ok ? rec.cmd.op : 'error', say });
    });

    // ---- the last command, cut by a power failure
    function cutFrames(rec, cap, prevDevs, names, engineSay) {
      const dev = cap.dev, ws = cap.commit.writes, n = ws.length, info = rec.cutInfo, k = info.k;
      const base = prevDevs[dev] || prevDevs[0];
      const allDevs = (sn) => prevDevs.map((d, j) => (j === dev ? Object.assign({}, sn, { at: d.at, dev: d.dev }) : d));
      const ex = FL.explain(cap, names);
      const plan = ws.length ? `It changes ${FL.plural(cap.writes.length, 'block')}, and with ${cap.mode === 'none' ? 'no journal' : 'the journal in ' + cap.mode + ' mode'} that takes ${FL.plural(n, 'write')}: ${ws.map((w, j) => (j + 1) + ' ' + (w.kind === 'TxB' ? 'begin' : w.kind === 'TxE' ? 'commit' : w.kind === 'log' ? 'log' : w.kind === 'jsb' ? 'journal super' : w.phase === 'checkpoint' ? 'checkpoint ' + w.block : (FL.KNAME[w.kind] || w.kind) + ' ' + w.block)).join(', ')}.` : `With a write-back cache its ${FL.plural(cap.writes.length, 'block')} only become dirty in memory: nothing is written to the disk.`;
      const cutSay = info.deferred ? 'every write waits in memory' : k >= n ? 'after every write' : `after write ${k} of ${n}`;
      const below = (sn) => (X, Y, RW) => {
        const items = [], g = sn.g;
        if (!g.jblocks) return { items, h: 0 };
        const js = F().journalState(FL.disk(sn));
        items.push(FL.head('jp:h', X, Y + 14, `the journal on the disk: blocks ${g.jStart}–${g.jStart + g.jblocks - 1}`));
        const homes = (e) => { const t = '→ ' + e.homes.join(','); return FL.tw(t, 12) <= 56 ? t : e.homes.length + ' homes'; };
        const cells = [{ lines: ['j-super', 'done ' + js.done], cls: 'jb' }].concat(js.log.map((e) => (e.kind === 'TxB' ? { lines: ['begin ' + e.seq, homes(e)], cls: 'jb txb' } : e.kind === 'TxE' ? { lines: ['commit ' + e.seq, 'done'], cls: 'jb txe' } : e.kind === 'data' ? { lines: ['copy'], cls: 'jb logged' } : { lines: ['—'], cls: 'jb empty' })));
        const cw = 66, per = Math.max(1, Math.floor((RW + 4) / (cw + 4))), rowsN = Math.ceil(cells.length / per);
        cells.forEach((c, j) => items.push(FL.cell('jp:c' + j, X + (j % per) * (cw + 4), Y + 26 + Math.floor(j / per) * 50, cw, 44, c.lines, 'dk ' + c.cls, 12)));
        return { items, h: 30 + rowsN * 50 };
      };
      // each write as it lands
      const states = [];
      for (let j = 0; j <= k; j++) {
        const c = F().cloneLive(cap.before);
        const tx = F().prepareAs(c, { cred: cap.cred }, cap.op, cap.args);
        F().commit(c, tx, { mode: cap.mode, checkpoint: cap.checkpoint, defer: cap.deferred, crashAfter: j });
        const sn = Object.assign(FL.snap(c), { dev, at: base.at });
        // memory as it was before the commit, less what this commit has written home already
        const mem = new Map(base.mem);
        for (const w of ws.slice(0, j)) if (w.phase === 'checkpoint' || w.phase === 'home' || w.phase === 'data') mem.delete(w.block);
        sn.mem = mem;
        states.push(sn);
      }
      const ttl = (sn) => devTitle(sn, ' · on the disk');
      push({
        items: FL.diskPaint({ sn: states[0], devs: allDevs(states[0]), narrow, mapTitle: ttl(states[0]), nsNarrow: false, right: FL.writesPanel(cap, 0, null, -1, below(states[0])) }).items,
        title: 'the plan', marks: mark(rec.cmd.line), fsi: { devs: allDevs(states[0]), dev },
        say: `${rec.cmd.text}: ${engineSay} ${plan} The power will fail ${cutSay}.`,
        tables: [{ title: 'The blocks it changes', cols: ['block', 'what', 'change'], rows: ex.map((r) => [String(r.block), FL.KNAME[r.kind] || r.kind, r.detail]) }, { title: 'Its writes, in order', cols: ['#', 'block', 'kind', 'phase'], rows: ws.map((w, j) => [String(j + 1), String(w.block), w.kind, w.phase || 'home']) }],
        metrics: metricsOf(states[0], null),
      }, { kind: 'plan', say: plan });
      for (let j = 1; j <= Math.min(k, n); j++) {
        const w = ws[j - 1], sn = states[j];
        push({
          items: FL.diskPaint({ sn, devs: allDevs(sn), narrow, lit: new Set([w.block]), mapTitle: ttl(sn), nsNarrow: false, right: FL.writesPanel(cap, j, null, j - 1, below(sn)) }).items,
          title: 'write ' + j, marks: mark(rec.cmd.line), fsi: { devs: allDevs(sn), dev },
          say: `Write ${j} of ${n}, block \`${w.block}\`: ${w.say}`, metrics: metricsOf(sn, null),
        }, { kind: 'write', say: w.say, block: w.block });
      }
      // the cut
      const cutSn = rec.devsCut[dev];
      const lostN = (rec.lost || []).length;
      const lostSay = lostN ? ` \`${lostN}\` dirty block${lostN === 1 ? '' : 's'} in the cache never reach the disk${info.deferred ? ', this command\'s among them' : ''}.` : '';
      const memLost = base.mem.size && !info.deferred ? ` The ${FL.plural(base.mem.size, 'block')} that were newer in memory are lost too; only the journal on the disk still has them.` : '';
      const cutText = info.deferred ? 'The power fails while the blocks are still in the cache.' : k >= n ? `The power fails just after the last write, ${n}: the disk has every write, but memory is lost.` : `The power fails after write ${k} of ${n}: write${n - k === 1 ? ' ' + n + ' never happens' : 's ' + (k + 1) + '–' + n + ' never happen'}.`;
      push({
        items: FL.diskPaint({ sn: cutSn, devs: rec.devsCut, narrow, mapTitle: ttl(cutSn), nsNarrow: false, right: FL.writesPanel(cap, k, k, -1, below(cutSn)) }).items,
        title: 'power cut', marks: mark(rec.cmd.line), fsi: { devs: rec.devsCut, dev },
        say: cutText + lostSay + memLost + ' Only what is on the disk survives.', metrics: metricsOf(cutSn, null),
      }, { kind: 'crash', say: cutText });
      // recovery: replay, fsck, repair
      const recSn = rec.devsRec[dev], fsck = rec.fsck[dev], fixes = rec.repairs[dev], okAfter = rec.after[dev];
      const replayed = new Set((rec.recovery || []).filter((s) => s.kind === 'replay-copy').flatMap((s) => s.homes || []));
      const bad = new Set(fsck.problems.filter((p) => p.block !== undefined).map((p) => p.block));
      const sections = [];
      if (cap.mode !== 'none') sections.push({ title: 'mount: the journal is replayed', rows: (rec.recovery || []).map((s) => ({ text: s.say, cls: /discard|none/.test(s.kind) ? 'old' : 'new' })), max: 5 });
      sections.push({ title: 'fsck reads the whole disk', rows: fsck.ok ? [{ text: 'every check passes: the bitmaps, inodes, directories and link counts agree', cls: 'new' }] : fsck.problems.map((p) => ({ text: p.say, cls: 'stale' })), max: 5 });
      const recSay = cap.mode !== 'none' ? (rec.recovery || []).map((s) => s.say).join(' ') + ' ' : '';
      const look = judge(recSn, cap, rec);
      push({
        items: FL.diskPaint({ sn: recSn, devs: rec.devsRec, narrow, lit: replayed, bad, litText: 'replayed from the journal', mapTitle: ttl(recSn), right: FL.sayPanel(sections) }).items,
        title: cap.mode !== 'none' ? 'replay and fsck' : 'fsck', marks: mark(rec.cmd.line), fsi: { devs: rec.devsRec, dev },
        say: `${recSay}fsck ${fsck.ok ? 'finds the file system consistent.' : 'finds ' + FL.plural(fsck.problems.length, 'problem') + ': ' + fsck.problems.slice(0, 3).map((p) => p.say).join(' ')}${look ? ' ' + look : ''}`,
        tables: [{ title: 'fsck', cols: ['kind', 'what'], rows: fsck.problems.length ? fsck.problems.map((p) => [p.kind, p.say]) : [['–', 'consistent']] }, inodeTable(recSn, FL.names(rec.devsRec))], metrics: metricsOf(recSn, null),
      }, { kind: 'fsck', say: fsck.ok ? 'fsck: consistent' : 'fsck: ' + fsck.problems.length + ' problems' });
      if (!fsck.ok) {
        const sn = rec.devs[dev];
        push({
          items: FL.diskPaint({ sn, devs: rec.devs, narrow, mapTitle: ttl(sn), right: FL.sayPanel([{ title: 'the repair', rows: fixes.map((f) => ({ text: f, cls: 'new' })), max: 6 }, { title: 'fsck again', rows: [{ text: okAfter ? 'consistent' : 'problems remain', cls: okAfter ? 'new' : 'stale' }] }]) }).items,
          title: 'repair', marks: mark(rec.cmd.line), fsi: { devs: rec.devs, dev },
          say: `The repair: ${fixes.join('; ')}. fsck then finds ${okAfter ? 'the disk consistent' : 'problems still'}. What the interrupted command meant to do may be half there or gone: fsck makes the parts agree, it cannot finish the command.`,
          tables: [{ title: 'Repairs', cols: ['fix'], rows: fixes.map((f) => [f]) }, inodeTable(sn, FL.names(rec.devs))], metrics: metricsOf(sn, null),
        }, { kind: 'repair', say: fixes.join('; ') });
      }
    }
    /** what a cut write or append leaves the file reading: stale bytes that fsck cannot see, or the old or new data */
    function judge(sn, cap, rec) {
      if (!['write', 'append'].includes(cap.op)) return '';
      try {
        const img = FL.live(sn), path = FL.where(rec.devs, rec.cmd.args[0]).path, ino = F().lookup(img, path).ino;
        if (!ino) return '';
        const want = FL.dataOf(rec.cmd.args[rec.cmd.op === 'write' ? 2 : 1], rec.i * 7), size = F().readInode(img, ino).size;
        const at = rec.cmd.op === 'write' ? rec.cmd.args[1] : null;
        const got = F().text(F().read(img, ino, at === null ? Math.max(0, size - want.length) : at, want.length));
        if (got === want) return `The file reads the new bytes in full.`;
        if (/OLD BYTES/.test(got)) return `Yet the file reads old bytes of a deleted file where the new data should be: its metadata points at blocks whose data never arrived, which fsck cannot see.`;
        return `The file does not hold the new bytes: the ${rec.cmd.op} is lost or half done.`;
      } catch (e) { return ''; }
    }

    // ---- the walk to byte N
    if (v.walk) walkFrames(B.final);
    function walkFrames(devs) {
      const w0 = FL.where(devs, v.walkPath), sn = w0.d, img = FL.live(sn), g = sn.g;
      let ino = 0;
      try { ino = F().lookup(img, w0.path).ino; } catch (e) { ino = 0; }
      const names = FL.names(devs);
      if (!ino || F().readInode(img, ino).type !== F().T_FILE) {
        const say = `Byte ${FL.grp(v.walkN)} of ${v.walkPath}: ${ino ? 'that is not a regular file' : 'there is no such file at the end of the commands'}, so there is nothing to walk.`;
        push({ items: FL.diskPaint({ sn, devs, narrow, right: FL.sayPanel([{ title: 'the walk to byte ' + FL.grp(v.walkN), rows: [{ text: say, cls: 'stale' }] }]) }).items, title: 'walk', marks: [], fsi: { devs, dev: sn.dev || 0 }, say }, { kind: 'walk', say });
        return;
      }
      let W;
      try { W = F().walk(img, ino, v.walkN); } catch (e) {
        const say = `Byte ${FL.grp(v.walkN)}: ${e.message}. The largest file this geometry allows is ${FL.bytes(F().maxFileSize(g))}.`;
        push({ items: FL.diskPaint({ sn, devs, narrow, right: FL.sayPanel([{ title: 'the walk to byte ' + FL.grp(v.walkN), rows: [{ text: say, cls: 'stale' }] }]) }).items, title: 'walk', marks: [], fsi: { devs, dev: sn.dev || 0 }, say }, { kind: 'walk', say });
        return;
      }
      const st = W.steps, size = F().readInode(img, ino).size;
      const blkOf = (s) => (s.kind === 'inode' ? s.block : s.kind === 'index' ? s.block : s.kind === 'hop' ? s.from : s.kind === 'data' ? s.block : s.kind === 'extent' ? s.block : null);
      st.forEach((s, j) => {
        const seen = new Set(st.slice(0, j).map(blkOf).filter(Boolean)), cur = blkOf(s);
        const right = FL.walkPanel(g, W, j, ino, v, size);
        push({
          items: FL.diskPaint({ sn, devs, narrow, lit: cur ? new Set([cur]) : new Set(), seen, litText: 'read at this step', nsAct: new Set([(sn.dev || 0) + ':' + ino]), right }).items,
          title: 'byte N: ' + s.kind, marks: [], fsi: { devs, dev: sn.dev || 0, ino },
          say: (j === 0 ? `The walk to byte \`${FL.grp(v.walkN)}\` of ${v.walkPath} (inode ${ino}, ${FL.grp(size)} bytes; the largest file here is ${FL.bytes(F().maxFileSize(g))}). ` : '') + s.say + (j === st.length - 1 ? ` In all the walk read \`${W.reads.length}\` block${W.reads.length === 1 ? '' : 's'}.` : ''),
          tables: [{ title: 'The walk', cols: ['step', 'what'], rows: st.map((x, q) => [String(q + 1), x.say]), hl: j }].concat(g.alloc === 'indexed' ? [{ title: 'What each part of the inode reaches', cols: ['part', 'file blocks', 'bytes'], rows: F().reach(g).map((r) => [r.part, FL.grp(r.from) + '–' + FL.grp(r.from + r.blocks - 1), FL.bytes(r.bytes)]).concat([['largest file', '', FL.bytes(F().maxFileSize(g))]]) }] : []),
          metrics: [{ label: 'Blocks read by the walk', value: W.reads.length }, { label: 'File block', value: FL.grp(W.fb) }, { label: 'Offset in it', value: W.off }, { label: 'Largest file', value: FL.bytes(F().maxFileSize(g)) }],
        }, { kind: 'walk-' + s.kind, say: s.say });
        void names;
      });
    }
    const last = frames[frames.length - 1];
    return { frames, trace, tables: last ? last.tables : [], metrics: last ? last.metrics : [], bench: B };
  };
})(globalThis.Proses = globalThis.Proses || {});
