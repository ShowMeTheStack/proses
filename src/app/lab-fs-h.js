// The File-system lab, part eight: the log-structured workbench (S.FS.lfs on a real image). Commands buffer changes
// in memory; sync writes them as a partial segment (a summary, then data, inodes and inode-map pieces) and a new
// checkpoint. The disk is drawn as rows of segments, every block named and marked live or dead; beside it the inode
// map and the numbers of the cleaner: segments cleaned, blocks copied, and the write cost. A crash forgets memory;
// mount reads the newest checkpoint and rolls forward through whole partial segments.
//   FL.parseLfs(text) -> {cmds, error}     FL.lfsRun(v, ctx)
(function (S) {
  'use strict';
  const FL = S.FsLab, L = () => S.FS.lfs;
  const ARGS = { create: 1, write: 3, append: 2, delete: 1, read: 1, sync: 0, clean: 0, churn: 1, crash: 0, mount: 0 };
  FL.parseLfs = function (text) {
    const cmds = [], src = String(text || '').split('\n');
    const bad = (line, msg) => ({ cmds, error: { line, col: 1, msg, hint: 'create NAME · write NAME OFFSET TEXT · append NAME TEXT · delete NAME · read NAME · sync · clean [N] · churn N (N seeded overwrites, then sync) · crash (then mount, rolling forward) · mount' } });
    for (let i = 0; i < src.length; i++) {
      const t = src[i].replace(/#.*$/, '').trim();
      if (!t) continue;
      const line = i + 1, w = t.split(/\s+/), op = w[0];
      if (ARGS[op] === undefined) return bad(line, `unknown command "${op}"`);
      if (w.length - 1 < ARGS[op]) return bad(line, `${op} needs ${ARGS[op]} argument${ARGS[op] === 1 ? '' : 's'}`);
      let args;
      if (op === 'write') { if (!/^\d+$/.test(w[2])) return bad(line, 'write NAME OFFSET TEXT'); args = [w[1], +w[2], t.replace(/^\S+\s+\S+\s+\S+\s/, '')]; }
      else if (op === 'append') args = [w[1], t.replace(/^\S+\s+\S+\s/, '')];
      else if (op === 'clean') { if (w[1] && !/^\d+$/.test(w[1])) return bad(line, 'clean [N]: how many segments'); args = [w[1] ? Math.max(1, Math.min(8, +w[1])) : 1]; }
      else if (op === 'churn') { if (!/^\d+$/.test(w[1]) || +w[1] < 1 || +w[1] > 200) return bad(line, 'churn N: 1 to 200 overwrites'); args = [+w[1]]; }
      else args = w.slice(1, 1 + ARGS[op]);
      if (['create', 'write', 'append', 'delete', 'read'].includes(op) && !/^[A-Za-z0-9._-]{1,27}$/.test(args[0])) return bad(line, 'a name is 1 to 27 letters, digits, dots, dashes or underscores (one flat directory)');
      const sz = (op === 'write' || op === 'append') && /^\[\s*(\d+)\s*(bytes?|b)?\s*\]$/i.exec(args[args.length - 1].trim());
      if (sz) { if (+sz[1] > 2000) return bad(line, 'at most 2000 bytes at once here'); args[args.length - 1] = FL.filler(+sz[1], i * 5); }
      cmds.push({ line, text: t.replace(/\s+/g, ' '), op, args });
    }
    if (!cmds.length) return bad(1, 'type at least one command');
    if (cmds.length > 20) return bad(cmds[20].line, 'at most 20 commands');
    return { cmds, error: null };
  };

  FL.lfsRun = function (v, ctx) {
    const narrow = ctx.narrow, P = FL.parseLfs(FL.fromRows(v.lcmds, 'cmd'));
    if (P.error) return { error: P.error, frames: [] };
    let fs;
    try { fs = L().mkfs({ bs: v.lbs, segBlocks: v.lseg, nsegs: v.lnsegs, ninodes: v.lninodes, policy: v.lpolicy, autoClean: v.lauto }); } catch (e) { return { frames: [], error: { msg: e.message } }; }
    const H = S.P15 && S.P15.lfs;
    if (!H) return { frames: [], error: { msg: 'the log drawing is not loaded' } };
    const frames = [], trace = [], g = fs.g;
    const rnd = FL.rng ? FL.rng(ctx.seed || 1) : Math.random;
    const compact = narrow || g.segBlocks > 9;
    const cw = narrow ? Math.max(30, Math.floor((376 - 80 - 64) / g.segBlocks) - 4) : compact ? Math.max(30, Math.floor((640 - 170) / g.segBlocks) - 4) : 52;
    const ch = narrow ? 24 : compact ? 26 : 32;
    const paint = (lit, picked, right) => {
      const d = H.draw(fs, { prefix: 'lf:d', compact, cw, ch, lit, picked, usage: !narrow, title: `the log: ${g.nsegs} segments of ${g.segBlocks} blocks, ${g.bs} bytes each` });
      const items = d.items.slice();
      items.push(...H.legend('lf:lg', 0, d.h + 12, Math.min(d.w, narrow ? 376 : 640), compact));
      const X = narrow ? 0 : Math.max(d.w + 20, 660), Y = narrow ? d.h + 12 + 80 : 0, RW = narrow ? 376 : 1000 - X;
      if (right) items.push(...right(X, Y, RW).items);
      return items;
    };
    const facts = () => {
      const st = L().stats(fs), use = L().usage(fs);
      return { st, use, clean: use.filter((x) => x.state === 'free').length };
    };
    const side = (extra) => (X, Y, RW) => {
      const items = [], f = facts();
      items.push(FL.head('lf:mh', X, Y + 14, 'the inode map'));
      const live = []; for (let i = 1; i < g.ninodes; i++) if (fs.imap[i]) live.push(i);
      const per = Math.max(1, Math.floor((RW + 4) / 74));
      live.slice(0, per * (RW < 400 ? 2 : 3)).forEach((ino, k) => items.push(FL.cell('lf:im' + ino, X + (k % per) * 74, Y + 26 + Math.floor(k / per) * 30, 70, 26, `${ino} → ${fs.imap[ino]}`, 'dk lfs-inode', 12)));
      let y = Y + 26 + Math.max(1, Math.ceil(Math.min(live.length, per * (RW < 400 ? 2 : 3)) / per)) * 30 + 14;
      const rows = [
        ['new data blocks', f.st.newBlocks], ['blocks written in all', f.st.written], ['cleaner read', f.st.cleanerReads], ['cleaner wrote', f.st.cleanerWrites],
        ['write cost', f.st.newBlocks ? f.st.writeCost : '–'], ['clean segments', f.clean + ' of ' + g.nsegs], ['changes in memory', fs.pending.length + fs.dirtyInodes.size ? 'yes' : 'none'],
      ];
      items.push(FL.head('lf:sh', X, y + 4, 'the cost'));
      if (RW < 400) rows.splice(0, rows.length, ['write cost', f.st.newBlocks ? f.st.writeCost : '–'], ['cleaner read, wrote', f.st.cleanerReads + ', ' + f.st.cleanerWrites], ['clean segments', f.clean + ' of ' + g.nsegs]);
      rows.forEach((r, k) => { items.push(FL.text('lf:sk' + k, X, y + 30 + k * 22, r[0], 'tick', 13)); items.push(FL.text('lf:sv' + k, X + Math.min(220, RW - 60), y + 30 + k * 22, String(r[1]), 'mono strong', 13)); });
      y += 30 + rows.length * 22;
      if (extra) { const e = extra(X, y + 6, RW); items.push(...e.items); y += 6 + e.h; }
      return { items, h: y - Y };
    };
    const tablesOf = () => {
      const f = facts();
      let files = [];
      try { files = L().list(fs).map((e) => [e.name, String(e.ino), String(e.size), String(fs.imap[e.ino] || 'memory')]); } catch (e) { files = []; }
      return [{ title: 'Segments', cols: ['segment', 'state', 'live blocks', 'u', 'age'], rows: f.use.map((x) => [String(x.seg), x.state, x.live + ' of ' + g.segBlocks, x.u.toFixed(2), String(x.age)]) }, { title: 'Files', cols: ['name', 'inode', 'size', 'inode at'], rows: files }];
    };
    const metricsOf = () => { const f = facts(); return [{ label: 'Write cost', value: f.st.newBlocks ? f.st.writeCost : '–', note: '(written + cleaner reads) ÷ new data' }, { label: 'Clean segments', value: f.clean + ' of ' + g.nsegs, cls: f.clean < 3 ? 'bad' : '' }, { label: 'Cleaner: read, wrote', value: f.st.cleanerReads + ', ' + f.st.cleanerWrites }, { label: 'Blocks written', value: f.st.written }, { label: 'New data blocks', value: f.st.newBlocks }]; };
    const snapBytes = () => fs.img.bytes.slice();
    const changed = (before) => { const s = new Set(); for (let b = 0; b < g.nblocks; b++) { const o = b * g.bs; for (let i = o; i < o + g.bs; i++) if (before[i] !== fs.img.bytes[i]) { s.add(b); break; } } return s; };
    const push = (f, step) => { trace.push(step); frames.push(Object.assign({ at: trace.length - 1 }, f)); };
    push({ items: paint(new Set([0, 1]), new Set(), side()), title: 'mkfs', marks: [], say: `A fresh log-structured disk: two checkpoint regions, then ${g.nsegs} segments of ${g.segBlocks} blocks. mkfs wrote the empty root directory, its inode and the inode map as the first partial segment, and a checkpoint naming them.`, tables: tablesOf(), metrics: metricsOf() }, { kind: 'mkfs', say: 'mkfs' });
    P.cmds.forEach((c) => {
      const before = snapBytes(), mark = [{ line: c.line, tag: '▶', cls: 'p0', act: true }];
      let steps = [], err = null, picked = new Set(), extraSay = '';
      try {
        switch (c.op) {
          case 'create': steps = L().create(fs, c.args[0]).steps; break;
          case 'write': steps = L().write(fs, c.args[0], c.args[1], c.args[2]).steps; break;
          case 'append': steps = L().append(fs, c.args[0], c.args[1]).steps; break;
          case 'delete': steps = L().delete(fs, c.args[0]).steps; break;
          case 'read': { const t = L().read(fs, c.args[0]); extraSay = ` It reads ${t.length} bytes: "${FL.clip(t, 40)}".`; steps = [{ kind: 'read', say: `Read ${c.args[0]}: the inode map says where its inode is, the inode where its blocks are.` }]; break; }
          case 'sync': steps = L().sync(fs).steps; break;
          case 'clean': { const r = L().clean(fs, { policy: v.lpolicy, count: c.args[0] }); steps = r.steps; picked = new Set(r.cleaned); break; }
          case 'churn': {
            const names = L().list(fs).filter((e) => e.size > 0).map((e) => e.name);
            if (!names.length) throw Object.assign(new Error('churn needs files with data to overwrite'), { code: 'ENOENT' });
            const hot = names.slice(0, Math.max(1, Math.ceil(names.length / 5)));
            for (let k = 0; k < c.args[0]; k++) {
              const nm = v.lskew === 'hot' && rnd() < 0.8 ? hot[Math.floor(rnd() * hot.length)] : names[Math.floor(rnd() * names.length)];
              L().write(fs, nm, 0, 'v' + k + ' ');
              if (k % 6 === 5) L().sync(fs);
            }
            steps = L().sync(fs).steps;
            steps.unshift({ kind: 'churn', say: `${c.args[0]} overwrites of the first bytes of ${v.lskew === 'hot' ? 'mostly the hottest fifth of the files' : 'files picked at random'} (from the seed), synced every six.` });
            break;
          }
          case 'crash': {
            const bare = L().mount({ g: fs.img.g, bytes: fs.img.bytes.slice() }, { rollForward: false });
            const files = (f) => L().list(f).map((e) => e.name + ' (' + e.size + ' B)').join(', ') || 'no files';
            fs = L().mount(fs.img, { rollForward: true });
            steps = [{ kind: 'crash', say: `The power fails: memory is lost, the buffer and the inode map in it. From the newest checkpoint alone the disk holds ${files(bare)}.` }].concat(fs.mountSteps, [{ kind: 'after', say: `After roll-forward: ${files(fs)}.` }]);
            break;
          }
          case 'mount': fs = L().mount(fs.img, { rollForward: true }); steps = fs.mountSteps; break;
        }
      } catch (e) { err = e; }
      const lit = changed(before);
      // the buffer steps are many and alike: one sentence for all of them
      const nBuf = steps.filter((s) => s.kind === 'buffer').length;
      const sayOf = steps.filter((s) => s.kind !== 'buffer' && s.kind !== 'dir').map((s) => s.say).filter(Boolean);
      if (nBuf) sayOf.splice(Math.min(1, sayOf.length), 0, `${FL.plural(nBuf, 'block')} ${nBuf === 1 ? 'goes' : 'go'} into the segment buffer in memory.`);
      const say = err ? `${c.text}: ${err.code || 'error'}, ${err.message}.` : `${c.text}: ${sayOf.slice(0, 6).join(' ')}${sayOf.length > 6 ? ' …' : ''}${extraSay}${lit.size ? ' ' + FL.plural(lit.size, 'block') + ' on the disk changed.' : ' Nothing on the disk changed yet.'}`;
      const list = sayOf.slice(-4).map((t) => ({ text: t, cls: 'old' }));
      push({ items: paint(lit, picked, side(FL.sayPanel([{ title: c.text, rows: err ? [{ text: err.message, cls: 'stale' }] : list.length ? list : [{ text: 'done', cls: 'old' }], max: narrow ? 2 : 3 }]))), title: c.op, marks: mark, say, tables: tablesOf(), metrics: metricsOf() }, { kind: err ? 'error' : c.op, say });
    });
    const last = frames[frames.length - 1];
    return { frames, trace, tables: last.tables, metrics: last.metrics };
  };
  /** a small seeded generator: the same seed gives the same numbers */
  FL.rng = function (seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };
})(globalThis.Proses = globalThis.Proses || {});
