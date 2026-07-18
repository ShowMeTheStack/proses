// Storage engines: the disk model's access time worked by hand (seek curve, rotation from the sector position,
// transfer, zones), the disk-arm policies against independent versions on random static queues and on requests
// arriving over time, the SSD's invariants (no live data lost through garbage collection, the mapping consistent,
// write amplification counted independently) against an independent FTL, and the error-detection codes against
// standard check values and independent implementations.
import { load, harness, rng } from './load.mjs';

const t = harness('storage');
const S = load(['core']);
const T = S.Storage, F = S.SSD, K = S.Codes;
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// ---- the disk model by hand ----
{
  const D = T.disk({ cylinders: 1000, heads: 4, spt: 100, rpm: 7200, settle: 1, knee: 100, kneeTime: 3, full: 12 });
  t.ok(near(D.rev, 60000 / 7200), '7200 RPM: a turn takes 8.333 ms');
  t.eq([T.seekTime(D, 0).ms, T.seekTime(D, 25).ms, T.seekTime(D, 100).ms, T.seekTime(D, 999).ms], [0, 2, 3, 12], 'seek: 0, 1 + 0.2·√25, the knee, the full stroke');
  t.ok(near(T.seekTime(D, 550).ms, 3 + (9 / 899) * 450) && T.seekTime(D, 550).part === 'linear', 'seek past the knee is linear');
  t.eq([T.seekTime(D, 4).part, T.seekTime(D, -4).ms], ['sqrt', T.seekTime(D, 4).ms], 'short seeks follow the square root; direction does not matter');
  t.eq(T.chs(D, 40050), { lba: 40050, cyl: 100, head: 0, sector: 50, spt: 100, zone: 0 }, 'sector 40050 is cylinder 100, head 0, sector 50');
  t.eq([T.chs(D, 40399).head, T.chs(D, 40399).sector, T.lba(D, { cyl: 100, head: 3, sector: 99 })], [3, 99, 40399], 'CHS and back');
  const x = T.access(D, { cyl: 0, t: 0 }, { cyl: 100, sector: 50, count: 8 });
  // seek 3 ms; at t = 3 the platter has turned 3 / 8.333 = 0.36, sector 36 is under the head; 14 sectors to wait
  t.ok(near(x.seek.ms, 3) && near(x.rotation.ms, 0.14 * D.rev) && near(x.transfer.ms, 0.08 * D.rev) && near(x.total, 3 + 0.22 * D.rev), 'request time: 3 + 1.167 + 0.667 = 4.833 ms');
  t.ok(near(x.rotation.sectors, 14) && x.steps.length === 3 && /4\.833/.test(x.say), 'rotation counted in sectors and narrated');
  const D2 = T.disk({ cylinders: 1000, heads: 4, spt: 100, rpm: 7200, settle: 1, knee: 100, kneeTime: 3, full: 12, phase: 0.2 });
  t.ok(near(T.access(D2, { cyl: 100, t: 0 }, { cyl: 100, sector: 10 }).rotation.ms, 0.9 * D2.rev), 'a sector just passed costs nearly a whole turn');
  t.ok(near(T.access(D2, { cyl: 100, t: 0 }, { cyl: 100, sector: 20 }).rotation.ms, 0), 'the sector under the head costs no wait');
  const D3 = T.disk({ cylinders: 1000, heads: 4, spt: 100, rpm: 6000, settle: 1, headSwitch: 0.5 });
  const y = T.access(D3, { cyl: 0, t: 0 }, { cyl: 0, head: 0, sector: 98, count: 4 });
  t.ok(y.transfer.switches === 1 && near(y.transfer.ms, 4 * 0.1 + 0.5), 'a transfer across a track pays one head switch');
  const Z = T.disk({ zones: [{ cyls: 2, spt: 12 }, { cyls: 2, spt: 8 }], heads: 2, rpm: 6000 });
  t.eq([T.chs(Z, 47), T.chs(Z, 48)].map((c) => [c.cyl, c.head, c.sector, c.zone]), [[1, 1, 11, 0], [2, 0, 0, 1]], 'zoned: 48 sectors in the outer zone, then the inner');
  t.eq([Z.sectors, Z.cylinders], [2 * 2 * 12 + 2 * 2 * 8, 4], 'zoned capacity');
  const av = T.averages(Z);
  t.ok(near(av.zones[0].sectorMs, 10 / 12) && near(av.zones[1].sectorMs, 10 / 8) && av.zones[0].rate > av.zones[1].rate, 'outer tracks read faster');
  // the average seek against a brute force over every pair
  const E = T.disk({ cylinders: 60, settle: 0.5, knee: 10, kneeTime: 2, full: 6 });
  let sum = 0; for (let i = 0; i < 60; i++) for (let j = 0; j < 60; j++) sum += T.seekTime(E, i - j).ms;
  t.ok(near(T.averages(E).avgSeek, sum / 3600, 1e-9), 'average seek over every pair of cylinders');
  t.ok(near(T.averages(E).avgRotation, E.rev / 2), 'average rotation is half a turn');
  // random requests against an independent timing
  const r = rng(3); let st = { cyl: 0, t: 0 }, ok = 0;
  const reqs = Array.from({ length: 200 }, () => ({ lba: Math.floor(r() * D.sectors - 8), count: 1 + Math.floor(r() * 8) }));
  for (const q of reqs) {
    const a = T.access(D, st, q), cyl = Math.floor(q.lba / 400), sec = q.lba % 100, d = Math.abs(cyl - st.cyl);
    const seek = d === 0 ? 0 : d <= 100 ? 1 + 0.2 * Math.sqrt(d) : 3 + (9 / 899) * (d - 100);
    const arrive = st.t + seek, turns = arrive / D.rev, under = (turns - Math.floor(turns)) * 100;
    let wait = (sec - under) / 100; while (wait < -1e-9) wait += 1; if (wait > 1 - 1e-9) wait = 0;
    const total = seek + wait * D.rev + (q.count * D.rev) / 100;
    if (near(a.total, total, 1e-6)) ok++;
    st = { cyl, t: st.t + total };
  }
  t.eq(ok, 200, 'access times equal an independent computation on 200 random requests');
  const sv = T.serve(D, reqs.slice(0, 20));
  t.ok(near(sv.total, sv.items.reduce((s, i) => s + i.total, 0)) && near(sv.total, sv.seek + sv.rotation + sv.transfer), 'serve: the total is the sum of the parts');
}

// ---- disk scheduling: hand-worked ----
{
  const q = [95, 180, 34, 119, 11, 123, 62, 64];
  const run = (p, o) => { const r = T.schedule(p, Object.assign({ requests: q, start: 50, cylinders: 200, n: 3 }, o || {})); return [r.order.map((i) => q[i]), r.totals.movement, r.totals.jumps]; };
  t.eq(run('fcfs'), [q, 644, 0], 'FCFS: 45 + 85 + 146 + 85 + 108 + 112 + 61 + 2 = 644');
  t.eq(run('sstf'), [[62, 64, 34, 11, 95, 119, 123, 180], 236, 0], 'SSTF: 236');
  t.eq(run('scan'), [[62, 64, 95, 119, 123, 180, 34, 11], 337, 0], 'SCAN up: 149 to the end, 188 back to 11');
  t.eq(run('look'), [[62, 64, 95, 119, 123, 180, 34, 11], 299, 0], 'LOOK up: 130 + 169');
  t.eq(run('cscan'), [[62, 64, 95, 119, 123, 180, 11, 34], 382, 199], 'C-SCAN up: 149 + a 199 return + 34');
  t.eq(run('clook'), [[62, 64, 95, 119, 123, 180, 11, 34], 322, 169], 'C-LOOK up: 130 + a 169 jump + 23');
  t.eq(run('nscan'), [[95, 180, 34, 11, 119, 123, 64, 62], 684, 0], 'N-step SCAN, batches of 3: 314 + 157 + 213');
  t.eq(run('fscan'), [[62, 64, 95, 119, 123, 180, 34, 11], 337, 0], 'F-SCAN on a static queue is SCAN');
  t.eq(run('scan', { dir: 'down' }), [[34, 11, 62, 64, 95, 119, 123, 180], 230, 0], 'SCAN down: 50 to 0, then 180');
  t.eq(run('look', { dir: 'down' }), [[34, 11, 62, 64, 95, 119, 123, 180], 208, 0], 'LOOK down: 39 + 169');
  t.eq(run('cscan', { dir: 'down' }), [[34, 11, 180, 123, 119, 95, 64, 62], 50 + 199 + 137, 199], 'C-SCAN down: 50, a 199 return, 137');
  t.eq(run('clook', { dir: 'down' }), [[34, 11, 180, 123, 119, 95, 64, 62], 39 + 169 + 118, 169], 'C-LOOK down');
  const f = T.schedule('fcfs', { requests: q, start: 50, cylinders: 200 });
  t.eq(f.served.map((s) => s.dist), [45, 85, 146, 85, 108, 112, 61, 2], 'FCFS: the seek of each request');
  t.eq([f.totals.time, f.totals.maxPassed, f.path.length], [644, 0, 10], 'FCFS: time, no overtakes, a path vertex per request');
  const s = T.schedule('sstf', { requests: q, start: 50, cylinders: 200 });
  t.eq([s.served.map((x) => x.passed), s.totals.maxPassed], [[0, 0, 2, 2, 4, 3, 2, 6], 6], 'SSTF overtakes: 180, second in the queue, is passed by six later requests');
  t.ok(s.steps.every((x) => x.say && !/undefined|NaN/.test(x.say)), 'every step narrated');
  const tie = T.schedule('sstf', { requests: [40, 60], start: 50, cylinders: 100, dir: 'down' });
  t.eq(tie.order, [0, 1], 'SSTF tie: the one in the current direction');
  const D = T.disk({ cylinders: 200, settle: 1, knee: 20, kneeTime: 3, full: 10 });
  const sk = T.schedule('fcfs', { requests: q, start: 50, cylinders: 200, disk: D });
  t.ok(near(sk.served[0].seekMs, T.seekTime(D, 45).ms) && near(sk.totals.seekMs, q.reduce((a, c, i) => a + T.seekTime(D, c - (i ? q[i - 1] : 50)).ms, 0), 1e-3), 'seek times from the disk model');
  // starvation: a far request and a stream of nearby arrivals
  const st = [{ cyl: 150, at: 0 }].concat(Array.from({ length: 100 }, (_, i) => ({ cyl: 50 + (i % 2) * 2, at: 2 * i })));
  const ss = T.schedule('sstf', { requests: st, start: 50, cylinders: 200, service: 2 }), sc = T.schedule('scan', { requests: st, start: 50, cylinders: 200, service: 2 });
  const farS = ss.served.find((x) => x.id === 0).wait, farC = sc.served.find((x) => x.id === 0).wait;
  t.ok(ss.order[ss.order.length - 1] === 0 && ss.totals.starved === 0 && farS > 200, 'SSTF starves the far request until the stream of near ones ends (' + farS + ')');
  t.ok(farC < 120 && farC < farS, 'SCAN reaches it on its sweep (' + farC + ')');
}

// ---- disk scheduling against independent versions ----
const closed = (p, q, s, C, up) => {    // static queues: order by sorting, movement by formula
  const idx = q.map((c, i) => i), hi = idx.filter((i) => (up ? q[i] >= s : q[i] <= s)).sort((a, b) => (up ? q[a] - q[b] : q[b] - q[a]) || a - b);
  const lo = idx.filter((i) => (up ? q[i] < s : q[i] > s));
  const asc = (a, b) => q[a] - q[b] || a - b, desc = (a, b) => q[b] - q[a] || a - b;
  const end = up ? C - 1 : 0;
  if (p === 'fcfs') { let pos = s, m = 0; for (const c of q) { m += Math.abs(c - pos); pos = c; } return [idx, m]; }
  if (p === 'sstf') {
    const left = idx.slice(), order = []; let pos = s, dir = up ? 1 : -1, m = 0;
    while (left.length) {
      left.sort((a, b) => Math.abs(q[a] - pos) - Math.abs(q[b] - pos) || (q[a] === q[b] ? a - b : ((q[b] - pos) * dir > 0) - ((q[a] - pos) * dir > 0)) || a - b);
      const i = left.shift(); if (q[i] !== pos) dir = q[i] > pos ? 1 : -1; m += Math.abs(q[i] - pos); pos = q[i]; order.push(i);
    }
    return [order, m];
  }
  const back = lo.slice().sort(up ? desc : asc), wrap = lo.slice().sort(up ? asc : desc);
  const hiEnd = hi.length ? q[hi[hi.length - 1]] : s;
  if (!lo.length) return [hi, Math.abs(hiEnd - s)];
  const lofar = up ? Math.min(...lo.map((i) => q[i])) : Math.max(...lo.map((i) => q[i])), lonear = up ? Math.max(...lo.map((i) => q[i])) : Math.min(...lo.map((i) => q[i]));
  if (p === 'scan') return [hi.concat(back), Math.abs(end - s) + Math.abs(end - lofar)];
  if (p === 'look') return [hi.concat(back), Math.abs(hiEnd - s) + Math.abs(hiEnd - lofar)];
  if (p === 'cscan') return [hi.concat(wrap), Math.abs(end - s) + (C - 1) + Math.abs(lonear - (C - 1 - end))];
  if (p === 'clook') return [hi.concat(wrap), Math.abs(hiEnd - s) + Math.abs(hiEnd - lofar) + Math.abs(lonear - lofar)];
};
{
  const r = rng(77); let cases = 0;
  for (let k = 0; k < 400; k++) {
    const C = 20 + Math.floor(r() * 300), n = 1 + Math.floor(r() * 14), s = Math.floor(r() * C), up = r() < 0.5;
    const q = Array.from({ length: n }, () => Math.floor(r() * C));
    if (k % 7 === 0) q.push(s, q[0]);           // duplicates and a request under the head
    for (const p of ['fcfs', 'sstf', 'scan', 'look', 'cscan', 'clook']) {
      const got = T.schedule(p, { requests: q, start: s, cylinders: C, dir: up ? 'up' : 'down' }), want = closed(p, q, s, C, up);
      t.eq([got.order, got.totals.movement], want, `${p} on a static queue #${k} (start ${s}, ${up ? 'up' : 'down'}, ${q.join(' ')})`);
      cases++;
    }
    // N-step SCAN on a static queue: batch after batch of the oldest n, each swept by SCAN from where the last ended
    const N = 1 + Math.floor(r() * 4), ns = T.schedule('nscan', { requests: q, start: s, cylinders: C, dir: up ? 'up' : 'down', n: N });
    let pos = s, dir = up, order = [], mv = 0;
    for (let b = 0; b < q.length; b += N) {
      const ids = [...Array(Math.min(N, q.length - b)).keys()].map((i) => b + i), sub = ids.map((i) => q[i]);
      const [o2, m2] = closed('scan', sub, pos, C, dir);
      order = order.concat(o2.map((i) => ids[i])); mv += m2;
      const lastC = sub[o2[o2.length - 1]];
      const lo = sub.filter((c) => (dir ? c < pos : c > pos)).length;
      if (lo) dir = !dir; else if (lastC !== pos) dir = lastC > pos;
      pos = lastC;
    }
    t.eq([ns.order, ns.totals.movement], [order, mv], `N-step SCAN (n = ${N}) #${k}`);
  }
  t.ok(cases === 2400, 'static queues tried: ' + cases);
}
// arrivals over time: a tick-by-tick simulator written separately
function tick(p, reqs, s, C, up, N) {
  const rs = reqs.map((x, i) => ({ i, cyl: x.cyl, at: x.at })), order = [], starts = [];
  let tm = 0, pos = s, dir = up ? 1 : -1, wait = [], batch = [], mv = 0, nextA = 0;
  const arr = rs.slice().sort((a, b) => a.at - b.at || a.i - b.i);
  while (order.length < rs.length) {
    while (nextA < arr.length && arr[nextA].at <= tm) wait.push(arr[nextA++]);
    if ((p === 'nscan' || p === 'fscan') && !batch.length && wait.length) batch = p === 'nscan' ? wait.slice(0, N) : wait.slice();
    const pool = p === 'nscan' || p === 'fscan' ? batch : wait;
    if (!pool.length) { tm = arr[nextA].at; continue; }
    const take = (x) => { order.push(x.i); starts.push(tm); wait = wait.filter((y) => y !== x); batch = batch.filter((y) => y !== x); };
    if (p === 'fcfs' || p === 'sstf') {
      let best = pool[0];
      if (p === 'sstf') best = pool.slice().sort((a, b) => Math.abs(a.cyl - pos) - Math.abs(b.cyl - pos) || (a.cyl === b.cyl ? 0 : ((b.cyl - pos) * dir > 0) - ((a.cyl - pos) * dir > 0)) || a.at - b.at || a.i - b.i)[0];
      if (best.cyl !== pos) dir = Math.sign(best.cyl - pos);
      mv += Math.abs(best.cyl - pos); tm += Math.abs(best.cyl - pos); pos = best.cyl; take(best); continue;
    }
    const here = pool.find((x) => x.cyl === pos);
    if (here) { take(here); continue; }
    const kind = p === 'nscan' || p === 'fscan' ? 'scan' : p;
    const ahead = pool.some((x) => Math.sign(x.cyl - pos) === dir), edge = dir > 0 ? C - 1 : 0;
    if (ahead || ((kind === 'scan' || kind === 'cscan') && pos !== edge)) { pos += dir; tm++; mv++; continue; }
    if (kind === 'scan' || kind === 'look') { dir = -dir; continue; }
    const to = kind === 'cscan' ? C - 1 - edge : dir > 0 ? Math.min(...pool.map((x) => x.cyl)) : Math.max(...pool.map((x) => x.cyl));
    mv += Math.abs(to - pos); tm += Math.abs(to - pos); pos = to;
  }
  return { order, starts, mv, tm };
}
{
  const r = rng(123); let cases = 0;
  for (let k = 0; k < 250; k++) {
    const C = 10 + Math.floor(r() * 150), n = 1 + Math.floor(r() * 16), s = Math.floor(r() * C), up = r() < 0.5, N = 1 + Math.floor(r() * 4);
    const reqs = Array.from({ length: n }, () => ({ cyl: Math.floor(r() * C), at: r() < 0.3 ? 0 : Math.floor(r() * 3 * C) }));
    for (const p of T.policies) {
      const g = T.schedule(p, { requests: reqs, start: s, cylinders: C, dir: up ? 'up' : 'down', n: N }), w = tick(p, reqs, s, C, up, N);
      t.eq([g.order, g.served.map((x) => x.start), g.totals.movement, g.totals.time], [w.order, w.starts, w.mv, w.tm], `${p} with arrivals #${k}`);
      // invariants: each request once, never before it arrives, the path's moves add up to the movement
      const ids = g.order.slice().sort((a, b) => a - b);
      const pathMove = g.path.slice(1).reduce((m, v, i) => m + Math.abs(v.cyl - g.path[i].cyl), 0);
      t.ok(ids.every((v, i) => v === i) && g.served.every((x) => x.start >= x.at) && pathMove === g.totals.movement && g.path.every((v, i) => !i || v.t >= g.path[i - 1].t), `${p} #${k}: invariants`);
      if (p === 'fcfs') t.ok(g.totals.maxPassed === 0, 'FCFS never overtakes');
      if (p === 'scan') t.ok(g.path.filter((v) => v.kind === 'turn').every((v) => v.cyl === 0 || v.cyl === C - 1), 'SCAN turns only at the ends');
      cases++;
    }
  }
  t.ok(cases === 2000, 'policies with arrivals tried: ' + cases);
}

// ---- SSD ----
{
  // by hand: 5 blocks of 4 pages, 10 logical pages
  const D = F.create({ blocks: 5, pages: 4, op: 1, reserve: 1 });
  t.eq([D.logical, D.opReal], [10, 1], 'over-provisioning 100%: 10 logical pages on 20 physical');
  for (let l = 0; l < 10; l++) F.write(D, l);
  let s = F.snapshot(D);
  t.eq([s.blocks[0].lpns, s.blocks[2].pages, s.active, s.blocks.filter((b) => b.free).map((b) => b.id)], [[0, 1, 2, 3], ['valid', 'valid', 'free', 'free'], 2, [3, 4]], 'ten writes fill blocks 0 and 1 and half of 2');
  for (const l of [0, 1, 2]) F.write(D, l);
  s = F.snapshot(D);
  t.eq([s.blocks[0].pages, s.blocks[2].lpns, s.blocks[3].lpns, s.l2p[2]], [['invalid', 'invalid', 'invalid', 'valid'], [8, 9, 0, 1], [2, -1, -1, -1], 12], 'overwrites go to new pages; the old ones turn invalid');
  const w = [4, 5, 6, 7].map((l) => F.write(D, l));
  s = F.snapshot(D);
  t.eq([w[3].steps.map((x) => x.kind), w[3].steps.find((x) => x.kind === 'gc-victim').block, s.blocks[1].erases, s.blocks[4].lpns[0]], [['invalidate', 'gc-victim', 'erase', 'new-block', 'write'], 1, 1, 7], 'with one free block left, GC erases block 1 (no valid pages)');
  t.eq([F.stats(D).host, F.stats(D).flash, F.stats(D).wa, F.stats(D).erases], [17, 17, 1, 1], 'no copies yet: write amplification 1');
  // a victim with valid pages: fill block 4, then overwrite so that the best victim still holds one page
  for (const l of [3, 8, 9]) F.write(D, l);
  const g = F.write(D, 0);
  t.ok(g.steps.some((x) => x.kind === 'gc-victim' && x.block === 0), 'block 0, now all invalid, is the next victim');
  // victims that still hold valid pages: 4 blocks of 4 pages, 7 logical pages
  const H = F.create({ blocks: 4, pages: 4, op: 1 });
  for (const l of [0, 1, 2, 3, 4, 5, 6, 0, 4, 1, 5, 2]) F.write(H, l);
  const sh = F.snapshot(H);
  t.eq([H.logical, sh.blocks.map((b) => b.valid), sh.blocks[1].lpns], [7, [1, 2, 4, 0], [-1, -1, 6, 0]], 'before: block 0 holds only page 3, block 1 pages 6 and 0');
  const h = F.write(H, 6);
  t.eq(h.steps.map((x) => x.kind + (x.block !== undefined ? ' ' + x.block : '')), ['invalidate 1', 'gc-victim 0', 'new-block 3', 'gc-copy 3', 'erase 0', 'gc-victim 1', 'gc-copy 3', 'erase 1', 'write 3'], 'two GC rounds, a tie broken to the lower block, each copying its one valid page');
  t.eq([F.snapshot(H).blocks[3].lpns, F.stats(H).host, F.stats(H).flash, F.stats(H).gcCopies, F.stats(H).wa], [[3, 0, 6, -1], 13, 15, 2, 1.154], 'WA = 15 flash writes / 13 host writes');
  t.eq(F.check(D), [], 'mapping consistent');
  t.eq(F.read(D, 0).value, F.stats(D).host, 'the last write, of page 0, reads back');
  F.trim(D, 3);
  t.eq([F.read(D, 3).value, F.check(D)], [null, []], 'TRIM unmaps a page');
  let threw = false; try { F.write(D, 10); } catch (e) { threw = true; } t.ok(threw, 'logical pages stop at the advertised size');
}
// an independent FTL: the same documented rules, written separately
function ftl(B, P, L, reserve, ops) {
  const st = new Array(B * P).fill(0), owner = new Array(B * P).fill(-1), map = new Array(L).fill(-1), er = new Array(B).fill(0), ptr = new Array(B).fill(0);
  let free = [...Array(B).keys()], act = -1, host = 0, flash = 0, copies = 0;
  const valid = (b) => st.slice(b * P, b * P + P).filter((x) => x === 1).length;
  const prog = (l) => { if (act < 0 || ptr[act] === P) { act = free.shift(); ptr[act] = 0; } const p = act * P + ptr[act]++; st[p] = 1; owner[p] = l; map[l] = p; flash++; };
  const gc = () => {
    let v = -1; for (let b = 0; b < B; b++) if (b !== act && !free.includes(b) && (v < 0 || valid(b) < valid(v))) v = b;
    for (let p = v * P; p < v * P + P; p++) if (st[p] === 1) { const l = owner[p]; st[p] = 2; owner[p] = -1; prog(l); copies++; }
    for (let p = v * P; p < v * P + P; p++) { st[p] = 0; owner[p] = -1; }
    er[v]++; free.push(v);
  };
  for (const o of ops) {
    if (o.op === 't') { if (map[o.lpn] >= 0) { st[map[o.lpn]] = 2; owner[map[o.lpn]] = -1; map[o.lpn] = -1; } continue; }
    host++;
    if (map[o.lpn] >= 0) { st[map[o.lpn]] = 2; owner[map[o.lpn]] = -1; map[o.lpn] = -1; }
    if (act < 0 || ptr[act] === P) { while (free.length <= reserve) gc(); }
    prog(o.lpn);
  }
  return { map, host, flash, copies, erases: er };
}
{
  const r = rng(9);
  for (let k = 0; k < 60; k++) {
    const B = 6 + Math.floor(r() * 14), P = 2 + Math.floor(r() * 7), op = [0.07, 0.15, 0.28, 0.5, 1][k % 5], kind = ['uniform', 'hotcold', 'sequential'][k % 3];
    const D = F.create({ blocks: B, pages: P, op, gc: 'greedy' });
    const ops = F.workload(kind, 6 * B * P, { logical: D.logical, seed: k + 1, fill: k % 2 === 0, trim: k % 4 === 1 ? 0.1 : 0 });
    const res = F.run(D, ops), ind = ftl(B, P, D.logical, 1, ops);
    t.eq([[...D.l2p], res.stats.host, res.stats.flash, res.stats.gcCopies, D.blocks.map((b) => b.erases)], [ind.map, ind.host, ind.flash, ind.copies, ind.erases], `greedy FTL #${k} (${B}×${P}, op ${op}, ${kind}) equals the independent one`);
  }
}
// invariants on every policy: no live data lost, the mapping consistent after every operation, WA counted
{
  const r = rng(41); let checks = 0;
  for (let k = 0; k < 48; k++) {
    const gc = k % 2 ? 'cost-benefit' : 'greedy', wear = ['none', 'dynamic', 'static'][k % 3];
    const B = 6 + Math.floor(r() * 12), P = 2 + Math.floor(r() * 6);
    const D = F.create({ blocks: B, pages: P, op: [0.1, 0.25, 0.5][k % 3], gc, wear, wearDelta: 2 });
    const ops = F.workload(['uniform', 'hotcold', 'sequential'][(k >> 1) % 3], 8 * B * P, { logical: D.logical, seed: 100 + k, fill: true, trim: k % 5 === 0 ? 0.08 : 0 });
    const truth = new Map(); let bad = 0, flashSteps = 0, host = 0, problems = 0;
    ops.forEach((o, i) => {
      const steps = o.op === 't' ? F.trim(D, o.lpn).steps : F.write(D, o.lpn, 'v' + i).steps;
      if (o.op === 't') truth.delete(o.lpn); else { truth.set(o.lpn, 'v' + i); host++; }
      flashSteps += steps.filter((x) => x.kind === 'write' || x.kind === 'gc-copy' || x.kind === 'wl-move').length;
      if (F.check(D).length) problems++;
      if (i % 7 === 0) for (let l = 0; l < D.logical; l++) if (F.read(D, l).value !== (truth.has(l) ? truth.get(l) : null)) bad++;
    });
    for (let l = 0; l < D.logical; l++) if (F.read(D, l).value !== (truth.has(l) ? truth.get(l) : null)) bad++;
    const s = F.stats(D);
    t.eq([bad, problems], [0, 0], `${gc}, ${wear} #${k}: every page reads its last write and the FTL stays consistent`);
    t.ok(s.flash === flashSteps && s.flash === s.host + s.gcCopies + s.wlCopies && s.host === host && near(s.wa, Math.round((flashSteps / host) * 1000) / 1000), `${gc}, ${wear} #${k}: WA = flash / host = ${s.wa}`);
    t.ok(s.erases === D.blocks.reduce((n, b) => n + b.erases, 0), `#${k}: erase counts add up`);
    checks++;
  }
  t.ok(checks === 48, 'SSD policy runs: ' + checks);
}
// what the knobs do: more over-provisioning lowers WA; static wear levelling narrows the spread; TRIM helps
{
  const wa = (op) => { const D = F.create({ blocks: 32, pages: 16, op }); return F.run(D, F.workload('uniform', 4000, { logical: D.logical, seed: 5, fill: true })).stats.wa; };
  const ws = [0.07, 0.28, 0.6, 1].map(wa);
  t.ok(ws[0] > ws[1] && ws[1] > ws[2] && ws[2] > ws[3] && ws[3] >= 1, 'WA falls as over-provisioning grows: ' + ws.join(', '));
  const spread = (wear) => { const D = F.create({ blocks: 24, pages: 8, op: 0.3, wear, wearDelta: 3 }); F.run(D, F.workload('hotcold', 5000, { logical: D.logical, seed: 8, fill: true, hot: 0.1, hotShare: 0.95 })); const s = F.stats(D); return s.maxErase - s.minErase; };
  const sn = spread('none'), sd = spread('static');
  t.ok(sd < sn, `static wear levelling narrows the erase spread (${sn} to ${sd})`);
  const withTrim = (trim) => { const D = F.create({ blocks: 24, pages: 8, op: 0.1 }); const ops = F.workload('uniform', 0, { logical: D.logical, fill: true }); if (trim) for (let l = D.logical >> 1; l < D.logical; l++) ops.push({ op: 't', lpn: l }); for (const o of F.workload('uniform', 2000, { logical: D.logical >> 1, seed: 4 })) ops.push(o); return F.run(D, ops).stats.wa; };
  t.ok(withTrim(true) < withTrim(false), 'TRIM of unused pages lowers WA');
  const cb = F.create({ blocks: 16, pages: 8, gc: 'cost-benefit' }); const tr = F.run(cb, F.workload('hotcold', 600, { logical: cb.logical, seed: 2, fill: true }), { snap: true });
  const vic = tr.steps.find((x) => x.kind === 'gc-victim');
  t.ok(vic && vic.scores.every((x) => x.score <= vic.scores.find((y) => y.block === vic.block).score), 'cost-benefit takes the best score');
  const last = tr.steps[tr.steps.length - 1];
  t.ok(last.snap && last.snap.blocks.length === 16 && last.snap.blocks.every((b) => b.pages.length === 8) && tr.series.length === 600 + cb.logical, 'snapshots and the WA series for drawing');
  t.ok(tr.steps.every((x) => x.say && !/undefined|NaN/.test(x.say)), 'every SSD step narrated');
}

// ---- error detection ----
{
  t.eq(K.crc32('123456789'), 0xcbf43926, 'CRC-32 of "123456789" is cbf43926');
  t.eq([K.crc32(''), K.crc32('a')], [0, 0xe8b7be43], 'CRC-32 of "" and "a"');
  t.eq(K.crc32Bits('123456789').crc, 0xcbf43926, 'CRC-32 bit by bit agrees');
  t.eq(K.crc32Bits('12').rows.length, 16, 'eight shifts a byte');
  // an independent CRC-32: MSB-first long division with the bits of each byte reflected, and the result reflected
  const refl = (v, n) => { let r = 0; for (let i = 0; i < n; i++) r = (r << 1) | ((v >>> i) & 1); return r >>> 0; };
  const msb = (bytes) => { let c = 0xffffffff; for (const b of bytes) { c ^= refl(b, 8) << 24; for (let i = 0; i < 8; i++) c = c & 0x80000000 ? ((c << 1) ^ 0x04c11db7) >>> 0 : (c << 1) >>> 0; } return (refl(c >>> 0, 32) ^ 0xffffffff) >>> 0; };
  const r = rng(17); let ok = 0;
  for (let k = 0; k < 300; k++) { const b = Uint8Array.from({ length: Math.floor(r() * 40) }, () => Math.floor(r() * 256)); if (K.crc32(b) === msb(b) && K.crc32Bits(b).crc === msb(b)) ok++; }
  t.eq(ok, 300, 'CRC-32 equals an independent MSB-first version on random data');
  const dv = K.crcDivide('101101', '1101');
  t.eq([dv.remainder, dv.codeword, dv.rows.length], ['010', '101101010', 3], 'CRC long division by hand: 101101 ÷ 1101 leaves 010');
  t.eq([K.crcCheck('101101010', '1101').ok, K.crcCheck('100101010', '1101').ok], [true, false], 'the codeword checks; a flipped bit is caught');
  let modOk = 0;
  for (let k = 0; k < 200; k++) {
    const m = 1 + Math.floor(r() * 4095), g = 8 + Math.floor(r() * 56) | 8, deg = Math.floor(Math.log2(g));
    let v = m * 2 ** deg; for (let i = 30; i >= deg; i--) if ((v >>> i) & 1) v ^= g << (i - deg);
    if (K.crcDivide(m.toString(2), g.toString(2)).remainder === v.toString(2).padStart(deg, '0')) modOk++;
  }
  t.eq(modOk, 200, 'long division equals polynomial remainder computed on integers');
  t.eq([K.parity('1011001').bit, K.parity('1011001', 'odd').bit, K.parity([1, 1, 1]).bit, K.parity('A').ones], [0, 1, 1, 2], 'parity bits');
  t.eq(K.internet([0x45, 0x00, 0x00, 0x1c]).value, 0xbae3, 'internet checksum: ~(4500 + 001c) = bae3');
  t.eq([K.internet([0xff, 0xff, 0x00, 0x01]).value, K.internet([0xff, 0xff, 0x00, 0x01]).folds], [0xfffe, 1], 'a carry folds back in');
  t.eq(K.internet([0x12, 0x34, 0x56]).words, [0x1234, 0x5600], 'an odd byte is padded');
  t.eq([K.fletcher16('abcde').value, K.fletcher16('abcdef').value, K.adler32('abc').value], [0xc8f0, 0x2057, 0x024d0127], 'Fletcher-16 check values; Adler-32 of abc: A = 1 + 97 + 98 + 99 = 0x127, B = 98 + 196 + 295 = 0x24d');
  t.eq(K.sum8([200, 100, 1]).value, 45, '8-bit sum wraps');
  t.eq(K.hamming74([1, 0, 1, 1]).code, [0, 1, 1, 0, 0, 1, 1], 'Hamming(7,4) of 1011 is 0110011');
  let ham = 0;
  for (let d = 0; d < 16; d++) {
    const bits = [3, 2, 1, 0].map((i) => (d >> i) & 1), c = K.hamming74(bits).code;
    if (K.hamming74decode(c).position === 0 && K.hamming74decode(c).data.join('') === bits.join('')) ham++;
    for (let i = 0; i < 7; i++) { const x = K.hamming74decode(K.flip(c, i)); if (x.position === i + 1 && x.data.join('') === bits.join('') && x.corrected.join('') === c.join('')) ham++; }
  }
  t.eq(ham, 16 * 8, 'Hamming(7,4): every codeword and every single flip of it corrected');
  const M = K.remap({ sectors: 100, spares: 2 });
  t.eq([K.markBad(M, 7).phys, K.markBad(M, 7).phys, K.markBad(M, 9).phys, K.markBad(M, 11).kind, K.resolve(M, 9).phys, K.resolve(M, 10).remapped], [100, 100, 101, 'no-spare', 101, false], 'bad-block remap to spares');
}
// ---- every say string of the storage and I/O engines, and of the RAID 5 scene, over seeded inputs: counts agree
// with their nouns (also after × and ·), a/an fits the next word, no doubled words, no undefined or NaN ----
{
// collects every say from the storage and I/O engines over seeded inputs and scans them
  const SING = 'byte block read write chunk cylinder sector page disk request unit interrupt poll call copy retry time stripe turn word job step bit one zero shift switch syscall system batch process slot spare EAGAIN head operation host flash erase entry group'.split(' ');
  function scan(text) {
    const bad = [];
    if (/undefined|NaN|Infinity|\[object/.test(text)) bad.push('undefined/NaN');
    const LABEL = /^(disk|disks|request|requests|block|blocks|page|pages|sector|sectors|chunk|chunks|stripe|stripes|unit|units|cylinder|cylinders|operation|byte|bit|bits|process|slot|spare|file|reference|position|frame|head|zone|level|raid|step|row|column|group|copy|batch|order|of|=|\+|−|-|⊕|\/|,|and|than|from|to|is|at|by|n|p|d|g|x|y|t|0x|a)$/i;
    const FN = /^(of|from|in|on|at|to|and|or|is|are|was|were|that|a|the|each|per|with|for|left|remain|waiting|before|after|but|so|then|while|than|as|it|they|still|back|later|$)/;
    const toks = [...text.matchAll(/[^\s]+/g)].map((m) => m[0]);
    for (let i = 0; i < toks.length - 1; i++) {
      const nm = toks[i].match(/^[(“‘]?(\d+(?:\.\d+)?)$/); if (!nm) continue;
      const wm = toks[i + 1].match(/^([A-Za-z]+)([^A-Za-z]*)$/); if (!wm) continue;
      const n = nm[1], w = wm[1], punct = wm[2], next = punct ? '' : (toks[i + 2] || '').replace(/[^A-Za-z]/g, '').toLowerCase();
      const prev = i ? toks[i - 1].replace(/[“‘(]/g, '') : '';
      if (prev && LABEL.test(prev) && !/^[(“‘]/.test(toks[i])) continue;
      if (n === '1' && /[^s]s$/.test(w) && !/(us|is|ss)$/.test(w) && !/^(ms|µs)$/.test(w)) bad.push('count: ' + toks[i - 1] + ' ' + n + ' ' + w);
      else if (n === '1' && w === 'bytes') bad.push('count: ' + n + ' ' + w);
      else if (n !== '1' && !/\./.test(n) && SING.includes(w) && FN.test(next)) bad.push('count: ' + n + ' ' + w + ' ' + next);
    }
    for (const m of text.matchAll(/\b(cylinders|sectors|disks|chunks|blocks|units|requests|pages|stripes|bits|bytes|slots|retries) (\d+)(?![\d,–]| to\b| and\b| of\b| \+)/g)) bad.push('count: ' + m[0]);
    for (const m of text.matchAll(/\b(a) ([a-z]\w*|\d+)/g)) {
      const w = m[2];
      if (/^\d/.test(w) ? /^(8|11|18|8\d)(\D|$)/.test(w) : /^[aeio]/.test(w) || (/^u/.test(w) && !/^(un[iu]|use|usu|uni)/.test(w))) bad.push('a/an: ' + m[0]);
    }
    for (const m of text.matchAll(/\b(An|an) ([a-z]\w*|\d+)/g)) {
      const w = m[2];
      if (/^\d/.test(w) ? !/^(8|11|18|8\d)(\D|$)/.test(w) : !/^[aeiou]/.test(w) && !/^h(our|onest)/.test(w)) bad.push('a/an: ' + m[0]);
    }
    for (const m of text.matchAll(/\b([A-Za-z]+) \1\b/gi)) if (!/^[0-9a-f]+$/i.test(m[1]) || /[g-z]/i.test(m[1])) bad.push('doubled: ' + m[0]);
    return bad;
  }
  function says(x, out = [], seen = new Set()) {
    if (!x || typeof x !== 'object' || seen.has(x)) return out;
    seen.add(x);
    if (ArrayBuffer.isView(x)) return out;
    if (typeof x.say === 'string') out.push(x.say);
    for (const k of Object.keys(x)) if (k !== 'say') says(x[k], out, seen);
    return out;
  }
  for (const [s, want] of [['read the 1 chunk (1 reads, against 2)', 1], ['request 3 (cylinders 12)', 1], ['read 1 bytes', 1], ['3 × 1 reads', 1], ['2 · 1 writes', 1], ['costs 3 read in all', 1], ['a error', 1], ['an block', 1], ['a 8-bit sum', 1], ['the the disk', 1], ['value NaN', 1], ['Disk 1 fails; 2 host writes; a unit; an 8-bit sum; 3 disk I/Os; requests 0 + 4', 0]])
    t.eq(scan(s).length, want, 'the scanner on “' + s + '”');
  const R = S.Raid, IO = S.IO;
  const all = []; const add = (x) => says(x, all);
  const r = rng(99), ri = (a, b) => a + Math.floor(r() * (b - a + 1));
  for (let k = 0; k < 40; k++) {
    for (const level of R.levels) {
      const disks = level === 10 ? 4 : ri(level === 6 ? 4 : level === 0 || level === 1 ? 2 : 3, 6);
      const A = R.create({ level, disks, chunk: ri(1, 3), stripes: ri(1, 3), layout: R.layouts[k % 4] }), cap = R.capacity(A);
      for (let i = 0; i < 4; i++) { const off = ri(0, cap - 1); add(R.write(A, off, Uint8Array.from({ length: ri(1, cap - off) }, () => ri(0, 255)), { method: ['auto', 'rmw', 'rcw'][i % 3] })); }
      add(R.read(A, 0, cap));
      if (level) { const d = ri(0, disks - 1); add(R.fail(A, d)); add(R.write(A, 0, Uint8Array.of(1))); add(R.read(A, 0, cap)); add(R.rebuild(A, d)); }
      if (level === 6) { add(R.fail(A, 0)); add(R.fail(A, 1)); add(R.read(A, 0, cap)); add(R.rebuild(A, [0, 1])); }
      add(R.smallWrite({ level, disks, chunks: ri(1, disks) }));
      add(R.formulas({ level, disks, size: ri(1, 3), seq: ri(1, 3), iops: ri(1, 3), latency: ri(1, 2) }));
    }
    const D = T.disk({ cylinders: ri(2, 500), heads: ri(1, 4), spt: ri(1, 50), rpm: 7200, overhead: k % 2, headSwitch: k % 3 ? 0.5 : 0, settle: 1, knee: ri(1, 3) });
    add({ say: T.seekTime(D, ri(0, D.cylinders - 1)).say }); add({ say: T.averages(D).say });
    add(T.serve(D, Array.from({ length: ri(1, 4) }, () => ({ lba: ri(0, D.sectors - 1), count: 1 }))));
    add(T.access(D, { cyl: 0, t: 0 }, { lba: 0, count: ri(1, Math.min(4, D.sectors)) }));
    const C = ri(2, 60);
    const reqs = Array.from({ length: ri(1, 6) }, () => ({ cyl: ri(0, C - 1), at: r() < 0.5 ? 0 : ri(0, 50) }));
    for (const p of T.policies) add(T.schedule(p, { requests: reqs, start: ri(0, C - 1), cylinders: C, n: ri(1, 3), service: k % 2 }));
    const Fd = F.create({ blocks: ri(4, 8), pages: ri(1, 4), gc: k % 2 ? 'greedy' : 'cost-benefit', wear: ['none', 'dynamic', 'static'][k % 3], wearDelta: 1 });
    add(F.run(Fd, F.workload('uniform', 60, { logical: Fd.logical, seed: k, fill: true, trim: 0.1 })));
    add(F.read(Fd, 0)); add(F.trim(Fd, 0, 2)); add(F.trim(Fd, 0));
    const bytes = Array.from({ length: ri(1, 3) }, () => ri(0, 255));
    for (const x of [K.parity(bytes), K.parity([1]), K.parity('0'), K.crc32Bits(bytes), K.crcDivide('1' + ri(0, 63).toString(2), '1' + ri(0, 7).toString(2)), K.crcDivide('1', '11'), K.sum8(bytes), K.internet(bytes.slice(0, ri(1, 3))), K.fletcher16(bytes), K.adler32(bytes), K.hamming74([ri(0,1),ri(0,1),ri(0,1),ri(0,1)]), K.hamming74decode(K.flip(K.hamming74([1,0,1,1]).code, ri(0, 6))), K.hamming74decode([0,1,1,0,0,1,1])]) add(x);
    const M = K.remap({ sectors: 10, spares: ri(1, 2) }); for (let i = 0; i < 3; i++) add(K.markBad(M, ri(0, 3))); add(K.resolve(M, 0)); add(K.resolve(M, 9));
    for (const m of IO.transferModes) add(IO.transfer(m, { bytes: ri(1, 12), unit: ri(1, 4), device: ri(1, 4), dmaBlock: [0, 1, 4][k % 3], irq: ri(1, 2), cmd: 1, copy: 1, poll: 1, dmaSetup: 1, bus: 1 }));
    add(IO.handshake(ri(0, 255)));
    for (const m of IO.ioModes) add(IO.mode(m, { syscall: ri(1, 2), device: ri(1, 30), copy: 1, work: ri(0, 20), use: 1, slice: ri(1, 5), notify: 1, other: ri(0, 1) ? 1 : ri(0, 30), irq: 1 }));
    for (const b of ['none', 'single', 'double', 'circular']) add(IO.buffering(b, { blocks: ri(1, 5), fill: ri(1, 9), move: ri(1, 2), compute: ri(1, 9), slots: ri(1, 4) }));
    add(IO.cache({ size: ri(1, 3), write: k % 2 ? 'back' : 'through', readAhead: ri(0, 2) }, Array.from({ length: 12 }, () => (r() < 0.1 ? { op: 'sync' } : { op: r() < 0.4 ? 'w' : 'r', block: ri(0, 5) }))));
    add(IO.spool(Array.from({ length: ri(1, 3) }, (_, i) => ({ proc: 'P' + i, at: ri(0, 4), pages: ri(1, 3) })), { pageTime: ri(1, 2), spoolTime: 1 }));
    add(IO.blockQueue(Array.from({ length: ri(1, 5) }, () => ({ at: ri(0, 5), sector: ri(0, 20), count: ri(1, 2), op: r() < 0.5 ? 'r' : 'w' })), { elevator: ['noop', 'look', 'deadline'][k % 3], readExpire: 1 }));
    add(IO.lifeOfRead({ bytes: ri(1, 3) === 1 ? 1 : ri(1, 9000), offset: ri(0, 5000), cached: [true, false, [true, false]][k % 3], blocks: [ri(0, 9), ri(0, 9), ri(0, 9)] }));
  }
  const V = load(['core', 'stage', 'demo'], { vm: true }), sc = V.Demo.byId('raid5');
  for (let msg = 0; msg < 4; msg++) for (const disks of [4, 5]) for (let chunk = 1; chunk <= 4; chunk++) for (const narrow of [false, true]) for (const f of sc.frames({ narrow, knobs: { msg, disks, chunk, fail: (msg + chunk) % disks } })) all.push(f.say);
  const found = new Map();
  for (const s of all) for (const b of scan(s)) if (!found.has(b)) found.set(b, s);
  t.ok(all.length > 20000, 'say strings scanned: ' + all.length);
  t.eq([...found].map(([b, s]) => b + ' in “' + s + '”'), [], 'no slips in any say string');
}
t.done();
