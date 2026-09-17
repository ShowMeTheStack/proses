// Part 15, cleaning a log-structured file system (S.FS.lfs.clean): overwrites leave dead blocks behind in old
// segments, and the log needs clean segments to write into. The cleaner picks segments, copies their live blocks to the
// head of the log and frees them. Greedy picks the emptiest; cost-benefit weighs the free space gained against the age
// of the data, (1 − u)·age / (1 + u), and does better when some data is hot and some cold. The write cost, every block
// written or read by the cleaner per block of new data, is measured on the same workload under both policies.
(function (S) {
  'use strict';
  const H = S.P15, F = () => S.FS, LL = () => S.P15.lfs;
  const GEO = { bs: 128, segBlocks: 12, nsegs: 10, ninodes: 40, autoClean: false };

  /** the workload: fill with files, then rounds of overwrites (hot files more often when skewed), cleaning as needed */
  function play(policy, skew, files, rounds, seed, record) {
    const L = F().lfs, fs = L.mkfs(GEO);
    let s = seed >>> 0;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    // the fill: the directory is rewritten as it grows, so the cleaner already has work; it runs quietly here, and the
    // counts start afresh once the files are in place
    const quiet = () => { while (fs.free.length < 3) { if (!L.clean(fs, { policy: 'greedy', count: 2 }).cleaned.length) break; } };
    for (let i = 0; i < files; i++) { quiet(); L.create(fs, 'f' + i); quiet(); L.write(fs, 'f' + i, 0, String.fromCharCode(97 + (i % 26)).repeat(100)); if (i % 4 === 3) { quiet(); L.sync(fs); } }
    quiet(); L.sync(fs);
    fs.stats = { newBlocks: 0, written: 0, cleanerReads: 0, cleanerWrites: 0 };
    if (record) record({ kind: 'fill', fs });
    const hot = Math.max(1, Math.round(files / 10));
    const cleanIfLow = (r) => { while (fs.free.length < 3) { const c = L.clean(fs, { policy, count: 2 }); if (record) record({ kind: 'clean', r, c, fs }); if (!c.cleaned.length) break; } };
    for (let r = 0; r < rounds; r++) {
      const touched = [];
      for (let k = 0; k < 6; k++) {
        cleanIfLow(r);
        const i = skew === 'hot' ? (rnd() < 0.9 ? Math.floor(rnd() * hot) : hot + Math.floor(rnd() * (files - hot))) : Math.floor(rnd() * files);
        L.write(fs, 'f' + i, 0, 'round ' + r + ' write ' + k + ' '); touched.push(i);
      }
      cleanIfLow(r);
      L.sync(fs);
      if (record) record({ kind: 'round', r, touched, fs });
    }
    return { fs, stats: L.stats(fs) };
  }

  S.topic({
    id: 'fsi-clean', family: 'p15-lfs', order: 20, title: 'The cleaner: greedy against cost-benefit',
    blurb: 'Overwrites leave the log full of dead blocks, and new writes need clean segments. The cleaner reads some segments, writes their live blocks again at the head of the log, and frees them. Which segments? Greedy takes the emptiest. Cost-benefit weighs the space freed against the cost of copying and how long the data has stayed put: cold, settled data is worth compacting even when its segment is fuller.',
    inputs: [
      { id: 'policy', kind: 'choice', label: 'policy', def: 'cost-benefit', options: [{ value: 'greedy', label: 'greedy (the emptiest)' }, { value: 'cost-benefit', label: 'cost-benefit' }] },
      { id: 'skew', kind: 'choice', label: 'overwrites', def: 'hot', options: [{ value: 'hot', label: '90% to a tenth of the files' }, { value: 'uniform', label: 'spread evenly' }] },
      { id: 'files', kind: 'number', label: 'files (one block each)', def: 22, min: 8, max: 22 },
      { id: 'rounds', kind: 'number', label: 'rounds of 6 overwrites', def: 14, min: 2, max: 16 },
      { id: 'seed', kind: 'number', label: 'seed', def: 11, min: 1, max: 9999 },
    ],
    presets: [
      { label: 'Hot and cold data, cost-benefit', values: { policy: 'cost-benefit', skew: 'hot', files: 22, rounds: 14, seed: 11 } },
      { label: 'Hot and cold data, greedy', values: { policy: 'greedy', skew: 'hot', files: 22, rounds: 14, seed: 11 } },
      { label: 'Uniform overwrites, greedy', values: { policy: 'greedy', skew: 'uniform', files: 20, rounds: 10, seed: 7 } },
      { label: 'Hot and cold, another seed', values: { policy: 'cost-benefit', skew: 'hot', files: 22, rounds: 10, seed: 1 } },
    ],
    counters: [{ id: 'clean', label: 'clean segments' }, { id: 'cost', label: 'write cost' }],
    run(inp) {
      const Fr = new S.Frames(['clean', 'cost']), L = F().lfs;
      const add = (ev) => {
        const fs = ev.fs, st = L.stats(fs), use = L.usage(fs), picked = new Set(ev.kind === 'clean' ? ev.c.cleaned : []);
        const d = LL().draw(fs, { prefix: 'cl:d', compact: true, cw: 36, ch: 28, picked, title: `the log: ${fs.g.nsegs} segments of ${fs.g.segBlocks} blocks` });
        const items = d.items.concat(LL().legend('cl:lg', 0, d.h + 8, d.w, true));
        const X = d.w + 20;
        items.push(H.head('cl:st', X, 4, 'the cleaner'));
        const rows = [`policy: ${inp.policy}`, `new data written: ${st.newBlocks}`, `all blocks written: ${st.written}`, `read by the cleaner: ${st.cleanerReads}`, `write cost: ${st.writeCost}`];
        rows.forEach((t, i) => items.push(H.text('cl:r' + i, X, 30 + i * 22, t, i === 4 ? 'strong' : 'mono', 13)));
        if (ev.kind === 'clean') ev.c.steps.filter((s) => s.kind === 'pick').forEach((s, i) => items.push(...H.para('cl:p' + i, X, 150 + i * 60, `segment ${s.seg}: u = ${s.u.toFixed(2)}, age ${s.age}`, 300, 13, 'hot').items));
        Fr.set('clean', use.filter((u) => u.state === 'free').length).set('cost', st.writeCost);
        let say, meta = { kind: ev.kind, stats: st, free: fs.free.length, segBlocks: fs.g.segBlocks, used: use.filter((u) => u.state !== 'free').length, hot: Math.max(1, Math.round(inp.files / 10)), per: 6 };
        if (ev.kind === 'fill') say = `${inp.files} files of one block each, written and synced: the log now holds ${H.plural(use.filter((u) => u.state !== 'free').length, 'used segment')} and ${H.plural(fs.free.length, 'clean one')}. Next come rounds of 6 overwrites each, ${inp.skew === 'hot' ? 'nine in ten to the same ' + Math.max(1, Math.round(inp.files / 10)) + ' hot files' : 'spread evenly over all files'}, each round synced.`;
        else if (ev.kind === 'round') say = `Round ${ev.r + 1}: files ${ev.touched.map((i) => 'f' + i).join(', ')} are overwritten. Each overwrite writes a new copy at the head and leaves the old one dead. ${H.plural(fs.free.length, 'clean segment')} left.`;
        else {
          const picks = ev.c.steps.filter((s) => s.kind === 'pick');
          say = `Fewer than 3 clean segments: the cleaner runs. ${picks.map((s) => s.say).join(' ')} ${ev.c.steps.find((s) => s.kind === 'cleaned').say} The write cost so far is ${st.writeCost}.`;
          meta = Object.assign(meta, { picks: picks.map((s) => ({ seg: s.seg, u: s.u, age: s.age, score: (1 - s.u) * s.age / (1 + s.u), u2: [1 - s.u, 1 + s.u], live: Math.round(s.u * fs.g.segBlocks) })), moved: ev.c.moved, cleaned: ev.c.cleaned });
        }
        Fr.add({ items, title: ev.kind === 'round' ? 'round ' + (ev.r + 1) : ev.kind, say, meta });
      };
      // the frames: the fill, every round, every clean (only the first few rounds and every clean, to keep it short)
      let shown = 0;
      const R = play(inp.policy, inp.skew, inp.files, inp.rounds, inp.seed, (ev) => { if (ev.kind === 'round' && shown >= 3 && ev.r < inp.rounds - 1) return; if (ev.kind === 'round') shown++; add(ev); });
      const other = inp.policy === 'greedy' ? 'cost-benefit' : 'greedy', O = play(other, inp.skew, inp.files, inp.rounds, inp.seed, null);
      const last = Fr.last(), base = (R.stats.written - R.stats.cleanerWrites) / Math.max(1, R.stats.newBlocks);
      Fr.add({ items: last.items, title: 'compared', say: `After ${inp.rounds} rounds, ${inp.policy} has a write cost of ${R.stats.writeCost}: for every block of new data, ${R.stats.writeCost} blocks were written or read in all. The same workload under ${other} costs ${O.stats.writeCost}, so ${R.stats.writeCost < O.stats.writeCost ? inp.policy : R.stats.writeCost > O.stats.writeCost ? other : 'neither'} ${R.stats.writeCost === O.stats.writeCost ? 'wins' : 'does better'} here. Of the ${R.stats.written + R.stats.cleanerReads} blocks moved, ${R.stats.cleanerReads} were cleaner reads and ${R.stats.cleanerWrites} cleaner writes; the rest are the new data with the new inodes and inode-map pieces each overwrite brings. Cost-benefit is built for hot and cold data: it compacts cold segments, which then stay compact, and leaves hot ones to empty by themselves; on a log this small, seeds differ.`, meta: { kind: 'compare', a: R.stats.writeCost, b: O.stats.writeCost, rounds: inp.rounds, stats: R.stats, moved: R.stats.written + R.stats.cleanerReads } });
      return { frames: Fr.list, def: { sections: [{ id: 'eq', kind: 'math', title: 'Cleaning', text: ['u: the live fraction of a segment', 'greedy: the smallest u first', 'cost-benefit: the largest (1 − u)·age / (1 + u)', 'write cost = (written + cleaner reads) / new data', 'for a segment cleaned at u: 2 / (1 − u)'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.kind === 'compare', pick: 'option', ask: 'Which policy will have the lower write cost on this workload?', options: ['greedy', 'cost-benefit', 'the same'], answer: (fr, i, inp) => { const m = fr[fr.length - 1].meta, mine = inp.policy, other = mine === 'greedy' ? 'cost-benefit' : 'greedy'; return m.a < m.b ? mine : m.a > m.b ? other : 'the same'; }, explain: (fr) => fr[fr.length - 1].say },
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.kind === 'clean' && f.meta.kind !== 'clean', pick: 'option', once: true, ask: 'Will the cleaner pick the segment with the fewest live blocks?', options: ['yes', 'not necessarily'], answer: (fr, i, inp) => (inp.policy === 'greedy' ? 'yes' : 'not necessarily'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'A segment is cleaned when 80% of it is live. Roughly what is the write cost?', options: ['about 10: read the segment, write 0.8 of it back, for 0.2 of free space', 'about 1', 'about 2', 'about 100'], answer: 0, why: '2 / (1 − u) = 2 / 0.2 = 10.' },
      { q: 'Why does greedy cleaning do badly with hot and cold data?', options: ['cold segments sit just above the threshold and are never cleaned, so free space is locked in them', 'it is too slow', 'it cleans hot segments too late', 'it ignores the summaries'], answer: 0, why: 'Cold free space is worth more: once compacted it stays compact.' },
      { q: 'How does the cleaner know which blocks of a segment are live?', options: ['the summary says what each block is; the inode map and inodes say whether it is still the current copy', 'a bitmap per segment', 'it reads every inode', 'all blocks are live'], answer: 0, why: 'A data block is live if its inode still points to it.' },
      { q: 'What does the cleaner cost a log-structured file system?', options: ['extra reads and writes, which grow sharply as the disk fills', 'nothing', 'a journal', 'its checkpoints'], answer: 0, why: 'Fuller segments are costlier to clean.' },
    ],
  });
  S.P15.cleanPlay = play;
})(globalThis.Proses = globalThis.Proses || {});
