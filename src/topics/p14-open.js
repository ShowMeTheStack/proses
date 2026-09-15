// Part 14, open files: a script of system calls run on the file-system engine (S.FS.Sys), drawn after every call
// as the calls with the current one lit, the file's bytes with each open-file entry's offset pointing into them,
// and the three tables: descriptors, open-file entries and inodes. The same picture serves two topics: the tables
// with any script, and fork sharing an offset.
(function (S) {
  'use strict';
  const R = Math.round;
  const T = () => S.T12, U = () => S.T14;

  /** the key step of a call (open, read, write-fd, ...): the one whose sentence narrates it */
  const KEY = { open: 'open', read: 'read', write: 'write-fd', lseek: 'lseek', dup: 'dup', fork: 'fork', close: 'close', op: null, proc: 'proc' };
  function keyStep(c) {
    if (!c.steps.length) return null;
    const k = KEY[c.call];
    return (k && c.steps.find((s) => s.kind === k)) || c.steps[c.steps.length - 1];
  }

  /**
   * frames for a run of calls: o {calls, files: [path], label(pid), predict: bool, intro: say, introMeta}
   * Each frame's meta: {i, call, args, result, err, step, snap, text: {path: bytes}, offsets}
   */
  function callFrames(o) {
    const t = T(), u = U(), F = S.FS;
    const paths = o.files;
    // what each path holds and which inode it names, after every call
    const capture = (sys, img) => { const m = { text: {}, ino: {} }; for (const p of paths) { try { m.ino[p] = F.lookup(img, p).ino; m.text[p] = m.ino[p] ? F.text(F.read(img, p)) : null; } catch (e) { m.ino[p] = 0; m.text[p] = null; } } return m; };
    const run = u.runCalls(o.calls, { setup: o.setup, capture });
    const frames = new S.Frames(['calls', 'entries', 'reads', 'writes']);
    let cur = run.before;
    const inoOf = (p) => cur.ino[p] || 0;
    const names = (dev, ino) => { for (const p of paths) if (inoOf(p) === ino && !dev) return p.split('/').pop(); return ''; };
    const callLines = o.calls.map((c) => (c[0] === 'proc' ? '' : 'P' + c[1] + ': ' + u.callText(c)));
    const CW = 22, SX = Math.max(330, Math.round(Math.max(...callLines.map((l) => t.tw(l, 14, { mono: true, bold: true })))) + 34), BW = Math.max(300, 780 - SX);
    let reads = 0, writes = 0;
    // a frame of the state after call i (−1: before any call)
    const draw = (i, snap, text, act, hot) => {
      const items = [];
      // the calls
      items.push(t.title('ot:ct', 0, 14, 'the calls'));
      callLines.forEach((l, k) => { if (!l) return; items.push(t.text('ot:c' + k, 0, 44 + k * 24, l, 'calc mono' + (k === i ? ' act' : k > i ? ' muted' : ''), 14)); });
      const callsH = 44 + callLines.length * 24;
      // the file's bytes, one strip a path, with the entries' offsets
      let y = 60;
      paths.forEach((p, pi) => {
        const s = text[p], ino = inoOf(p);
        items.push(t.title('ot:ft' + pi, SX, y - 38 + 14, p + (s === null ? ' (no such file)' : ' · ' + s.length + ' bytes')));
        const n = Math.max(1, (s || '').length + 1), cw = Math.max(13, Math.min(CW, R(BW / n)));
        const offs = snap.files.filter((f) => f.ino === ino && f.dev === 0 && s !== null);
        // the pointer tags, stacked so none overlaps another
        const tags = [], levels = [];
        const groups = new Map();
        for (const f of offs) { const at = Math.min(f.offset, n - 1); if (!groups.has(at)) groups.set(at, []); groups.get(at).push(f.id); }
        [...groups.entries()].sort((a, b) => a[0] - b[0]).forEach(([at, ids]) => {
          const text2 = (ids.length > 1 ? 'entries ' : 'entry ') + ids.join(', '), w = Math.max(30, t.tw(text2, 13, { bold: true }) + 16), cx = SX + at * cw + cw / 2;
          let lv = 0; while (levels[lv] !== undefined && levels[lv] > cx - w / 2 - 6) lv++;
          levels[lv] = cx + w / 2;
          tags.push({ at, ids, text: text2, cx, lv });
        });
        const nl = Math.max(0, ...tags.map((g) => g.lv + 1));
        const sy = y + nl * 38;
        if (s !== null) {
          for (let k = 0; k < n; k++) {
            const ch = k < s.length ? (s[k] === ' ' ? '␣' : s[k]) : '';
            items.push({ key: 'ot:b' + pi + '.' + k, kind: 'cell', x: R(SX + k * cw), y: R(sy), w: cw, h: 30, rx: 0, text: ch, size: 14, cls: 'dk byte mono' + (k >= s.length ? ' ft-eof' : '') + (hot && hot.path === p && k >= hot.from && k < hot.to ? ' act' : '') });
          }
          for (let k = 0; k <= n - 1; k += n > 12 ? 5 : 1) items.push(t.text('ot:x' + pi + '.' + k, SX + k * cw + cw / 2, sy + 48, String(k), 'tick', 12, 'middle'));
          for (const g of tags) items.push({ key: 'ot:h' + pi + '.' + g.ids.join('-'), kind: 'head', x: R(g.cx), y: R(sy - 2 - g.lv * 38), text: g.text, side: 'above', cls: g.ids.includes(act.file) ? '' : 'ft-off' });
        }
        y = sy + 82;
      });
      const ty = Math.max(callsH, y - 20) + 16;
      const tb = S.Kit.fsTables.draw({ prefix: 'ot:t', x: 0, y: ty, snap, label: o.label, name: names, act, widths: [150, 214, 214] });
      items.push(...tb.items);
      return items;
    };
    frames.add({ items: draw(-1, { procs: [{ pid: 1, fds: [] }], files: [], inodes: [] }, cur.text, {}), title: 'before', say: o.intro, meta: Object.assign({ i: -1 }, o.introMeta || {}) });
    run.out.forEach((c, i) => {
      cur = c.extra;
      const st = keyStep(c), text = cur.text, snap = c.snap;
      const act = {};
      if (st) { if (st.pid !== undefined) act.pid = st.pid; if (st.fd !== undefined) act.fd = st.fd; if (st.file !== undefined) act.file = st.file; if (st.ino !== undefined) act.ino = st.ino; }
      if (c.call === 'fork') { act.pid = c.args[1]; }
      let hot = null, say;
      if (c.err) say = `${u.callText([c.call, ...c.args])} fails with ${c.err.code}: ${c.err.message}.`;
      else {
        say = st ? st.say : 'Done.';
        if (c.call === 'read') { reads++; say += c.result.length ? ' It gets “' + c.result + '”.' : ' It gets nothing: the offset is at the end of the file.'; const f = snap.files.find((x) => x.id === st.file); const p = paths.find((q) => inoOf(q) === (f && f.ino)); if (p) hot = { path: p, from: st.from, to: st.from + st.got }; }
        if (c.call === 'write') { writes++; const f = snap.files.find((x) => x.id === st.file); const p = paths.find((q) => inoOf(q) === (f && f.ino)); if (p) hot = { path: p, from: st.from, to: st.from + st.len }; }
      }
      frames.set('calls', i + 1).set('entries', snap.files.length).set('reads', reads).set('writes', writes);
      frames.add({ items: draw(i, snap, text, act, hot), title: c.call, say, meta: { i, call: c.call, args: c.args, lens: c.args.map((a) => (typeof a === 'string' ? a.length : a)), result: c.result, err: c.err, step: st, snap, sizes: Object.values(text).map((s) => (s === null ? 0 : s.length)), offsets: snap.files.map((f) => f.offset) } });
    });
    return frames.list;
  }
  S.T14.callFrames = callFrames;

  /** the offset the entry used by call i+1 will have after it: for predictions */
  const nextOffset = (fr, i) => {
    const m = fr[i + 1] && fr[i + 1].meta;
    if (!m || m.err || !m.step || !['read', 'write'].includes(m.call)) return null;
    const f = m.snap.files.find((x) => x.id === m.step.file);
    return f ? f.offset : null;
  };
  const offsetOptions = (fr, i) => { const a = nextOffset(fr, i), m = fr[i + 1].meta, f = fr[i].meta.snap ? fr[i].meta.snap.files.find((x) => x.id === m.step.file) : null, now = f ? f.offset : 0; return [...new Set([now, a, a + (m.call === 'read' ? m.args[2] : m.args[2].length), Math.max(0, a - 1)])].sort((x, y) => x - y).map(String); };

  const SETUP = (content) => (sys) => { sys.op(1, 'create', '/notes'); if (content) sys.op(1, 'write', '/notes', 0, content); };
  const DEF_SCRIPT = ['1 open /notes rw', '1 read 0 4', '1 open /notes r', '1 read 1 9', '1 dup 0', '1 write 2 XYZ', '1 lseek 0 0 set', '1 read 0 7', '1 close 0', '1 close 2'].join('\n');

  S.topic({
    id: 'fs-open-tables', family: 'p14-open', order: 10, title: 'Three tables: descriptors, open files and inodes',
    blurb: 'An open file is three things. The process holds a small number, its descriptor, an index into its own table. That points to an entry in the kernel’s open-file table, which keeps the offset and the access mode. The entry points to the in-memory inode, kept once however many times the file is open. Run calls and watch each table change.',
    inputs: [
      { id: 'content', kind: 'string', label: 'what /notes holds', def: 'the quick brown fox', min: 0, max: 24, spaces: true },
      { id: 'script', kind: 'program', label: 'calls (process, call, arguments)', def: DEF_SCRIPT, check: (v) => U().parseScript(v).error },
    ],
    presets: [
      { label: 'Two opens, a dup', values: { content: 'the quick brown fox', script: DEF_SCRIPT } },
      { label: 'Open, read to the end, close', values: { content: 'tea at four', script: ['1 open /notes r', '1 read 0 4', '1 read 0 4', '1 read 0 4', '1 read 0 4', '1 close 0'].join('\n') } },
      { label: 'Two opens: two offsets', values: { content: 'abcdefghij', script: ['1 open /notes rw', '1 open /notes rw', '1 write 0 XX', '1 write 1 YYY', '1 lseek 0 0 set', '1 read 0 10', '1 close 0', '1 close 1'].join('\n') } },
      { label: 'dup: one offset', values: { content: 'abcdefghij', script: ['1 open /notes rw', '1 dup 0', '1 write 0 XX', '1 write 1 YYY', '1 lseek 0 0 set', '1 read 1 10', '1 close 0', '1 close 1'].join('\n') } },
      { label: 'Append mode', values: { content: 'log:', script: ['1 open /notes a', '1 open /notes w', '1 write 1 ab', '1 write 0 cd', '1 write 1 ef', '1 close 0', '1 close 1'].join('\n') } },
      { label: 'Mistakes: EBADF', values: { content: 'read only', script: ['1 open /notes r', '1 write 0 oops', '1 close 0', '1 read 0 4'].join('\n') } },
      { label: 'Seek past the end', values: { content: 'ab', script: ['1 open /notes rw', '1 lseek 0 6 set', '1 write 0 Z', '1 lseek 0 0 set', '1 read 0 9', '1 close 0'].join('\n') } },
    ],
    counters: [{ id: 'calls', label: 'calls' }, { id: 'entries', label: 'open-file entries' }, { id: 'reads', label: 'reads' }, { id: 'writes', label: 'writes' }],
    run(inp) {
      const p = U().parseScript(inp.script);
      const frames = callFrames({ calls: p.calls, files: ['/notes'], setup: SETUP(inp.content), label: (pid) => 'process ' + pid, intro: `/notes holds ${S.T12.plural(inp.content.length, 'byte')} and nothing is open. Each call below changes one or more of the three tables; the tags above the bytes show where each open-file entry's offset points.`, introMeta: { len: inp.content.length } });
      return { frames, def: { sections: [{ id: 't', kind: 'math', title: 'The three tables', text: ['descriptor table: one a process, fd → entry', 'open-file table: offset, mode, refs', 'inode table: one a file in use, open count', 'open: new entry, lowest free fd', 'dup, fork: new fd, same entry (shared offset)', 'read, write: advance the entry’s offset', 'close: fd freed; entry freed at refs 0'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => nextOffset(fr, i) !== null, once: true, pick: 'option', ask: (fr, i) => `After the next call, ${U().callText([fr[i + 1].meta.call, ...fr[i + 1].meta.args])}, where will the offset of the entry it uses be?`, options: offsetOptions, answer: (fr, i) => String(nextOffset(fr, i)), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'A process opens the same file twice. How many open-file entries and how many in-memory inodes?', options: ['two entries, one inode', 'one entry, one inode', 'two entries, two inodes', 'one entry, two inodes'], answer: 0, why: 'Each open makes its own entry with its own offset; the inode is kept once, with an open count of 2.' },
      { q: 'Where is the file offset kept?', options: ['in the open-file entry', 'in the descriptor table', 'in the inode', 'in the directory entry'], answer: 0, why: 'That is why two descriptors made by dup share it, and two opens do not.' },
      { q: 'After fd2 = dup(fd1), a read through fd2…', options: ['moves the offset fd1 sees too', 'starts at offset 0', 'fails until fd1 is closed', 'reads a copy of the file'], answer: 0, why: 'Both descriptors point to one entry, so they share its offset.' },
      { q: 'open returns which descriptor?', options: ['the lowest one free in the process’s table', 'the inode number', 'one more than the last descriptor returned', 'a random free one'], answer: 0, why: 'The lowest free slot: which is why closing 1 and then opening a file redirects standard output.' },
      { q: 'When is the open-file entry freed?', options: ['when its last descriptor is closed', 'at the first close', 'when the file is unlinked', 'when the process that opened it exits, even if a child still uses it'], answer: 0, why: 'The entry counts its references: dup and fork add one each, close takes one away.' },
    ],
  });

  // =================================================================================================================
  const FORK_CASES = {
    before: (a, b) => [['open', 1, '/out', 'wct'], ['fork', 1, 2], ['write', 2, 0, b], ['write', 1, 0, a], ['write', 2, 0, b], ['close', 2, 0], ['close', 1, 0]],
    after: (a, b) => [['fork', 1, 2], ['open', 1, '/out', 'wc'], ['open', 2, '/out', 'w'], ['write', 2, 0, b], ['write', 1, 0, a], ['write', 2, 0, b], ['close', 2, 0], ['close', 1, 0]],
    append: (a, b) => [['fork', 1, 2], ['open', 1, '/out', 'ac'], ['open', 2, '/out', 'a'], ['write', 2, 0, b], ['write', 1, 0, a], ['write', 2, 0, b], ['close', 2, 0], ['close', 1, 0]],
  };
  S.topic({
    id: 'fs-fork-offset', family: 'p14-open', order: 20, title: 'fork shares the offset',
    blurb: 'A child made by fork gets a copy of its parent’s descriptor table, and every copied descriptor points to the same open-file entry, so parent and child share one offset: their writes follow one another. Open the file after the fork instead and each has its own entry and offset, and they write over each other, unless both open it for appending.',
    inputs: [
      { id: 'when', kind: 'choice', label: 'the file is opened', def: 'before', options: [{ value: 'before', label: 'before fork (shared entry)' }, { value: 'after', label: 'after fork, by each (two entries)' }, { value: 'append', label: 'after fork, for appending' }] },
      { id: 'parent', kind: 'string', label: 'the parent writes', def: 'PARENT', min: 1, max: 8 },
      { id: 'child', kind: 'string', label: 'the child writes', def: 'kid', min: 1, max: 8 },
    ],
    presets: [
      { label: 'Opened before fork', values: { when: 'before', parent: 'PARENT', child: 'kid' } },
      { label: 'Opened after fork: overwritten', values: { when: 'after', parent: 'PARENT', child: 'kid' } },
      { label: 'Opened after fork, appending', values: { when: 'append', parent: 'PARENT', child: 'kid' } },
      { label: 'Equal lengths, after fork', values: { when: 'after', parent: 'AAAA', child: 'bbbb' } },
    ],
    counters: [{ id: 'calls', label: 'calls' }, { id: 'entries', label: 'open-file entries' }, { id: 'writes', label: 'writes' }],
    run(inp) {
      const calls = FORK_CASES[inp.when](inp.parent, inp.child);
      const frames = callFrames({ calls, files: ['/out'], label: (pid) => (pid === 1 ? 'parent (1)' : 'child (2)'), intro: inp.when === 'before' ? 'The parent opens /out, then forks. Both write through descriptor 0. Will the child’s words and the parent’s follow one another, or land on top of each other?' : inp.when === 'after' ? 'The parent forks first; then parent and child each open /out themselves and write through their own descriptor 0.' : 'The parent forks first; then each opens /out for appending (O_APPEND) and writes.', introMeta: {} });
      return { frames, def: { sections: [{ id: 't', kind: 'math', title: 'Who shares what', text: ['open, then fork: one entry, one offset, refs 2', 'fork, then open twice: two entries, two offsets', 'O_APPEND: each write moves to the end first', 'the inode is always shared: one file'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.call === 'write' && f.meta.args[0] === 2 && f.meta.i === f.meta.i, once: true, pick: 'option', ask: (fr, i) => { const m = fr[i + 1].meta; return m.call === 'write' ? `The next write is the ${m.args[0] === 1 ? 'parent' : 'child'}’s. At which offset will it land?` : 'What happens next?'; }, options: (fr, i) => { const m = fr[i + 1].meta, now = fr[i].meta.snap.files.find((x) => x.id === m.step.file); return [...new Set([0, m.step.from, now ? now.offset : 0, fr[i].meta.sizes[0]])].sort((a, b) => a - b).map(String); }, answer: (fr, i) => { const m = fr[i + 1].meta; return m.call === 'write' && m.step ? String(m.step.from) : null; }, explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'A file is opened, then the process forks, and both write 5 bytes. The file then holds…', options: ['10 bytes: one write after the other', '5 bytes: the second overwrites the first', 'two separate copies', 'it depends on the inode'], answer: 0, why: 'One open-file entry, one offset: each write starts where the last one ended.' },
      { q: 'Parent and child each open the same file after fork and write 5 bytes. The file holds…', options: ['5 bytes: both wrote at offset 0', '10 bytes', 'nothing', 'two files'], answer: 0, why: 'Two entries, each starting at offset 0: the second write lands on the first.' },
      { q: 'What does O_APPEND change?', options: ['before each write the offset moves to the end of the file', 'the file can only be read', 'the offset is shared between processes', 'writes go to a new file'], answer: 0, why: 'So writers with separate entries never overwrite each other.' },
      { q: 'After fork, the open-file entry’s reference count is…', options: ['one more for every descriptor the child got', 'unchanged', 'reset to 1', 'doubled only if the file is a pipe'], answer: 0, why: 'Each copied descriptor is one more reference; the entry lives until all are closed.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
