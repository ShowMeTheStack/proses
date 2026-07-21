// A block-level file system, part 9: the buffer cache and disk time.
//   new F.Cache({capacity, policy: 'write-back'|'write-through', sync: ticks between flushes (0: never),
//                unified: true|false})
//     cache.read(key, data?) -> {hit, evicted}    a block read through the cache; a miss is a disk read
//     cache.write(key, data?) -> {hit, evicted}   write-through: a disk write now; write-back: the block is dirty
//     cache.evict -> the least recently used block goes; a dirty one is written (cache.onWrite(key) is called)
//     cache.flush() -> [keys written]   every dirty block written; cache.tick(dt) flushes when the sync interval
//         passes; cache.drop() forgets everything (a crash)
//     cache.stats {hits, misses, reads, writes, evictions, copies}; cache.snapshot() -> [{key, dirty, kind}] in LRU
//         order, most recent last
//     unified: false models a separate page cache and buffer cache: a file's data block read through read() is
//         held twice (once in each), so the same memory caches fewer distinct blocks (stats.copies counts them).
//     capacity 0 is no cache at all: every read and write goes to the disk.
//   Keys are 'dev:block' strings, or block numbers; kind 'data' or 'meta' says which cache a block belongs to.
//   F.diskTime(blocks, {bs, disk}) -> {ms, items, model}   the time to serve the block accesses in order: through
//     S.Storage (the disk model) when it is loaded, else a stand-in (seek 1 + 0.02·d ms over d cylinders of 16
//     blocks, half a turn at 7200 rpm, 0.05 ms a block).
(function (S) {
  'use strict';
  const F = (S.FS = S.FS || {});

  class Cache {
    constructor(o) {
      o = o || {};
      this.capacity = o.capacity === undefined ? 8 : o.capacity; this.policy = o.policy || 'write-back'; this.sync = o.sync || 0; this.unified = o.unified !== false;
      this.lru = new Map(); this.dirty = new Set(); this.clock = 0; this.lastSync = 0; this.onWrite = o.onWrite || null;
      this.stats = { hits: 0, misses: 0, reads: 0, writes: 0, evictions: 0, copies: 0 };
    }
    slots(kind) { return this.unified ? this.capacity : kind === 'data' ? Math.floor(this.capacity / 2) : this.capacity - Math.floor(this.capacity / 2); }
    held(kind) { let n = 0; for (const v of this.lru.values()) if (this.unified || v.pool === kind) n++; return n; }
    touch(key, kind, pool) { const v = this.lru.get(pool + key) || { key, kind, pool }; this.lru.delete(pool + key); this.lru.set(pool + key, v); }
    evictFrom(pool) {
      for (const [k, v] of this.lru) {
        if (!this.unified && v.pool !== pool) continue;
        this.lru.delete(k); this.stats.evictions++;
        if (this.dirty.has(v.key) && ![...this.lru.values()].some((x) => x.key === v.key)) { this.dirty.delete(v.key); this.stats.writes++; if (this.onWrite) this.onWrite(v.key); return { key: v.key, written: true }; }
        return { key: v.key, written: false };
      }
      return null;
    }
    insert(key, kind) {
      const pools = this.unified ? ['u'] : kind === 'data' ? ['data', 'meta'] : ['meta'];
      let evicted = null;
      for (const pool of pools) {
        if (this.lru.has(pool + key)) { this.touch(key, kind, pool); continue; }
        if (this.held(pool) >= this.slots(pool)) evicted = this.evictFrom(pool) || evicted;
        this.touch(key, kind, pool);
        if (pools.length > 1 && pool === 'meta') this.stats.copies++;
      }
      return evicted;
    }
    has(key) { for (const v of this.lru.values()) if (v.key === key) return true; return false; }
    read(key, kind) {
      kind = kind || 'meta';
      if (!this.capacity) { this.stats.misses++; this.stats.reads++; return { hit: false }; }
      const hit = this.has(key);
      if (hit) this.stats.hits++; else { this.stats.misses++; this.stats.reads++; }
      const evicted = this.insert(key, kind);
      return { hit, evicted };
    }
    write(key, kind) {
      kind = kind || 'meta';
      if (!this.capacity || this.policy === 'write-through') { this.stats.writes++; if (this.capacity) return { hit: this.has(key), evicted: this.insert(key, kind), written: true }; return { written: true }; }
      const hit = this.has(key), evicted = this.insert(key, kind);
      this.dirty.add(key);
      return { hit, evicted, written: false };
    }
    flush() { const out = [...this.dirty]; for (const k of out) { this.stats.writes++; if (this.onWrite) this.onWrite(k); } this.dirty.clear(); this.lastSync = this.clock; return out; }
    tick(dt) { this.clock += dt || 1; if (this.sync && this.clock - this.lastSync >= this.sync) return this.flush(); return []; }
    drop() { const lost = [...this.dirty]; this.lru.clear(); this.dirty.clear(); return lost; }
    snapshot() { return [...this.lru.values()].map((v) => ({ key: v.key, kind: v.kind, pool: v.pool, dirty: this.dirty.has(v.key) })); }
  }
  F.Cache = Cache;

  F.diskTime = function (blocks, o) {
    o = o || {};
    const bs = o.bs || 512, per = Math.max(1, bs / 512), St = S.Storage;
    if (St && St.disk && St.serve) {
      try {
        const D = o.disk || St.disk({ cylinders: 200, heads: 2, spt: 32, rpm: 7200 });
        const r = St.serve(D, blocks.map((b, i) => ({ lba: b * per, count: per, id: i })), { cyl: 0, t: 0 });
        return { ms: r.total, items: r.items.map((x) => ({ seek: x.seek.ms, rotation: x.rotation.ms, transfer: x.transfer.ms })), model: 'storage' };
      } catch (e) { /* fall back to the stand-in */ }
    }
    let cyl = 0, ms = 0;
    const items = blocks.map((b) => { const c = Math.floor(b / 16), d = Math.abs(c - cyl), seek = d ? 1 + 0.02 * d : 0, it = { seek, rotation: 4.17, transfer: 0.05 }; cyl = c; ms += seek + 4.17 + 0.05; return it; });
    return { ms: +ms.toFixed(3), items, model: 'stand-in' };
  };
})(globalThis.Proses = globalThis.Proses || {});
