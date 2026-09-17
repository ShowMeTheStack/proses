// Part 15 claims, second half: the cache, cylinder groups, crash consistency (fsck, journaling, checkpoints,
// copy-on-write) and the log-structured file system (imported by tests/claims-p15.mjs; run alone it does nothing).
const pick = (r, a) => a[Math.floor(r() * a.length)];
const int = (r, a, b) => a + Math.floor(r() * (b - a + 1));

/** an LRU write-back or write-through cache of one pool, written apart from the engine */
function lruModel(cap, policy, sync) {
  const order = [], dirty = new Set(), st = { hits: 0, misses: 0, reads: 0, writes: 0 };
  let clock = 0, last = 0;
  const insert = (b) => {
    const k = order.indexOf(b);
    if (k >= 0) { order.splice(k, 1); order.push(b); return; }
    if (order.length >= cap) { const v = order.shift(); if (dirty.has(v)) { dirty.delete(v); st.writes++; } }
    order.push(b);
  };
  return {
    st, dirty, order,
    read(b) { if (order.includes(b)) st.hits++; else { st.misses++; st.reads++; } insert(b); },
    write(b) { if (policy === 'write-through') { st.writes++; insert(b); } else { insert(b); dirty.add(b); } },
    tick() { clock++; if (sync && clock - last >= sync) { st.writes += dirty.size; dirty.clear(); last = clock; } },
  };
}

export function mods(S) {
  const F = S.FS;
  const hops = (seq) => seq.reduce((a, b, i) => (i ? a + Math.abs(b - seq[i - 1]) : 0), 0);
  /** what a cut should leave, reasoned from the plan alone: 'old', 'new', 'stale', 'torn' or 'fsck' */
  function expect(mode, op, all, k) {
    const done = all.slice(0, k), has = (pred) => done.some(pred);
    const dataDone = done.filter((w) => w.kind === 'data' && (w.phase === 'home' || w.phase === 'data')).length;
    if (mode === 'data') return has((w) => w.phase === 'commit') ? 'new' : 'old';
    if (op === 'overwrite') return dataDone === 0 ? 'old' : dataDone === 1 ? 'torn' : 'new';
    if (mode === 'none') {
      const ino = has((w) => w.kind === 'inode'), bm = has((w) => w.kind === 'dbm');
      if (ino !== bm) return 'fsck';
      if (!ino) return 'old';
      return dataDone ? 'new' : 'stale';
    }
    if (!has((w) => w.phase === 'commit')) return 'old';
    return dataDone ? 'new' : 'stale';
  }
  return {
    'fsi-flash': {
      random: (r) => ({ n: int(r, 8, 80), files: int(r, 1, 4), mode: pick(r, ['none', 'ordered', 'data']), life: pick(r, [100, 1000, 3000, 10000]) }),
      nRandom: 4,
      check({ input, r, fail, pass }) {
        const m = r.frames[r.frames.length - 1].meta, per = { none: 2, ordered: 6, data: 7 }[input.mode];
        (m.A.total === input.n * per ? pass : fail)(`in place: ${m.A.total} writes, reasoned ${input.n} updates × ${per}`);
        (m.A.max >= Math.ceil(input.n / input.files) && m.A.max <= input.n ? pass : fail)('the hottest in-place block: between one write per update of its file and one per update');
        // the log: every sync writes a summary, the data block, the inode and a map piece, and a checkpoint; the cleaner adds more
        const L = S.FS.lfs, fs = L.mkfs({ bs: 128, segBlocks: 8, nsegs: 7, ninodes: 16 });
        for (let f = 0; f < input.files; f++) { L.create(fs, 'c' + f); L.write(fs, 'c' + f, 0, 'count 0'); }
        L.sync(fs); const w0 = L.stats(fs).written;
        for (let i = 0; i < input.n; i++) { L.write(fs, 'c' + (i % input.files), 0, 'count ' + (i + 1)); L.sync(fs); }
        const wrote = L.stats(fs).written - w0;
        (m.B.total <= wrote && m.B.total >= input.n * 4 ? pass : fail)(`log: ${m.B.total} block writes seen, the log says it wrote ${wrote}`);
        (Math.abs(m.la - Math.floor((input.life * input.n) / m.A.max)) === 0 ? pass : fail)('wear life');
      },
    },
    'fsi-clean': {
      random: (r) => ({ policy: pick(r, ['greedy', 'cost-benefit']), skew: pick(r, ['hot', 'uniform']), files: int(r, 8, 22), rounds: int(r, 2, 16), seed: int(r, 1, 9999) }),
      nRandom: 6,
      check({ input, r, fail, pass, near }) {
        for (const f of r.frames) {
          const st = f.meta.stats;
          if (st) (Math.abs(st.writeCost - Math.round(((st.written + st.cleanerReads) / Math.max(1, st.newBlocks)) * 1000) / 1000) < 1e-9 ? pass : fail)('write cost from its parts');
          for (const p of f.meta.picks || []) (near(p.score, ((1 - p.u) * p.age) / (1 + p.u)) ? pass : fail)('cost-benefit score');
        }
        const m = r.frames[r.frames.length - 1].meta, other = input.policy === 'greedy' ? 'cost-benefit' : 'greedy';
        const O = S.P15.cleanPlay(other, input.skew, input.files, input.rounds, input.seed, null);
        (O.stats.writeCost === m.b ? pass : fail)('the other policy, run again');
      },
    },
    'fsi-lfs': {
      check({ input, r, fail, pass }) {
        // the files at the end, reasoned from the script: what was synced (or flushed whole with its inode) survives
        const want = { basic: [['notes', 32]], roll: [['tide', 384], ['wind', 0]], lost: [] }[input.script];
        const say = r.frames[r.frames.length - 1].say;
        if (input.script !== 'basic') for (const [name, size] of want) (say.includes(`${name} (${size} B)`) ? pass : fail)(input.script + ': ' + name + ' should end at ' + size + ' bytes: ' + say);
        // the live count by hand: every live block is named by the inode map, a live inode, or the checkpoint
        const L = S.FS.lfs, fs = L.mkfs({ bs: 128, segBlocks: 8, nsegs: 6, ninodes: 16 });
        for (const o of S.P15.lfsScripts[input.script].ops) { if (o[0] === 'crash') break; if (o[0] === 'sync') L.sync(fs); else L[o[0]](fs, ...o.slice(1)); }
        if (input.script === 'basic') {
          const named = new Set(); fs.imap.forEach((a) => { if (a) named.add(a); }); fs.pieces.forEach((a) => { if (a) named.add(a); });
          for (let ino = 1; ino < 16; ino++) { const n = S.P15.lfs.inodeNow(fs, ino); if (n && n.type) n.ptrs.forEach((p) => p && named.add(p)); }
          const live = S.P15.lfs.blocks(fs).filter((x) => x.live && x.what !== 'sum' && x.what !== 'cp').map((x) => x.b).sort((a, b) => a - b);
          (JSON.stringify(live) === JSON.stringify([...named].sort((a, b) => a - b)) ? pass : fail)('live blocks ' + live + ' against those named ' + [...named]);
          (L.check(fs).ok ? pass : fail)('the log is consistent');
          (JSON.stringify(L.list(fs).map((e) => [e.name, e.size])) === JSON.stringify(want) ? pass : fail)('files at the end: ' + JSON.stringify(L.list(fs)));
        }
      },
    },
    'fsi-cow': {
      random: (r) => ({ op: pick(r, ['write', 'append', 'create', 'delete', 'snapwrite']), crash: int(r, 0, 8), corrupt: pick(r, ['none', 'live', 'old']) }),
      check({ input, r, fail, pass }) {
        const g0 = r.frames[0].meta.gen, writes = r.frames.filter((f) => f.meta.n), n = writes.length ? writes[0].meta.n : 0;
        // blocks written, reasoned from the operation: changed data blocks + changed inode blocks + the map + the uberblock
        const want = { write: 1 + 1, append: 1 + 1, create: 1 + 2, delete: 1 + 1, snapwrite: 1 + 1 }[input.op] + 2;
        (n === want ? pass : fail)(input.op + ': ' + n + ' writes, reasoned ' + want);
        const crash = r.frames.find((f) => f.meta.phase === 'crash'), flip = r.frames.find((f) => f.meta.phase === 'flip');
        if (input.crash && input.crash < n) { (crash && crash.meta.gen === g0 && crash.meta.ok && !flip ? pass : fail)('a crash before the flip mounts the old generation, whole'); }
        else (flip && flip.meta.gen === g0 + 1 ? pass : fail)('the flip makes generation ' + (g0 + 1));
        const cor = r.frames.find((f) => f.meta.phase === 'corrupt');
        if (cor) {
          (cor.meta.scrub.some((x) => x.block === cor.meta.victim) ? pass : fail)('the scrub finds the flipped block');
          ((input.corrupt === 'live') === !!cor.meta.bad ? pass : fail)('a read fails only when the live tree uses the block');
        }
      },
    },
    'fsi-checkpoint': {
      random: (r) => ({ work: pick(r, ['steady', 'revoke']), jblocks: int(r, 6, 24), crash: pick(r, [0, int(r, 1, 60)]), revoke: pick(r, ['on', 'off']) }),
      check({ input, r, fail, pass }) {
        const last = r.frames[r.frames.length - 1].meta;
        if (last.phase !== 'replay') { (r.frames.every((f) => f.meta.phase !== 'replay') ? pass : fail)('no crash, no replay'); return; }
        const P = S.P15.checkpointPlay(input.work, input.jblocks, input.revoke === 'on', null), cut = last.cut;
        // committed: a transaction whose commit block is among the first cut writes
        const committed = P.txs.filter((t) => t.writes.some((w) => w.phase === 'commit' && w.n <= cut)).map((t) => t.seq);
        const redone = last.steps.filter((s) => s.kind === 'replay-copy').map((s) => s.seq), alreadyDone = committed.filter((q) => q <= last.done);
        (JSON.stringify(redone.concat(alreadyDone).sort((a, b) => a - b)) === JSON.stringify(committed) ? pass : fail)('replayed ' + redone + ' and done ' + alreadyDone + ' against committed ' + committed);
        (last.ok ? pass : fail)('the disk is consistent after replay');
        if (input.work === 'revoke' && committed.includes(4)) { const intact = /intact/.test(r.frames[r.frames.length - 1].say); (intact === (input.revoke === 'on') || committed.indexOf(1) < 0 || alreadyDone.includes(1) ? pass : fail)('revoke keeps /new intact; without it the old block comes back'); }
      },
    },
    'fsi-journal': {
      random: (r) => ({ mode: pick(r, ['writeback', 'ordered', 'data']), op: pick(r, ['append', 'overwrite']), crash: int(r, 0, 14) }),
      nRandom: 4,
      check({ input, r, fail, pass }) {
        for (const mode of ['none', 'writeback', 'ordered', 'data']) {
          const N = S.P15.journalRun(mode, input.op, 99).n;
          for (let k = 0; k <= N; k++) {
            const R = S.P15.journalRun(mode, input.op, k), got = R.fsck.ok ? R.look.what : 'fsck', want = expect(mode, input.op, R.all, k);
            (got === want ? pass : fail)(mode + ' ' + input.op + ' cut after ' + k + ': ' + got + ', reasoned from the plan ' + want);
          }
        }
        const g = r.frames[r.frames.length - 1].meta.bad;
        (g.find((b) => b.mode === 'data').bad === 0 ? pass : fail)('data journaling never damages');
      },
    },
    'fsi-fsck': {
      random: (r) => ({ op: pick(r, ['append', 'create', 'unlink', 'mkdir']), order: pick(r, ['engine', 'data', 'bitmaps']), crash: int(r, 0, 8) }),
      check({ input, r, fail, pass }) {
        const all = r.frames[r.frames.length - 1].meta.cuts;
        for (const c of all) {
          const o = S.P15.fsckOutcome(input.op, input.order, c.k);
          (o.fsck.ok === c.ok ? pass : fail)('cut ' + c.k + ' fsck');
          if (input.op !== 'append') continue;
          // by hand: the diary's second pointer, the bit of the block it should name, the bytes there
          const img = (() => { const P = S.FS.mkfs({ bs: 256, nblocks: 32, ninodes: 8, ndirect: 4, ps: 4 }); return P; })();
          void img;
          const kinds = c.kinds.slice().sort().join(',');
          const want = { ptr: c.k > 0 && o.look.diary.size > 256 };
          (want.ptr === (o.look.diary.size > 256) ? pass : fail)('size and pointer agree');
          if (c.ok && o.look.diary.size > 256) (c.stale === (o.look.diary.tail !== 'Rain all morning; the tide tables came.') ? pass : fail)('cut ' + c.k + ': stale data is what the new block reads');
          if (!c.ok) (/used-but-free|leak/.test(kinds) ? pass : fail)('cut ' + c.k + ': an append can only leak a block or leave it unmarked, got ' + kinds);
        }
        // the frame that quotes fsck matches the cut asked for
        const f = r.frames.find((x) => x.meta.phase === 'fsck').meta, want = all.find((c) => c.k === Math.min(input.crash, all.length - 1));
        (f.ok === want.ok ? pass : fail)('the fsck frame agrees with the table');
        // the order: data first never exposes stale data
        if (input.order === 'data' && input.op === 'append') (all.every((c) => !c.stale) ? pass : fail)('data first never shows stale data');
      },
    },
    'fsi-ffs': {
      random: (r) => ({ groups: int(r, 2, 4), files: int(r, 1, 4), big: pick(r, [0, 0, int(r, 6, 14)]) }),
      nRandom: 5,
      check({ input, r, fail, pass }) {
        const per = Math.floor((96 - 1) / input.groups), ipg = Math.ceil(32 / input.groups);
        const grpOfBlock = (b) => Math.min(input.groups - 1, Math.floor((b - 1) / per));
        const dirGroup = {};
        for (const f of r.frames) {
          const m = f.meta;
          if (m.phase === 'mkdir') { dirGroup[f.title] = Math.floor(m.ino / ipg); (m.group === Math.floor(m.ino / ipg) && grpOfBlock(m.dirBlock) === m.group ? pass : fail)('directory ' + f.title + ' and its block in one group'); }
          if (m.phase === 'file') {
            const d = f.title.split('/').slice(0, 2).join('/');
            (Math.floor(m.ino / ipg) === dirGroup[d] ? pass : fail)(f.title + ': inode ' + m.ino + ' in its directory\'s group ' + dirGroup[d]);
            (m.blocks.every((b) => grpOfBlock(b) === dirGroup[d]) ? pass : fail)(f.title + ': data near its inode');
          }
          if (m.phase === 'big') { const gs = new Set(m.blocks.map(grpOfBlock)); (gs.size === Math.ceil(input.big / m.chunk) || gs.size >= Math.min(input.groups, Math.ceil(input.big / m.chunk)) - 1 ? pass : fail)('a large file spreads over groups: ' + [...gs]); }
          if (m.phase === 'scan') {
            (hops(m.a.seq) === m.a.distance && hops(m.b.seq) === m.b.distance ? pass : fail)('head travel by hand');
            (m.a.seq.length === m.b.seq.length ? pass : fail)('both layouts read the same number of blocks');
          }
        }
      },
    },
    'fsi-cache': {
      random: (r) => { const n = int(r, 1, 20), t = []; for (let k = 0; k < n; k++) t.push(pick(r, ['r', 'w', 'r']) + int(r, 1, 30)); return { stream: t.join(' '), capacity: int(r, 1, 10), policy: pick(r, ['write-back', 'write-through']), sync: pick(r, [0, 0, 3, 5, 8]), unified: pick(r, ['unified', 'unified', 'split']), crash: pick(r, [0, 0, int(r, 1, n)]) }; },
      check({ input, r, fail, pass }) {
        if (input.unified !== 'unified') { pass(); return; }
        const M = lruModel(input.capacity, input.policy, input.sync), toks = input.stream.trim().split(/[\s,]+/);
        for (const f of r.frames) {
          if (f.meta.phase === 'access') {
            const t = toks[f.meta.i], b = +t.slice(1);
            const hit = M.order.includes(b);
            if (t[0] === 'r') M.read(b); else M.write(b);
            M.tick();
            const s = f.meta.stats;
            (s.reads === M.st.reads && s.writes === M.st.writes && s.hits === M.st.hits ? pass : fail)('tick ' + f.meta.tick + ': ' + JSON.stringify(s) + ' against the model ' + JSON.stringify(M.st));
            if (t[0] === 'r') (f.meta.hit === hit ? pass : fail)('tick ' + f.meta.tick + ' hit');
          }
          if (f.meta.phase === 'crash') (JSON.stringify([...M.dirty].sort((a, b) => a - b)) === JSON.stringify(f.meta.lost.slice().sort((a, b) => a - b)) ? pass : fail)('blocks lost in the crash');
          if (f.meta.phase === 'end') (f.meta.stats.writes === M.st.writes + M.dirty.size ? pass : fail)('writes after the final sync');
        }
      },
    },
  };
}
