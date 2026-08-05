// Storage, file-system and synchronisation exercise kinds.
//   inode-walk       {bs, ps, ndirect, levels, N, ask: 'walk' | 'max'}
//                    walk: Answer {part: 'direct' | 'single' | 'double' | 'triple', indices: '2, 17' (the slot for a
//                      direct block; else the index in each indirect block, top first), offset: '40'}
//                    max: Answer the largest file size in bytes (a number)
//   disk-order       {policy: 'fcfs' | 'sstf' | 'scan' | 'look' | 'cscan' | 'clook', requests: [cyl..], start,
//                    cylinders, dir: 'up' | 'down', ask: 'both' | 'order' | 'movement'}
//                    Answer {order: '65, 67, 37, ..' (cylinders in service order), movement: '236'}
//   raid-parity      {chunks: ['0x3A', 0xC4, ..] (one byte from each data disk, in order), ask: 'p' | 'q'}
//                    Answer the parity byte, '0x5F' or '5F' or 0b01011111 (P: the XOR; Q: ⊕ g^k·D_k in GF(2⁸))
//   semaphore-trace  {sems: [{id, init}], threads: [{name, prog: ['wait s', 'post s', 'work'..]}], schedule:
//                    ['T0', 'T1', ..] (who takes each step)}
//                    Answer {'1|s': '0', '1|blocked': 'T1', ..} after each step k: each semaphore's value, and the
//                    threads blocked (a list, empty for none)
(function (S) {
  'use strict';
  const K = (S.Check = S.Check || {});
  const O = () => K.os;

  // ---- inode-walk ----------------------------------------------------------------------------------------------------
  const geo = (x) => ({ bs: x.bs, ps: x.ps, ndirect: x.ndirect, levels: x.levels === undefined ? 3 : x.levels, alloc: 'indexed' });
  O().kind('inode-walk', {
    want(x) {
      const g = geo(x);
      if (x.ask === 'max') return { max: S.FS.maxFileSize(g) };
      const fb = Math.floor(x.N / x.bs), loc = S.FS.locate(g, fb);
      if (!loc) return { part: 'beyond', indices: '', offset: '' };
      return { part: S.FS.LEVEL[loc.level], indices: (loc.level === 0 ? [loc.slot] : loc.idx).join(', '), offset: String(x.N % x.bs), fb };
    },
    check(x, a) {
      const W = this.want(x);
      if (x.ask === 'max') {
        const g = O().int(a);
        if (g === null) return { ok: false, message: 'Type the size in bytes, a whole number.' };
        if (g === BigInt(W.max)) return { ok: true, message: 'Right: ' + W.max + ' bytes.' + (x.why ? ' ' + x.why : '') };
        return { ok: false, message: 'Not quite: the largest file is ' + (g < BigInt(W.max) ? 'bigger' : 'smaller') + ' than ' + g + ' bytes.', details: ['Count the blocks each part maps: the direct pointers, then P, P² and P³ for the indirect ones, with P = block size ÷ pointer size.'] };
      }
      a = a || {};
      if (W.part === 'beyond') return /beyond|none|too big/i.test(String(a.part || '')) ? { ok: true, message: 'Right: byte ' + x.N + ' is past the largest file.' } : { ok: false, message: 'Not quite: look at the largest file these pointers can map.' };
      const list = [{ key: 'part', label: 'the part', want: W.part, kind: 'text' }, { key: 'indices', label: 'the index list', want: W.indices, kind: 'list' }, { key: 'offset', label: 'the offset', want: BigInt(W.offset), kind: 'int' }];
      const r = O().fields(x, list, a);
      if (!r.ok) r.details = (r.details || []).concat(['Byte ' + x.N + ' is in file block ⌊' + x.N + ' ÷ ' + x.bs + '⌋; subtract the blocks each earlier part maps.']);
      return r;
    },
    solve(x) { const W = this.want(x); return x.ask === 'max' ? String(W.max) : { part: W.part, indices: W.indices, offset: W.offset }; },
    lint(x) { const p = []; if (![2, 4, 8].includes(x.ps)) p.push('pointer size must be 2, 4 or 8'); if (!(x.bs >= 64)) p.push('block size too small'); if (x.ask !== 'max' && !(x.N >= 0)) p.push('no byte N'); return p; },
    wrongFrom(x) { const s = this.solve(x); if (x.ask === 'max') return [String(+s + x.bs), String(+s - x.bs)]; return [Object.assign({}, s, { offset: String(+s.offset + 1) }), Object.assign({}, s, { part: s.part === 'direct' ? 'single' : 'direct' })]; },
    example() {
      return {
        id: 'k-inode', kind: 'inode-walk', title: 'Find byte 70,000', level: 2,
        text: ['An inode has 10 direct pointers and one single, double and triple indirect pointer each; blocks are 1024 bytes and pointers 4 bytes. Which part maps byte 70,000, which index is used at each indirect level, and at what offset in the block is the byte?'],
        bs: 1024, ps: 4, ndirect: 10, levels: 3, N: 70000,
        hints: ['Byte 70,000 is in file block ⌊70000 ÷ 1024⌋ = 68, at offset 70000 − 68 × 1024.', 'The direct pointers map blocks 0 to 9; the single indirect block maps the next 256.', 'File block 68 is 58 blocks into the single indirect part: part single, index 58, offset 368.'],
        solution: { part: 'single', indices: '58', offset: '368' }, wrong: [{ part: 'single', indices: '68', offset: '368' }, { part: 'double', indices: '0, 58', offset: '368' }],
      };
    },
  });

  // ---- disk-order --------------------------------------------------------------------------------------------------
  const sched = (x) => S.Storage.schedule(x.policy || 'fcfs', { requests: x.requests, start: x.start, cylinders: x.cylinders || 200, dir: x.dir || 'up' });
  O().kind('disk-order', {
    fieldsOf(x) {
      const r = sched(x), ask = x.ask || 'both', out = [];
      if (ask !== 'movement') out.push({ key: 'order', label: 'the service order', want: r.served.map((s) => s.cyl).join(', '), kind: 'list' });
      if (ask !== 'order') out.push({ key: 'movement', label: 'the total head movement', want: BigInt(r.totals.movement), kind: 'int' });
      return out;
    },
    check(x, a) {
      const r = O().fields(x, this.fieldsOf(x), a);
      if (!r.ok && a && a.order) {
        const want = sched(x).served.map((s) => String(s.cyl)), got = O().list(a.order);
        const k = want.findIndex((w, i) => got[i] !== w);
        if (k >= 0 && r.cells.order === false) r.details = [k ? 'The order is right for the first ' + O().plural(k, 'request') + ' and goes wrong at the ' + ord(k + 1) + '.' : 'The order goes wrong at the first request.'].concat(r.details || []);
      }
      return r;
    },
    solve(x) { return Object.fromEntries(this.fieldsOf(x).map((f) => [f.key, String(f.want)])); },
    lint(x) { const p = []; try { sched(x); } catch (e) { p.push('the schedule does not run: ' + e.message); } if ((x.requests || []).length > 16) p.push('at most 16 requests'); return p; },
    wrongFrom(x) { const s = this.solve(x); const out = []; if (s.order) out.push(Object.assign({}, s, { order: x.requests.join(', ') === s.order ? x.requests.slice().reverse().join(', ') : x.requests.join(', ') })); if (s.movement) out.push(Object.assign({}, s, { movement: String(+s.movement + 2) })); return out; },
    example() {
      return {
        id: 'k-disk', kind: 'disk-order', title: 'Shortest seek first', level: 1, policy: 'sstf',
        text: ['A disk of 200 cylinders has its head at cylinder 60. Serve the queue 91, 30, 150, 44, 72, 186 shortest seek first: the order, and the total head movement.'],
        requests: [91, 30, 150, 44, 72, 186], start: 60, cylinders: 200,
        hints: ['From 60 the nearest request is 72.', 'After 72 comes 91 (19 away), then the nearer of 44 and 150.', '72, 91, 44, 30, 150, 186: movement 12 + 19 + 47 + 14 + 120 + 36 = 248.'],
        solution: { order: '72, 91, 44, 30, 150, 186', movement: '248' }, wrong: [{ order: '91, 30, 150, 44, 72, 186', movement: '248' }, { order: '72, 91, 44, 30, 150, 186', movement: '226' }],
      };
    },
  });
  const ord = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');

  // ---- raid-parity -------------------------------------------------------------------------------------------------
  O().kind('raid-parity', {
    want(x) {
      const d = x.chunks.map((c) => Number(O().int(c)));
      if (x.ask === 'q') return S.GF.pq(d.map((v) => Uint8Array.of(v)), 1).q[0];
      return S.Raid.xor(d.map((v) => Uint8Array.of(v)), 1)[0];
    },
    check(x, a) {
      const t = String(a === undefined || a === null ? '' : a).trim();
      if (!t) return { ok: false, message: 'Type the parity byte, like 0x5F.' };
      // two bare digits are read as hex (a parity byte is written in hex); 0x, 0b and three-digit decimals as such
      const g = O().int(/^[0-9a-f]{1,2}$/i.test(t) ? '0x' + t : t);
      if (g === null || g < 0n || g > 255n) return { ok: false, message: '"' + t + '" is not one byte: write two hex digits, like 0x5F.' };
      const w = this.want(x), diff = Number(g) ^ w;
      if (!diff) return { ok: true, message: 'Right: ' + O().hex(w, 2) + '.' + (x.why ? ' ' + x.why : '') };
      let bits = 0; for (let v = diff; v; v >>= 1) bits += v & 1;
      return { ok: false, message: 'Not quite: ' + O().plural(bits, 'bit is', 'bits are') + ' wrong.', details: [x.ask === 'q' ? 'Q multiplies chunk k by g^k in GF(2⁸) before the XOR.' : 'P is the XOR of the data bytes: a bit is 1 when an odd number of the bytes have a 1 there.'] };
    },
    solve(x) { return O().hex(this.want(x), 2); },
    lint(x) { const p = []; if (!(x.chunks || []).length) p.push('no chunks'); for (const c of x.chunks || []) { const v = O().int(c); if (v === null || v < 0n || v > 255n) p.push('chunk ' + c + ' is not a byte'); } return p; },
    wrongFrom(x) { const w = this.want(x); return [O().hex(w ^ 1, 2), O().hex(w ^ 0x80, 2)]; },
    example() {
      return {
        id: 'k-raid', kind: 'raid-parity', title: 'The parity byte', level: 1, ask: 'p',
        text: ['A RAID 5 stripe holds the bytes `0x3A`, `0xC4` and `0x5F` on its three data disks. What byte does the parity disk hold?'],
        chunks: ['0x3A', '0xC4', '0x5F'],
        hints: ['Parity is the XOR of the data, bit by bit.', '0x3A XOR 0xC4 = 0xFE.', '0xFE XOR 0x5F = 0xA1.'],
        solution: '0xA1', wrong: ['0xA0', '0xFE'],
      };
    },
  });

  // ---- semaphore-trace ----------------------------------------------------------------------------------------------
  const opOf = (s) => { const m = /^\s*(wait|post|work|think)\s*(\w+)?\s*$/i.exec(s); if (!m) throw new Error('"' + s + '" is not an op (wait s, post s, work)'); const op = m[1].toLowerCase(); return op === 'wait' || op === 'post' ? { op, s: m[2] } : { op }; };
  /** the semaphores and the blocked threads after each step of the schedule */
  K.os.semTrace = function (x) {
    const M = S.Sync.machine({ threads: x.threads.map((t) => ({ name: t.name, prog: t.prog.map(opOf) })), sems: x.sems.map((s) => ({ id: s.id, init: s.init || 0 })) });
    const ids = x.threads.map((t) => t.name), rows = [];
    x.schedule.forEach((who, k) => {
      const tid = ids.indexOf(who);
      if (tid < 0) throw new Error('step ' + (k + 1) + ' names no thread ' + who);
      if (!M.choices().includes(tid)) throw new Error('step ' + (k + 1) + ': ' + who + ' cannot run then (blocked or finished)');
      const r = M.step(tid);
      const row = { step: k + 1, who, say: r.say };
      for (const s of x.sems) row[s.id] = M.sem[s.id].value;
      row.blocked = (M.threads || []).filter((t) => t.state === 'blocked').map((t) => t.name);
      rows.push(row);
    });
    return rows;
  };
  O().kind('semaphore-trace', {
    fieldsOf(x) {
      const out = [];
      for (const r of K.os.semTrace(x)) {
        for (const s of x.sems) out.push({ key: r.step + '|' + s.id, label: 'step ' + r.step + ' ' + s.id, want: BigInt(r[s.id]), kind: 'int' });
        if (x.blocked !== false) out.push({ key: r.step + '|blocked', label: 'step ' + r.step + ' blocked', want: r.blocked.join(', '), kind: 'set' });
      }
      return out;
    },
    check(x, a) {
      const list = this.fieldsOf(x), r = O().fields(x, list, a);
      if (r.ok) return r;
      const first = list.find((f) => r.cells[f.key] === false);
      return { ok: false, cells: r.cells, message: 'Not quite: ' + O().plural(list.filter((f) => r.cells[f.key] === false).length, 'cell is', 'cells are') + ' not right (marked in red); the first is at step ' + first.key.split('|')[0] + '.', details: ['A wait on a semaphore at 0 blocks the thread; a post with a thread waiting wakes it and leaves the value as it is.'] };
    },
    solve(x) { return Object.fromEntries(this.fieldsOf(x).map((f) => [f.key, String(f.want)])); },
    lint(x) { try { K.os.semTrace(x); return x.schedule.length > 16 ? ['at most 16 steps'] : []; } catch (e) { return ['the schedule does not run: ' + e.message]; } },
    wrongFrom(x) { const s = this.solve(x), k = Object.keys(s).find((q) => !q.endsWith('blocked')); return [Object.assign({}, s, { [k]: String(+s[k] + 1) })]; },
    example() {
      const x = {
        id: 'k-sem', kind: 'semaphore-trace', title: 'Trace a semaphore', level: 1,
        text: ['Semaphore s starts at 1. Two threads each run wait s, work, post s. Follow the schedule below: the value of s and who is blocked after each step.'],
        sems: [{ id: 's', init: 1 }], threads: [{ name: 'T1', prog: ['wait s', 'work', 'post s'] }, { name: 'T2', prog: ['wait s', 'work', 'post s'] }],
        schedule: ['T1', 'T2', 'T1', 'T1', 'T2', 'T2'],
        hints: ['T1\'s wait takes s from 1 to 0.', 'T2 then waits on 0, so it blocks.', 'T1\'s post hands s straight to T2: the values run 0, 0, 0, 0, 0, 1, and T2 is blocked after steps 2 and 3.'],
      };
      x.solution = this.solve(x);
      x.wrong = [Object.assign({}, x.solution, { '2|s': '-1' }), Object.assign({}, x.solution, { '2|blocked': '' })];
      return x;
    },
  });
})(globalThis.Proses = globalThis.Proses || {});
