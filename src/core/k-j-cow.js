// The simulated kernel, part ten: a page view of each process's memory, with copy-on-write. Memory is cut into
// pages of o.pageSize bytes; each page maps to a frame (sys.frames {id: {id, refs}}; p.pages[i] = frame id).
// fork shares every frame with the child, read-only (refs 2); the first write to a shared page, by either
// process, gives the writer a copy in a new frame: the trace shows it as a 'cow' step {pid, page, from, to}.
// exec and exit give the frames back. With o.cow false (the enumerator) nothing is tracked.
//   sys.initPages(p), sys.forkPages(parent, child), sys.freePages(p), sys.checkCow(p)
//   (Writes are found by comparing a shared page with the copy kept when it was shared, after each step of a
//   process that shares pages; a store hook in the machine would make this exact and cheaper.)
(function (S) {
  'use strict';
  const K = (S.Kern = S.Kern || {});
  const proto = K.System.prototype;
  // sys.keep {frame: bytes}: a shared frame's bytes as they were when it was shared (never changed, so clones
  // share the arrays)

  const memOf = (p) => (p.M ? p.M.mem : null);
  proto.newFrame = function () { const id = this.nextFrame++; this.frames[id] = { id, refs: 1 }; return id; };
  proto.initPages = function (p) {
    if (!this.o.cow || !memOf(p)) { p.pages = []; return; }
    this.freePages(p);
    const n = Math.ceil(memOf(p).length / this.o.pageSize);
    p.pages = Array.from({ length: n }, () => this.newFrame());
  };
  proto.freePages = function (p) {
    for (const f of p.pages || []) { const fr = this.frames[f]; if (fr && --fr.refs <= 0) delete this.frames[f]; if (fr && fr.refs < 2) delete this.keep[f]; }
    p.pages = [];
  };
  proto.forkPages = function (parent, child) {
    if (!this.o.cow || !memOf(parent)) { child.pages = []; return; }
    const ps = this.o.pageSize, keep = new Map();
    child.pages = parent.pages.slice();
    parent.pages.forEach((f, i) => {
      this.frames[f].refs++;
      const m = memOf(parent);
      keep.set(f, m.slice(i * ps, Math.min(m.length, (i + 1) * ps)));
    });
    for (const [f, b] of keep) this.keep[f] = b;
    this.event('cow-share', child, { parent: parent.pid, pages: child.pages.slice() }, `${this.who(child)} shares all ${child.pages.length} of its parent's pages, read-only: no memory is copied yet.`);
  };
  /** after p ran: any shared page it changed is split off into a new frame */
  proto.checkCow = function (p) {
    const mem = memOf(p);
    if (!this.o.cow || !mem || !p.pages.length) return;
    const ps = this.o.pageSize;
    for (let i = 0; i < p.pages.length; i++) {
      const f = p.pages[i], fr = this.frames[f];
      if (!fr || fr.refs < 2) continue;
      const was = this.keep[f];
      if (!was) continue;
      const a = i * ps, b = Math.min(mem.length, a + ps);
      let same = true;
      for (let k = a; k < b; k++) if (mem[k] !== was[k - a]) { same = false; break; }
      if (same) continue;
      fr.refs--;
      if (fr.refs < 2) delete this.keep[f];
      const g = this.newFrame();
      p.pages[i] = g;
      this.event('cow', p, { page: i, from: f, to: g, left: fr.refs }, `${this.who(p)} writes to page ${i}, which it shared: the kernel copies it into frame ${g} (copy-on-write)${fr.refs === 1 ? ', and frame ' + f + ' is now private to the other process' : ''}.`);
    }
  };
})(globalThis.Proses = globalThis.Proses || {});
