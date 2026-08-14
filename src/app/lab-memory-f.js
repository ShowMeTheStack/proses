// The Memory lab, part six: the allocation workbench's inputs and its runs. Five allocators, each driven by a list of
// operations the student types:
//   contig   A=200 (KiB), -A, #  (compact)          first, best, worst or next fit over one memory, a kernel at the bottom
//   seg      A.code=120, -A.heap, -A (all of A), #  each segment placed on its own by the same fits
//   buddy    P=70 (KiB), -P                          power-of-two blocks split and coalesced
//   slab     a=inode, -a, shrink                     caches of one object size, slabs full, partial or empty
//   malloc   a=20 (bytes), -a                        a heap of tagged blocks: first, next, best fit or segregated lists
//   ML.allocFields(show) -> [field..]   ML.allocPresets [{label, values}]   ML.checkAlloc(v) -> 'why' | null
//   ML.parseOps(kind, list) -> [{op: 'alloc' | 'free' | 'compact' | 'shrink', id, size, cache, proc, seg, text}] (throws a sentence)
//   ML.allocSteps(v) -> {kind, steps: [{op, k, st (the engine's step, or a skip), say}], names, unit, engine}
(function (S) {
  'use strict';
  const ML = S.MemLab;
  const M = () => S.Mem;
  const OPS = {
    contig: ['A=200', 'B=150', 'C=260', 'D=100', '-B', '-D', 'E=120', 'F=210', '-A', 'G=230', '#', 'G=230'],
    seg: ['A.code=120', 'A.heap=90', 'A.stack=60', 'B.code=160', 'B.heap=200', '-A.heap', 'C.code=80', 'C.heap=110', '-B', 'C.stack=150', 'A.heap=140'],
    buddy: ['P=70', 'Q=35', 'R=80', 'S=60', '-Q', 'T=120', '-P', '-S', 'U=200', '-R'],
    slab: ['a=inode', 'b=inode', 'c=task', 'd=inode', 'e=inode', 'f=dentry', '-b', 'g=task', '-a', '-d', '-e', 'shrink', 'h=inode'],
    malloc: ['a=20', 'b=40', 'c=12', 'd=60', '-b', 'e=16', '-c', '-a', 'f=30', 'g=8', '-d', 'h=50'],
  };
  ML.OPS = OPS;
  const KINDS = [{ value: 'contig', label: 'contiguous: one run each' }, { value: 'seg', label: 'segmentation: a run a segment' }, { value: 'buddy', label: 'buddy system' }, { value: 'slab', label: 'slab caches' }, { value: 'malloc', label: 'malloc heap' }];
  const FITS = [{ value: 'first', label: 'first fit' }, { value: 'best', label: 'best fit' }, { value: 'worst', label: 'worst fit' }, { value: 'next', label: 'next fit' }];
  const opsField = (kind, label, help, show) => ({ id: 'ops_' + kind, label, type: 'list', kind: 'text', def: OPS[kind], minLen: 1, maxLen: 24, help, show: (v) => show(v) && v.alloc === kind,
    check: (x) => { try { ML.parseOps(kind, x); return null; } catch (e) { return e.message; } } });

  ML.allocFields = (show) => [
    { id: 'alloc', label: 'Allocator', type: 'select', group: 'Allocator', def: 'contig', options: KINDS, show },
    { id: 'fit', label: 'Placement', type: 'select', def: 'first', options: FITS, show: (v) => show(v) && (v.alloc === 'contig' || v.alloc === 'seg') },
    { id: 'compact', label: 'Compact', type: 'select', def: 'never', options: [{ value: 'never', label: 'only on #' }, { value: 'on-fail', label: 'when a request fails' }], show: (v) => show(v) && (v.alloc === 'contig' || v.alloc === 'seg') },
    { id: 'memK', label: 'Memory', type: 'number', def: 1024, min: 64, max: 65536, unit: 'KiB', show: (v) => show(v) && (v.alloc === 'contig' || v.alloc === 'seg') },
    { id: 'osK', label: 'Kernel at the bottom', type: 'number', def: 128, min: 0, max: 8192, unit: 'KiB', show: (v) => show(v) && (v.alloc === 'contig' || v.alloc === 'seg') },
    { id: 'arena', label: 'Arena', type: 'select', def: 1024, options: [256, 512, 1024, 2048, 4096].map((n) => ({ value: n, label: n + ' KiB' })), show: (v) => show(v) && v.alloc === 'buddy' },
    { id: 'minBlock', label: 'Smallest block', type: 'select', def: 32, options: [8, 16, 32, 64].map((n) => ({ value: n, label: n + ' KiB' })), show: (v) => show(v) && v.alloc === 'buddy' },
    { id: 'caches', label: 'Caches (name:object bytes)', type: 'list', kind: 'text', def: ['inode:256', 'task:512', 'dentry:192'], minLen: 1, maxLen: 4, show: (v) => show(v) && v.alloc === 'slab',
      check: (x) => { for (const c of x) if (!/^[a-z][a-z0-9_]{0,9}:\d{1,5}$/.test(c)) return 'Caches: "' + c + '" should be name:bytes, like inode:256'; return new Set(x.map((c) => c.split(':')[0])).size === x.length ? null : 'Caches: each name once'; } },
    { id: 'slabBytes', label: 'Slab size', type: 'select', def: 1024, options: [512, 1024, 2048, 4096].map((n) => ({ value: n, label: n + ' bytes' })), show: (v) => show(v) && v.alloc === 'slab' },
    { id: 'heap', label: 'Heap', type: 'select', def: 256, options: [128, 256, 512, 1024].map((n) => ({ value: n, label: n + ' bytes' })), show: (v) => show(v) && v.alloc === 'malloc' },
    { id: 'mfit', label: 'Search', type: 'select', def: 'first', options: [{ value: 'first', label: 'first fit' }, { value: 'next', label: 'next fit' }, { value: 'best', label: 'best fit' }, { value: 'segregated', label: 'segregated lists' }], show: (v) => show(v) && v.alloc === 'malloc' },
    opsField('contig', 'Requests (A=200 KiB, -A frees, # compacts)', 'each name once at a time; sizes in KiB', show),
    opsField('seg', 'Segments (A.code=120, -A.heap, -A, #)', 'a process’s segments each get their own run; sizes in KiB', show),
    opsField('buddy', 'Requests (P=70 KiB, -P frees)', 'a request gets the next power of two', show),
    opsField('slab', 'Objects (a=inode, -a frees, shrink)', 'an object goes into a slab of its cache', show),
    opsField('malloc', 'Calls (a=20 bytes, -a frees)', 'malloc(20) for a; free(a)', show),
  ];

  ML.parseOps = function (kind, list) {
    return list.map((t) => {
      const x = String(t).trim();
      let m;
      if (x === '#' && (kind === 'contig' || kind === 'seg')) return { op: 'compact', text: x };
      if (x === 'shrink' && kind === 'slab') return { op: 'shrink', text: x };
      if (kind === 'seg') {
        if ((m = /^([A-Z][A-Za-z0-9]{0,3})\.([a-z][a-z0-9]{0,5})=(\d{1,6})$/.exec(x)) && +m[3] > 0) return { op: 'alloc', id: m[1] + '.' + m[2], proc: m[1], seg: m[2], size: +m[3], text: x };
        if ((m = /^-([A-Z][A-Za-z0-9]{0,3})(?:\.([a-z][a-z0-9]{0,5}))?$/.exec(x))) return { op: 'free', proc: m[1], seg: m[2] || null, id: m[2] ? m[1] + '.' + m[2] : m[1], text: x };
        throw new Error('"' + x + '": write A.code=120 to place a segment, -A.code or -A to free, # to compact');
      }
      if (kind === 'slab') {
        if ((m = /^([a-z][a-z0-9]{0,3})=([a-z][a-z0-9_]{0,9})$/.exec(x))) return { op: 'alloc', id: m[1], cache: m[2], text: x };
        if ((m = /^-([a-z][a-z0-9]{0,3})$/.exec(x))) return { op: 'free', id: m[1], text: x };
        throw new Error('"' + x + '": write a=inode to allocate, -a to free, shrink to give empty slabs back');
      }
      const idRe = kind === 'malloc' ? '[a-z][a-z0-9]{0,3}' : '[A-Za-z][A-Za-z0-9]{0,3}';
      if ((m = new RegExp('^(' + idRe + ')=(\\d{1,6})$').exec(x)) && +m[2] > 0) return { op: 'alloc', id: m[1], size: +m[2], text: x };
      if ((m = new RegExp('^-(' + idRe + ')$').exec(x))) return { op: 'free', id: m[1], text: x };
      throw new Error('"' + x + '": write ' + (kind === 'malloc' ? 'a=20 for malloc(20), -a for free(a)' : 'A=200 to allocate, -A to free' + (kind === 'contig' ? ', # to compact' : '')));
    });
  };

  ML.checkAlloc = function (v) {
    const k = v.alloc;
    try { ML.parseOps(k, v['ops_' + k] || []); } catch (e) { return e.message; }
    if ((k === 'contig' || k === 'seg') && v.osK >= v.memK) return 'The kernel (' + v.osK + ' KiB) must leave room in the ' + v.memK + ' KiB of memory';
    if (k === 'buddy' && v.minBlock > v.arena) return 'The smallest block cannot be larger than the arena';
    if (k === 'slab') {
      const names = (v.caches || []).map((c) => c.split(':')[0]);
      for (const c of v.caches || []) { const n = +c.split(':')[1]; if (!(n >= v.slabBytes / 16 && n <= v.slabBytes)) return 'Caches: ' + c + ' should be ' + v.slabBytes / 16 + ' to ' + v.slabBytes + ' bytes, so a ' + v.slabBytes + '-byte slab holds 1 to 16 objects'; }
      for (const o of ML.parseOps('slab', v.ops_slab)) if (o.op === 'alloc' && !names.includes(o.cache)) return 'Objects: ' + o.text + ' names no cache (' + names.join(', ') + ')';
    }
    return null;
  };

  /** the operations run through the engine; a free of something not there, or a name taken twice, is a step that says so */
  ML.allocSteps = function (v) {
    const kind = v.alloc, ops = ML.parseOps(kind, v['ops_' + kind]), steps = [], KiB = (s) => s.replace(/(\d+) bytes?\b/g, '$1 KiB');
    const names = [];
    const nameOf = (o) => (kind === 'seg' ? o.proc : o.id);
    for (const o of ops) if (o.op === 'alloc' && !names.includes(nameOf(o))) names.push(nameOf(o));
    let E;
    if (kind === 'contig' || kind === 'seg') E = M().contig({ memory: v.memK, osSize: v.osK, policy: v.fit, compact: v.compact });
    else if (kind === 'buddy') E = M().buddy({ size: v.arena, minBlock: v.minBlock });
    else if (kind === 'slab') E = M().slab({ caches: v.caches.map((c) => ({ name: c.split(':')[0], objSize: +c.split(':')[1] })), slabBytes: v.slabBytes });
    else E = M().malloc({ heap: v.heap, policy: v.mfit });
    const live = new Set();
    // the allocator's whole state after a step, whatever the step was
    const snap = () => (kind === 'contig' || kind === 'seg' ? { blocks: E.blocks(), holes: E.holes(), frag: E.frag() } : kind === 'buddy' ? { tree: E.tree(), freeLists: E.freeLists(), allocated: E.allocated() } : kind === 'slab' ? E.snapshot() : { blocks: E.blocks(), freeLists: E.freeLists(), stats: E.stats() });
    const start = snap();
    ops.forEach((o, k) => {
      const push = (st, say) => steps.push({ op: o, k, st, say: say || st.say, snap: snap() });
      if (o.op === 'compact') { const st = E.compact(); push(st, KiB(st.say)); return; }
      if (o.op === 'shrink') { push(E.shrink()); return; }
      if (o.op === 'alloc') {
        if (live.has(o.id)) { push({ kind: 'skip' }, o.text + ': ' + o.id + ' is in use already; free it first.'); return; }
        const st = kind === 'contig' || kind === 'seg' ? E.alloc(o.id, o.size) : kind === 'buddy' ? E.alloc(o.id, o.size) : kind === 'slab' ? E.alloc(o.cache, o.id) : E.malloc(o.id, o.size);
        if (st.kind !== 'fail') live.add(o.id);
        push(st, kind === 'contig' || kind === 'seg' || kind === 'buddy' ? KiB(st.say) : st.say);
        return;
      }
      // a free; in segmentation -A frees every segment of A
      const ids = kind === 'seg' && !o.seg ? [...live].filter((id) => id.split('.')[0] === o.proc) : [o.id];
      if (!ids.length || ids.some((id) => !live.has(id))) { push({ kind: 'skip' }, o.text + ': ' + (kind === 'seg' && !o.seg ? o.proc + ' has no segments in memory' : o.id + ' is not allocated') + ', so there is nothing to free.'); return; }
      ids.forEach((id, j) => {
        const st = kind === 'malloc' ? E.free(id) : E.free(id);
        live.delete(id);
        push(st, kind === 'contig' || kind === 'seg' || kind === 'buddy' ? KiB(st.say) : st.say);
        if (j < ids.length - 1) steps[steps.length - 1].more = true;
      });
    });
    return { kind, ops, steps, names, E, start };
  };

  ML.allocPresets = [
    { label: 'Allocation: first fit, then compaction', values: { mode: 'alloc', alloc: 'contig', fit: 'first', compact: 'never', memK: 1024, osK: 128, ops_contig: OPS.contig } },
    { label: 'Allocation: best fit leaves slivers', values: { mode: 'alloc', alloc: 'contig', fit: 'best', compact: 'never', memK: 1024, osK: 128, ops_contig: ['A=300', 'B=50', 'C=200', 'D=60', 'E=110', '-A', '-C', 'F=290', 'G=190', 'H=40', 'I=60'] } },
    { label: 'Allocation: segmentation', values: { mode: 'alloc', alloc: 'seg', fit: 'first', compact: 'on-fail', memK: 1024, osK: 128, ops_seg: OPS.seg } },
    { label: 'Allocation: the buddy system', values: { mode: 'alloc', alloc: 'buddy', arena: 1024, minBlock: 32, ops_buddy: OPS.buddy } },
    { label: 'Allocation: slab caches', values: { mode: 'alloc', alloc: 'slab', slabBytes: 1024, caches: ['inode:256', 'task:512', 'dentry:192'], ops_slab: OPS.slab } },
    { label: 'Allocation: malloc, segregated lists', values: { mode: 'alloc', alloc: 'malloc', heap: 256, mfit: 'segregated', ops_malloc: OPS.malloc } },
  ];
})(globalThis.Proses = globalThis.Proses || {});
