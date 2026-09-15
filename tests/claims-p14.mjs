// Part 14, the file-system interface: every preset and random inputs of each topic; every number in the narration
// must be in the frame's values (tests/claims-lib-p12.mjs), and those values are worked out again here apart from
// the topics and the engines: offsets and file contents by a small model of descriptors and open-file entries,
// the namespace and its link counts by a dictionary of names, path lookups by walking a hand-built tree, the
// shuffled order of direct access by the same generator written out again, and permission checks by the rule.
// Usage: node tests/claims-p14.mjs [topic id ...]
import { setup, pick, int, wording, numbersIn, leaves, matches, near } from './claims-lib-p12.mjs';

const { S, t, rnd } = setup('claims-p14');
const only = process.argv.slice(2);
const word = (r, n) => [...Array(n)].map(() => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(r() * 26)]).join('');

// ---- a model of descriptors, open-file entries and files (bytes as strings) ----
function model(files) {
  const fs = Object.assign({}, files), procs = { 1: [] }, entries = [];
  let next = 1;
  const ent = (pid, fd) => procs[pid] && procs[pid][fd];
  return {
    fs, procs, entries,
    run(c) {
      const [name, pid, ...a] = c;
      switch (name) {
        case 'open': {
          const [path, fl] = a;
          if (fs[path] === undefined) { if (!/c/.test(fl)) return { err: 'ENOENT' }; fs[path] = ''; }
          if (/t/.test(fl) && /[wa]/.test(fl)) fs[path] = '';
          const e = { id: next++, path, off: 0, r: /r/.test(fl), w: /[wa]/.test(fl), a: /a/.test(fl), refs: 1 };
          entries.push(e);
          let fd = 0; while (procs[pid][fd]) fd++;
          procs[pid][fd] = e;
          return { v: fd };
        }
        case 'read': { const e = ent(pid, a[0]); if (!e || !e.r) return { err: 'EBADF' }; const s = fs[e.path].slice(e.off, e.off + a[1]); e.off += s.length; return { v: s }; }
        case 'write': {
          const e = ent(pid, a[0]); if (!e || !e.w) return { err: 'EBADF' };
          if (e.a) e.off = fs[e.path].length;
          let s = fs[e.path]; if (e.off > s.length) s += '\0'.repeat(e.off - s.length);
          fs[e.path] = s.slice(0, e.off) + a[1] + s.slice(e.off + a[1].length); e.off += a[1].length; return { v: a[1].length };
        }
        case 'lseek': { const e = ent(pid, a[0]); if (!e) return { err: 'EBADF' }; e.off = a[2] === 'end' ? fs[e.path].length + a[1] : a[2] === 'cur' ? e.off + a[1] : a[1]; return { v: e.off }; }
        case 'dup': { const e = ent(pid, a[0]); if (!e) return { err: 'EBADF' }; let fd = 0; while (procs[pid][fd]) fd++; procs[pid][fd] = e; e.refs++; return { v: fd }; }
        case 'fork': { procs[a[0]] = procs[pid].slice(); for (const e of procs[a[0]]) if (e) e.refs++; return { v: a[0] }; }
        case 'close': { const e = ent(pid, a[0]); if (!e) return { err: 'EBADF' }; procs[pid][a[0]] = undefined; e.refs--; if (!e.refs) entries.splice(entries.indexOf(e), 1); return { v: 0 }; }
        default: return { v: null };
      }
    },
  };
}
/** run a script through the model and compare with the topic's frames (offsets, results, the file's bytes) */
function checkCalls(calls, files, r, fail, pass) {
  const m = model(files);
  const frames = r.frames.filter((f) => f.meta.i >= 0);
  calls.forEach((c, i) => {
    const want = m.run(c), f = frames[i], meta = f.meta;
    if (want.err) { (meta.err && meta.err.code === want.err ? pass : fail)('call ' + i + ' should fail with ' + want.err + ', got ' + JSON.stringify(meta.err)); return; }
    if (meta.err) { fail('call ' + i + ' failed: ' + meta.err.code); return; }
    if (c[0] === 'read') (meta.result === want.v ? pass : fail)('read ' + i + ' got ' + JSON.stringify(meta.result) + ', by the model ' + JSON.stringify(want.v));
    if (c[0] === 'open' || c[0] === 'dup') (meta.result === want.v ? pass : fail)('descriptor ' + meta.result + ', by the model ' + want.v);
    const offs = meta.snap.files.map((x) => x.offset).sort((a, b) => a - b), mo = m.entries.map((e) => e.off).sort((a, b) => a - b);
    (JSON.stringify(offs) === JSON.stringify(mo) ? pass : fail)('offsets after call ' + i + ': ' + offs + ', by the model ' + mo);
    const refs = meta.snap.files.map((x) => x.refs).sort(), mr = m.entries.map((e) => e.refs).sort();
    (JSON.stringify(refs) === JSON.stringify(mr) ? pass : fail)('refs after call ' + i);
    const size = (Object.values(m.fs)[0] || '').length;
    (meta.sizes[0] === size ? pass : fail)('size after call ' + i + ': ' + meta.sizes[0] + ', by the model ' + size);
  });
}

const mods = {
  'fs-open-tables': {
    random(r) {
      const content = word(r, int(r, 0, 16)), lines = ['1 open /notes ' + pick(r, ['r', 'rw', 'w', 'a'])], n = int(r, 3, 9);
      let fds = 1;
      for (let k = 0; k < n; k++) {
        const fd = int(r, 0, fds), op = pick(r, ['read', 'write', 'lseek', 'dup', 'open', 'close', 'read']);
        if (op === 'read') lines.push(`1 read ${fd} ${int(r, 1, 6)}`);
        else if (op === 'write') lines.push(`1 write ${fd} ${word(r, int(r, 1, 4))}`);
        else if (op === 'lseek') lines.push(`1 lseek ${fd} ${int(r, 0, 8)} ${pick(r, ['set', 'cur', 'end'])}`);
        else if (op === 'dup') { lines.push(`1 dup ${fd}`); fds++; }
        else if (op === 'open') { lines.push('1 open /notes ' + pick(r, ['r', 'rw', 'w', 'a'])); fds++; }
        else lines.push(`1 close ${fd}`);
      }
      return { content, script: lines.join('\n') };
    },
    check({ input, r, fail, pass }) { checkCalls(S.T14.parseScript(input.script).calls, { '/notes': input.content }, r, fail, pass); },
  },
  'fs-fork-offset': {
    random: (r) => ({ when: pick(r, ['before', 'after', 'append']), parent: word(r, int(r, 1, 8)).toUpperCase(), child: word(r, int(r, 1, 8)) }),
    check({ input, r, fail, pass }) {
      const a = input.parent, b = input.child, L = r.frames[r.frames.length - 1].meta;
      // by hand: the three writes child, parent, child
      let want;
      if (input.when === 'after') { const s1 = b; let s = a + s1.slice(a.length); s = s.slice(0, b.length) + s.slice(b.length); want = (() => { let x = ''; const put = (off, w) => { if (off > x.length) x += '\0'.repeat(off - x.length); x = x.slice(0, off) + w + x.slice(off + w.length); }; put(0, b); put(0, a); put(b.length, b); return x; })(); void s; }
      else want = b + a + b;
      (L.sizes[0] === want.length ? pass : fail)('final size ' + L.sizes[0] + ', by hand ' + want.length);
      const calls = { before: [['open', 1, '/out', 'wct'], ['fork', 1, 2], ['write', 2, 0, b], ['write', 1, 0, a], ['write', 2, 0, b], ['close', 2, 0], ['close', 1, 0]], after: [['fork', 1, 2], ['open', 1, '/out', 'wc'], ['open', 2, '/out', 'w'], ['write', 2, 0, b], ['write', 1, 0, a], ['write', 2, 0, b], ['close', 2, 0], ['close', 1, 0]], append: [['fork', 1, 2], ['open', 1, '/out', 'ac'], ['open', 2, '/out', 'a'], ['write', 2, 0, b], ['write', 1, 0, a], ['write', 2, 0, b], ['close', 2, 0], ['close', 1, 0]] }[input.when];
      checkCalls(calls, { '/out': undefined }, r, fail, pass);
    },
  },
  'fs-fork-c': {
    nRandom: 0,
    check({ input, r, fail, pass }) {
      const L = r.frames[r.frames.length - 1].meta;
      if (!L.final) { fail('the program did not finish'); return; }
      const src = input.src, want = /O_APPEND/.test(src) ? 'child parent' : /dup\(a\)/.test(src) ? '3ne two ' : /if \(fork\(\) == 0\) \{\n\s+int fd = open/.test(src) ? 'parent' : 'child parent';
      const ino = L.final.dir.log, got = r.frames[r.frames.length - 2].meta.files.inodes[ino];
      (got && got.data === want ? pass : fail)('log holds ' + JSON.stringify(got && got.data) + ', by hand ' + JSON.stringify(want));
      // open before fork: the child's write moves the one shared offset
      for (const f of r.frames) if (f.meta.table) for (const e of f.meta.table.files) (e.refs >= 1 ? pass : fail)('an entry with no references is drawn');
    },
  },
  'fs-unlink-open': {
    nRandom: 0,
    check({ input, r, fail, pass }) {
      let unlinked = false;
      for (const f of r.frames) {
        const m = f.meta;
        if (m.phase === 'unlink') unlinked = true;
        if (!m.table) continue;
        for (const n of m.table.inodes) {
          const named = Object.values(m.files.dir).includes(n.ino);
          (n.nlink === (named ? 1 : 0) && n.orphan === !named ? pass : fail)('inode ' + n.ino + ' links ' + n.nlink + ' named ' + named);
          if (unlinked && !named) (n.refs > 0 ? pass : fail)('an orphan must still be open');
        }
        // a file with no name and nothing open must be gone from the kernel's files
        for (const nd of Object.values(m.files.inodes)) {
          const named = Object.values(m.files.dir).includes(nd.ino), open = m.table.files.some((x) => x.ino === nd.ino);
          (named || open ? pass : fail)('inode ' + nd.ino + ' kept with no name and no open file');
        }
      }
      if (/read back/.test(input.src)) (r.frames.some((f) => /read back: temporary/.test(f.say)) || r.frames.some((f) => f.meta.nterm) ? pass : fail)('read back after unlink');
    },
  },
  'fs-dir-structures': {
    random: (r) => { const n = int(r, 1, 3), m = int(r, 1, 3), us = ['ann', 'bob', 'cy', 'dee', 'eve'].slice(0, 5).sort(() => r() - 0.5).slice(0, n), fs = ['plan', 'notes', 'data', 'log', 'todo'].sort(() => r() - 0.5).slice(0, m); return { kind: pick(r, ['single', 'two', 'tree', 'acyclic']), users: us, files: fs }; },
    check({ input, r, fail, pass }) {
      const U = input.users.length, M = input.files.length, L = r.frames[r.frames.length - 1].meta;
      const want = { single: [M, U * M - M], two: [U + U * M, 0], tree: [2 * U + U * M, 0], acyclic: [2 * U + U * M + (U > 1 ? 1 : 0), U > 1 ? 1 : 0] }[input.kind];
      (L.names === want[0] && L.refused === want[1] ? pass : fail)(`names ${L.names}, refused ${L.refused}; by hand ${want}`);
    },
  },
  'fs-path-lookup': {
    random: (r) => ({ path: pick(r, ['/', '']) + [...Array(int(r, 1, 4))].map(() => pick(r, ['home', 'ann', 'bob', 'srv', 'notes', 'game', 'index', '.', '..', 'nope'])).join('/'), cwd: pick(r, ['/', '/home', '/home/ann', '/home/bob', '/srv']) }),
    check({ input, r, fail, pass }) {
      // the tree by hand; bob/ann is a symbolic link to /home/ann/notes
      const tree = { '': { home: { ann: { notes: 'f' }, bob: { game: 'f', ann: '@/home/ann/notes' } }, srv: { index: 'f' } } };
      const parts = (p) => p.split('/').filter(Boolean);
      let stack = input.path.startsWith('/') ? [] : parts(input.cwd), comps = parts(input.path), reads = 0, ok = true;
      const nodeAt = (st) => { let n = tree['']; for (const c of st) n = n[c]; return n; };
      let guard = 0;
      while (comps.length && guard++ < 50) {
        const c = comps.shift(), dir = nodeAt(stack);
        if (typeof dir !== 'object') { ok = false; break; }
        reads++;
        if (c === '.') continue;
        if (c === '..') { stack.pop(); continue; }
        const nx = dir[c];
        if (nx === undefined) { ok = false; break; }
        if (typeof nx === 'string' && nx.startsWith('@')) { stack = []; comps = parts(nx.slice(1)).concat(comps); continue; }
        stack.push(c);
      }
      const L = r.frames[r.frames.length - 1].meta;
      (L.dirs === reads ? pass : fail)('directories read ' + L.dirs + ', by hand ' + reads);
      if (ok) { const want = S.FS.lookup(S.T14.nsRun([], { setup: [['mkdir', '/home'], ['mkdir', '/home/ann'], ['mkdir', '/home/bob'], ['mkdir', '/srv'], ['create', '/home/ann/notes'], ['write', '/home/ann/notes', 0, 'buy milk'], ['create', '/home/bob/game'], ['create', '/srv/index'], ['symlink', '/home/ann/notes', '/home/bob/ann']] }).img, '/' + stack.join('/')).ino; (L.ino === want ? pass : fail)('found inode ' + L.ino + ', by hand the path /' + stack.join('/') + ' = ' + want); }
      else (!L.ino ? pass : fail)('should not be found');
    },
  },
};

// ---- the namespace by a dictionary: names -> inode ids with link counts ----
function nsModel(ops) {
  const names = new Map([['/', { id: 'root', type: 'directory' }]]), nl = new Map([['root', 2]]), data = new Map();
  let k = 0;
  const parent = (p) => p.slice(0, p.lastIndexOf('/')) || '/';
  const resolve = (p, depth = 0) => {
    if (depth > 8) return { err: 'ELOOP' };
    const cs = p.split('/').filter(Boolean); let cur = '/';
    for (let i = 0; i < cs.length; i++) {
      const nx = (cur === '/' ? '' : cur) + '/' + cs[i], e = names.get(nx);
      if (!e) return { err: 'ENOENT' };
      if (e.type === 'symlink') { const r = resolve(e.target + (i < cs.length - 1 ? '/' + cs.slice(i + 1).join('/') : ''), depth + 1); return r; }
      cur = nx;
    }
    return { path: cur, e: names.get(cur) };
  };
  const out = [];
  for (const [op, a, b] of ops) {
    let err = null, text = null;
    const has = (p) => names.has(p), par = (p) => names.get(parent(p));
    if (op === 'mkdir' || op === 'create' || op === 'symlink') {
      const p = op === 'symlink' ? b : a;
      if (!par(p) || par(p).type !== 'directory') err = 'ENOENT'; else if (has(p)) err = 'EEXIST';
      else { const id = 'i' + k++; names.set(p, { id, type: op === 'mkdir' ? 'directory' : op === 'symlink' ? 'symlink' : 'file', target: op === 'symlink' ? a : null }); nl.set(id, op === 'mkdir' ? 2 : 1); data.set(id, ''); if (op === 'mkdir') nl.set(par(p).id, nl.get(par(p).id) + 1); }
    } else if (op === 'write') { const r = resolve(a); if (r.err) err = r.err; else data.set(r.e.id, data.get(r.e.id) + b); }
    else if (op === 'link') {
      const r = resolve(a);
      if (r.err) err = r.err; else if (r.e.type === 'directory') err = 'EPERM'; else if (has(b)) err = 'EEXIST'; else if (!par(b)) err = 'ENOENT';
      else { names.set(b, r.e); nl.set(r.e.id, nl.get(r.e.id) + 1); }
    } else if (op === 'unlink') {
      if (!has(a)) err = 'ENOENT'; else if (names.get(a).type === 'directory') err = 'EISDIR';
      else { const e = names.get(a); names.delete(a); nl.set(e.id, nl.get(e.id) - 1); }
    } else if (op === 'rename') {
      if (!has(a)) err = 'ENOENT';
      else { const e = names.get(a); if (has(b)) { const o = names.get(b); nl.set(o.id, nl.get(o.id) - 1); } names.delete(a); names.set(b, e); }
    } else if (op === 'cat' || op === 'lookup') { const r = resolve(a); if (r.err) err = r.err; else text = data.get(r.e.id); }
    const files = {};
    for (const [p, e] of names) if (e.type !== 'directory') files[p] = nl.get(e.id);
    out.push({ err, text, files });
  }
  return out;
}
const nsCheck = ({ input, r, fail, pass }) => {
  const ops = S.T14.parseOps(input.ops, 12).ops, want = nsModel(ops);
  r.frames.filter((f) => f.meta.i !== undefined).forEach((f, i) => {
    const m = f.meta, w = want[i];
    ((m.err ? m.err.code : null) === w.err ? pass : fail)(ops[i].join(' ') + ': error ' + (m.err && m.err.code) + ', by the model ' + w.err);
    if (w.text !== null && !w.err && ops[i][0] === 'cat') (m.text === w.text.length ? pass : fail)('cat length');
    const got = {}; for (const [p, v] of Object.entries(m.paths)) if (v[2] !== 'directory') got[p] = v[1];
    (JSON.stringify(Object.entries(got).sort()) === JSON.stringify(Object.entries(w.files).sort()) ? pass : fail)('names and link counts after ' + ops[i].join(' ') + ': ' + JSON.stringify(got) + ', by the model ' + JSON.stringify(w.files));
  });
};
const nsRandom = (r) => {
  const names = ['/x', '/y', '/z', '/d/x', '/d/y'], lines = ['mkdir /d'];
  for (let k = 0; k < int(r, 3, 10); k++) {
    const op = pick(r, ['create', 'link', 'unlink', 'write', 'cat', 'rename', 'symlink']);
    if (op === 'link' || op === 'rename' || op === 'symlink') lines.push(`${op} ${pick(r, names)} ${pick(r, names)}`);
    else if (op === 'write') lines.push(`write ${pick(r, names)} ${word(r, 3)}`);
    else lines.push(`${op} ${pick(r, names)}`);
  }
  return { ops: lines.join('\n') };
};
mods['fs-hard-links'] = { random: nsRandom, check: nsCheck };
mods['fs-symlinks'] = { random: nsRandom, check: nsCheck };

mods['fs-file-ops'] = {
  random: (r) => { const lines = ['create /f']; for (let k = 0; k < int(r, 2, 8); k++) { const op = pick(r, ['write', 'truncate', 'stat', 'cat', 'chmod']); lines.push(op === 'write' ? 'write /f ' + word(r, int(r, 1, 30)) : op === 'truncate' ? 'truncate /f ' + int(r, 0, 150) : op === 'chmod' ? 'chmod ' + pick(r, ['600', '644', '755']) + ' /f' : op + ' /f'); } return { ops: lines.join('\n') }; },
  check({ input, r, fail, pass }) {
    const ops = S.T14.parseOps(input.ops, 12).ops;
    let size = null, blocks = new Set();
    r.frames.filter((f) => f.meta.i !== undefined).forEach((f, i) => {
      const [op, a, b] = ops[i], m = f.meta;
      if (m.err) return;
      if (op === 'create') { size = 0; blocks = new Set(); }
      if (op === 'write') { for (let k = Math.floor(size / 64); k <= Math.floor((size + b.length - 1) / 64); k++) blocks.add(k); size += b.length; }
      if (op === 'truncate') { size = b; for (const k of [...blocks]) if (k >= Math.ceil(b / 64)) blocks.delete(k); }
      const written = blocks.size * 64;
      if (op === 'unlink' || op === 'rename') return;
      if (m.now && size !== null && ops.filter((x) => x[0] === 'create').length === 1 && !ops.some((x) => x[0] === 'rename' || x[0] === 'link')) {
        (m.now.size === size ? pass : fail)(op + ': size ' + m.now.size + ', by hand ' + size);
        (m.now.dataBlocks.length === written / 64 ? pass : fail)(op + ': blocks ' + m.now.dataBlocks.length + ', by hand ' + written / 64);
      }
      if (op === 'chmod') (m.now.perms === [...a].map((d) => ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'][+d]).join('') ? pass : fail)('mode');
    });
  },
};
mods['fs-access-methods'] = {
  random: (r) => ({ alloc: pick(r, ['indexed', 'contiguous', 'linked', 'fat']), layout: pick(r, ['interleaved', 'alone']), records: int(r, 2, 12), seed: int(r, 1, 999) }),
  check({ input, r, fail, pass }) {
    const n = input.records, order = [...Array(n).keys()];
    let s = input.seed >>> 0; const g = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(g() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (const name of ['sequential', 'direct']) {
      const fr = r.frames.filter((f) => f.meta.phase === name), got = fr.map((f) => f.meta.step.record), want = name === 'direct' ? order : [...Array(n).keys()];
      (JSON.stringify(got) === JSON.stringify(want) ? pass : fail)(name + ' order ' + got + ', by hand ' + want);
      let reads = 0, travel = 0, prev = null;
      fr.forEach((f) => { reads += f.meta.step.reads; if (prev !== null) travel += Math.abs(f.meta.step.block - prev); prev = f.meta.step.block; (f.meta.reads === reads ? pass : fail)('running reads'); });
      const tot = r.frames.find((f) => f.meta.phase === name + '-total').meta;
      (tot.reads === reads ? pass : fail)(name + ' reads ' + tot.reads + ', summed ' + reads);
      // the head's travel counts every block read, chains included: at least the travel between the records
      (tot.travel >= travel ? pass : fail)(name + ' travel ' + tot.travel + ' at least ' + travel);
      (reads >= n ? pass : fail)('at least one read a record');
    }
  },
};
mods['fs-mount'] = {
  random: (r) => { const scen = pick(r, ['tour', 'busy', 'cross']); return { scen, at: scen === 'cross' ? '/mnt' : pick(r, ['/mnt', '/notes']) }; },
  check({ input, r, fail, pass }) {
    const want = { tour: [null, null, null, null, 'ENOENT'], busy: [null, null, 'EBUSY', null, null], cross: [null, 'EXDEV', null, 'EXDEV', null] }[input.scen];
    const got = r.frames.filter((f) => f.meta.i !== undefined).map((f) => (f.meta.err ? f.meta.err.code : null));
    (JSON.stringify(got) === JSON.stringify(want) ? pass : fail)('errors ' + JSON.stringify(got) + ', by hand ' + JSON.stringify(want));
    for (const f of r.frames) if (f.meta.phase === 'stat' && !f.meta.err) (f.meta.result.dev === (f.meta.on ? 1 : 0) ? pass : fail)('a path under the mount point is on device 1 while mounted');
  },
};
mods['fs-permissions'] = {
  random: (r) => { const o = () => String(int(r, 0, 7)); return { mode: o() + o() + o(), dmode: o() + o() + o(), owner: int(r, 0, 3) * 10, group: int(r, 1, 3) * 10, uid: pick(r, [0, 10, 11, 20, 30]), gid: pick(r, [10, 20, 30]), want: pick(r, ['r', 'w', 'rw']) }; },
  check({ input, r, fail, pass }) {
    const bits = (mode, uid, gid, owner, group) => { const m = parseInt(mode, 8); return uid === owner ? (m >> 6) & 7 : gid === group ? (m >> 3) & 7 : m & 7; };
    const need = (input.want.includes('r') ? 4 : 0) | (input.want.includes('w') ? 2 : 0);
    const root = input.uid === 0;
    const search = root || (bits(input.dmode, input.uid, input.gid, input.owner, input.group) & 1) === 1;
    const file = root || (bits(input.mode, input.uid, input.gid, input.owner, input.group) & need) === need;
    const L = r.frames[r.frames.length - 1].meta;
    ((!L.err) === (search && file) ? pass : fail)('allowed ' + !L.err + ', by the rule ' + (search && file));
    const d = r.frames.find((f) => f.meta.phase === 'dir').meta;
    (d.ok === search ? pass : fail)('search');
  },
};

// the shared runner, with one difference: ".." is the name of a directory entry here, not two full stops
function generic(ctx) {
  const { r, input, fail, pass } = ctx, inVals = leaves(input).concat([0, 1, 2]);
  r.frames.forEach((f, i) => {
    for (const w of wording(String(f.say).replace(/“[^”]*”/g, '“quoted”').replace(/'\.\.?'|`\.\.?`|\.\.\//g, 'dotdot'))) fail('frame ' + i + ': ' + w + ': ' + f.say);
    if (!f.meta) { fail('frame ' + i + ': no meta'); return; }
    const vals = leaves(f.meta).concat(inVals);
    for (const num of numbersIn(f.say)) { if (matches(num, vals)) pass(); else fail('frame ' + i + ': the narration says ' + num.txt + ', which is not in the frame\'s values: ' + f.say.slice(0, 200)); }
    if (f.predict) for (const w of wording(f.predict.ask)) fail('frame ' + i + ' prediction: ' + w);
  });
}
function runPart(pattern) {
  let runs = 0;
  const seen = new Set();
  for (const tp of S.topics) {
    if (!pattern.test(tp.family) || (only.length && !only.some((o) => tp.id.startsWith(o)))) continue;
    seen.add(tp.id);
    const mod = mods[tp.id] || {};
    if (!mods[tp.id]) t.ok(false, tp.id + ': no claims module');
    const inputs = [{}].concat((tp.presets || []).map((p) => p.values)), nPre = inputs.length;
    if (mod.random) for (let k = 0; k < (mod.nRandom === undefined ? 8 : mod.nRandom); k++) inputs.push(mod.random(rnd));
    inputs.forEach((v, idx) => {
      const input = S.inputOf(tp, Object.assign(S.inputOf(tp), v)), err = S.checkInput(tp, input);
      if (err) { if (idx < nPre) t.ok(false, tp.id + ' refuses ' + JSON.stringify(v) + ': ' + err); return; }
      const js = JSON.stringify(v), tag = tp.id + ' ' + (js.length > 90 ? js.slice(0, 87) + '…}' : js);
      const r = S.run(tp, input);
      if (!r.ok) { t.ok(false, tag + ': ' + r.error); return; }
      runs++;
      const ctx = { S, tp, input, r, near, fail: (m) => t.ok(false, tag + ': ' + m), pass: () => t.ok(true) };
      generic(ctx);
      if (mod.check) { try { mod.check(ctx); } catch (e) { t.ok(false, tag + ': the check threw ' + e.message + ' ' + (e.stack || '').split('\n')[1]); } }
    });
  }
  return { runs, seen };
}
const { runs, seen } = runPart(/^p14-/);
for (const id of Object.keys(mods)) if (!only.length && !seen.has(id)) t.ok(false, id + ': a claims module for a topic that does not exist');
console.log('  (' + runs + ' runs over ' + seen.size + ' topics)');
t.done();
