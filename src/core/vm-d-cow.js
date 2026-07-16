// Virtual-memory engines, part 4: page states. Copy-on-write after fork and zero-fill-on-demand as a model of page
// tables and frames with reference counts (the same idea and terms as the kernel's fork, kept separate from it),
// and a file mapped with mmap, shared against private, with dirty pages written back.
//   S.VM.cow() -> C
//     C.spawn(pid, [content | 'zero', ..])  a process whose page i holds that content ('zero': demand-zero, unmapped)
//     C.fork(parent, child)   the child shares every frame; writable pages turn read-only copy-on-write in both
//     C.read(pid, page)       a demand-zero page maps the shared zero frame read-only
//     C.write(pid, page, value)  a demand-zero page (or one on the zero frame) gets a fresh zeroed frame; a
//                             copy-on-write page is copied if others share its frame, else just made writable
//     C.exit(pid)             its frames lose a reference; frames nobody refers to are freed
//     every call -> step {kind, pid, page, frame, from, say, snapshot}
//     kinds: spawn, fork, read, zero-map, write, zero-fill, cow-copy, cow-reuse, exit
//     snapshot: {procs: {pid: [{page, frame, state: 'rw' | 'cow' | 'zfod'}]}, frames: [{id, refs, value}],
//                zeroFrame: id, copies}
//   S.VM.mmap({file: [values], frames}) -> F
//     F.map(pid, 'shared' | 'private')  F.read(pid, page)  F.write(pid, page, value)  F.msync(pid)  F.unmap(pid)
//     every call -> step {kind, pid, page, say, snapshot}; a page comes into the page cache from the file on first
//     touch; a shared write dirties the cached page, which msync or unmap writes back to the file; a private write
//     copies the page first and never reaches the file. snapshot: {file, cache: [{page, value, dirty}],
//     private: {pid: {page: value}}, maps: {pid: mode}, fileWrites}
(function (S) {
  'use strict';
  const V = (S.VM = S.VM || {});

  V.cow = function () {
    const procs = new Map(), frames = new Map();
    let next = 1, copies = 0;
    const ZERO = 0;
    frames.set(ZERO, { id: ZERO, refs: 0, value: 0, zero: true });
    const newFrame = (value) => { const f = { id: next++, refs: 1, value }; frames.set(f.id, f); return f; };
    const drop = (id) => { const f = frames.get(id); f.refs--; if (f.refs <= 0 && !f.zero) frames.delete(id); };
    const snapshot = () => {
      const p = {};
      for (const [pid, pt] of procs) p[pid] = [...pt.entries()].map(([page, e]) => ({ page, frame: e.frame, state: e.state }));
      return { procs: p, frames: [...frames.values()].map((f) => ({ id: f.id, refs: f.refs, value: f.value })), zeroFrame: ZERO, copies };
    };
    const out = (st) => Object.assign(st, { snapshot: snapshot() });
    const pte = (pid, page) => { const pt = procs.get(pid); if (!pt || !pt.has(page)) throw new Error('process ' + pid + ' has no page ' + page); return pt.get(page); };
    const C = { snapshot };
    C.spawn = function (pid, pages) {
      const pt = new Map();
      pages.forEach((v, i) => pt.set(i, v === 'zero' ? { frame: null, state: 'zfod' } : { frame: newFrame(v).id, state: 'rw' }));
      procs.set(pid, pt);
      return out({ kind: 'spawn', pid, say: 'Process ' + pid + ' starts with ' + S.Mem.count(pages.length, 'page') + ': ' + pages.filter((v) => v !== 'zero').length + ' in frames of their own and ' + pages.filter((v) => v === 'zero').length + ' demand-zero (no frame until touched).' });
    };
    C.fork = function (parent, child) {
      const pt = procs.get(parent), ct = new Map();
      let shared = 0;
      for (const [page, e] of pt) {
        if (e.frame !== null) { frames.get(e.frame).refs++; shared++; if (e.state === 'rw') e.state = 'cow'; }
        ct.set(page, { frame: e.frame, state: e.state });
      }
      procs.set(child, ct);
      return out({ kind: 'fork', pid: parent, child, say: 'Process ' + parent + ' forks ' + child + ': nothing is copied. The ' + shared + ' mapped pages are shared, every writable one now read-only and marked copy-on-write in both page tables.' });
    };
    C.read = function (pid, page) {
      const e = pte(pid, page);
      if (e.state === 'zfod') { e.frame = ZERO; e.state = 'cow'; frames.get(ZERO).refs++; return out({ kind: 'zero-map', pid, page, frame: ZERO, say: 'Process ' + pid + ' reads demand-zero page ' + page + ': a fault maps the shared zero frame, read-only; it reads 0.' }); }
      return out({ kind: 'read', pid, page, frame: e.frame, value: frames.get(e.frame).value, say: 'Process ' + pid + ' reads page ' + page + ' in frame ' + e.frame + ': ' + frames.get(e.frame).value + ', no fault.' });
    };
    C.write = function (pid, page, value) {
      const e = pte(pid, page);
      if (e.state === 'zfod' || e.frame === ZERO) {
        if (e.frame === ZERO) drop(ZERO);
        const f = newFrame(0);
        e.frame = f.id; e.state = 'rw'; f.value = value;
        return out({ kind: 'zero-fill', pid, page, frame: f.id, say: 'Process ' + pid + ' writes demand-zero page ' + page + ': a fault gives it frame ' + f.id + ', filled with zeros (nothing to copy), and the write lands.' });
      }
      if (e.state === 'cow') {
        const old = frames.get(e.frame);
        if (old.refs > 1) {
          const f = newFrame(old.value);
          drop(old.id); copies++;
          e.frame = f.id; e.state = 'rw'; f.value = value;
          return out({ kind: 'cow-copy', pid, page, frame: f.id, from: old.id, say: 'Process ' + pid + ' writes copy-on-write page ' + page + ': frame ' + old.id + ' is shared (' + S.Mem.count((old.refs + 1), 'reference') + '), so a fault copies it into frame ' + f.id + ', made writable; the write lands there.' });
        }
        e.state = 'rw'; old.value = value;
        return out({ kind: 'cow-reuse', pid, page, frame: old.id, say: 'Process ' + pid + ' writes copy-on-write page ' + page + ': nobody else uses frame ' + old.id + ' any more, so the fault just makes it writable; no copy.' });
      }
      frames.get(e.frame).value = value;
      return out({ kind: 'write', pid, page, frame: e.frame, say: 'Process ' + pid + ' writes page ' + page + ' in frame ' + e.frame + ' directly: it is writable.' });
    };
    C.exit = function (pid) {
      const pt = procs.get(pid), before = frames.size;
      for (const e of pt.values()) if (e.frame !== null) drop(e.frame);
      procs.delete(pid);
      return out({ kind: 'exit', pid, say: 'Process ' + pid + ' exits: each of its frames loses a reference, and ' + (before - frames.size) + ' that nobody uses any more are freed.' });
    };
    return C;
  };

  V.mmap = function (o) {
    const file = o.file.slice(), cache = new Map(), priv = new Map(), maps = new Map();
    let fileWrites = 0;
    const snapshot = () => ({ file: file.slice(), cache: [...cache].sort((a, b) => a[0] - b[0]).map(([page, c]) => ({ page, value: c.value, dirty: c.dirty })), private: Object.fromEntries([...priv].map(([pid, m]) => [pid, Object.fromEntries(m)])), maps: Object.fromEntries(maps), fileWrites });
    const out = (st) => Object.assign(st, { snapshot: snapshot() });
    const load = (page) => { if (!cache.has(page)) { cache.set(page, { value: file[page], dirty: false }); return true; } return false; };
    const mode = (pid) => { const m = maps.get(pid); if (!m) throw new Error('process ' + pid + ' has not mapped the file'); return m; };
    const writeBack = () => { const pages = []; for (const [page, c] of cache) if (c.dirty) { file[page] = c.value; c.dirty = false; fileWrites++; pages.push(page); } return pages.sort((a, b) => a - b); };
    const F = { snapshot };
    F.map = function (pid, how) { maps.set(pid, how); if (how === 'private') priv.set(pid, new Map()); return out({ kind: 'map', pid, mode: how, say: 'Process ' + pid + ' maps the file ' + how + ' (MAP_' + how.toUpperCase() + '): no page is read yet; each comes in on its first touch.' }); };
    F.read = function (pid, page) {
      const m = mode(pid);
      if (m === 'private' && priv.get(pid).has(page)) return out({ kind: 'read', pid, page, value: priv.get(pid).get(page), say: 'Process ' + pid + ' reads page ' + page + ' from its own private copy: ' + priv.get(pid).get(page) + '.' });
      const fresh = load(page);
      return out({ kind: 'read', pid, page, value: cache.get(page).value, say: 'Process ' + pid + ' reads page ' + page + (fresh ? ': a fault reads it from the file into the page cache' : ' from the page cache') + ': ' + cache.get(page).value + '.' });
    };
    F.write = function (pid, page, value) {
      const m = mode(pid), fresh = load(page);
      if (m === 'shared') { const c = cache.get(page); c.value = value; c.dirty = true; return out({ kind: 'write', pid, page, value, say: 'Process ' + pid + ' writes ' + value + ' to shared page ' + page + (fresh ? ' (read in from the file first)' : '') + ': the cached page is now dirty, and every process mapping it shared sees the new value.' }); }
      const had = priv.get(pid).has(page);
      priv.get(pid).set(page, value);
      return out({ kind: 'write', pid, page, value, say: 'Process ' + pid + ' writes ' + value + ' to private page ' + page + (had ? ' in its own copy.' : ': copy-on-write gives it a private copy of the cached page first. The file and other processes never see this write.') });
    };
    F.msync = function (pid) { mode(pid); const pages = writeBack(); return out({ kind: 'msync', pid, pages, say: 'msync: ' + (pages.length ? 'dirty page' + (pages.length > 1 ? 's ' : ' ') + S.Mem.list(pages) + ' ' + S.Mem.are(pages) + ' written back to the file.' : 'no page is dirty, so the file is already up to date.') }); };
    F.unmap = function (pid) {
      const m = mode(pid);
      maps.delete(pid);
      const pages = m === 'shared' ? writeBack() : [];
      const n = m === 'private' ? priv.get(pid).size : 0;
      priv.delete(pid);
      return out({ kind: 'unmap', pid, pages, say: 'Process ' + pid + ' unmaps the file' + (m === 'shared' ? (pages.length ? '; dirty page' + (pages.length > 1 ? 's ' : ' ') + S.Mem.list(pages) + ' ' + S.Mem.are(pages) + ' written back.' : '; nothing is dirty.') : '; its ' + n + ' private cop' + (n === 1 ? 'y is' : 'ies are') + ' thrown away.') });
    };
    return F;
  };

  (S.engines = S.engines || []).push({ name: 'Copy-on-write and mmap' });
})(globalThis.Proses = globalThis.Proses || {});
