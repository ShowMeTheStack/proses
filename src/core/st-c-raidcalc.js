// RAID by the numbers: the small-write problem counted, and the capacity, fault tolerance and throughput of each
// level worked out for given disks. Pure functions; no array is built.
//   S.Raid.smallWrite({level, disks, chunks, copies}) -> {w, chunks, full, rmw, rcw, best, mirror?, say}
//       chunks: how many whole chunks of one stripe are written (1 .. w). full, rmw, rcw: {reads, writes, ios}
//       (full is the cost when the whole stripe is written; rmw: read the old data and parity, write the new;
//       rcw: read the rest of the stripe, write the new data and parity). best: 'full' | 'rmw' | 'rcw' | 'none'.
//   S.Raid.formulas({level, disks, size, seq, iops, copies, latency}) -> {capacity, efficiency, tolerance: {least,
//       most}, seqRead, seqWrite, randRead, randWrite, penalty, readLatency, writeLatency, lines: [{name, formula,
//       value, unit, say}]}
//       size: one disk's capacity in GB; seq: one disk's sequential rate in MB/s; iops: one disk's random I/Os per
//       second; latency: one random I/O's time in ms. The model is the plain one: reads spread over every disk that
//       holds useful data; each small write costs `penalty` disk I/Os (RAID 1/10 m, RAID 5 4, RAID 6 6, RAID 4 the
//       same 4 but all on the one parity disk); sequential writes run at the rate of the disks holding data.
(function (S) {
  'use strict';
  const pl = (n, w, ws) => n + ' ' + (n === 1 ? w : ws || w + 's');
  const R = (S.Raid = S.Raid || {});
  const num = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));

  R.smallWrite = function (o) {
    const level = o.level, n = o.disks, m = level === 1 ? n : level === 10 ? o.copies || 2 : 1;
    const w = { 0: n, 1: 1, 10: n / m, 4: n - 1, 5: n - 1, 6: n - 2 }[level], k = Math.max(1, Math.min(o.chunks || 1, w));
    const np = level === 6 ? 2 : level === 4 || level === 5 ? 1 : 0;
    const io = (reads, writes) => ({ reads, writes, ios: reads + writes });
    if (!np) {
      const c = io(0, k * m);
      return { w, chunks: k, full: io(0, w * m), rmw: c, rcw: c, best: 'none', say: level === 0 ? `RAID 0 writes the ${k} chunk${k === 1 ? '' : 's'} and nothing else: ${k} write${k === 1 ? '' : 's'}.` : `Every chunk goes to each of its ${m} copies: ${k} chunk${k === 1 ? '' : 's'} cost ${k * m} writes and no reads.` };
    }
    const full = io(0, w + np), rmw = io(k + np, k + np), rcw = io(w - k, k + np);
    const best = k === w ? 'full' : rmw.reads < rcw.reads ? 'rmw' : 'rcw';
    const pn = np === 2 ? 'P and Q' : 'the parity';
    const say = k === w
      ? `All ${w} data chunks of the stripe are new, so ${pn} come${np === 2 ? '' : 's'} from them alone: ${w + np} writes and no reads.`
      : `Writing ${k} of the ${w} chunks: read-modify-write reads the ${k} old chunk${k === 1 ? '' : 's'} and ${pn} (${rmw.reads} reads) then writes ${rmw.writes}; reconstruct-write reads the other ${w - k} chunk${w - k === 1 ? '' : 's'} (${pl(rcw.reads, 'read')}) then writes ${rcw.writes}. ${best === 'rmw' ? 'Read-modify-write' : 'Reconstruct-write'} needs fewer reads.`;
    return { w, chunks: k, full, rmw, rcw, best, say };
  };

  R.formulas = function (o) {
    const a = Object.assign({ level: 5, disks: 4, size: 1000, seq: 200, iops: 150, copies: 2, latency: 8 }, o || {});
    const L = a.level, N = a.disks, B = a.size, Sq = a.seq, Io = a.iops, T = a.latency, m = L === 1 ? N : L === 10 ? a.copies : 1;
    const lines = [];
    const add = (name, formula, value, unit, say) => { lines.push({ name, formula, value, unit, say }); return value; };
    const dataDisks = { 0: N, 1: 1, 10: N / m, 4: N - 1, 5: N - 1, 6: N - 2 }[L];
    const r = {};
    r.capacity = add('capacity', { 0: 'N · B', 1: 'B', 10: 'N / m · B', 4: '(N − 1) · B', 5: '(N − 1) · B', 6: '(N − 2) · B' }[L], dataDisks * B, 'GB', `${num(dataDisks)} disk${dataDisks === 1 ? '' : 's'}' worth of data out of ${N}: ${num(dataDisks)} × ${B} GB = ${num(dataDisks * B)} GB.`);
    r.efficiency = add('space efficiency', { 0: '1', 1: '1 / N', 10: '1 / m', 4: '(N − 1) / N', 5: '(N − 1) / N', 6: '(N − 2) / N' }[L], dataDisks / N, '', `${num(dataDisks)} / ${N} = ${num(Math.round((dataDisks / N) * 1000) / 10)}% of the raw space holds data.`);
    const least = { 0: 0, 1: N - 1, 10: m - 1, 4: 1, 5: 1, 6: 2 }[L], most = L === 10 ? (N / m) * (m - 1) : least;
    r.tolerance = { least, most };
    add('fault tolerance', L === 10 ? 'm − 1 (up to N / m · (m − 1))' : { 0: '0', 1: 'N − 1', 4: '1', 5: '1', 6: '2' }[L], least, 'disks', L === 10 ? `Any ${least} disk${least === 1 ? '' : 's'} may fail; up to ${most} if each group loses at most ${m - 1}.` : L === 0 ? 'Any one failure loses data.' : `Any ${least} disk${least === 1 ? '' : 's'} may fail without losing data.`);
    const seqR = { 0: N, 1: 1, 10: N / m, 4: N - 1, 5: N - 1, 6: N - 2 }[L];
    r.seqRead = add('sequential read', { 0: 'N · S', 1: 'S', 10: 'N / m · S', 4: '(N − 1) · S', 5: '(N − 1) · S', 6: '(N − 2) · S' }[L], seqR * Sq, 'MB/s', `${num(seqR)} disk${seqR === 1 ? '' : 's'} deliver useful data at ${Sq} MB/s each: ${num(seqR * Sq)} MB/s.`);
    r.seqWrite = add('sequential write', { 0: 'N · S', 1: 'S', 10: 'N / m · S', 4: '(N − 1) · S', 5: '(N − 1) · S', 6: '(N − 2) · S' }[L], seqR * Sq, 'MB/s', `Full stripes: the parity costs no reads, so the ${num(seqR)} data disk${seqR === 1 ? '' : 's'} write at ${Sq} MB/s each: ${num(seqR * Sq)} MB/s.`);
    const rr = L === 4 ? N - 1 : N;
    r.randRead = add('random read', L === 4 ? '(N − 1) · R' : 'N · R', rr * Io, 'IOPS', `${rr} disk${rr === 1 ? '' : 's'} hold data, each serving ${Io} random reads a second: ${rr * Io} IOPS.`);
    const pen = { 0: 1, 1: m, 10: m, 4: 4, 5: 4, 6: 6 }[L];
    r.penalty = pen;
    const rw = L === 4 ? Io / 2 : (N * Io) / pen;
    r.randWrite = add('random write', L === 4 ? 'R / 2' : pen === 1 ? 'N · R' : `N · R / ${pen}`, rw, 'IOPS', L === 4 ? `Every small write reads and writes the one parity disk, so that disk caps the array: ${Io} / 2 = ${num(rw)} IOPS.` : pen === 1 ? `Each write is one disk I/O: ${N} × ${Io} = ${num(rw)} IOPS.` : `Each small write costs ${pen} disk I/Os${L === 5 ? ' (read the old data and parity, write both)' : L === 6 ? ' (read the old data, P and Q, write all three)' : ' (one per copy)'}: ${N} × ${Io} / ${pen} = ${num(rw)} IOPS.`);
    r.readLatency = add('small read latency', 'T', T, 'ms', `One disk serves it: ${T} ms.`);
    const wl = L === 4 || L === 5 || L === 6 ? 2 * T : T;
    r.writeLatency = add('small write latency', wl === T ? 'T' : '2 T', wl, 'ms', wl === T ? `The writes go out in parallel: ${T} ms.` : `The reads, then the writes, each in parallel: 2 × ${T} = ${2 * T} ms.`);
    r.lines = lines;
    return r;
  };
})(globalThis.Proses = globalThis.Proses || {});
