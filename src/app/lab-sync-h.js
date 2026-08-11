// The Sync lab, part eight: the problem's own scene, when the program matches a known problem. It is recognised
// from the program's own names (as the ready-made programs write them, and as a student naturally would):
//   table   a mutex array forks[N] (or chopsticks) and threads that start in philosopher: seats, forks and waits
//   ring    an int array buf with ints in and out (0 is an empty slot): the slots and the two indexes
//   room    functions read_book and write_book: who reads or writes inside, who waits at the door
//   shop    functions barber and customer and an int free_seats: the seats, the barber, the door
//   gate    an int array round_of, or a semaphore gate: one lane a worker, the barrier across them
//   list    int arrays key and next (node 0 the head): the chain of nodes and whose locks they are under
//   hash    int arrays items and size: one row a bucket
//   queue   int arrays value and next with ints head and tail: the chain from head to tail
//   SL.sceneOf(P, beat) -> {kind, ..} | null      SL.scene(sc, beat, prev, x, y, o) -> {items, w, h}
(function (S) {
  'use strict';
  const SL = (S.SyncLab = S.SyncLab || {});
  const KS = () => S.Kit.sync, KSc = () => S.Kit.scenes;
  const has = (b, n) => b.world.vars.find((v) => v.name === n);

  SL.sceneOf = function (P, b) {
    const I = P.I, fn = (n) => I.fns.some((f) => f.name === n);
    const forks = I.mutexes.find((g) => g.arr && /fork|chop/i.test(g.name));
    if (forks && b.world.threads.some((t) => /phil/i.test(t.fn))) return { kind: 'table', base: forks.name, n: forks.n, title: 'the table' };
    if (has(b, 'buf') && has(b, 'buf').arr && has(b, 'in') && has(b, 'out')) return { kind: 'ring', n: I.vars.find((g) => g.name === 'buf').n, title: 'the ring of slots' };
    if (fn('read_book') && fn('write_book')) return { kind: 'room', title: 'the reading room' };
    if (fn('barber') && fn('customer') && has(b, 'free_seats')) return { kind: 'shop', chairs: I.consts.SEATS || 1, chairLine: P.I.lines.findIndex((l) => /sem_wait\s*\(\s*&\s*call_next\s*\)/.test(l)) + 1, title: 'the barbershop' };
    if ((has(b, 'round_of') && has(b, 'round_of').arr) || I.sems.some((g) => /^gate/.test(g.name))) return { kind: 'gate', title: 'the barrier' };
    if (has(b, 'key') && has(b, 'next') && has(b, 'key').arr) return { kind: 'list', title: 'the list' };
    if (has(b, 'items') && has(b, 'size') && has(b, 'size').arr) return { kind: 'hash', B: I.consts.B || has(b, 'size').value.length, CAP: I.consts.CAP || 3, title: 'the hash table' };
    if (has(b, 'value') && has(b, 'next') && has(b, 'head') && has(b, 'tail')) return { kind: 'queue', title: 'the queue' };
    if (P.gran === 'machine' && b.world.vars.length && b.world.vars.length <= 6) return { kind: 'race', title: 'registers and memory', at: P.I.at };
    return null;
  };

  const pcls = (t) => t.cls;
  const person = (t) => ({ id: t.k === undefined ? 0 : t.k, name: t.name });
  const kOf = (b, t) => { const x = b.names[t.tid]; return x ? Math.max(0, x.k) : 0; };

  SL.scene = function (sc, b, prev, x, y, o) {
    o = o || {};
    const W = b.world, act = b.rec ? b.rec.tid : null, items = [];
    const ths = W.threads.filter((t) => !t.main);
    const val = (n) => { const v = has(b, n); return v ? v.value : null; };
    if (sc.kind === 'table') {
      const n = sc.n, R = o.narrow ? 88 : 118, cx = x + R + 46, cy = y + R + 44;
      const seatOf = (t) => (typeof t.arg === 'number' && t.arg >= 0 && t.arg < n ? t.arg : null);
      const phils = ths.filter((t) => /phil/i.test(t.fn));
      const bySeat = Array.from({ length: n }, (_, i) => phils.find((t) => seatOf(t) === i) || null);
      const forks = Array.from({ length: n }, (_, j) => { const m = W.mutexes.find((z) => z.base === sc.base && z.i === j); const h = m && m.ownerTid ? W.threads.find((t) => t.tid === m.ownerTid) : null; return h && seatOf(h) !== null ? seatOf(h) : null; });
      const dead = b.status === 'deadlock';
      const waits = [];
      bySeat.forEach((t, i) => {
        if (!t || t.state !== 'blocked' || !t.on || t.on.kind !== 'mutex') return;
        const m = W.mutexes.find((z) => z.name === t.on.name), h = m && m.ownerTid ? W.threads.find((z) => z.tid === m.ownerTid) : null;
        if (h && seatOf(h) !== null && seatOf(h) !== i) waits.push({ from: i, to: seatOf(h), cls: dead ? 'hot' : '' });
      });
      const seats = bySeat.map((t, i) => {
        if (!t) return { name: 'P' + i, cls: 's-new', sub: 'not seated' };
        const st = t.state === 'done' ? 'done' : t.state === 'blocked' ? 'waiting' : t.cur === 'eat' ? 'eating' : forks.includes(i) ? 'hungry' : 'thinking';
        const cls = { thinking: 's-new', hungry: 's-ready', eating: 's-running', waiting: 's-blocked', done: 's-done' }[st];
        return { name: t.name, cls: cls + (t.tid === act ? ' act' : ''), sub: st, subCls: st === 'eating' ? 'up' : '' };
      });
      items.push(...KS().table({ prefix: 'tb', cx, cy, R, r: 30, n, seats, forks, waits, tableR: R * 0.6, forkW: 40, forkH: 24, size: 15, forkIn: 0.75 }).items);
      const note = dead ? 'deadlock' : forks.filter((f) => f !== null).length + ' of ' + n + ' forks held';
      // on a phone the table is too small to write in: the note sits above it, on the left
      // the table itself is covered in forks: the note sits above it, on the left
      items.push({ key: 'tb:c', kind: 'text', x, y: y + 14, text: note, size: 14, cls: dead ? 'verdict hot' : 'ringnote' });
      return { items, w: 2 * R + 92, h: 2 * R + 92 };
    }
    if (sc.kind === 'ring') {
      const N = sc.n, R = 62 + 10 * N, cx = x + R + 64, cy = y + R + 58;
      const buf = val('buf') || [], pb = prev ? (prev.world.vars.find((v) => v.name === 'buf') || {}).value || [] : [];
      let hit;
      buf.forEach((v, k) => { if (pb[k] !== undefined && pb[k] !== v) hit = k; });
      items.push(...KS().ring({ prefix: 'rg', cx, cy, R, cw: 56, ch: 34, slots: buf.slice(0, N).map((v) => (v ? String(v) : null)), inAt: val('in'), outAt: val('out'), act: hit, tagGap: 30 }).items);
      const full = buf.slice(0, N).filter((v) => v).length;
      items.push({ key: 'rg:count', kind: 'text', x: cx, y: cy + 6, text: full + ' of ' + N + ' full', anchor: 'middle', size: 15, cls: 'ringnote' });
      return { items, w: 2 * R + 128, h: 2 * R + 116 };
    }
    if (sc.kind === 'room') {
      const rx = x + (o.narrow ? 112 : 206), rw = o.narrow ? 244 : 260, rh = 150, ry = y + 70;
      const role = (t) => (/write/i.test(t.fn) ? 'w' : 'r');
      const inside = [], door = [], away = [];
      for (const t of ths) {
        if (t.state === 'done') continue;
        const p = { id: kOf(b, t), name: t.name, mode: role(t) };
        if (t.cur === 'read_book' || t.cur === 'write_book') inside.push(Object.assign(p, { mode: t.cur === 'write_book' ? 'w' : 'r' }));
        else if (t.state === 'blocked') door.push(p);
        else away.push(p);
      }
      const writing = inside.some((p) => p.mode === 'w');
      const r = KSc().room({ prefix: 'rm', x: rx, y: ry, w: rw, h: rh, inside, door: door.slice(0, o.narrow ? 2 : 4), away, act: act === null ? -1 : (W.threads.find((t) => t.tid === act) ? kOf(b, W.threads.find((t) => t.tid === act)) : -1), doorState: writing ? 'shut' : inside.length ? 'readers' : 'open', title: 'the room', writing, awayX: o.narrow ? 100 : 196 });
      items.push(...r.items);
      return { items, w: rx - x + rw + 10, h: rh + 70 };
    }
    if (sc.kind === 'shop') {
      const custs = ths.filter((t) => /cust/i.test(t.fn) && t.state !== 'done'), bar = ths.find((t) => /barber/i.test(t.fn));
      const seated = [], door = [];
      let inChair = null;
      for (const t of custs) {
        const p = { id: kOf(b, t), name: t.name };
        if (t.state === 'blocked' && t.on && /call_next/.test(t.on.name)) seated.push(p);
        else if (sc.chairLine && t.line > sc.chairLine) inChair = p;
        else door.push(p);
      }
      const bs = !bar ? 'asleep' : bar.state === 'blocked' && bar.on && /arrivals/.test(bar.on.name) ? 'asleep' : bar.cur === 'trim' ? 'cutting' : 'busy';
      const actT = W.threads.find((t) => t.tid === act);
      const r = KSc().shop({ prefix: 'sh', x, y: y + 10, seats: sc.chairs, chairs: sc.chairs, seated, inChair, door: door.slice(0, o.narrow ? 1 : 3), away: [], barber: bs, barberName: bar ? bar.name : 'B', act: actT ? (actT === bar ? 0 : kOf(b, actT)) : -1 });
      items.push(...r.items);
      return { items, w: r.w + (o.narrow ? 70 : 170), h: r.h + 20 };
    }
    if (sc.kind === 'gate') {
      const rounds = val('round_of');
      const lanes = ths.filter((t) => /work/i.test(t.fn) || true).map((t, i) => ({ id: kOf(b, t), name: t.name, at: t.state === 'done' ? 'past' : t.state === 'blocked' && t.on && /gate/.test(t.on.name) ? 'gate' : 'before', state: t.state, note: Array.isArray(rounds) && typeof t.arg === 'number' && rounds[t.arg] !== undefined ? 'round ' + rounds[t.arg] : t.state }));
      const w = o.narrow ? 250 : 340;
      const actT = W.threads.find((t) => t.tid === act);
      const r = KSc().gate({ prefix: 'gt', x, y: y + 40, w, lanes, act: actT ? kOf(b, actT) : -1, laneH: 52, label: 'the barrier' });
      items.push(...r.items);
      return { items, w: w + 80, h: r.h + 44 };
    }
    if (sc.kind === 'list' || sc.kind === 'queue') {
      const key = val(sc.kind === 'list' ? 'key' : 'value') || [], next = val('next') || [], used = val('used');
      const start = sc.kind === 'list' ? 0 : val('head') || 0, chain = [];
      const seen = new Set();
      for (let p = start; p !== -1 && p !== null && p !== undefined && !seen.has(p) && p < key.length; p = next[p]) { seen.add(p); chain.push(p); }
      const loose = [];
      for (let p = 1; p < (used === null ? key.length : Math.min(used, key.length)); p++) if (!seen.has(p) && (sc.kind === 'list' || p > (val('head') || 0))) loose.push(p);
      const locks = {};
      for (const m of W.mutexes) if (m.base === 'node' && m.owner) locks[m.i] = m;
      const cw = 58, ch = 40, gap = 30;
      items.push({ key: 'ls:t', kind: 'text', x, y: y + 14, text: sc.kind === 'list' ? 'the list, from the head (node 0)' : 'the queue, from the dummy at head', size: 13, cls: 'title' });
      chain.forEach((p, i) => {
        const cx = x + i * (cw + gap), cy = y + 46;
        const label = p === 0 && sc.kind === 'list' ? 'head' : sc.kind === 'queue' && i === 0 ? 'dummy' : String(key[p]);
        items.push({ key: 'ls:n' + p, kind: 'cell', x: cx, y: cy, w: cw, h: ch, rx: 7, text: label, size: 15, cls: 'lsnode' + (locks[p] ? ' locked ' + locks[p].ownerCls : '') });
        items.push({ key: 'ls:i' + p, kind: 'text', x: cx + cw / 2, y: cy + ch + 17, text: 'node ' + p, anchor: 'middle', size: 13, cls: 'tick' });
        if (locks[p]) items.push({ key: 'ls:l' + p, kind: 'text', x: cx + cw / 2, y: cy - 8, text: 'locked by ' + locks[p].owner, anchor: 'middle', size: 13, cls: 'lslock' });
        if (i) items.push({ key: 'ls:e' + chain[i - 1] + '>' + p, kind: 'edge', from: 'ls:n' + chain[i - 1], to: 'ls:n' + p, cls: 'lsedge' });
        if (sc.kind === 'queue' && p === val('tail')) items.push({ key: 'ls:tail', kind: 'text', x: cx + cw / 2, y: cy - 8, text: 'tail', anchor: 'middle', size: 13, cls: 'lslock' });
      });
      loose.forEach((p, i) => {
        const cx = x + i * (cw + gap), cy = y + 46 + ch + 50;
        items.push({ key: 'ls:n' + p, kind: 'cell', x: cx, y: cy, w: cw, h: ch, rx: 7, text: String(key[p]), size: 15, cls: 'lsnode loose' });
        items.push({ key: 'ls:i' + p, kind: 'text', x: cx + cw / 2, y: cy + ch + 17, text: 'node ' + p + ', not linked', anchor: 'middle', size: 13, cls: 'tick' });
      });
      const n = Math.max(chain.length, loose.length, 4);
      return { items, w: n * (cw + gap), h: 46 + ch + 50 + ch + 22 };
    }
    if (sc.kind === 'hash') {
      const B = sc.B, CAP = sc.CAP, it = val('items') || [], size = val('size') || [], cw = 50, ch = 36;
      items.push({ key: 'hs:t', kind: 'text', x, y: y + 14, text: 'the hash table: key k goes to bucket k % ' + B, size: 13, cls: 'title' });
      for (let bk = 0; bk < B; bk++) {
        const yy = y + 30 + bk * (ch + 18), m = W.mutexes.find((z) => z.base === 'bucket' && z.i === bk);
        items.push({ key: 'hs:b' + bk, kind: 'cell', x, y: yy, w: 86, h: ch, rx: 6, text: 'bucket ' + bk, size: 13, cls: 'lsnode bucket' + (m && m.owner ? ' locked ' + m.ownerCls : '') });
        for (let j = 0; j < CAP; j++) {
          const v = it[bk * CAP + j], inUse = j < size[bk];
          items.push({ key: 'hs:c' + bk + '_' + j, kind: 'cell', x: x + 100 + j * (cw + 6), y: yy, w: cw, h: ch, rx: 5, text: v ? String(v) : inUse ? '?' : '', size: 15, cls: 'slot ' + (inUse ? (v ? 'full' : 'stray') : v ? 'stray' : 'empty') });
        }
        items.push({ key: 'hs:s' + bk, kind: 'text', x: x + 100 + CAP * (cw + 6) + 8, y: yy + ch / 2 + 5, text: 'size ' + size[bk] + (m && m.owner ? ' · locked by ' + m.owner : ''), size: 13, cls: 'tick' });
      }
      return { items, w: 100 + CAP * (cw + 6) + 160, h: 30 + B * (ch + 18) };
    }
    if (sc.kind === 'race') {
      // each thread's register on the left, memory on the right; this step's load or store is an arrow between them
      const workers = ths, regs = o.regs || {}, rowH = 50, memX = x + (o.narrow ? 190 : 330);
      const ms = b.rec ? b.rec.events.filter((e) => e.mstep).map((e) => e.mstep) : [];
      const m = ms[ms.length - 1];
      items.push({ key: 'rc:t1', kind: 'text', x, y: y + 14, text: 'registers', size: 13, cls: 'title' });
      items.push({ key: 'rc:t2', kind: 'text', x: memX, y: y + 14, text: 'memory', size: 13, cls: 'title' });
      workers.forEach((t, i) => {
        const yy = y + 30 + i * rowH;
        items.push({ key: 'rc:n' + t.tid, kind: 'cell', x, y: yy, w: 56, h: 34, rx: 7, text: t.name, size: 15, cls: 'thcard ' + (t.state === 'done' ? 's-done' : t.state === 'blocked' ? 's-blocked' : 's-ready') + ' ' + t.cls + (t.tid === act ? ' act' : '') });
        const r = regs[t.tid];
        items.push({ key: 'rc:r' + t.tid, kind: 'cell', x: x + 70, y: yy, w: 76, h: 34, rx: 6, text: r === undefined ? 'r  –' : 'r = ' + r, size: 15, cls: 'regcell' + (t.tid === act && m && m.what !== 'store' ? ' hot' : '') });
      });
      const vars = W.vars.filter((v) => !v.arr || v.value.length <= 4);
      vars.forEach((v, i) => {
        const yy = y + 30 + i * rowH;
        const hit = m && (m.what === 'load' || m.what === 'store') && P_at(sc, b, m.addr) === v.name;
        const txt = v.name + ' = ' + SL.showVal(v.value);
        items.push({ key: 'rc:v' + v.name, kind: 'cell', x: memX, y: yy, w: Math.ceil(S.textWidth(txt, 15, { mono: true, bold: true })) + 24, h: 34, rx: 6, text: txt, size: 15, cls: 'varval' + (hit ? ' act' : '') });
        if (hit && act !== null) {
          const reg = 'rc:r' + act, mem = 'rc:v' + v.name;
          items.push({ key: 'rc:e', kind: 'edge', from: m.what === 'load' ? mem : reg, to: m.what === 'load' ? reg : mem, cls: 'ptr ' + (m.what === 'load' ? 'pout' : 'pin'), label: m.what, size: 13 });
        }
      });
      return { items, w: memX - x + 200, h: 30 + Math.max(workers.length, vars.length) * rowH };
    }
    return { items, w: 0, h: 0 };
  };
  const P_at = (sc, b, addr) => (sc.at ? sc.at(addr).replace(/\[.*$/, '') : null);
})(globalThis.Proses = globalThis.Proses || {});
