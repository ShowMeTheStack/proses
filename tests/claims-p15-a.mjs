// Part 15 claims, first half: the layout, commands, allocation, the inode walk, free space, lookup and costs
// (imported by tests/claims-p15.mjs; run alone it does nothing).
const pick = (r, a) => a[Math.floor(r() * a.length)];
const int = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const pow2 = (n) => { let p = 1; while (p < n) p *= 2; return p; };

export function mods(S) {
  const F = S.FS;
  /** the layout by the formulas, apart from the engine */
  function layoutByHand(bs, nblocks, ninodes, nd, ps, jb) {
    const bits = bs * 8, isz = Math.max(32, pow2(16 + (nd + 3) * ps)), ibm = Math.ceil(ninodes / bits), it = Math.ceil((ninodes * isz) / bs);
    let dbm = 1, ndata;
    for (;;) { ndata = nblocks - 1 - ibm - dbm - it - jb; if (Math.ceil(ndata / bits) <= dbm) break; dbm++; }
    const P = bs / ps;
    return { isz, ibm, dbm, it, ndata, dataStart: nblocks - ndata, perBlk: bs / isz, P, max: bs * (nd + P + P * P + P * P * P) };
  }
  const CMDS = ['mkdir /a', 'create /a/f', 'write /a/f 0 hello there', 'append /a/f more text', 'link /a/f /g', 'unlink /a/f', 'create /h', 'write /h 300 far out', 'truncate /h 10', 'symlink /h /s', 'rename /h /a/h2', 'rmdir /a', 'unlink /g', 'mkdir /b', 'rmdir /b', 'create /a/f'];
  /** a file's data blocks read by hand from the raw image, for each allocation method */
  function blocksByHand(img, ino) {
    const g = img.g, a = F.inodeAt(g, ino), u = img.bytes, off = a.block * g.bs + a.off, ps = g.ps;
    const rd = (o) => (ps === 2 ? u[o] | (u[o + 1] << 8) : (u[o] | (u[o + 1] << 8) | (u[o + 2] << 16) | (u[o + 3] << 24)) >>> 0);
    const slot = (i) => rd(off + 16 + i * ps), out = [];
    if (g.alloc === 'contiguous') { for (let k = 0; k < slot(1); k++) out.push(slot(0) + k); return out; }
    if (g.alloc === 'extent') { for (let e = 0; e < Math.floor((g.ndirect + 3) / 2); e++) for (let k = 0; k < slot(2 * e + 1); k++) out.push(slot(2 * e) + k); return out; }
    if (g.alloc === 'linked' || g.alloc === 'fat') {
      let b = slot(0);
      for (let k = 0; k < slot(2); k++) { out.push(b); b = g.alloc === 'linked' ? rd(b * g.bs + g.bs - ps) : rd(g.dbmStart * g.bs + (b - g.dataStart) * ps); }
      return out;
    }
    for (let i = 0; i < g.ndirect; i++) if (slot(i)) out.push(slot(i));
    const s1 = slot(g.ndirect);
    if (s1) for (let k = 0; k < g.bs / ps; k++) { const p = rd(s1 * g.bs + k * ps); if (p) out.push(p); }
    return out;
  }
  /** resolve a path by hand on an image: {ino, dirs, err} (names looked up with F.list, links read with F.readlink) */
  function resolve(img, path, cred) {
    let comps = path.split('/').filter(Boolean), ino = 1, dirs = 0, links = 0;
    const pathOf = new Map([[1, '/']]);
    while (comps.length) {
      const c = comps.shift(), here = pathOf.get(ino), st = F.stat(img, ino);
      if (st.type !== 'directory') return { ino: 0, dirs, err: 'ENOTDIR' };
      const bits = cred.uid === 0 ? 7 : cred.uid === st.uid ? (st.mode >> 6) & 7 : cred.gid === st.gid ? (st.mode >> 3) & 7 : st.mode & 7;
      if (!(bits & 1)) return { ino: 0, dirs, err: 'EACCES' };
      dirs++;
      const e = F.list(img, here).find((x) => x.name === c);
      if (!e) return { ino: 0, dirs, err: null };
      const t = F.stat(img, e.ino, { nofollow: true });
      if (t.type === 'symlink') { if (++links > 8) return { ino: 0, dirs, err: 'ELOOP' }; const target = F.readlink(img, (here === '/' ? '' : here) + '/' + c); comps = target.split('/').filter(Boolean).concat(comps); if (target.startsWith('/')) ino = 1; continue; }
      if (c === '..' || c === '.') { ino = e.ino; continue; }
      pathOf.set(e.ino, (here === '/' ? '' : here) + '/' + c);
      ino = e.ino;
    }
    return { ino, dirs, err: null };
  }
  const USERS = { root: { uid: 0, gid: 0 }, ana: { uid: 1, gid: 1 }, ben: { uid: 2, gid: 2 } };
  const PATHS = ['/home/ana/notes/todo', '/links/docs/plan', '/home/ben/secret', '/links/loop', '/etc/shadow', '/home/ana/../ben/secret', '/etc/hosts', '/links/docs/../notes/todo', '/home', '/links/docs/todo/x'];
  return {
    'fsi-costs': {
      random: (r) => { const mode = pick(r, ['none', 'none', 'ordered', 'data']); return { capacity: pick(r, [0, 1, 2, 4, 8, 16, 32]), policy: mode === 'none' ? pick(r, ['write-back', 'write-through']) : 'write-through', size: int(r, 1, 12), mode }; },
      check({ input, r, fail, pass }) {
        // the same sequence through the engine's own cost table
        const geo = { bs: 128, nblocks: 64, ninodes: 16, ndirect: 4, ps: 4, jblocks: input.mode === 'none' ? 0 : 20 };
        const text = 'x'.repeat(128 * input.size);
        const A = F.costs(geo, { mode: input.mode, cache: { capacity: 0 }, text }), B = F.costs(geo, { mode: input.mode, cache: { capacity: input.capacity, policy: input.policy }, text });
        const ops = r.frames.filter((f) => f.meta.a);
        ops.forEach((f) => {
          const a = A.find((x) => x.op === f.meta.phase), b = B.find((x) => x.op === f.meta.phase);
          (a.reads === f.meta.a.reads && a.writes === f.meta.a.writes && b.reads === f.meta.b.reads && b.writes === f.meta.b.writes && b.hits === f.meta.b.hits ? pass : fail)(f.meta.phase + ': ' + JSON.stringify([f.meta.a, f.meta.b]) + ' against ' + JSON.stringify([a, b]));
          (f.meta.a.hits === 0 ? pass : fail)('no hits without a cache');
        });
        const t = r.frames[r.frames.length - 1].meta;
        (t.sa.reads === A.reduce((x, y) => x + y.reads, 0) && t.sb.writes === B.reduce((x, y) => x + y.writes, 0) ? pass : fail)('totals');
        if (input.policy === 'write-through' || !input.capacity) (t.sb.writes === t.sa.writes ? pass : fail)('write-through saves no writes');
      },
    },
    'fsi-lookup': {
      random: (r) => ({ path: pick(r, PATHS), user: pick(r, ['root', 'ana', 'ben']) }),
      check({ input, r, fail, pass }) {
        // the same tree, rebuilt; '..' is resolved through the entries, as the topic does
        const t = S.byId('fsi-lookup'), last = r.frames[r.frames.length - 1].meta;
        const img = (() => { const im = F.mkfs({ bs: 128, nblocks: 64, ninodes: 24, ndirect: 4, ps: 4 }), run = (op, ...a) => F.apply(im, op, a);
          run('mkdir', '/etc'); run('create', '/etc/hosts'); run('create', '/etc/passwd'); run('mkdir', '/home'); run('mkdir', '/home/ana'); run('mkdir', '/home/ana/notes'); run('create', '/home/ana/notes/todo'); run('create', '/home/ana/notes/plan'); run('mkdir', '/home/ben'); run('create', '/home/ben/secret'); run('chown', '/home/ana', 1, 1); run('chown', '/home/ben', 2, 2); run('chmod', '/home/ben', 0o700); run('mkdir', '/links'); run('symlink', '/home/ana/notes', '/links/docs'); run('symlink', '/links/loop', '/links/loop'); return im; })();
        void t;
        const want = resolve(img, input.path, USERS[input.user]);
        (want.ino === last.ino ? pass : fail)('result inode ' + last.ino + ' by hand ' + want.ino);
        (want.dirs === last.dirs ? pass : fail)('directories searched ' + last.dirs + ' by hand ' + want.dirs);
        ((want.err || null) === (last.err || null) ? pass : fail)('error ' + last.err + ' by hand ' + want.err);
        // reads never decrease, and every block read is a real block
        let prev = 0; for (const f of r.frames) { (f.meta.reads >= prev && f.meta.here.every((b) => b > 0 && b < 64) ? pass : fail)('reads'); prev = f.meta.reads; }
      },
    },
    'fsi-free': {
      random: (r) => ({ pattern: pick(r, ['holes', 'runs', 'scattered', 'full']), k: int(r, 1, 30) }),
      nRandom: 6,
      check({ input, r, fail, pass }) {
        const m0 = r.frames[0].meta, rows = r.frames[r.frames.length - 1].meta.rows;
        // free blocks from the frame's own picture of the list, checked against the bitmap rows of the bitmap frame
        const lst = r.frames.find((f) => f.meta.phase === 'list').meta;
        const nfree = m0.nfree, kk = Math.min(input.k, nfree), runs = m0.runs;
        (lst.kk === kk ? pass : fail)('blocks to find');
        (rows[0].overhead === Math.ceil(m0.ndata / 8) && rows[1].overhead === 4 && rows[2].overhead === 4 && rows[3].overhead === runs * 8 ? pass : fail)('bytes of structure ' + rows.map((x) => x.overhead));
        (rows[0].reads === 1 && rows[1].reads === kk && rows[2].reads === Math.ceil(kk / 31) && rows[3].reads === 1 ? pass : fail)('reads ' + rows.map((x) => x.reads));
        // the chain is in increasing block order and the runs counted from it agree
        const ch = lst.chain; (ch.every((b, i) => !i || b > ch[i - 1]) ? pass : fail)('the list in block order');
        // the bitmap read by hand from the image's bytes
        const img = S.P15.freeImage(input.pattern), g = img.g, bits = [];
        for (let j = 0; j < g.ndata; j++) bits.push((img.bytes[g.dbmStart * g.bs + (j >> 3)] >> (j & 7)) & 1);
        const freeBy = bits.filter((b) => !b).length, runsBy = bits.filter((b, j) => !b && (j === 0 || bits[j - 1])).length;
        (freeBy === nfree && runsBy === runs ? pass : fail)('free ' + nfree + ' in ' + runs + ' runs; by hand ' + freeBy + ' in ' + runsBy);
      },
    },
    'fsi-reach': {
      random: (r) => { const size = int(r, 2, 20); return { method: pick(r, ['contiguous', 'linked', 'fat', 'extent', 'indexed']), size, k: int(r, 0, size - 1), scatter: pick(r, ['scattered', 'together']) }; },
      check({ input, r, fail, pass }) {
        const m0 = r.frames[0].meta, k = input.k, size = input.size;
        (m0.data.length === size && m0.target === m0.data[k] ? pass : fail)('the file has ' + size + ' blocks and block k is ' + m0.data[k]);
        const byHand = { contiguous: 2, linked: k + 2, fat: k > 0 ? 3 : 2, extent: 2, indexed: k < 4 ? 2 : 3 };
        const walkReads = r.frames[r.frames.length - 2].meta.reads;
        (walkReads === byHand[input.method] ? pass : fail)('reads to block k: ' + walkReads + ', by hand ' + byHand[input.method]);
        const tab = r.frames[r.frames.length - 1].meta.table;
        for (const c of tab) {
          (c.reads === { contiguous: 2, linked: k + 2, fat: k > 0 ? 3 : 2, extent: 2, indexed: k < 4 ? 2 : 3 }[c.method] ? pass : fail)(c.method + ': reads ' + c.reads);
          if (c.method === 'linked') (c.dirReads === 1 + (size * (size + 1)) / 2 ? pass : fail)('linked direct access reads 1 + 1 + 2 + … + size = ' + (1 + (size * (size + 1)) / 2) + ', topic ' + c.dirReads);
          (c.seqReads >= size + 1 ? pass : fail)(c.method + ' sequential reads at least every block and the inode');
        }
        const cont = tab.find((c) => c.method === 'contiguous');
        (cont.seqDist <= Math.min(...tab.map((c) => c.seqDist)) + 40 ? pass : fail)('contiguous reads in order with little travel');
      },
    },
    'fsi-inode': {
      random: (r) => { const bs = pick(r, ['64', '128', '256', '512', '1024', '4096']), lv = int(r, 1, 3); return { bs, ps: +bs > 1024 ? pick(r, ['4', '8']) : pick(r, ['2', '4', '8']), ndirect: int(r, 1, 12), levels: lv, target: pick(r, ['direct', 'single', 'N', 'N'].concat(lv >= 2 ? ['double'] : []).concat(lv >= 3 ? ['triple'] : [])), N: Math.floor(Math.pow(10, 1 + r() * 11)) }; },
      check({ input, r, fail, pass }) {
        const bs = +input.bs, ps = +input.ps, P = bs / ps, d = input.ndirect, L = input.levels;
        let max = d; for (let l = 1; l <= L; l++) max += Math.pow(P, l);
        const m0 = r.frames[0].meta, N = m0.N;
        (m0.max === bs * max ? pass : fail)('largest file ' + m0.max + ' by hand ' + bs * max);
        const fb = Math.floor(N / bs);
        (m0.fb === fb && m0.off === N % bs ? pass : fail)('file block and offset');
        // the level and the indices by hand
        let level = 0, rel = fb;
        if (fb >= d) { rel = fb - d; level = 1; let span = P; while (rel >= span) { rel -= span; level++; span *= P; } }
        (m0.level === level ? pass : fail)('level ' + m0.level + ' by hand ' + level);
        const starts = [0, d]; for (let l = 1; l <= L; l++) starts.push(starts[starts.length - 1] + Math.pow(P, l));
        (JSON.stringify(starts) === JSON.stringify(m0.starts) ? pass : fail)('where each part starts');
        const idx = []; let x = rel; for (let k = 0; k < level; k++) { idx.unshift(x % P); x = Math.floor(x / P); }
        const seen = r.frames.filter((f) => f.meta.phase === 'index').map((f) => f.meta.step.idx);
        (JSON.stringify(seen) === JSON.stringify(idx) ? pass : fail)('indices ' + seen + ' by hand ' + idx);
        const last = r.frames[r.frames.length - 1].meta;
        (last.reads === level + 2 ? pass : fail)('blocks read ' + last.reads + ' by hand ' + (level + 2));
      },
    },
    'fsi-alloc': {
      random: (r) => ({ method: pick(r, ['contiguous', 'linked', 'fat', 'extent', 'indexed']), work: pick(r, ['interleave', 'holes', 'big']) }),
      nRandom: 6,
      check({ input, r, fail, pass }) {
        const P = S.P15.allocPlay(input.method, input.work), img = P.img;
        const last = r.frames[r.frames.length - 2].meta;
        for (const f of last.files) {
          const by = blocksByHand(img, f.ino);
          (JSON.stringify(by) === JSON.stringify(f.data) ? pass : fail)(f.name + ': blocks ' + f.data + ' by hand ' + by);
          if (input.method === 'contiguous') (f.data.every((b, i) => !i || b === f.data[i - 1] + 1) ? pass : fail)(f.name + ' is one run');
        }
        // free blocks counted from the bitmap (or the FAT) by hand
        const g = img.g;
        let free = 0;
        for (let j = 0; j < g.ndata; j++) {
          if (g.fat) { const o = g.dbmStart * g.bs + j * g.ps; free += img.bytes[o] === 0 && img.bytes[o + 1] === 0 ? 1 : 0; }
          else free += (img.bytes[g.dbmStart * g.bs + (j >> 3)] >> (j & 7)) & 1 ? 0 : 1;
        }
        (free === last.nfree ? pass : fail)('free blocks ' + last.nfree + ' by hand ' + free);
        (F.fsck(img).ok ? pass : fail)('the image is consistent');
        // the comparison: failures and moves agree with each method's own run
        const cmp = r.frames[r.frames.length - 1].meta.cmp;
        for (const c of cmp) { const R = S.P15.allocPlay(c.method, input.work); (R.steps.filter((x) => !x.ok).length === c.fails ? pass : fail)(c.method + ' failures'); }
        (cmp.filter((c) => c.method !== 'contiguous').every((c) => c.moved === 0) ? pass : fail)('only contiguous allocation moves data');
      },
    },
    'fsi-commands': {
      random: (r) => { const n = int(r, 1, 12), ls = []; for (let k = 0; k < n; k++) ls.push(pick(r, CMDS)); return { script: ls.join('\n'), bs: pick(r, ['64', '128', '256']), ndirect: int(r, 1, 8) }; },
      check({ input, r, fail, pass }) {
        // replay on a fresh image; the blocks that changed are found by comparing the bytes before and after
        const img = F.mkfs({ bs: +input.bs, nblocks: 64, ninodes: 16, ndirect: input.ndirect, ps: 4 });
        const ops = r.frames.slice(1);
        for (const f of ops) {
          const m = f.meta;
          if (m.phase === 'error') { pass(); continue; }
          const before = img.bytes.slice(), c = m.op, line = input.script.split('\n').map((x) => x.trim()).filter(Boolean)[m.i];
          const w = line.split(/\s+/);
          const args = c === 'write' ? [w[1], +w[2], line.replace(/^\S+\s+\S+\s+\S+\s?/, '')] : c === 'append' ? [w[1], line.replace(/^\S+\s+\S+\s?/, '')] : c === 'truncate' ? [w[1], +w[2]] : w.slice(1);
          F.apply(img, c, args);
          const diff = [];
          for (let b = 0; b < img.g.nblocks; b++) { const a = b * img.g.bs; for (let k = 0; k < img.g.bs; k++) if (before[a + k] !== img.bytes[a + k]) { diff.push(b); break; } }
          // a block may be rewritten with the same bytes (a freed block's bitmap set and cleared): written ⊇ changed
          (diff.every((b) => m.changed.includes(b)) ? pass : fail)('frame ' + m.i + ': the bytes of ' + diff + ' changed; the topic lists ' + m.changed);
          (F.fsck(img).ok ? pass : fail)('consistent after ' + line);
          const tx = new F.Tx(img); let fi = 0; for (let i = 1; i < 16; i++) if (!tx.inode(i).type) fi++;
          (fi === m.fi && F.countFree(tx) === m.fb ? pass : fail)('free counts after ' + line);
        }
      },
    },
    'fsi-layout': {
      random: (r) => ({ bs: pick(r, ['64', '128', '256', '512', '1024']), nblocks: int(r, 24, 256), ninodes: int(r, 4, 200), ndirect: int(r, 1, 12), ps: pick(r, ['2', '4', '8']), jblocks: pick(r, [0, 0, 4, 6, 9]) }),
      check({ input, r, fail, pass }) {
        const L = layoutByHand(+input.bs, input.nblocks, input.ninodes, input.ndirect, +input.ps, input.jblocks);
        const m = r.frames[0].meta, g = m.g;
        (g.isz === L.isz ? pass : fail)('inode size ' + g.isz + ' by hand ' + L.isz);
        (m.regions[1][1] === L.ibm && m.regions[2][1] === L.dbm && m.regions[3][1] === L.it ? pass : fail)('region sizes ' + JSON.stringify(m.regions) + ' by hand ' + [L.ibm, L.dbm, L.it]);
        (g.ndata === L.ndata && g.dataStart === L.dataStart ? pass : fail)('data region ' + g.dataStart + '+' + g.ndata + ' by hand ' + L.dataStart + '+' + L.ndata);
        (m.perBlk === L.perBlk && m.maxSize === L.max ? pass : fail)('inodes per block and largest file');
        // the regions tile the disk in order
        let at = 0;
        for (const [s, c] of m.regions) { (s === at ? pass : fail)('region at ' + s + ' follows ' + at); at = s + c; }
        (at === input.nblocks ? pass : fail)('the regions cover the disk');
        const last = r.frames[r.frames.length - 1].meta;
        (Math.abs(last.pct - (100 * L.dataStart) / input.nblocks) < 1e-9 ? pass : fail)('metadata share');
      },
    },
  };
}
