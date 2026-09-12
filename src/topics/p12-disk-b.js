// Part 12, hard disks (2): the seek curve with the averages of a random access, and the time of each request in a
// queue worked out as seek, rotational wait and transfer, with the platter turning under the head. Every number
// comes from the disk model (src/core/st-d-disk.js).
(function (S) {
  'use strict';
  const T = () => S.T12;
  const R = Math.round;
  const DISKS = {
    teach: { label: 'a small teaching disk (200 cylinders, 7200 RPM)', o: { cylinders: 200, heads: 4, spt: 32, rpm: 7200, settle: 1, full: 10 } },
    desktop: { label: 'a desktop drive (7200 RPM)', o: { cylinders: 120000, heads: 6, spt: 1200, rpm: 7200, settle: 1, full: 18 } },
    laptop: { label: 'a laptop drive (5400 RPM)', o: { cylinders: 80000, heads: 4, spt: 900, rpm: 5400, settle: 1.5, full: 22 } },
    server: { label: 'a server drive (15000 RPM)', o: { cylinders: 60000, heads: 8, spt: 1500, rpm: 15000, settle: 0.5, full: 8 } },
  };
  S.T12.DISKS = DISKS;
  const diskOpts = Object.keys(DISKS).map((k) => ({ value: k, label: DISKS[k].label }));
  const mkDisk = (k, extra) => S.Storage.disk(Object.assign({}, DISKS[k].o, extra || {}));

  // =================================================================================================================
  S.topic({
    id: 'disk-seek', family: 'p12-disk', order: 20, title: 'Seek, rotation and transfer: a random read',
    blurb: 'The arm accelerates and brakes, so a short seek costs about the square root of its distance and a long one grows in a straight line. Averaged over every pair of cylinders the arm travels a third of the disk; the platter then turns half a revolution on average; the transfer itself is tiny. Add them up to see why a random 4 KiB read takes milliseconds while a sequential stream flies.',
    inputs: [
      { id: 'disk', kind: 'choice', label: 'disk', def: 'teach', options: diskOpts },
      { id: 'd1', kind: 'number', label: 'a short seek (cylinders)', def: 10, min: 1, max: 200000 },
      { id: 'd2', kind: 'number', label: 'a long seek (cylinders)', def: 150, min: 1, max: 200000 },
    ],
    check(inp) { const C = DISKS[inp.disk].o.cylinders; if (inp.d1 >= C || inp.d2 >= C) return 'seeks: at most ' + (C - 1) + ' cylinders on this disk'; if (inp.d2 <= inp.d1) return 'the long seek must be longer than the short one'; return null; },
    presets: [
      { label: 'Teaching disk', values: { disk: 'teach', d1: 10, d2: 150 } },
      { label: 'Desktop drive', values: { disk: 'desktop', d1: 200, d2: 90000 } },
      { label: 'Laptop drive', values: { disk: 'laptop', d1: 50, d2: 60000 } },
      { label: 'Server drive', values: { disk: 'server', d1: 1000, d2: 40000 } },
    ],
    counters: [{ id: 'ms', label: 'ms so far' }],
    run(inp) {
      const t = T(), St = S.Storage, D = mkDisk(inp.disk), C = D.cylinders, av = St.averages(D);
      const s1 = St.seekTime(D, inp.d1), s2 = St.seekTime(D, inp.d2), sAvgD = St.seekTime(D, Math.round(av.avgSeekDistance));
      const z = av.zones[0], per4k = Math.ceil(4096 / D.sectorBytes), xfer = per4k * z.sectorMs, iops = 1000 / av.access4k, randMB = (iops * 4096) / 1e6, seqMB = z.rate;
      const F = new S.Frames(['ms']);
      const N = 160, pts = [];
      for (let k = 0; k <= N; k++) { const d = Math.round((k / N) * (C - 1)); pts.push([d, St.seekTime(D, d).ms]); }
      const ymax = Math.ceil(D.full * 1.1);
      const ax = S.Kit.curve.axes({ prefix: 'sk:ax', x: 60, y: 44, w: 360, h: 250, xr: [0, C - 1], yr: [0, ymax], xticks: 0, yticks: S.Kit.curve.ticks(0, ymax, 5), xname: 'seek distance (cylinders)', yname: 'seek time (ms)', grid: true });
      const xt = [0, D.knee, C - 1].map((d, i) => t.text('sk:xt' + i, ax.X(d), 314, String(d), 'tick', 12, 'middle'));
      const base = { C, knee: D.knee, kneeTime: t.r3(D.kneeTime), full: D.full, settle: D.settle, a: t.r3(D.a), b: t.r3(D.b), d1: inp.d1, d2: inp.d2, s1: t.r3(s1.ms), s2: t.r3(s2.ms), rpm: D.rpm, rev: t.r3(D.rev), avgRot: t.r3(av.avgRotation), avgSeek: t.r3(av.avgSeek), avgD: t.r3(av.avgSeekDistance), avgDr: Math.round(av.avgSeekDistance), third: t.r3(C / 3), sAvgD: t.r3(sAvgD.ms), spt: z.spt, sectorMs: t.r3(z.sectorMs), per4k, xfer: t.r3(xfer), access: t.r3(av.access4k), iops: R(iops), randMB: t.r3(randMB), seqMB: t.r3(seqMB), ratio: R(seqMB / randMB), bytes: D.sectorBytes, kib: 4 };
      const RX = 470, lines = [];
      const panel = (n, act) => [t.title('sk:pt', RX, 44, 'one random 4 KiB read'), ...lines.slice(0, n).flatMap((l, i) => [t.text('sk:l' + i, RX, 80 + i * 28 + (i > 3 ? 12 : 0), l[0], i === act ? 'strong act-t' : 'tick', 14), t.text('sk:v' + i, 790, 80 + i * 28 + (i > 3 ? 12 : 0), l[1], 'calc' + (i === act ? ' act' : ''), 14, 'end')])].concat(n > 3 ? [{ key: 'sk:rule', kind: 'line', x1: RX, y1: 80 + 2 * 28 + 10, x2: 790, y2: 80 + 2 * 28 + 10, cls: 'faint', audit: 'ignore' }] : []);
      lines.push(['average seek', t.fix(av.avgSeek, 3) + ' ms'], ['average rotation', t.fix(av.avgRotation, 3) + ' ms'], ['transfer', t.fix(xfer, 3) + ' ms'], ['total', t.fix(av.access4k, 3) + ' ms'], ['reads a second', String(R(iops))], ['random reads', t.fix(randMB, 3) + ' MB/s'], ['in sequence', t.fix(seqMB, 3) + ' MB/s']);
      /** the stacked bar of one random read, scaled to the total */
      const bar = (upTo) => {
        const parts = [['seek', av.avgSeek, 'seek'], ['rotation', av.avgRotation, 'rot'], ['transfer', xfer, 'xfer']].slice(0, upTo);
        const x0 = 60, W = 730, y = 380, its = [t.text('sk:bt', x0, y - 14, 'where the time goes', 'title', 13), { key: 'sk:btr', kind: 'cell', x: x0, y, w: W, h: 32, rx: 3, text: '', cls: 'tl-track', audit: 'group' }];
        let x = x0;
        parts.forEach(([name, ms, cls], i) => { const w = Math.max(3, (ms / av.access4k) * W); its.push(t.cell('sk:b' + i, x, y, w, 32, w > t.tw(name, 13) + 12 ? name : '', 'tl ' + cls, 13, { audit: 'overlap-ok' })); x += w; });
        return its;
      };
      const plot = (extra) => [...ax.items, ...xt, S.Kit.curve.line(ax, 'sk:curve', pts, 'c0'), S.Kit.curve.vline(ax, 'sk:knee', D.knee, ''), t.text('sk:kn', ax.X(D.knee) + 6, 62, 'knee', 'tick', 12), ...(extra || [])];
      F.add({ items: plot(), say: `Seek time against distance on this disk: ${D.settle} ms to settle on the track, then up to the knee at ${D.knee} cylinders (${t.fix(D.kneeTime, 3)} ms) it grows like the square root of the distance, and beyond it in a straight line to ${D.full} ms for the full stroke of ${C - 1} cylinders.`, meta: Object.assign({ phase: 'curve', C1: C - 1 }, base) });
      F.add({ items: plot([S.Kit.curve.dot(ax, 'sk:d1', inp.d1, s1.ms, 'act')]), say: s1.say, meta: Object.assign({ phase: 'short' }, base) });
      F.add({ items: plot([S.Kit.curve.dot(ax, 'sk:d1', inp.d1, s1.ms, ''), S.Kit.curve.dot(ax, 'sk:d2', inp.d2, s2.ms, 'act')]), say: s2.say + ` ${t.fix(inp.d2 / inp.d1, 2)} times the distance of the short seek costs only ${t.fix(s2.ms / s1.ms, 2)} times its time.`, meta: Object.assign({ phase: 'long', ratioD: t.r2(inp.d2 / inp.d1), ratioT: t.r2(s2.ms / s1.ms) }, base) });
      const avgItems = [S.Kit.curve.vline(ax, 'sk:avd', av.avgSeekDistance, 'act')];
      F.add({ items: plot(avgItems), say: `For a random request the arm travels, on average over every pair of cylinders, ${t.fix(av.avgSeekDistance, 3)} cylinders: about a third of the ${C} (${t.fix(C / 3, 3)}).`, meta: Object.assign({ phase: 'avgd' }, base) });
      F.set('ms', t.r3(av.avgSeek));
      F.add({ items: plot(avgItems.concat([S.Kit.curve.hline(ax, 'sk:avs', av.avgSeek, 'act'), S.Kit.curve.dot(ax, 'sk:dav', av.avgSeekDistance, sAvgD.ms, '')])).concat(panel(1, 0), bar(1)), say: `Averaged over every pair, a seek takes ${t.fix(av.avgSeek, 3)} ms. That is not the seek of the average distance (${t.fix(sAvgD.ms, 3)} ms for ${Math.round(av.avgSeekDistance)} cylinders): short seeks are dear for their length, so the curve bends.`, meta: Object.assign({ phase: 'avgs' }, base) });
      F.set('ms', t.r3(av.avgSeek + av.avgRotation));
      F.add({ items: plot(avgItems).concat(panel(2, 1), bar(2)), say: `At ${D.rpm} RPM one turn takes 60000 / ${D.rpm} = ${t.fix(D.rev, 3)} ms. The sector wanted is anywhere on the track, so on average the head waits half a turn: ${t.fix(av.avgRotation, 3)} ms.`, meta: Object.assign({ phase: 'rot', k60: 60000 }, base) });
      F.set('ms', t.r3(av.access4k));
      F.add({ items: plot(avgItems).concat(panel(4, 2), bar(3)), say: `4 KiB is ${per4k} sectors of ${D.sectorBytes} bytes. An outer track holds ${z.spt} sectors, so one passes in ${t.fix(z.sectorMs, 3)} ms and the transfer takes ${t.fix(xfer, 3)} ms. The whole read: ${t.fix(av.avgSeek, 3)} + ${t.fix(av.avgRotation, 3)} + ${t.fix(xfer, 3)} = ${t.fix(av.access4k, 3)} ms.`, meta: Object.assign({ phase: 'xfer', k4: 4096 }, base) });
      F.add({ items: plot(avgItems).concat(panel(7, 5), bar(3)), say: `So the disk does about ${R(iops)} random 4 KiB reads a second, ${t.fix(randMB, 3)} MB/s, while reading on along the track it streams ${t.fix(seqMB, 3)} MB/s: about ${R(seqMB / randMB)} times as fast. Keeping a file's blocks together, and serving requests in a good order, is what makes a disk quick.`, meta: Object.assign({ phase: 'total' }, base) });
      return { frames: F.list, def: { sections: [{ id: 'f', kind: 'math', title: 'The time of one access', text: ['seek(d) = settle + a·√d          d ≤ knee', 'seek(d) = knee time + b·(d − knee)   d > knee', 'avg distance ≈ cylinders / 3', 'one turn = 60000 / RPM ms; avg wait = half a turn', 'transfer = sectors × turn / sectors a track', 'access = seek + rotation + transfer'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'avgd', pick: 'option', ask: 'Is the average seek time the seek time of the average distance?', options: ['no: it is larger, since short seeks cost more than their share', 'yes: exactly', 'no: it is smaller'], answer: (fr) => (fr[4].meta.avgSeek > fr[4].meta.sAvgD ? 'no: it is larger, since short seeks cost more than their share' : fr[4].meta.avgSeek < fr[4].meta.sAvgD ? 'no: it is smaller' : 'yes: exactly'), explain: (fr) => fr[4].say },
      { at: (f) => f.meta.phase === 'rot', pick: 'option', ask: 'Which part of a random 4 KiB read is the smallest?', options: ['the transfer', 'the seek', 'the rotational wait'], answer: 'the transfer', explain: (fr) => fr[6].say },
    ],
    quiz: [
      { q: 'A disk spins at 10000 RPM. What is its average rotational wait?', options: ['3 ms', '6 ms', '10 ms', '1.5 ms'], answer: 0, why: 'One turn takes 60000 / 10000 = 6 ms, and on average the sector is half a turn away.' },
      { q: 'Why does a seek of 10 cylinders cost much more than a tenth of a seek of 100?', options: ['the arm must accelerate, brake and settle whatever the distance', 'the tracks are longer further out', 'the disk spins slower for short seeks', 'it does not: seek time is proportional to distance'], answer: 0, why: 'The fixed settling time and the acceleration dominate short seeks: the curve grows like a square root.' },
      { q: 'Over every pair of cylinders chosen at random, the arm travels on average…', options: ['about a third of the cylinders', 'half of the cylinders', 'a quarter of the cylinders', 'all of them'], answer: 0, why: 'For two uniform points on a line of length L the mean distance is L / 3.' },
      { q: 'Random 4 KiB reads give a few hundred kilobytes a second on a drive that streams over a hundred megabytes a second. The cure is…', options: ['to keep related blocks close and read them in order', 'to spin the disk slower', 'to use smaller sectors', 'to read each block twice'], answer: 0, why: 'Seek and rotation dwarf the transfer; reading many neighbouring blocks per seek recovers the streaming rate.' },
    ],
  });

  // =================================================================================================================
  const parseReq = (x) => { const m = String(x).match(/^(\d+)(?:\+(\d+))?$/); return m ? { lba: +m[1], count: m[2] ? +m[2] : 1 } : null; };
  S.topic({
    id: 'disk-access', family: 'p12-disk', order: 30, title: 'The time of each request',
    blurb: 'Requests served in the order given, each worked out from the arm’s place and the platter’s angle: the seek to its cylinder, the wait while the platter turns its first sector under the head, and the transfer of its sectors. Neighbouring blocks cost almost nothing; a block one sector behind the head costs a whole turn.',
    inputs: [
      { id: 'disk', kind: 'choice', label: 'disk', def: 'teach', options: diskOpts },
      { id: 'reqs', kind: 'list', label: 'requests (block or block+count)', def: ['9000', '9001+4', '12345', '200'], min: 1, max: 6, check: (v) => (v.every(parseReq) ? null : 'requests: a block number, or block+count such as 9000+8') },
      { id: 'start', kind: 'number', label: 'arm starts at cylinder', def: 0, min: 0, max: 200000 },
    ],
    check(inp) {
      const D = mkDisk(inp.disk);
      if (inp.start >= D.cylinders) return 'arm starts at cylinder: at most ' + (D.cylinders - 1);
      for (const x of inp.reqs.map(parseReq)) { if (x.lba + x.count > D.sectors) return 'requests: this disk has ' + D.sectors + ' sectors'; if (x.count > 64) return 'requests: at most 64 sectors each'; }
      return null;
    },
    presets: [
      { label: 'Four requests on the teaching disk', values: { disk: 'teach', reqs: ['9000', '9001+4', '12345', '200'], start: 0 } },
      { label: 'Next block, then one behind', values: { disk: 'teach', reqs: ['5000+8', '5008+8', '5007'], start: 39 } },
      { label: 'Same cylinder, other head', values: { disk: 'teach', reqs: ['640+2', '680+2', '700'], start: 5 } },
      { label: 'Desktop: scattered 4 KiB reads', values: { disk: 'desktop', reqs: ['100000000+8', '5000+8', '700000000+8', '100000008+8'], start: 60000 } },
      { label: 'Server drive', values: { disk: 'server', reqs: ['2000000+8', '600000000+8', '2000016+8'], start: 0 } },
    ],
    counters: [{ id: 'ms', label: 'ms' }, { id: 'done', label: 'requests done' }],
    run(inp) {
      const t = T(), St = S.Storage, D = mkDisk(inp.disk), reqs = inp.reqs.map(parseReq).map((q, i) => ({ lba: q.lba, count: q.count, id: 'r' + (i + 1) }));
      const sv = St.serve(D, reqs, { cyl: inp.start, t: 0 }), items = sv.items, total = sv.total;
      const F = new S.Frames(['ms', 'done']);
      const PL = { cx: 165, cy: 190, R: 145, r0: 36 }, HA = 0.25;
      const lanes = (upTo, now, act) => t.lanes({ prefix: 'da:ln', x: 380, y: 52, w: 420, labelW: 76, t1: total, upTo, now, unit: 'ms', rowH: 28, gap: 8, rows: [
        { label: 'seek', segs: items.map((x, i) => ({ from: x.start, to: x.start + x.seek.ms, cls: 'seek' + (act === i + ':s' ? ' act' : ''), text: x.id })) },
        { label: 'rotation', segs: items.map((x, i) => ({ from: x.start + x.seek.ms, to: x.start + x.seek.ms + x.rotation.ms, cls: 'rot' + (act === i + ':r' ? ' act' : ''), text: x.id })) },
        { label: 'transfer', segs: items.map((x, i) => ({ from: x.end - x.transfer.ms, to: x.end, cls: 'xfer' + (act === i + ':x' ? ' act' : ''), text: x.id })) },
      ] });
      const cols = [['', 34], ['cyl, head, sector', 140], ['seek', 62], ['rotation', 70], ['transfer', 70], ['total', 62]];
      const table = (upTo, actRow, part) => {
        const its = [], x0 = 380, y0 = 210, rh = 26;
        let x = x0;
        cols.forEach(([h, w], j) => { its.push(t.text('da:th' + j, x + (j ? w - 4 : 0), y0, h, 'tick', 12, j ? 'end' : 'start')); x += w; });
        items.forEach((q, i) => {
          x = x0;
          const y = y0 + 26 + i * rh, shown = i < upTo || (i === upTo && part >= 0);
          const vals = [q.id, `${q.chs.cyl}, ${q.chs.head}, ${q.chs.sector}`, shown && part >= 1 || i < upTo ? t.fix(q.seek.ms, 3) : '', i < upTo || (i === upTo && part >= 2) ? t.fix(q.rotation.ms, 3) : '', i < upTo || (i === upTo && part >= 3) ? t.fix(q.transfer.ms, 3) : '', i < upTo || (i === upTo && part >= 3) ? t.fix(q.total, 3) : ''];
          cols.forEach(([, w], j) => { its.push(t.text('da:td' + i + '.' + j, x + (j ? w - 4 : 0), y, vals[j], (j === 0 ? 'strong' : 'calc') + (i === actRow ? ' act' : '') + (shown || j < 2 ? '' : ' muted'), 13, j ? 'end' : 'start')); x += w; });
        });
        return its;
      };
      const pic = (armCyl, cyl, sector, span, theta, secCls, upTo, now, act, row, part, extra) => {
        const p = S.T12.platter(Object.assign({ prefix: 'da:p', D, cyl, sector, span, lit: cyl === null ? null : 'sector', rot: HA - theta, head: { angle: HA }, armCyl, secCls }, PL));
        return [...p.items, t.text('da:pt', PL.cx, 22, 'the platter turns under the head', 'tick', 13, 'middle'), ...lanes(upTo, now, act).items, ...table(row, row, part), ...(extra || [])];
      };
      const base = { total: t.r3(total), n: items.length, start: inp.start, rev: t.r3(D.rev), rpm: D.rpm };
      F.add({ items: pic(inp.start, items[0].chs.cyl, items[0].chs.sector, items[0].transfer.sectors, St.angle(D, 0), 'target', 0, 0, null, 0, -1), say: `The arm is on cylinder ${inp.start} and the platter turns once every ${t.fix(D.rev, 3)} ms (${D.rpm} RPM). ${t.cap(t.plural(items.length, 'request'))} wait, to be served in the order given; the first, ${items[0].id}, wants block ${items[0].chs.lba}.`, meta: Object.assign({ phase: 'start', lba: items[0].chs.lba }, base) });
      items.forEach((q, i) => {
        const arrive = q.start + q.overhead + q.seek.ms, atSec = arrive + q.rotation.ms;
        const m = { i, id: q.id, lba: q.chs.lba, chs: q.chs, from: q.from, d: q.seek.d, seek: t.r3(q.seek.ms), rot: t.r3(q.rotation.ms), rotSec: t.r3(q.rotation.sectors), angleSec: t.r3(q.rotation.angle * q.chs.spt), xfer: t.r3(q.transfer.ms), sectors: q.transfer.sectors, switches: q.transfer.switches, tot: t.r3(q.total), arrive: t.r3(arrive), end: t.r3(q.end), per: t.r3(D.rev / q.chs.spt), spt: q.chs.spt, frac: t.r1(100 * q.rotation.ms / D.rev) };
        F.set('ms', t.r3(arrive));
        F.add({ items: pic(q.chs.cyl, q.chs.cyl, q.chs.sector, q.transfer.sectors, St.angle(D, arrive), 'target', arrive, arrive, i + ':s', i, 1), title: q.id + ': seek', say: q.seek.d ? `${q.id}, block ${q.chs.lba}, is on cylinder ${q.chs.cyl}, head ${q.chs.head}, sector ${q.chs.sector}. The arm moves ${q.seek.d} cylinders from ${q.from}: ${t.fix(q.seek.ms, 3)} ms.` : `${q.id}, block ${q.chs.lba}, is on cylinder ${q.chs.cyl}, head ${q.chs.head}, sector ${q.chs.sector}: the arm is already there, so no seek.`, meta: Object.assign({ phase: 'seek' }, base, m) });
        F.set('ms', t.r3(atSec));
        F.add({ items: pic(q.chs.cyl, q.chs.cyl, q.chs.sector, q.transfer.sectors, St.angle(D, atSec), 'target', atSec, atSec, i + ':r', i, 2), title: q.id + ': rotation', say: q.rotation.ms > 1e-9 ? `When the arm arrives, at ${t.fix(arrive, 3)} ms, sector ${t.fix(q.rotation.angle * q.chs.spt, 3)} of ${q.chs.spt} is under the head; sector ${q.chs.sector} is ${t.fix(q.rotation.sectors, 3)} sectors further round, so the head waits ${t.fix(q.rotation.ms, 3)} ms (${t.fix(100 * q.rotation.ms / D.rev, 1)}% of a turn).` : `Sector ${q.chs.sector} arrives under the head just as the arm does: no rotational wait at all.`, meta: Object.assign({ phase: 'rot' }, base, m) });
        F.set('ms', t.r3(q.end)).set('done', i + 1);
        F.add({ items: pic(q.chs.cyl, q.chs.cyl, q.chs.sector, q.transfer.sectors, St.angle(D, q.end), '', q.end, q.end, i + ':x', i, 3), title: q.id + ': transfer', say: `${t.cap(t.plural(q.transfer.sectors, 'sector'))} pass under the head at ${t.fix(D.rev / q.chs.spt, 3)} ms each${q.transfer.switches ? ', with ' + t.plural(q.transfer.switches, 'head switch', 'head switches') : ''}: ${t.fix(q.transfer.ms, 3)} ms. ${q.id} took ${t.fix(q.seek.ms, 3)} + ${t.fix(q.rotation.ms, 3)} + ${t.fix(q.transfer.ms, 3)} = ${t.fix(q.total, 3)} ms and ends at ${t.fix(q.end, 3)} ms.`, meta: Object.assign({ phase: 'xfer' }, base, m) });
      });
      const sum = { seek: t.r3(sv.seek), rot: t.r3(sv.rotation), xfer: t.r3(sv.transfer), ps: t.r1(100 * sv.seek / total), pr: t.r1(100 * sv.rotation / total), px: t.r1(100 * sv.transfer / total) };
      const last = items[items.length - 1];
      F.add({ items: pic(last.chs.cyl, null, null, 0, St.angle(D, total), '', total, total, null, items.length, 3), title: 'totals', say: `All ${t.plural(items.length, 'request')} took ${t.fix(total, 3)} ms: seeking ${t.fix(sv.seek, 3)} ms (${t.fix(100 * sv.seek / total, 1)}%), waiting for the platter ${t.fix(sv.rotation, 3)} ms (${t.fix(100 * sv.rotation / total, 1)}%), and moving data only ${t.fix(sv.transfer, 3)} ms (${t.fix(100 * sv.transfer / total, 1)}%).`, meta: Object.assign({ phase: 'end' }, base, sum) });
      return { frames: F.list, def: { sections: [{ id: 'f', kind: 'math', title: 'One request', text: ['seek: from the arm’s cylinder to the request’s', 'rotation: until its first sector is under the head', 'transfer: sectors × (one turn / sectors a track)', 'total = seek + rotation + transfer', 'the next request starts where this one ended'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'xfer' && f.meta.i === 0, once: true, pick: 'option', ask: (fr, i) => { const nx = fr.find((g, k) => k > i && g.meta.phase === 'seek'); return nx ? 'The next request, ' + nx.meta.id + ', needs how long a seek?' : 'Done'; }, options: ['none: the arm is already on its cylinder', 'a short one', 'a long one'], answer: (fr, i) => { const nx = fr.find((g, k) => k > i && g.meta.phase === 'seek'); if (!nx) return null; return nx.meta.d === 0 ? 'none: the arm is already on its cylinder' : nx.meta.seek < nx.meta.rev ? 'a short one' : 'a long one'; }, explain: (fr, i) => fr.find((g, k) => k > i && g.meta.phase === 'seek').say },
    ],
    quiz: [
      { q: 'Block b has just been read. Reading block b + 1 straight after costs…', options: ['one sector’s transfer, with no seek and no wait', 'a full turn', 'an average seek', 'half a turn'], answer: 0, why: 'The next sector arrives under the head right after the last one.' },
      { q: 'Block b has just been read. Reading block b − 1 next costs about…', options: ['a whole turn of the platter', 'nothing', 'one sector time', 'a full-stroke seek'], answer: 0, why: 'That sector has just passed the head; the platter must go nearly all the way round.' },
      { q: 'Switching from one head to another on the same cylinder needs…', options: ['no seek, only a short electronic switch', 'a seek of one cylinder', 'a full turn', 'the arm to return to cylinder 0'], answer: 0, why: 'All heads sit on the same cylinder; only the one that reads changes.' },
      { q: 'For small random requests most of the time goes into…', options: ['seeking and waiting for the platter', 'transferring the data', 'the controller', 'the bus'], answer: 0, why: 'A 4 KiB transfer takes a few hundredths of a millisecond against milliseconds of positioning.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
