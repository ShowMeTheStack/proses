// Part 12, mass storage: the exercises of chapters 1 and 2 (a block's place on the disk, the time of a request, and
// the disk-arm policies). Every number in a text, an answer or a hint is worked out here by the engines (S.Storage):
// nothing is typed from memory.
(function (S) {
  'use strict';
  const C = S.Content, St = S.Storage;
  if (!C || !St || C.exercises.has('ms-x-chs')) return;
  const K = () => S.Check.kinds;
  const fx = (v, d) => { const p = Math.pow(10, d === undefined ? 3 : d); return String(Math.round(v * p) / p); };
  const list = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);

  // =========================================================================================================
  // Chapter 1: where a block lives
  // =========================================================================================================
  const GEO = { cylinders: 40, heads: 6, spt: 20 }, D1 = St.disk(GEO), per = GEO.heads * GEO.spt;
  const geoText = 'A disk has ' + GEO.cylinders + ' cylinders, ' + GEO.heads + ' surfaces (a head each) and ' + GEO.spt + ' sectors on every track. Blocks are numbered from 0 along a track, then through the other surfaces of the same cylinder, then on to the next cylinder.';
  const LBAS = [77, 1234, 2399, 4321], lrows = LBAS.map((b) => 'block ' + b), lcols = ['cylinder', 'head', 'sector'];
  const chs = LBAS.map((b) => St.chs(D1, b));
  const ccells = (f) => Object.fromEntries(lrows.flatMap((r, i) => [[r + '|cylinder', f(i, 'cyl')], [r + '|head', f(i, 'head')], [r + '|sector', f(i, 'sector')]]));
  C.exercise({ id: 'ms-x-chs', chapter: 'ms-disk', title: 'From block number to place', level: 2, kind: 'table',
    text: [geoText, 'Where is each block? Give its cylinder, head and sector (all counted from 0).'],
    rows: lrows, cols: lcols, corner: 'block', cells: ccells((i, k) => chs[i][k]), cellKind: 'number',
    hints: ['One cylinder holds ' + GEO.heads + ' × ' + GEO.spt + ' = ' + per + ' blocks: the cylinder is ⌊block / ' + per + '⌋.', 'Within the cylinder, the head is ⌊(block mod ' + per + ') / ' + GEO.spt + '⌋ and the sector is block mod ' + GEO.spt + '.', chs.map((c) => c.lba + ' = (' + c.cyl + ', ' + c.head + ', ' + c.sector + ')').join('; ') + '.'],
    solution: ccells((i, k) => chs[i][k]),
    wrong: [ccells((i, k) => (k === 'cyl' ? Math.floor(LBAS[i] / GEO.spt) % GEO.cylinders : chs[i][k])), ccells((i, k) => (k === 'head' ? Math.floor(LBAS[i] / GEO.spt) : chs[i][k]))],
    why: 'Consecutive blocks stay on one cylinder for ' + per + ' blocks, so a run of them needs no seek.' });

  const P1 = { cyl: 7, head: 3, sector: 11 }, lba1 = St.lba(D1, P1);
  C.exercise({ id: 'ms-x-lba', chapter: 'ms-disk', title: 'From place to block number', level: 1, kind: 'number',
    text: [geoText, 'Which block number is cylinder ' + P1.cyl + ', head ' + P1.head + ', sector ' + P1.sector + '?'],
    answer: lba1,
    whyNot: { [String((P1.cyl * GEO.spt + P1.head) * GEO.heads + P1.sector)]: 'That multiplies by the heads and sectors the wrong way round: a cylinder holds heads × sectors blocks, a track holds sectors.', [String(P1.cyl * per + P1.head + P1.sector)]: 'Each head before this one is a whole track of ' + GEO.spt + ' sectors, not one.', '*': 'Count the whole cylinders before it, then the whole tracks, then the sectors.' },
    hints: ['Every cylinder before cylinder ' + P1.cyl + ' holds ' + per + ' blocks.', 'Then ' + P1.head + ' whole tracks of ' + GEO.spt + ' on this cylinder, then ' + P1.sector + ' more sectors.', '(' + P1.cyl + ' × ' + GEO.heads + ' + ' + P1.head + ') × ' + GEO.spt + ' + ' + P1.sector + ' = ' + lba1 + '.'],
    solution: lba1, wrong: [(P1.cyl * GEO.spt + P1.head) * GEO.heads + P1.sector, P1.cyl * per + P1.head + P1.sector] });

  // ---- time ----------------------------------------------------------------------------------------------------
  const D54 = St.disk({ cylinders: 1000, heads: 4, spt: 100, rpm: 5400 }), av = St.averages(D54);
  const rot = +fx(av.avgRotation, 2);
  C.exercise({ id: 'ms-x-rot', chapter: 'ms-disk', title: 'Waiting for the platter', level: 1, kind: 'number',
    text: ['A disk spins at 5400 RPM. On average, how many milliseconds does a random request wait for its first sector to come round under the head? Give two decimals.'],
    answer: rot, tolerance: 0.011,
    whyNot: { [fx(av.rev, 2)]: 'That is a whole turn. The sector is anywhere on the track, so on average it is half a turn away.', '5.4': 'Turn the speed into the time of one turn first: 60000 ms / 5400.', '*': 'One turn takes 60000 / 5400 ms; the average wait is half of it.' },
    hints: ['A minute is 60000 ms.', 'One turn takes 60000 / 5400 = ' + fx(av.rev, 3) + ' ms.', 'Half a turn on average: ' + fx(av.rev, 3) + ' / 2 = ' + fx(av.avgRotation, 3) + ' ms.'],
    solution: rot, wrong: [+fx(av.rev, 2), 5.4] });

  const xfer = av.access4k - av.avgSeek - av.avgRotation, seek2 = +fx(av.avgSeek, 2), acc = +fx(seek2 + av.avgRotation + xfer, 2);
  C.exercise({ id: 'ms-x-access', chapter: 'ms-disk', title: 'One random read', level: 2, kind: 'number',
    text: ['The same 5400 RPM disk has 100 sectors of 512 bytes on every track, and its average seek is ' + seek2 + ' ms. A program reads one 4 KiB block from a random place. How long does it take on average, in ms? Give two decimals.'],
    answer: acc, tolerance: 0.02,
    whyNot: { [fx(seek2 + av.avgRotation, 2)]: 'That leaves out the transfer: the 8 sectors still have to pass under the head.', [fx(seek2 + av.rev + xfer, 2)]: 'That waits a whole turn; on average the wait is half a turn.', '*': 'Add the average seek, the average rotational wait and the transfer of 8 sectors.' },
    hints: ['4 KiB is 8 sectors of 512 bytes.', 'One turn takes ' + fx(av.rev, 3) + ' ms and passes 100 sectors, so a sector takes ' + fx(av.rev / 100, 4) + ' ms; the average wait is half a turn, ' + fx(av.avgRotation, 3) + ' ms.', seek2 + ' + ' + fx(av.avgRotation, 3) + ' + 8 × ' + fx(av.rev / 100, 4) + ' = ' + acc + ' ms. The data moves for only ' + fx(xfer, 3) + ' ms of it.'],
    solution: acc, wrong: [+fx(seek2 + av.avgRotation, 2), +fx(seek2 + av.rev + xfer, 2)] });

  const DT = { cylinders: 200, heads: 2, spt: 50, rpm: 6000, settle: 1, knee: 40, kneeTime: 5, full: 9 }, D2 = St.disk(DT);
  const RQ = [{ cyl: 40, head: 1, sector: 30, count: 4, id: 'r1' }, { cyl: 52, head: 0, sector: 10, count: 2, id: 'r2' }];
  const sv = St.serve(D2, RQ, { cyl: 0, t: 0 }), it = sv.items;
  const s40 = St.seekTime(D2, 40), s12 = St.seekTime(D2, 12);
  const trows = ['r1', 'r2'], tcols = ['seek', 'rotation', 'transfer', 'ends at'];
  const tval = (x, c) => +fx(c === 'seek' ? x.seek.ms : c === 'rotation' ? x.rotation.ms : c === 'transfer' ? x.transfer.ms : x.end, 3);
  const tcells = (f) => Object.fromEntries(trows.flatMap((r, i) => tcols.map((c) => [r + '|' + c, f(i, c)])));
  C.exercise({ id: 'ms-x-req-time', chapter: 'ms-disk', title: 'Two requests, millisecond by millisecond', level: 3, kind: 'table',
    text: ['A disk turns at 6000 RPM and has 50 sectors on every track. At t = 0 the arm is on cylinder 0 and the start of sector 0 is just under the heads; sector k of every track starts k fiftieths of a turn round. A seek of 40 cylinders takes ' + fx(s40.ms) + ' ms and one of 12 cylinders ' + fx(s12.ms) + ' ms.',
      'Two requests are served in order: r1 reads 4 sectors from cylinder 40, head 1, sector 30; then r2 reads 2 sectors from cylinder 52, head 0, sector 10. For each, give the seek, the rotational wait and the transfer, and the time it ends, in ms (three decimals at most).'],
    rows: trows, cols: tcols, corner: 'request', cells: tcells((i, c) => tval(it[i], c)), cellKind: 'number', tolerance: 0.006,
    hints: ['A turn takes 10 ms, so a sector passes in 0.2 ms. When the arm arrives at time t, the head is over sector (t mod 10) / 0.2.', 'r1 arrives at ' + fx(s40.ms) + ' ms, over sector ' + fx(it[0].rotation.angle * 50) + '; sector 30 is ' + fx(it[0].rotation.sectors) + ' sectors further. r1 ends at ' + fx(it[0].end) + '; r2 starts seeking then.', it.map((x) => x.id + ': ' + fx(x.seek.ms) + ' + ' + fx(x.rotation.ms) + ' + ' + fx(x.transfer.ms) + ', ending at ' + fx(x.end)).join('; ') + ' ms.'],
    solution: tcells((i, c) => tval(it[i], c)),
    wrong: [tcells((i, c) => (i === 1 && c === 'rotation' ? 5 : i === 1 && c === 'ends at' ? +fx(it[0].end + s12.ms + 5 + 0.4) : tval(it[i], c))), tcells((i, c) => (c === 'transfer' ? 0.2 : tval(it[i], c)))] });

  C.exercise({ id: 'ms-x-seq', chapter: 'ms-disk', title: 'Why runs of blocks are quick', level: 1, kind: 'choice',
    text: ['On the disk of the lesson a random 4 KiB read takes about 12.5 ms, yet reading on along a track delivers data six times as fast. Why?'],
    options: ['The next block\'s sectors follow straight on under the head: no seek and no rotational wait', 'The disk spins faster when it reads sequentially', 'Sequential reads use a different, faster head', 'The controller compresses consecutive blocks'],
    answer: 0, whyNot: { 1: 'A disk spins at one speed whatever it reads.', 2: 'One head serves each surface; it reads every block on it.', 3: 'The drive stores the bytes it is given.' },
    hints: ['Split the 12.5 ms into its parts.', 'Seek and rotation are about 10 ms of it; the transfer of 8 sectors about 2 ms.', 'The next block is the next sector on the same track: it is already arriving under the head, so only the transfer is paid.'],
    solution: 0, wrong: [1, 2] });

  // =========================================================================================================
  // Chapter 2: the disk arm
  // =========================================================================================================
  const Q1 = [143, 22, 176, 95, 61, 188, 9, 120], Q2 = [38, 180, 112, 7, 150, 66, 191, 94, 25];
  const qText = (q, start, dir) => 'A disk has cylinders 0 to 199. The head is on cylinder ' + start + (dir ? ', moving ' + (dir === 'up' ? 'up (towards higher cylinders)' : 'down (towards cylinder 0)') : '') + ', and these requests wait, in the order they arrived: ' + q.join(', ') + '.';
  const run = (p, q, start, dir) => St.schedule(p, { requests: q, start, cylinders: 200, dir: dir || 'up' });
  const order = (r) => r.served.map((s) => s.cyl).join(', ');
  const moves = (r) => r.served.map((s) => s.dist);
  const diskEx = (x, hints, wrong) => { x.kind = 'disk-order'; x.cylinders = 200; x.hints = hints; x.solution = K()['disk-order'].solve(x); x.wrong = wrong; return C.exercise(x); };

  const rF = run('fcfs', Q1, 70);
  diskEx({ id: 'ms-x-fcfs', chapter: 'ms-arm', title: 'First come, first served', level: 1, policy: 'fcfs', requests: Q1, start: 70, ask: 'movement',
    text: [qText(Q1, 70), 'They are served first come, first served. How many cylinders does the arm move in all?'] },
  ['The arm visits the cylinders exactly in the order given.', 'Add up |next − current| for each move, starting from 70.', moves(rF).join(' + ') + ' = ' + rF.totals.movement + ' cylinders.'],
  [{ movement: String(rF.totals.movement - 70) }, { movement: String(Math.max(...Q1) - Math.min(...Q1)) }]);

  const rS = run('sstf', Q1, 70);
  diskEx({ id: 'ms-x-sstf', chapter: 'ms-arm', title: 'Shortest seek first', level: 1, policy: 'sstf', requests: Q1, start: 70, ask: 'both',
    text: [qText(Q1, 70), 'Serve them shortest seek time first. Give the order the cylinders are served in, and the total head movement.'] },
  ['From 70 the nearest request is 61 (9 away); 95 is 25 away.', 'After 61 the nearest is 95 (34), and the arm keeps finding the next one up, until 188; then it has to come all the way down.', order(rS) + ': ' + moves(rS).join(' + ') + ' = ' + rS.totals.movement + ' cylinders.'],
  [{ order: Q1.join(', '), movement: String(rF.totals.movement) }, { order: '61, 22, 9, 95, 120, 143, 176, 188', movement: '240' }]);

  const rSc = run('scan', Q1, 70, 'up'), rLk = run('look', Q1, 70, 'up');
  diskEx({ id: 'ms-x-scan', chapter: 'ms-arm', title: 'SCAN, upwards', level: 2, policy: 'scan', dir: 'up', requests: Q1, start: 70, ask: 'both',
    text: [qText(Q1, 70, 'up'), 'Serve them by SCAN: sweep up serving every request on the way, run on to the last cylinder, 199, then turn and sweep down. Give the order and the total head movement.'] },
  ['Upwards from 70 the requests are 95, 120, 143, 176 and 188, in that order.', 'SCAN carries on to 199 before it turns, then meets 61, 22 and 9 on the way down.', order(rSc) + ': (199 − 70) + (199 − 9) = ' + rSc.totals.movement + ' cylinders.'],
  [{ order: order(rLk), movement: String(rLk.totals.movement) }, { order: '95, 120, 143, 176, 188, 9, 22, 61', movement: String(rSc.totals.movement) }]);

  const rLd = run('look', Q1, 70, 'down'), rSd = run('scan', Q1, 70, 'down');
  diskEx({ id: 'ms-x-look', chapter: 'ms-arm', title: 'LOOK, downwards', level: 2, policy: 'look', dir: 'down', requests: Q1, start: 70, ask: 'both',
    text: [qText(Q1, 70, 'down'), 'Serve them by LOOK: sweep down serving every request on the way, turn as soon as nothing waits further down, and sweep up. Give the order and the total head movement.'] },
  ['Downwards from 70: 61, 22, 9. Nothing waits below 9, so LOOK turns there.', 'On the way up: 95, 120, 143, 176, 188.', order(rLd) + ': (70 − 9) + (188 − 9) = ' + rLd.totals.movement + ' cylinders.'],
  [{ order: order(rSd), movement: String(rSd.totals.movement) }, { order: order(rLd), movement: String(rLd.totals.movement + 9) }]);

  const rC = run('cscan', Q2, 100, 'up');
  diskEx({ id: 'ms-x-cscan', chapter: 'ms-arm', title: 'C-SCAN, with the return', level: 2, policy: 'cscan', dir: 'up', requests: Q2, start: 100, ask: 'both',
    text: [qText(Q2, 100, 'up'), 'Serve them by C-SCAN: sweep up to cylinder 199 serving every request on the way, return to cylinder 0 without serving anything, and sweep up again. Count the return in the movement. Give the order and the total head movement.'] },
  ['Upwards from 100: 112, 150, 180, 191, then on to 199.', 'The return from 199 to 0 is ' + rC.totals.jumps + ' cylinders; then 7, 25, 38, 66, 94 on the second sweep up.', order(rC) + ': (199 − 100) + ' + rC.totals.jumps + ' + 94 = ' + rC.totals.movement + ' cylinders.'],
  [{ order: order(rC), movement: String(rC.totals.movement - rC.totals.jumps) }, { order: '112, 150, 180, 191, 94, 66, 38, 25, 7', movement: String(run('scan', Q2, 100, 'up').totals.movement) }]);

  const rCl = run('clook', Q2, 100, 'up');
  diskEx({ id: 'ms-x-clook', chapter: 'ms-arm', title: 'C-LOOK', level: 2, policy: 'clook', dir: 'up', requests: Q2, start: 100, ask: 'both',
    text: [qText(Q2, 100, 'up'), 'Serve them by C-LOOK: sweep up only as far as the highest request, jump back to the lowest waiting request, and sweep up again. Count the jump in the movement. Give the order and the total head movement.'] },
  ['The first sweep ends at 191, the highest request: nothing waits above it.', 'The jump goes from 191 to 7, the lowest waiting request: ' + rCl.totals.jumps + ' cylinders.', order(rCl) + ': (191 − 100) + ' + rCl.totals.jumps + ' + (94 − 7) = ' + rCl.totals.movement + ' cylinders.'],
  [{ order: order(rCl), movement: String(rC.totals.movement) }, { order: order(rCl), movement: String(rCl.totals.movement - rCl.totals.jumps) }]);

  const P6 = ['fcfs', 'sstf', 'scan', 'cscan', 'look', 'clook'], NM = { fcfs: 'FCFS', sstf: 'SSTF', scan: 'SCAN', cscan: 'C-SCAN', look: 'LOOK', clook: 'C-LOOK' };
  const all2 = P6.map((p) => ({ p, r: run(p, Q2, 100, 'up') })), LIM = 300;
  const under = all2.filter((x) => x.r.totals.movement < LIM).map((x) => NM[x.p]);
  C.exercise({ id: 'ms-x-best', chapter: 'ms-arm', title: 'Which policies stay under 300?', level: 3, kind: 'set', caseless: true,
    text: [qText(Q2, 100, 'up'), 'Run all six policies on this queue, the sweeps starting upward: FCFS, SSTF, SCAN, C-SCAN, LOOK and C-LOOK (the circular returns counted). Which of them move the arm fewer than ' + LIM + ' cylinders in all? Answer as a set, like {FCFS, SCAN}.'],
    answer: '{' + under.join(', ') + '}',
    hints: ['FCFS zigzags from end to end; the circular sweeps pay for a return of nearly the whole disk.', 'SSTF goes down to 94 first, then up to 191, then all the way down to 7.', all2.map((x) => NM[x.p] + ' ' + x.r.totals.movement).join(', ') + ': under ' + LIM + ' are {' + under.join(', ') + '}.'],
    solution: '{' + under.join(', ') + '}', wrong: ['{' + under.filter((n) => n !== 'SSTF').join(', ') + '}', '{LOOK}'],
    whyNot: 'Work out each policy\'s movement; a circular sweep counts its return.' });

  C.exercise({ id: 'ms-x-starve', chapter: 'ms-arm', title: 'Who can wait for ever?', level: 1, kind: 'choice',
    text: ['A busy disk keeps receiving requests for cylinders near 170 to 185, a few every millisecond. One request for cylinder 15 is waiting. Under which policy may it never be served?'],
    options: ['FCFS', 'SSTF', 'SCAN', 'C-LOOK'],
    answer: 1, whyNot: { 0: 'FCFS serves in arrival order, so every request ahead of it is served first and then it is.', 2: 'SCAN sweeps to the end and back, so cylinder 15 is reached on the next downward sweep.', 3: 'C-LOOK jumps back to the lowest waiting request at the end of each sweep, so 15 is served on the next one.' },
    hints: ['Ask which policy chooses only by distance from the arm.', 'With new requests always near 175, there is always a request nearer than 15.', 'SSTF: the far request is passed over as long as nearer ones keep arriving. Every sweep policy reaches it within about two sweeps.'],
    solution: 1, wrong: [0, 2] });

  const mw = +fx(rS.totals.meanWait, 2);
  C.exercise({ id: 'ms-x-wait', chapter: 'ms-arm', title: 'The waiting under SSTF', level: 2, kind: 'number',
    text: [qText(Q1, 70), 'All eight requests are waiting at time 0, and moving the arm one cylinder takes one time unit (serving a request takes no time). Under SSTF, what is the mean time a request waits until it is served?'],
    answer: mw, tolerance: 0.01,
    whyNot: { [fx(rS.totals.movement / Q1.length, 2)]: 'That is the movement per request: the mean of the moves, not of the times each request is reached.', [String(rS.totals.maxWait)]: 'That is the longest wait, by the last request served.', '*': 'A request waits until the arm reaches it: add the moves up to it.' },
    hints: ['Each request waits for every move up to the moment the arm reaches it.', 'The service order is ' + order(rS) + '; the arm reaches them at times ' + rS.served.map((s) => s.done).join(', ') + '.', '(' + rS.served.map((s) => s.wait).join(' + ') + ') / 8 = ' + mw + '.'],
    solution: mw, wrong: [+fx(rS.totals.movement / Q1.length, 2), rS.totals.maxWait] });
})(globalThis.Proses = globalThis.Proses || {});
