// A hard disk's geometry and timing. A request's time is the controller overhead, the seek to its cylinder, the
// rotational wait until its first sector comes under the head, and the transfer of its sectors.
//   S.Storage.disk({cylinders, heads, spt | zones: [{cyls, spt}], rpm, sectorBytes, settle, knee, kneeTime, full,
//                   overhead, headSwitch, phase}) -> D
//     zones: outer zones first (cylinder 0 is the outermost); each holds `cyls` cylinders of `spt` sectors a track.
//     The seek curve: 0 for no movement; settle + a·√d up to the knee (a chosen so that a seek of `knee` cylinders
//     takes kneeTime), then a straight line on to `full` for the full stroke of cylinders − 1. All times in ms.
//     phase: the fraction of a turn under the head at t = 0 (sector k of a track starts at angle k / spt).
//   S.Storage.seekTime(D, d) -> {d, ms, part: 'none'|'sqrt'|'linear', say}
//   S.Storage.chs(D, lba) -> {lba, cyl, head, sector, spt, zone};  S.Storage.lba(D, {cyl, head, sector}) -> lba
//   S.Storage.angle(D, t) -> the fraction of a turn under the heads at time t
//   S.Storage.access(D, {cyl, t}, {lba | cyl, head, sector, count, id}) -> {id, chs, from, start, overhead, seek:
//       {d, ms, part}, rotation: {ms, sectors, angle, target}, transfer: {ms, sectors, switches}, total, end,
//       state: {cyl, t}, steps, say}
//     The transfer runs on across tracks of the same cylinder (and on to the next cylinder) at the speed of each
//     sector's zone, with headSwitch ms at each track boundary; the rotation stays in step (the tracks are skewed).
//   S.Storage.serve(D, reqs, {cyl, t}) -> {items: [access..], total, steps}   requests in the order given
//   S.Storage.averages(D) -> {rev, avgRotation, avgSeek, avgSeekDistance, zones: [{from, to, spt, rate, sectorMs}],
//       access4k, say}   the average seek is over every pair of cylinders, each equally likely
(function (S) {
  'use strict';
  const pl = (n, w, ws) => n + ' ' + (n === 1 ? w : ws || w + 's');
  const T = (S.Storage = S.Storage || {});
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const fx = (v) => String(r3(v));

  T.disk = function (o) {
    const a = Object.assign({ cylinders: 1000, heads: 4, spt: 100, rpm: 7200, sectorBytes: 512, settle: 1, overhead: 0, headSwitch: 0, phase: 0 }, o || {});
    const C = a.zones ? a.zones.reduce((n, z) => n + z.cyls, 0) : a.cylinders;
    if (C < 2) throw new Error('a disk needs at least two cylinders');
    const knee = a.knee === undefined ? Math.max(1, Math.round((C - 1) / 4)) : Math.min(a.knee, C - 1);
    const full = a.full === undefined ? 10 * a.settle : a.full;
    const kneeTime = a.kneeTime === undefined ? a.settle + (full - a.settle) * 0.6 : a.kneeTime;
    let from = 0, lba = 0;
    const zones = (a.zones || [{ cyls: C, spt: a.spt }]).map((z, i) => { const zz = { i, from, to: from + z.cyls - 1, spt: z.spt, firstLba: lba }; from += z.cyls; lba += z.cyls * a.heads * z.spt; return zz; });
    const D = { cylinders: C, heads: a.heads, zones, rpm: a.rpm, rev: 60000 / a.rpm, sectorBytes: a.sectorBytes, settle: a.settle, knee, kneeTime, full, overhead: a.overhead, headSwitch: a.headSwitch, phase: a.phase, sectors: lba };
    D.a = (kneeTime - a.settle) / Math.sqrt(knee);
    D.b = C - 1 > knee ? (full - kneeTime) / (C - 1 - knee) : 0;
    D.capacity = lba * a.sectorBytes;
    return D;
  };
  const zoneOf = (D, cyl) => D.zones.find((z) => cyl >= z.from && cyl <= z.to);

  T.seekTime = function (D, d) {
    d = Math.abs(d);
    if (d === 0) return { d, ms: 0, part: 'none', say: 'The head is already on the cylinder: no seek.' };
    if (d <= D.knee) { const ms = D.settle + D.a * Math.sqrt(d); return { d, ms, part: 'sqrt', say: `A seek of ${d} cylinder${d === 1 ? '' : 's'} is short, so the arm is still accelerating: ${D.settle} + ${fx(D.a)} · √${d} = ${fx(ms)} ms.` }; }
    const ms = D.kneeTime + D.b * (d - D.knee);
    return { d, ms, part: 'linear', say: `A seek of ${d} cylinders reaches full speed past ${D.knee}: ${fx(D.kneeTime)} + ${fx(D.b)} · (${d} − ${D.knee}) = ${fx(ms)} ms.` };
  };

  T.chs = function (D, lba) {
    if (lba < 0 || lba >= D.sectors) throw new Error('sector ' + lba + ' is not on the disk');
    const z = D.zones.find((x, i) => i === D.zones.length - 1 || lba < D.zones[i + 1].firstLba), off = lba - z.firstLba, per = D.heads * z.spt;
    return { lba, cyl: z.from + Math.floor(off / per), head: Math.floor(off / z.spt) % D.heads, sector: off % z.spt, spt: z.spt, zone: z.i };
  };
  T.lba = function (D, p) { const z = zoneOf(D, p.cyl); return z.firstLba + (p.cyl - z.from) * D.heads * z.spt + p.head * z.spt + p.sector; };
  T.angle = (D, t) => { const x = (D.phase + t / D.rev) % 1; return x < 0 ? x + 1 : x; };

  T.access = function (D, state, req) {
    const p = req.lba !== undefined ? T.chs(D, req.lba) : Object.assign({ head: 0, sector: 0 }, req, { spt: zoneOf(D, req.cyl).spt });
    const chs = req.lba !== undefined ? p : T.chs(D, T.lba(D, p)), count = req.count || 1, id = req.id === undefined ? chs.lba : req.id;
    const start = state.t, from = state.cyl, steps = [];
    const sk = T.seekTime(D, chs.cyl - from);
    const arrive = start + D.overhead + sk.ms;
    const ang = T.angle(D, arrive), target = chs.sector / chs.spt;
    let frac = target - ang; if (frac < 0) frac += 1; if (frac > 1 - 1e-9) frac = 0;
    const rot = { ms: frac * D.rev, sectors: frac * chs.spt, angle: ang, target };
    let tms = 0, switches = 0, lba = chs.lba, cur = chs;
    for (let i = 0; i < count; i++) {
      if (i) { const nx = T.chs(D, lba); if (nx.head !== cur.head || nx.cyl !== cur.cyl) { switches++; tms += D.headSwitch; } cur = nx; }
      tms += D.rev / cur.spt; lba++;
    }
    const tr = { ms: tms, sectors: count, switches };
    const total = D.overhead + sk.ms + rot.ms + tms, end = start + total;
    if (D.overhead) steps.push({ kind: 'overhead', ms: D.overhead, say: `The controller takes ${fx(D.overhead)} ms to accept request ${id}.` });
    steps.push({ kind: 'seek', ms: sk.ms, d: sk.d, from, to: chs.cyl, say: sk.d ? `Seek from cylinder ${from} to ${chs.cyl}, ${pl(sk.d, 'cylinder')}: ${fx(sk.ms)} ms.` : `The arm is already on cylinder ${chs.cyl}: no seek.` });
    steps.push({ kind: 'rotate', ms: rot.ms, angle: ang, target, say: `At t = ${fx(arrive)} ms sector ${fx(ang * chs.spt)} of ${chs.spt} is under the head; sector ${chs.sector} is ${pl(r3(rot.sectors), 'sector')} further round: ${fx(rot.ms)} ms of the ${fx(D.rev)} ms turn.` });
    steps.push({ kind: 'transfer', ms: tms, sectors: count, say: `Read ${count} sector${count === 1 ? '' : 's'} at ${fx(D.rev / chs.spt)} ms each${switches ? ' with ' + switches + ' head switch' + (switches === 1 ? '' : 'es') : ''}: ${fx(tms)} ms.` });
    const say = `Request ${id} (cylinder ${chs.cyl}, head ${chs.head}, sector ${chs.sector}): ${D.overhead ? fx(D.overhead) + ' overhead + ' : ''}${fx(sk.ms)} seek + ${fx(rot.ms)} rotation + ${fx(tms)} transfer = ${fx(total)} ms.`;
    return { id, chs, from, start, overhead: D.overhead, seek: { d: sk.d, ms: sk.ms, part: sk.part }, rotation: rot, transfer: tr, total, end, state: { cyl: chs.cyl, t: end }, steps, say };
  };

  T.serve = function (D, reqs, state) {
    let st = Object.assign({ cyl: 0, t: 0 }, state || {});
    const items = [], steps = [];
    for (const r of reqs) {
      const x = T.access(D, st, typeof r === 'number' ? { lba: r } : r);
      items.push(x); steps.push({ kind: 'request', id: x.id, start: x.start, end: x.end, seek: x.seek.ms, rotation: x.rotation.ms, transfer: x.transfer.ms, cyl: x.chs.cyl, say: x.say });
      st = x.state;
    }
    const sum = (f) => items.reduce((n, x) => n + f(x), 0);
    return { items, total: st.t - (state && state.t ? state.t : 0), seek: sum((x) => x.seek.ms), rotation: sum((x) => x.rotation.ms), transfer: sum((x) => x.transfer.ms), steps };
  };

  T.averages = function (D) {
    const C = D.cylinders;
    let avgSeek = T.seekTime(D, 0).ms / C, avgD = 0;
    for (let d = 1; d < C; d++) { const p = (2 * (C - d)) / (C * C); avgSeek += p * T.seekTime(D, d).ms; avgD += p * d; }
    const zones = D.zones.map((z) => ({ from: z.from, to: z.to, spt: z.spt, sectorMs: D.rev / z.spt, rate: (z.spt * D.sectorBytes) / (D.rev / 1000) / 1e6 }));
    const per4k = Math.ceil(4096 / D.sectorBytes), avgRotation = D.rev / 2;
    const access4k = D.overhead + avgSeek + avgRotation + per4k * zones[0].sectorMs;
    return { rev: D.rev, avgRotation, avgSeek, avgSeekDistance: avgD, zones, access4k, say: `At ${D.rpm} RPM a turn takes ${fx(D.rev)} ms, so the average rotational wait is half a turn, ${fx(avgRotation)} ms; the average seek over every pair of cylinders is ${fx(avgSeek)} ms (${fx(avgD)} cylinders); a random 4 KiB read on the outer zone takes about ${fx(access4k)} ms.` };
  };
})(globalThis.Proses = globalThis.Proses || {});
