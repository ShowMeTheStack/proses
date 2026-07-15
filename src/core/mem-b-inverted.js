// Memory engines, part 2: an inverted page table. One entry per physical frame, holding the (pid, page) that
// lives there; a hash anchor table points at the first entry of each chain, and each entry points at the next one
// with the same hash. A lookup hashes (pid, vpn), reads the anchor, and follows the chain comparing; the frame
// number is the matching entry's position in the table.
//   S.Mem.ipt({frames, anchors, pageBytes, vaBits, entryBytes, anchorBytes, mult}) -> table
//     .hash(pid, vpn) -> slot ((vpn + mult·pid) mod anchors)
//     .place(frame, pid, vpn)   puts a page in a frame, at the head of its chain
//     .lookup(pid, vpn, off) -> {ok, frame, pa, slot, chain: [frames visited], steps, accesses}
//     .size() -> {entryBytes, iptBytes, anchorBytes, total}
//   S.Mem.forwardBytes({vaBits, pageBytes, pteBytes, procs}) -> bytes of one flat table per process
// And a hashed page table: buckets of chained entries (page, frame, next), one table per address space, sized by
// the pages mapped rather than the address space.
//   S.Mem.hpt({buckets, pageBytes, vaBits, entryBytes, bucketBytes}) -> table
//     .hash(vpn) -> bucket (vpn mod buckets)
//     .insert(vpn, pfn) -> {bucket, node, say}     a new entry at the head of its bucket's chain
//     .remove(vpn) -> bool
//     .lookup(vpn, off) -> {ok, pfn, pa, bucket, chain: [nodes visited], steps, accesses}
//     .chain(bucket) -> [nodes], .nodes [{vpn, pfn, next}], .size() -> {nodeBytes, bucketBytes, total}
//     .lengths() -> chain lengths per bucket
(function (S) {
  'use strict';
  const M = (S.Mem = S.Mem || {});

  M.ipt = function (o) {
    const frames = o.frames, anchors = o.anchors, mult = o.mult || 7;
    const pageBytes = o.pageBytes || 4096, offBits = M.log2(pageBytes), vaBits = o.vaBits || 32;
    const entryBytes = o.entryBytes || 8, anchorBytes = o.anchorBytes || 4;
    const entries = Array.from({ length: frames }, () => null); // {pid, vpn, next}
    const anchor = Array(anchors).fill(-1);
    const T = { frames, anchors, mult, pageBytes, offBits, vaBits, entries, anchor, entryBytes, anchorBytes };
    T.hash = (pid, vpn) => (vpn + mult * pid) % anchors;
    T.place = function (frame, pid, vpn) {
      if (entries[frame]) throw new Error('frame ' + frame + ' is in use');
      for (const e of entries) if (e && e.pid === pid && e.vpn === vpn) throw new Error('page ' + vpn + ' of pid ' + pid + ' is resident already');
      const h = T.hash(pid, vpn);
      entries[frame] = { pid, vpn, next: anchor[h] };
      anchor[h] = frame;
      return h;
    };
    /** the frames on a slot's chain, in order */
    T.chain = function (slot) { const out = []; for (let f = anchor[slot]; f !== -1; f = entries[f].next) out.push(f); return out; };
    T.lookup = function (pid, vpn, off) {
      off = off || 0;
      const h = T.hash(pid, vpn), steps = [], chain = [];
      steps.push({ kind: 'hash', slot: h, say: 'Hash (pid ' + pid + ', page ' + vpn + '): (' + vpn + ' + ' + mult + ' × ' + pid + ') mod ' + anchors + ' = ' + h + '.' });
      let accesses = 1;
      const first = anchor[h];
      steps.push({ kind: 'anchor', slot: h, frame: first, access: accesses, say: first === -1 ? 'Anchor ' + h + ' is empty: no resident page hashes here, so this is a page fault.' : 'Anchor ' + h + ' points at entry ' + first + ', the head of its chain (memory access ' + accesses + ').' });
      for (let f = first; f !== -1; f = entries[f].next) {
        const e = entries[f], hit = e.pid === pid && e.vpn === vpn;
        accesses++;
        chain.push(f);
        steps.push({ kind: 'compare', frame: f, hit, entry: Object.assign({}, e), access: accesses, say: hit
          ? 'Entry ' + f + ' holds (pid ' + e.pid + ', page ' + e.vpn + '): a match, so the page is in frame ' + f + ', the entry’s own position (memory access ' + accesses + ').'
          : 'Entry ' + f + ' holds (pid ' + e.pid + ', page ' + e.vpn + '), not ours; ' + (e.next === -1 ? 'the chain ends here.' : 'follow its link to entry ' + e.next + '.') + ' (memory access ' + accesses + ')' });
        if (hit) {
          const pa = f * pageBytes + off;
          steps.push({ kind: 'frame', frame: f, pa, accesses: accesses + 1, say: 'Frame ' + f + ' × ' + pageBytes + ' + offset ' + M.hex(off, offBits) + ' = physical address ' + M.hex(pa, offBits + Math.ceil(Math.log2(frames))) + '; with the data itself that is ' + (accesses + 1) + ' memory accesses.' });
          return { ok: true, frame: f, pa, slot: h, chain, steps, accesses: accesses + 1 };
        }
      }
      if (first !== -1) steps.push({ kind: 'fault', slot: h, accesses, say: 'The chain of anchor ' + h + ' ended without (pid ' + pid + ', page ' + vpn + '): it is not resident, so this is a page fault after ' + accesses + ' memory accesses.' });
      return { ok: false, frame: -1, slot: h, chain, steps, accesses };
    };
    T.size = function () {
      const iptBytes = frames * entryBytes, anchorTable = anchors * anchorBytes;
      return { entryBytes, iptBytes, anchorBytes: anchorTable, total: iptBytes + anchorTable };
    };
    return T;
  };

  M.hpt = function (o) {
    const buckets = o.buckets || 16, pageBytes = o.pageBytes || 4096, offBits = M.log2(pageBytes);
    const entryBytes = o.entryBytes || 16, bucketBytes = o.bucketBytes || 8;
    const head = Array(buckets).fill(-1), nodes = [];
    const T = { buckets, pageBytes, head, nodes };
    T.hash = (vpn) => Number(BigInt(vpn) % BigInt(buckets));
    T.chain = function (b) { const out = []; for (let k = head[b]; k !== -1; k = nodes[k].next) out.push(k); return out; };
    T.find = (vpn) => { const b = T.hash(vpn); return T.chain(b).find((k) => nodes[k].vpn === Number(vpn)); };
    T.insert = function (vpn, pfn) {
      if (T.find(vpn) !== undefined) throw new Error('page ' + vpn + ' is mapped already');
      const b = T.hash(vpn), k = nodes.length;
      nodes.push({ vpn: Number(vpn), pfn: Number(pfn), next: head[b] });
      head[b] = k;
      return { bucket: b, node: k, say: 'Page ' + vpn + ' hashes to bucket ' + b + ' (' + vpn + ' mod ' + buckets + '); its entry, frame ' + pfn + ', goes at the head of the chain.' };
    };
    T.remove = function (vpn) {
      const b = T.hash(vpn);
      let prev = -1;
      for (let k = head[b]; k !== -1; prev = k, k = nodes[k].next) {
        if (nodes[k].vpn !== Number(vpn)) continue;
        if (prev < 0) head[b] = nodes[k].next; else nodes[prev].next = nodes[k].next;
        nodes[k].removed = true;
        return true;
      }
      return false;
    };
    T.lookup = function (vpn, off) {
      off = off || 0;
      const b = T.hash(vpn), steps = [], chain = [];
      let accesses = 1;
      steps.push({ kind: 'hash', bucket: b, say: 'Page ' + vpn + ' hashes to bucket ' + b + ': ' + vpn + ' mod ' + buckets + ' = ' + b + '; reading the bucket is memory access 1.' });
      for (let k = head[b]; k !== -1; k = nodes[k].next) {
        const e = nodes[k], hit = e.vpn === Number(vpn);
        accesses++;
        chain.push(k);
        steps.push({ kind: 'compare', node: k, hit, entry: Object.assign({}, e), access: accesses, say: 'Entry for page ' + e.vpn + (hit ? ': a match, frame ' + e.pfn + '.' : ': not ours, ' + (e.next === -1 ? 'and the chain ends.' : 'follow the link.')) + ' (memory access ' + accesses + ')' });
        if (hit) {
          const pa = e.pfn * pageBytes + off;
          steps.push({ kind: 'frame', pfn: e.pfn, pa, accesses: accesses + 1, say: 'Frame ' + e.pfn + ' × ' + pageBytes + ' + ' + M.hex(off, offBits) + ' = ' + M.hex(pa, 0) + '; with the data, ' + (accesses + 1) + ' memory accesses.' });
          return { ok: true, pfn: e.pfn, pa, bucket: b, chain, steps, accesses: accesses + 1 };
        }
      }
      steps.push({ kind: 'fault', bucket: b, accesses, say: 'No entry for page ' + vpn + ' in bucket ' + b + ': a page fault after ' + accesses + ' memory access' + (accesses > 1 ? 'es' : '') + '.' });
      return { ok: false, pfn: -1, bucket: b, chain, steps, accesses };
    };
    T.lengths = () => head.map((_, b) => T.chain(b).length);
    T.size = function () { const live = nodes.filter((n) => !n.removed).length; return { nodeBytes: live * entryBytes, bucketBytes: buckets * bucketBytes, total: live * entryBytes + buckets * bucketBytes }; };
    return T;
  };

  /** one flat (single-level) forward table per process, covering the whole virtual space */
  M.forwardBytes = (o) => (o.procs || 1) * 2 ** (o.vaBits - M.log2(o.pageBytes)) * (o.pteBytes || 4);
})(globalThis.Proses = globalThis.Proses || {});
