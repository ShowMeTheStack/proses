// Part 12, mass storage: the chapters and the lessons. The exercises are in 121-storage-ex.js and 121-storage-ex2.js;
// the challenges, the guided tour, the course and the pages the diagram checker looks at are in 122-storage-ch.js.
// Each lesson opens with a question, runs the topic that shows the idea at a frame chosen for the point being made,
// asks for a prediction, sums up, and leads to its exercises. Every value quoted here is what the topics' own
// engines (S.Storage, S.SSD, S.Raid, S.GF, S.Codes) say on the inputs given.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.chapters.some((c) => c.id === 'ms-disk')) return;

  C.chapter({ id: 'ms-disk', part: 'storage', n: 1, title: 'Hard disks', blurb: 'Platters, cylinders and sectors, where a block number lands, and the seek, the rotational wait and the transfer that make up the time of one request.' });
  C.chapter({ id: 'ms-arm', part: 'storage', n: 2, title: 'Scheduling the disk arm', blurb: 'First come first served, the nearest request first, and the sweeps: SCAN, LOOK and their circular forms, weighed by movement and by waiting.' });
  C.chapter({ id: 'ms-flash', part: 'storage', n: 3, title: 'Solid-state drives', blurb: 'Pages written once and erased a block at a time, the translation layer that hides it, garbage collection, write amplification and wear.' });
  C.chapter({ id: 'ms-raid', part: 'storage', n: 4, title: 'RAID and error codes', blurb: 'Striping, mirrors and parity, the small-write penalty, a failed disk rebuilt byte by byte, and the codes that notice or mend damage.' });
  const X = (id) => ({ exercise: id });
  const POLS = ['fcfs', 'sstf', 'scan', 'cscan', 'look', 'clook', 'nscan', 'fscan'];
  const pols = (on) => Object.fromEntries(POLS.map((p) => ['p_' + p, on.includes(p)]));
  const lab = (title, text, setup) => ({ lab: 'storage', title, text, setup });
  // the RAID figures: the numbers come from the engine (S.Raid) on the topic's own inputs, and the frames are found by
  // their titles, so the captions follow the topic's narration
  const raidFig = function (more) {
    const t = S.byId && S.byId('raid-layout'), R = S.Raid;
    const v = Object.assign(t ? S.inputOf(t) : { level: '5', disks: 5, layout: 'left-symmetric', find: 9, size: 4000, seq: 200, iops: 150 }, more || {});
    const level = +v.level, disks = +v.disks, f = R.formulas({ level, disks, size: +v.size, seq: +v.seq, iops: +v.iops });
    const A = R.create({ level, disks, chunk: 1, stripes: 16, layout: v.layout }), m = R.map(A, +v.find), w = R.width(A);
    const fs = t ? t.run(S.inputOf(t, Object.assign(S.inputOf(t), more || {}))).frames : [], at = (re, d) => { const i = fs.findIndex((x) => re.test(x.title || '')); return i < 0 ? Math.min(d, Math.max(0, fs.length - 1)) : i; };
    return { v, level, disks, f, m, w, find: +v.find, last: Math.max(0, fs.length - 1), fFind: at(/find/i, 7), fTol: at(/tolerance/i, 10), fWrite: at(/random write/i, 14), fStripe1: at(/stripe 1/i, 2) };
  };
  const r5 = raidFig(), r0 = raidFig({ level: '0', disks: 4 }), r6 = raidFig({ level: '6', disks: 6 });
  // the CRC figures follow the topic's own inputs: the message, generator and flipped bits are read from its defaults
  // and worked through the engine, and the frames are found by what they show
  const crcFig = (function () {
    const t = S.byId && S.byId('codes-crc');
    if (!t || !S.Codes) return null;
    const v = S.inputOf(t), msg = String(v.msg), gen = String(v.gen), flips = [].concat(v.flip || []).map(Number);
    const d = S.Codes.crcDivide(msg, gen);
    let recv = d.codeword.split('').map(Number);
    for (const i of flips) recv = S.Codes.flip(recv, i);
    const chk = S.Codes.crcCheck(recv.join(''), gen);
    const frames = t.run(v).frames, n = frames.length;
    let at = frames.findIndex((f) => /check/i.test(f.title || '') && (f.say || '').includes(d.remainder));
    if (at < 0) at = Math.max(0, n - 3);
    return { msg, gen, rem: d.remainder, flips, got: chk.remainder, ok: chk.ok, at, last: n - 1 };
  })();

  // =========================================================================================================
  // Chapter 1: hard disks
  // =========================================================================================================
  C.lesson({
    id: 'ms-geometry', chapter: 'ms-disk', title: 'Where a block lives', minutes: 7,
    summary: 'A disk numbers its sectors 0, 1, 2 … as logical blocks, but each one sits at a place: a cylinder (how far out the arm must be), a head (which surface) and a sector (how far round the track). Blocks are numbered so that consecutive ones fill a track, then the other surfaces of the same cylinder, and only then the next cylinder: the arm moves as little as possible for a run of blocks.',
    blocks: [
      'A file system asks the disk for block 137. The disk has no block 137 in any physical sense: it has spinning platters, a stack of heads on one arm, and rings of sectors. Which ring, which surface, and how far round?',
      { def: 'cylinder, head and sector', text: 'a track is one ring of sectors on one surface; the tracks at the same distance on every surface form a cylinder, all reachable without moving the arm. The head picks the surface, the sector the position round the track.' },
      { topic: 'disk-geometry', frame: 0, caption: '6 cylinders, 4 surfaces and 12 sectors a track: 288 sectors in all. Block 137 is one of them.' },
      { topic: 'disk-geometry', frame: 1, caption: 'A cylinder holds 4 × 12 = 48 sectors; ⌊137 / 48⌋ = 2, so the block is on cylinder 2.' },
      { predict: { q: 'Block 137 is 41 sectors into cylinder 2, and each track holds 12. Which head reads it, and which sector?', options: ['head 3, sector 5', 'head 1, sector 41', 'head 2, sector 5'], answer: 0, explain: '⌊41 / 12⌋ = 3 whole tracks are passed, so head 3; 41 mod 12 = 5 is the sector on that track.' } },
      { topic: 'disk-geometry', frame: 3, caption: 'Head 3, sector 5: block 137 is (2, 3, 5).' },
      { topic: 'disk-geometry', frame: 4, caption: 'Back again: (2 × 4 + 3) × 12 + 5 = 137. Block 138 is the next sector of the same track: no seek and no wait.' },
      { math: 'cylinder = ⌊LBA / (heads × sectors a track)⌋\nhead     = ⌊(LBA mod (heads × sectors a track)) / sectors a track⌋\nsector   = LBA mod sectors a track\nLBA      = (cylinder × heads + head) × sectors a track + sector' },
      { h: 'Zones: outer tracks are longer' },
      'A real platter is not drawn in equal slices. An outer track is longer than an inner one, so drives pack more sectors into the outer tracks, in zones of equal tracks. The arithmetic is the same, done inside the block\'s zone.',
      { topic: 'disk-geometry', input: { layout: 'zoned' }, frame: 1, caption: 'Zoned: 12, 9 and 6 sectors a track. Zone 2 starts at block 96, so block 137 is 41 blocks into it, on tracks of 9.' },
      { topic: 'disk-geometry', input: { layout: 'zoned' }, frame: 4, caption: 'In the zoned disk block 137 is cylinder 3, head 0, sector 5. Outer zones pass more sectors under the head each turn, so they read faster.' },
      lab('A disk of your own in the Storage lab', 'Set the cylinders, heads and sectors a track, and watch a queue of requests served on it.', Object.assign({ mode: 'disk', dCyl: 200, dHeads: 4, dSpt: 100, dSrc: 'list', dStart: 104, dDir: 'up' }, pols(['fcfs']))),
      { h: 'Recap' },
      { list: ['A logical block number names a cylinder, a head and a sector.', 'Blocks fill a track, then the other surfaces of the cylinder, then the next cylinder.', 'Consecutive blocks are next to each other on the platter: reading them costs no seek.', 'Zoned disks put more sectors on outer tracks; the sum is done within a zone.'] },
      X('ms-x-chs'), X('ms-x-lba'),
    ],
  });

  C.lesson({
    id: 'ms-time', chapter: 'ms-disk', title: 'Seek, rotation and transfer', minutes: 9,
    summary: 'One request costs a seek (the arm moves to the cylinder), a rotational wait (the sector comes round under the head) and a transfer (the sectors pass under it). For a small random read the first two are almost all of it: a few milliseconds each, against a fraction of a millisecond to move the data. A seek grows like the square root of the distance while the arm accelerates, then in a straight line.',
    blocks: [
      'A disk spins at 7200 turns a minute and its arm can cross the whole platter in 10 ms. A program reads one 4 KiB block from a random place. Where does the time go?',
      { def: 'seek, rotational latency, transfer', text: 'the seek moves the arm to the cylinder; the rotational latency waits for the first sector to come round; the transfer reads the sectors as they pass under the head.' },
      { topic: 'disk-seek', frame: 0, caption: 'The seek curve: 1 ms to settle, a square root up to 50 cylinders (6.4 ms), then a straight line to 10 ms for 199 cylinders.' },
      { topic: 'disk-seek', frame: 2, caption: '150 cylinders take 8.816 ms, against 3.415 ms for 10: fifteen times the distance for 2.58 times the time.' },
      { predict: { q: 'At 7200 RPM, how long on average does the head wait for the wanted sector to come round?', options: ['8.333 ms, a whole turn', '4.167 ms, half a turn', 'nothing: the head waits only when it misses'], answer: 1, explain: 'One turn takes 60000 / 7200 = 8.333 ms. The sector is anywhere on the track, so on average it is half a turn away: 4.167 ms.' } },
      { topic: 'disk-seek', frame: 5, caption: 'Half a turn, 4.167 ms, on average.' },
      { topic: 'disk-seek', frame: 6, caption: 'The whole random read: an average seek of 6.24 ms, 4.167 ms waiting and 2.083 ms of transfer, 12.49 ms.' },
      { topic: 'disk-seek', frame: 7, caption: 'About 80 random 4 KiB reads a second, 0.328 MB/s, against 1.966 MB/s reading on along the track.' },
      { h: 'Request by request' },
      { topic: 'disk-access', frame: 3, caption: 'r1, block 9000: a seek of 70 cylinders (6.883 ms), a wait of 3.533 ms and one sector, 0.26 ms.' },
      { topic: 'disk-access', frame: 6, caption: 'r2, block 9001, is the very next sector: no seek, no wait, only the transfer of its 4 sectors.' },
      { topic: 'disk-access', frame: 13, caption: '4 requests, 35.677 ms: 54% seeking, 40.9% waiting for the platter, 5.1% moving data.' },
      { tip: 'The two lessons for software are the ones the next chapter and the file-system parts build on: keep blocks that are read together next to each other, and serve the waiting requests in an order that keeps the arm\'s journeys short.' },
      { h: 'Recap' },
      { list: ['A request = seek + rotational wait + transfer.', 'Average rotational wait = half a turn = 30000 / RPM ms.', 'Short seeks are dear for their length; a random seek averages a third of the stroke in distance.', 'For small random reads the disk spends almost all its time positioning, not transferring.'] },
      X('ms-x-rot'), X('ms-x-access'), X('ms-x-req-time'), X('ms-x-seq'),
    ],
  });

  // =========================================================================================================
  // Chapter 2: scheduling the disk arm
  // =========================================================================================================
  C.lesson({
    id: 'ms-near', chapter: 'ms-arm', title: 'First come, or nearest first', minutes: 8,
    summary: 'When several requests wait, the order in which the arm serves them decides how far it travels. First come, first served is fair but sends the arm back and forth across the disk. Shortest seek time first always goes to the nearest request: far less movement, but a request at the edge can be passed over again and again while new requests keep arriving near the arm.',
    blocks: [
      'Eight requests wait for cylinders 130, 41, 188, 12, 97, 155, 63 and 77, and the arm is on cylinder 104. In the order they arrived, the arm would swing from one side of the disk to the other. Is there a better order, and who pays for it?',
      { topic: 'disk-arm', input: { policy: 'fcfs' }, frame: 9, caption: 'First come, first served: 687 cylinders of movement, 85.88 a request.' },
      { def: 'SSTF', text: 'shortest seek time first: serve the waiting request nearest the arm, wherever it is.' },
      { topic: 'disk-arm', frame: 2, caption: 'SSTF from 97: 77 is 20 away, 130 is 33, 63 is 34. It goes to 77.' },
      { predict: { q: 'SSTF works its way down to 12. Which request is served last?', options: ['12, at the bottom', '130, the first to arrive', '188, the farthest from where the arm started'], answer: 2, explain: 'After 12 the nearest is 130, then 155, then 188. The request for 188 waits for everything else: 268 time units.' } },
      { topic: 'disk-arm', frame: 9, caption: 'SSTF: 268 cylinders, less than half of FCFS\'s 687. But the request for 188 waited 268, the longest of all.' },
      { h: 'Starvation' },
      'On a fixed queue the far request is only late. With requests arriving all the time near the arm, it can be passed over indefinitely: the arm always has something nearer to do.',
      lab('SSTF starving a far request, in the Storage lab', 'A request for cylinder 20 waits while new requests keep arriving near 175. Compare SSTF with LOOK and C-SCAN in the side-by-side charts.', Object.assign({ mode: 'disk', dSrc: 'table', dStart: 175, dDir: 'up', dCyl: 200 }, pols(['sstf', 'look', 'cscan']))),
      { table: [['Policy', 'Movement on this queue', 'Fair?'], ['FCFS', '687 cylinders', 'yes: arrival order'], ['SSTF', '268 cylinders', 'no: far requests can starve']], caption: 'The two greedy extremes on the queue 130, 41, 188, 12, 97, 155, 63, 77 from cylinder 104.' },
      { h: 'Recap' },
      { list: ['FCFS serves in arrival order: fair, but the arm zigzags.', 'SSTF serves the nearest request: little movement, but unfair.', 'With a steady stream of nearby arrivals, SSTF can starve a far request.'] },
      X('ms-x-fcfs'), X('ms-x-sstf'), X('ms-x-starve'), X('ms-x-wait'),
    ],
  });

  C.lesson({
    id: 'ms-sweep', chapter: 'ms-arm', title: 'Sweeps: SCAN, LOOK and the circular ones', minutes: 9,
    summary: 'SCAN moves the arm in one direction serving every request it reaches, goes on to the end of the disk, and turns. LOOK turns as soon as nothing waits ahead. C-SCAN and C-LOOK serve in one direction only and jump back for the next sweep, so a request\'s wait no longer depends on which side of the arm it happens to be. Every sweep bounds how long a request can wait.',
    blocks: [
      'A lift in a tall building does not go to whichever floor is nearest: it goes up, stopping at every floor that called it, and then comes down. Could the disk arm work the same way, and would it travel much more than SSTF?',
      { def: 'SCAN (the elevator)', text: 'the arm sweeps in its current direction, serving every request on the way, runs on to the last cylinder, then turns and sweeps back.' },
      { topic: 'disk-arm', input: { policy: 'scan' }, frame: 4, caption: 'SCAN upward from 104 serves 130, 155 and 188, runs on to 199 and turns there.' },
      { topic: 'disk-arm', input: { policy: 'scan' }, frame: 10, caption: 'Back down to 12: 282 cylinders in all, and the request for 12 waits longest.' },
      { predict: { q: 'LOOK is SCAN that turns at the last request instead of the edge. How much movement does it save here?', options: ['nothing: the requests are the same', '22 cylinders: from 188 to 199 and back', '199 cylinders: the whole return'], answer: 1, explain: 'SCAN runs on from 188 to 199 and comes back: 11 cylinders each way. LOOK turns at 188, so it moves 282 − 22 = 260.' } },
      { topic: 'disk-arm', input: { policy: 'look' }, frame: 10, caption: 'LOOK turns at 188: 260 cylinders.' },
      { def: 'C-SCAN and C-LOOK', text: 'circular sweeps: serve only while moving up; at the end (C-SCAN) or after the last request (C-LOOK) return to the other end without serving, and sweep up again. The return is counted in the movement here.' },
      { topic: 'disk-arm', input: { policy: 'cscan' }, frame: 10, caption: 'C-SCAN: 391 cylinders, 199 of them the return from the top to cylinder 0.' },
      { topic: 'disk-arm-compare', frame: 6, caption: 'All six side by side. C-LOOK: 345 cylinders, 176 of them the jump from 188 back to 12.' },
      { topic: 'disk-arm-compare', frame: 7, caption: 'On this queue LOOK moves least, 260, and also has the shortest longest wait. FCFS moves most, 687.' },
      'Why pay for the return at all? On a two-way sweep, a request just behind the arm waits a short time if the arm is about to turn, and a long time if it has just turned: the cylinders in the middle are served twice as often as those at the edges. The circular sweeps give every cylinder the same treatment, at the cost of the jump.',
      lab('All six policies on your own queue, in the Storage lab', 'The same queue served six ways, charts side by side with the movement and the waits. Change the queue or the head\'s direction.', Object.assign({ mode: 'disk', dSrc: 'list', dQueue: [130, 41, 188, 12, 97, 155, 63, 77], dStart: 104, dDir: 'up', dCyl: 200 }, pols(['fcfs', 'sstf', 'scan', 'cscan', 'look', 'clook']))),
      { tip: 'The challenge "The tide-gauge archive" asks for the policy that keeps the arm\'s travel lowest on queues you do not see, without letting any request be overtaken too often.' },
      { challenge: 'ms-ch-tide' },
      { h: 'Recap' },
      { list: ['SCAN sweeps to the edge and turns; LOOK turns at the last request.', 'C-SCAN and C-LOOK serve one way and jump back: more movement, more even waits.', 'Every sweep bounds the wait: a request is reached within about two sweeps.', 'Which moves least depends on the queue and the starting direction.'] },
      X('ms-x-scan'), X('ms-x-look'), X('ms-x-cscan'), X('ms-x-clook'), X('ms-x-best'),
    ],
  });

  // =========================================================================================================
  // Chapter 3: solid-state drives
  // =========================================================================================================
  C.lesson({
    id: 'ms-ftl', chapter: 'ms-flash', title: 'Flash pages and the translation layer', minutes: 8,
    summary: 'Flash is read and written in pages, but a page can only be written once after its whole erase block is erased. So an SSD never overwrites in place: it writes the new copy to a free page elsewhere, marks the old one invalid, and its flash translation layer (FTL) keeps a table from each logical page to the physical page that holds it now.',
    blocks: [
      'A program overwrites the same 4 KiB of a file again and again. On a hard disk the head goes back to the same sectors each time. Flash cannot do that: a written page must be erased before it is written again, and erasing works only on a whole block of pages. What does the drive do instead?',
      { def: 'page, erase block', text: 'a page (a few KiB) is the unit of reading and programming; an erase block (often hundreds of pages) is the unit of erasing. A page is free (erased), valid, or invalid (a stale copy).' },
      { topic: 'ssd-ftl', frame: 0, caption: '5 erase blocks of 4 pages: 20 physical pages, but only 11 logical pages are offered to the computer. The rest is spare room.' },
      { topic: 'ssd-ftl', frame: 5, caption: 'Logical pages 0 to 3 fill block 0; the mapping table points 0 → 0, 1 → 1, 2 → 2, 3 → 3.' },
      { predict: { q: 'Logical page 1 is now written again. What happens to physical page 1 of block 0?', options: ['It is erased and rewritten', 'It is marked invalid; the new copy goes to a free page', 'It is left valid; the table keeps both copies'], answer: 1, explain: 'Erasing it would erase all of block 0, with pages 0, 2 and 3 still valid in it. The new copy goes to the next free page and the old one becomes invalid.' } },
      { topic: 'ssd-ftl', frame: 6, caption: 'The overwrite: the old copy in block 0, page 1 becomes invalid.' },
      { topic: 'ssd-ftl', frame: 8, caption: 'The new copy goes to block 1, page 0; the table now points 1 → 4.' },
      { topic: 'ssd-ftl', frame: 13, caption: 'TRIM: the file system says logical page 2 is no longer needed, so its copy turns invalid without any write.' },
      { topic: 'ssd-ftl', frame: 15, caption: 'So far 8 logical writes became 8 flash writes and no erases: the invalid pages are still waiting to be reclaimed.' },
      lab('An FTL of your own in the Storage lab', 'A small flash of 16 blocks of 8 pages: watch every write land, every overwrite leave an invalid page behind, and the table change.', { mode: 'ssd', sBlocks: 16, sPages: 8, sOp: 0.25, sWork: 'uniform', sCount: 200, sFill: true }),
      { h: 'Recap' },
      { list: ['Flash pages are programmed once, then erased only with their whole block.', 'An overwrite writes elsewhere and leaves an invalid copy.', 'The FTL\'s table maps each logical page to its current physical page.', 'TRIM lets the file system invalidate pages it no longer uses.'] },
      X('ms-x-ftl'), X('ms-x-logical'),
    ],
  });

  C.lesson({
    id: 'ms-gc', chapter: 'ms-flash', title: 'Garbage collection and write amplification', minutes: 8,
    summary: 'Invalid pages are reclaimed by garbage collection: pick a victim block, copy its still-valid pages to the active block, and erase it. Those copies are writes the computer never asked for. Write amplification, flash writes over logical writes, measures them; it falls as the spare room (over-provisioning) grows and as the victims hold fewer valid pages.',
    blocks: [
      'Sooner or later every block holds a mix of valid and invalid pages, and no block is free. The drive must erase a block to go on, but a block with valid pages in it cannot simply be erased. What does it cost to make room?',
      { def: 'garbage collection', text: 'choose a victim block, copy its valid pages into the active block, then erase the victim, which becomes free. The greedy policy picks the block with the fewest valid pages.' },
      { topic: 'ssd-gc', frame: 1, caption: '445 logical pages on 512 physical (15.1% spare). Once all are written, space must be reclaimed.' },
      { topic: 'ssd-gc', frame: 2, caption: 'The first collection: block 4 has the fewest valid pages, 13 of 16. Copying them is 13 flash writes nobody asked for.' },
      { def: 'write amplification', text: 'flash page writes ÷ the page writes the computer asked for (logical writes). 1 means no extra writes; every garbage-collection copy pushes it up.' },
      { topic: 'ssd-gc', frame: 10, caption: 'After 2000 random writes: 9412 flash writes for 2445 logical writes, write amplification 3.849.' },
      { predict: { q: 'The same 2000 random writes on a drive with only 7% spare room. Write amplification will be…', options: ['about the same, 3.8', 'lower: fewer spare pages to copy', 'much higher'], answer: 2, explain: 'With little spare room every block is nearly full of valid pages when it is collected, so each collection copies almost a whole block to free a few pages: 9.613.' } },
      { topic: 'ssd-gc', input: { op: '0.07' }, frame: 10, caption: '7% spare: write amplification 9.613.' },
      { topic: 'ssd-gc', input: { op: '0.5' }, frame: 10, caption: '50% spare: 1.592. Spare room is bought with capacity, and repaid in speed and in the drive\'s life.' },
      { topic: 'ssd-gc', input: { workload: 'sequential' }, frame: 10, caption: 'Sequential writes invalidate whole blocks at a time: no copies at all, write amplification 1.' },
      { topic: 'ssd-gc', input: { workload: 'hotcold', gc: 'cost-benefit' }, frame: 10, caption: 'Hot and cold data with the cost-benefit victim, which also weighs a block\'s age: 3.561, against 3.682 for greedy on the same writes.' },
      lab('Little spare room, in the Storage lab', 'The Storage lab\'s SSD with 7% spare room: watch the write amplification climb as garbage collection copies nearly full blocks. Raise the spare room and run it again.', { mode: 'ssd', sOp: 0.07, sCount: 500, sWork: 'uniform', sGc: 'greedy', sWear: 'none' }),
      { h: 'Recap' },
      { list: ['Garbage collection copies a victim\'s valid pages, then erases it.', 'Write amplification = flash writes / logical writes.', 'More spare room, fewer valid pages per victim, less amplification.', 'Sequential writes and TRIM keep it near 1.'] },
      X('ms-x-wa'), X('ms-x-victim'), X('ms-x-spare'),
    ],
  });

  C.lesson({
    id: 'ms-wear', chapter: 'ms-flash', title: 'Wear levelling', minutes: 6,
    summary: 'A flash block survives a limited number of erases. If the same few blocks take all the erases, they wear out while the rest are hardly used. Dynamic levelling writes into the least-worn free block; static levelling also moves cold data out of little-worn blocks so they join the rotation. It evens the wear at the price of extra copies.',
    blocks: [
      'Most of a drive\'s data is written once and left alone: programs, photos, archives. A few pages are rewritten all day. If the blocks holding the cold data are never erased, every erase falls on the others. How long will they last?',
      { topic: 'ssd-wear', frame: 0, caption: 'Three drives of 24 blocks, the same writes: 80% of them to the hottest 20% of pages. Only where they write differs.' },
      { predict: { q: 'Dynamic levelling always takes the least-worn free block. Will it even out the wear on blocks that hold cold data?', options: ['Yes: it always picks the least-worn block', 'No: blocks full of cold data are never free, so it never picks them', 'Only with TRIM'], answer: 1, explain: 'A block full of cold, valid data is never collected, so it never becomes free and dynamic levelling never sees it. Only moving the cold data out puts that block back in use.' } },
      { topic: 'ssd-wear', frame: 6, caption: 'After 6000 writes the spread of erase counts is 47 with no levelling, 50 dynamic and 4 static. Static paid 10453 extra page moves for it.' },
      { def: 'static wear levelling', text: 'when the spread of erase counts passes a limit, move the data of the least-worn block elsewhere so that block is erased and reused.' },
      lab('Static levelling in the Storage lab', 'Hot and cold writes with static wear levelling and TRIM: the erase counts of every block, and the extra moves levelling costs.', { mode: 'ssd', sWork: 'hotcold', sWear: 'static', sDelta: 3, sTrim: 0.1, sCount: 1200 }),
      { h: 'Recap' },
      { list: ['Each block survives a limited number of erases.', 'Dynamic levelling chooses among free blocks only.', 'Static levelling moves cold data so its block shares the wear, at the cost of extra writes.'] },
      X('ms-x-wear'),
    ],
  });

  // =========================================================================================================
  // Chapter 4: RAID and error codes
  // =========================================================================================================
  C.lesson({
    id: 'ms-levels', chapter: 'ms-raid', title: 'RAID levels', minutes: 9,
    summary: 'RAID makes several disks look like one. RAID 0 stripes chunks across the disks for speed, with no redundancy. RAID 1 mirrors every chunk. RAID 4 adds a parity disk; RAID 5 rotates the parity round the disks so no one disk takes every parity write; RAID 6 adds a second parity and survives two failures. Each level trades capacity, speed and safety differently.',
    blocks: [
      'One disk holds ' + r5.v.size + ' GB and serves ' + r5.v.iops + ' random reads a second. ' + r5.disks + ' of them together could hold ' + r5.disks + ' times as much, or serve ' + r5.disks + ' times as many reads, or survive one of them dying. Can they do all three?',
      { def: 'striping', text: 'logical chunks 0, 1, 2 … go to the disks in turn, one stripe at a time, so a large read keeps every disk busy at once.' },
      { topic: 'raid-layout', input: { level: '0', disks: 4 }, frame: r0.last, caption: 'RAID 0 on ' + r0.disks + ' disks: all ' + r0.f.capacity + ' GB hold data and ' + r0.f.randRead + ' random reads a second, but any one failure loses data.' },
      { topic: 'raid-layout', frame: r5.fStripe1, caption: 'RAID ' + r5.level + ' on ' + r5.disks + ' disks: each stripe has ' + r5.w + ' data chunks and a parity chunk, and the parity moves one disk left each stripe.' },
      { topic: 'raid-layout', frame: r5.fFind, caption: 'Chunk ' + r5.find + ' is stripe ⌊' + r5.find + ' / ' + r5.w + '⌋ = ' + r5.m.stripe + ', position ' + r5.m.k + ': chunk ' + r5.find + ' on disk ' + r5.m.disk + ' in this layout. Writing it also changes the parity on disk ' + r5.m.parity + '.' },
      { predict: { q: 'RAID ' + r5.level + ' on ' + r5.disks + ' disks of ' + r5.v.size + ' GB. How much can it store, and how many disks may fail?', options: [r5.disks * r5.v.size + ' GB, none', r5.f.capacity + ' GB, any one', (r5.disks * r5.v.size) / 2 + ' GB, any two'], answer: 1, explain: 'One disk\'s worth of every stripe is parity: ' + r5.w + ' × ' + r5.v.size + ' = ' + r5.f.capacity + ' GB, and the parity can rebuild any one lost disk.' } },
      { topic: 'raid-layout', frame: r5.fTol, caption: r5.f.capacity + ' GB, ' + Math.round(r5.f.efficiency * 100) + '% of the raw space, and any ' + r5.f.tolerance.least + ' disk may fail.' },
      { topic: 'raid-layout', frame: r5.fWrite, caption: 'The price is in small writes: each costs ' + r5.f.penalty + ' disk I/Os, so ' + r5.disks + ' disks give only ' + r5.f.randWrite + ' random writes a second.' },
      { topic: 'raid-layout', input: { level: '6', disks: 6 }, frame: r6.fTol, caption: 'RAID 6 on ' + r6.disks + ' disks: two parity chunks a stripe, so any ' + r6.f.tolerance.least + ' disks may fail.' },
      { table: [['Level', 'Capacity of n disks', 'Survives', 'A small write costs'], ['0', 'n', 'nothing', '1 I/O'], ['1 (2 copies)', 'n / 2', '1 disk (one of each pair)', '2 I/Os'], ['4', 'n − 1', '1 disk', '4 I/Os, all on the parity disk'], ['5', 'n − 1', '1 disk', '4 I/Os'], ['6', 'n − 2', '2 disks', '6 I/Os']], caption: 'The plain model of each level.' },
      lab('A RAID array in the Storage lab', 'Choose the level, the disks and the chunk size; write a message across them and see every chunk, every parity byte and the layout.', { mode: 'raid', rLevel: 5, rDisks: 5, rChunk: 4, rFail1: -1, rFail2: -1 }),
      { h: 'Recap' },
      { list: ['Chunk c is in stripe ⌊c / data chunks a stripe⌋.', 'RAID 0: speed, no safety. RAID 1: a copy of everything.', 'RAID 5: one disk of parity, rotated. RAID 6: two.', 'Parity costs little to read but a lot on a small write.'] },
      X('ms-x-levels'), X('ms-x-chunk'), X('ms-x-small'),
    ],
  });

  C.lesson({
    id: 'ms-parity', chapter: 'ms-raid', title: 'Parity bit by bit, and the small write', minutes: 8,
    summary: 'A parity chunk is the XOR of the data chunks of its stripe, bit by bit: a 1 wherever an odd number of them have a 1. Any one chunk is then the XOR of all the others. To change one chunk, the array can read the old data and the old parity and XOR both differences in (read-modify-write), or read the rest of the stripe and recompute (reconstruct-write): either way a small write costs several disk I/Os.',
    blocks: [
      'Four data chunks and one more chunk that lets you rebuild any of the four from the other four. How can one chunk hold enough to replace whichever one is lost?',
      { def: 'parity (XOR)', text: 'P = D0 ⊕ D1 ⊕ … ⊕ Dk. A bit of P is 1 when an odd number of the data bits in that column are 1. Since x ⊕ x = 0, any one chunk = the XOR of all the others with P.' },
      { topic: 'raid-write', frame: 1, caption: 'Byte 0 of stripe 0: 53 ⊕ 4e ⊕ 20 ⊕ 4f = 72 (hex). Each bit column holds an odd or even count of ones.' },
      { predict: { q: 'Now write two new bytes into one chunk of stripe 0. With read-modify-write, how many disk I/Os does it take?', options: ['1: write the chunk', '2: write the chunk and the parity', '4: read old data and old parity, write both'], answer: 2, explain: 'The new parity is P_old ⊕ D_old ⊕ D_new, so the array must read the old chunk and the old parity, then write the new chunk and the new parity.' } },
      { topic: 'raid-write', frame: 7, caption: 'P_new = P_old ⊕ D_old ⊕ D_new: byte 0 is 72 ⊕ 20 ⊕ 4d = 1f.' },
      { topic: 'raid-write', frame: 8, caption: '2 reads and 2 writes for 2 bytes. A whole stripe needs 5 writes and no reads.' },
      'For a write that changes k of the w data chunks of a stripe:',
      { math: 'read-modify-write: read k + 1, write k + 1\nreconstruct-write: read w − k, write k + 1\nfull stripe:       read 0,     write w + 1' },
      lab('A small write in the Storage lab', 'Write a few bytes into a RAID 5 array and count the reads and writes; then make the write span a whole stripe.', { mode: 'raid', rLevel: 5, rDisks: 5, rChunk: 4, rFail1: -1, rFail2: -1, rSwOff: 5, rSwText: 'X' }),
      { h: 'Recap' },
      { list: ['P is the XOR of the data, column by column.', 'Any one lost chunk is the XOR of the rest.', 'A small write by read-modify-write: 2 reads and 2 writes.', 'Writing whole stripes avoids the reads.'] },
      X('ms-x-p'), X('ms-x-p5'), X('ms-x-rmw'),
    ],
  });

  C.lesson({
    id: 'ms-rebuild', chapter: 'ms-raid', title: 'A disk fails: rebuilding, and RAID 6', minutes: 9,
    summary: 'When a disk fails, a RAID 5 array runs degraded: a read of a lost chunk XORs the others in that stripe. A new disk is rebuilt the same way, stripe by stripe. RAID 6 keeps a second parity Q, with each data chunk weighted by its own power of g in GF(2⁸); with P and Q any two lost chunks can be solved for.',
    blocks: [
      'Disk 2 of a four-disk RAID 5 stops answering. The array still has to serve reads, and a replacement disk has to be filled. Where does each lost byte come from?',
      { topic: 'raid-rebuild', frame: 1, caption: 'Disk 2 fails. Reads still work, degraded: 2 chunks of the message are worked out on the fly.' },
      { topic: 'raid-rebuild', frame: 2, caption: 'Stripe 0: the lost data byte is 4d ⊕ 45 ⊕ 28 = 20, the XOR of the other three disks.' },
      { topic: 'raid-rebuild', frame: 6, caption: 'The new disk, rebuilt stripe by stripe, is equal byte for byte to the one lost.' },
      { warn: 'A rebuild reads every other disk from end to end. If a second disk fails, or one sector cannot be read, during that time, RAID 5 loses data. That risk grows with disk size, and is why large arrays use RAID 6.' },
      { h: 'RAID 6: a second parity' },
      { topic: 'raid6-pq', frame: 1, caption: 'P = 53 ⊕ 4f ⊕ 53 ⊕ 21 = 6e. Lose two bytes and P gives only their XOR.' },
      { predict: { q: 'Q is ⊕ g^k · D_k in GF(2⁸): each byte has its own weight. Why is a second XOR (with every weight 1) useless?', options: ['It would equal P, so it adds no equation', 'It would overflow a byte', 'XOR cannot be undone'], answer: 0, explain: 'With every weight 1, Q would be P again: one equation twice. Distinct weights g^k make the two equations independent, so two unknowns can be solved.' } },
      { topic: 'raid6-pq', frame: 6, caption: 'Q = 53 ⊕ 9e ⊕ 51 ⊕ 15 = 89: the bytes weighted by 1, 02, 04 and 08.' },
      { topic: 'raid6-pq', frame: 8, caption: 'D1 and D3 lost: D1 = (Q′ ⊕ g³·P′) / (g¹ ⊕ g³) = 4f, and D3 = P′ ⊕ D1 = 21.' },
      { topic: 'raid-rebuild', input: { level: '6', disks: 5, fail: ['1', '3'] }, frame: 1, caption: 'RAID 6 on 5 disks, disks 1 and 3 lost: 5 chunks worked out on the fly, and the message still reads back.' },
      lab('Two disks lost, in the Storage lab', 'RAID 6 on 6 disks with disks 1 and 4 failed: every lost byte rebuilt from P and Q, worked out step by step.', { mode: 'raid', rLevel: 6, rDisks: 6, rFail1: 1, rFail2: 4 }),
      { h: 'Recap' },
      { list: ['Degraded read: the lost chunk = the XOR of the rest of its stripe.', 'A rebuild does that for every stripe onto a new disk.', 'RAID 6: P and Q = ⊕ g^k · D_k solve for any two lost chunks.'] },
      X('ms-x-lost'), X('ms-x-q'), X('ms-x-rebuild-reads'),
    ],
  });

  C.lesson({
    id: 'ms-codes', chapter: 'ms-raid', title: 'Catching errors: parity, checksums, CRC and Hamming', minutes: 9,
    summary: 'RAID mends a disk that has failed and says so. A disk that returns wrong bytes without saying so needs a check value stored with each block: a parity bit, a sum, a checksum or a CRC. Each catches some kinds of damage and misses others. A Hamming code goes further: its syndrome names the flipped bit, so it can be corrected.',
    blocks: [
      'A block reads back with one byte changed and no error from the drive. Nothing in the bytes themselves says they are wrong. What can be stored beside them so that the damage shows?',
      { topic: 'codes-checksum', frame: 1, caption: 'A parity bit for each byte makes its count of ones even. One flipped bit in a byte is caught; two in the same byte are not.' },
      { topic: 'codes-checksum', frame: 8, caption: 'One flipped bit: every check notices it.' },
      { predict: { q: 'Two neighbouring bytes swap places. Which check is sure to miss it?', options: ['CRC-32', 'the 8-bit sum', 'Fletcher-16'], answer: 1, explain: 'A plain sum adds the same bytes in any order. Fletcher-16 and CRC-32 weigh each byte by where it is, so a swap changes them.' } },
      { topic: 'codes-checksum', input: { damage: 'swap', at2: 6 }, frame: 8, caption: 'Bytes 5 and 6 swapped: the 8-bit sum misses it; every check that depends on position notices.' },
      crcFig ? { topic: 'codes-crc', frame: crcFig.at, caption: 'A CRC is the remainder of a long division in binary with XOR for subtraction: ' + crcFig.msg + ' with generator ' + crcFig.gen + ' leaves ' + crcFig.rem + '.' } : 'A CRC is the remainder of a long division in binary, with XOR in place of subtraction.',
      crcFig ? { topic: 'codes-crc', frame: crcFig.last, caption: (crcFig.flips.length === 1 ? 'One bit flipped' : crcFig.flips.length + ' bits flipped') + ' in transit: the received bits leave remainder ' + crcFig.got + (crcFig.ok ? ', zero, so this damage slips through.' : ', not zero, so the damage is noticed.') } : 'A damaged block leaves a remainder that is not zero.',
      { h: 'Mending one bit' },
      { topic: 'codes-hamming', frame: 4, caption: 'Hamming(7,4): 4 data bits in positions 3, 5, 6, 7 and 3 checks in 1, 2, 4. Each check covers the positions whose number has its bit.' },
      { topic: 'codes-hamming', frame: 6, caption: 'Bit 5 flips. p1 and p3 fail, p2 passes: the syndrome 101 = 5 names the bad position.' },
      { topic: 'codes-hamming', frame: 7, caption: 'Flip bit 5 back: the data 1011 is mended.' },
      { table: [['Check', 'Catches', 'Misses'], ['a parity bit a byte', 'any odd number of flips in a byte', 'two flips in one byte'], ['8-bit sum', 'one changed byte', 'reordered bytes'], ['Fletcher, Adler', 'changes and most reorderings', 'rare collisions'], ['CRC-32', 'every burst of up to 32 bits', 'rare collisions'], ['Hamming(7,4)', 'any one flip, and mends it', 'two flips: it mends the wrong bit']], caption: 'What each check does.' },
      { h: 'Recap' },
      { list: ['A check value is stored with the block and recomputed on reading.', 'Sums ignore order; Fletcher, Adler and CRCs do not.', 'A CRC is a remainder of binary long division.', 'A Hamming syndrome names the flipped bit, so it can be corrected.'] },
      X('ms-x-hamming'), X('ms-x-crc'), X('ms-x-detect'),
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
