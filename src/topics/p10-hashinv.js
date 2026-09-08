// Part 10, hashed and inverted page tables. A hashed table keeps one chained node per mapped page in buckets chosen by
// the page number; an inverted table keeps one entry per physical frame naming the (process, page) in it, found by
// hashing into an anchor table and following a chain. Lookups are walked node by node with the memory accesses
// counted. Engines: S.Mem.hpt, S.Mem.ipt, S.Mem.forwardBytes (src/core/mem-b-inverted.js).
(function (S) {
  'use strict';
  const H = S.P10, M = () => S.Mem;

  S.topic({
    id: 'mem-hashed', family: 'p10-tables', order: 30, title: 'A hashed page table',
    blurb: 'For a large sparse address space, a hashed page table sizes itself by the pages actually mapped. The page number is hashed to pick a bucket; each bucket holds a chain of nodes (page, frame, next). A lookup reads the bucket, then compares node after node until the page matches or the chain ends. Collisions make chains longer and lookups slower, so the bucket count is kept near the number of mapped pages.',
    inputs: [
      { id: 'buckets', kind: 'choice', label: 'Buckets', def: '8', options: ['4', '8', '16'].map((v) => ({ value: v, label: v })) },
      { id: 'map', kind: 'list', label: 'Mapped pages (page:frame), in order', def: ['3:12', '11:4', '19:7', '8:2', '24:9', '5:1', '16:30'], min: 1, max: 14 },
      { id: 'look', kind: 'list', label: 'Lookups (pages)', def: ['19', '8', '27', '5'], min: 1, max: 5 },
    ],
    check(inp) {
      const seen = new Set();
      for (const x of inp.map) { const m = /^(\d+):(\d+)$/.exec(x); if (!m || +m[1] > 99999) return 'Mapped pages: page:frame with pages up to 99999 ("' + x + '")'; if (seen.has(m[1])) return 'Mapped pages: page ' + m[1] + ' is mapped twice'; seen.add(m[1]); }
      for (const x of inp.look) if (!/^\d+$/.test(x)) return 'Lookups: page numbers ("' + x + '")';
      return null;
    },
    presets: [
      { label: 'Eight buckets, one long chain', values: {} },
      { label: 'Sixteen buckets: shorter chains', values: { buckets: '16' } },
      { label: 'Four buckets, everything collides', values: { buckets: '4', map: ['4:1', '8:2', '12:3', '16:4', '20:5', '1:6'], look: ['4', '20', '24'] } },
      { label: 'Pages far apart in a big space', values: { buckets: '8', map: ['40960:3', '81920:5', '12345:8', '99999:9', '65536:11'], look: ['99999', '65536', '40961'] } },
    ],
    counters: [{ id: 'acc', label: 'memory accesses' }],
    run(inp) {
      const B = +inp.buckets, T = M().hpt({ buckets: B, pageBytes: 4096 }), ins = inp.map.map((x) => { const [p, f] = x.split(':').map(Number); return T.insert(p, f); });
      const F = new S.Frames(['acc']), view = H.box(0, 0, 790, 480), rh = B > 8 ? 27 : B > 4 ? 40 : 64;
      const lens = T.lengths(), step = Math.min(150, Math.floor(650 / Math.max(1, ...lens)));
      const draw = (o) => {
        o = o || {};
        const items = [H.text('bt', 20, 18, 'buckets', 'title'), H.text('ct', 130, 18, 'chains: page → frame', 'title')];
        for (let b = 0; b < B; b++) {
          const y = 30 + b * rh, chain = T.chain(b);
          items.push(H.cell('b' + b, 20, y, 70, rh - 6, b, 'mb-idx' + (o.bucket === b ? ' sel lv0' : ''), 13, { rx: 3 }));
          chain.forEach((k, j) => {
            const n = T.nodes[k], st = o.seen && o.seen.includes(k) ? (k === o.cur ? (o.hit ? ' good' : ' act') : ' seen') : '';
            items.push(H.cell('n' + k, 130 + j * step, y, step - 30, rh - 6, 'page ' + n.vpn + ' → ' + n.pfn, 'mb-ent' + st, 13, { rx: 3 }));
            items.push({ key: 'e' + k, kind: 'edge', from: j ? 'n' + chain[j - 1] : 'b' + b, to: 'n' + k, cls: o.seen && o.seen.includes(k) ? 'act' : '' });
          });
          if (!chain.length) items.push(H.text('em' + b, 130, y + rh / 2, 'empty', 'tick', 12));
        }
        if (o.result) items.push(H.text('res', 780, 466, o.result, o.bad ? 'p10-sum bad' : 'p10-sum good', 15, 'end'));
        return items;
      };
      F.add({ items: draw(), say: `${H.plural(ins.length, 'page')} went in, each at the head of bucket page mod ${B}. The chains have lengths ${lens.join(', ')}: ` + (Math.max(...lens) > 1 ? `bucket ${lens.indexOf(Math.max(...lens))} holds ${Math.max(...lens)} colliding pages.` : 'no collisions.'), meta: { phase: 'build', n: ins.length, B, lens, longest: Math.max(...lens), at: lens.indexOf(Math.max(...lens)) }, view, hl: { d: [0, 1] } });
      for (const x of inp.look) {
        const p = Number(x), r = T.lookup(p, 0), seen = [];
        let acc = 0;
        r.steps.forEach((st) => {
          if (st.kind === 'hash') { acc = 1; F.count('acc'); F.add({ items: draw({ bucket: st.bucket, seen: [] }), say: st.say, meta: { phase: 'hash', page: p, bucket: st.bucket, B, acc }, view, hl: { d: [0] } }); }
          if (st.kind === 'compare') { seen.push(st.node); acc = st.access; F.count('acc'); F.add({ items: draw({ bucket: r.bucket, seen: seen.slice(), cur: st.node, hit: st.hit }), say: st.say, meta: { phase: 'compare', page: p, node: st.entry.vpn, frame: st.entry.pfn, hit: st.hit, acc }, view, hl: { d: [2] } }); }
          if (st.kind === 'frame') { F.count('acc'); F.add({ items: draw({ bucket: r.bucket, seen, cur: seen[seen.length - 1], hit: true, result: 'page ' + p + ' → frame ' + st.pfn + ': ' + st.accesses + ' accesses' }), say: `Page ${p} is in frame ${st.pfn}: ${H.plural(st.accesses, 'memory access', 'memory accesses')} with the data, the bucket and ${H.plural(seen.length, 'node')} on its chain.`, meta: { phase: 'found', page: p, frame: st.pfn, accesses: st.accesses, nodes: seen.length }, view, hl: { d: [3] } }); }
          if (st.kind === 'fault') F.add({ items: draw({ bucket: r.bucket, seen, cur: -1, result: 'page ' + p + ': not mapped', bad: true }), say: st.say, meta: { phase: 'fault', page: p, bucket: r.bucket, accesses: st.accesses }, view, hl: { d: [4] } });
        });
      }
      const sz = T.size();
      F.add({ items: draw(), say: `The table takes ${sz.total} bytes: ${ins.length} nodes of 16 bytes and ${B} buckets of 8, growing with the mapped pages and not with the address space. A longer chain costs one more access per node passed.`, meta: { phase: 'end', total: sz.total, n: ins.length, B, node: 16, bucketB: 8 }, view });
      return { frames: F.list, def: H.def('Hashed table', ['bucket = page mod buckets', 'insert at the head of the bucket\'s chain', 'lookup: read the bucket, compare node by node', 'a match: the node\'s frame', 'the chain ends: a page fault']) };
    },
    predict: [
      { at: (f, i, fr) => f.meta.phase !== 'end' && fr[i + 1] && fr[i + 1].meta.phase === 'hash', pick: 'item', ask: (fr, i) => `Page ${fr[i + 1].meta.page} is looked up next. Click its bucket.`, answer: (fr, i) => 'b' + fr[i + 1].meta.bucket, explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'With 8 buckets, which bucket does page 27 hash to?', options: ['3', '7', '2', '27'], answer: 0, why: '27 mod 8 = 3.' },
      { q: 'A lookup finds the page in the third node of its chain. How many memory accesses, with the data?', options: ['5', '3', '4', '2'], answer: 0, why: 'The bucket, three nodes, then the data.' },
      { q: 'The memory a hashed table takes grows with…', options: ['the number of mapped pages', 'the size of the virtual address space', 'the number of frames', 'the TLB'], answer: 0, why: 'One node per mapping, plus the buckets.' },
      { q: 'Clustered page tables improve on this by…', options: ['storing several neighbouring pages in one node', 'using more levels', 'removing the buckets', 'flushing the TLB'], answer: 0, why: 'Sparse but clustered spaces then need fewer nodes and shorter chains.' },
    ],
  });

  S.topic({
    id: 'mem-inverted', family: 'p10-tables', order: 40, title: 'An inverted page table',
    blurb: 'An inverted page table turns the table around: one entry per physical frame, saying which process\'s page lives there. Its size follows physical memory, and one table serves every process, which matters for 64-bit spaces where per-process tables would be vast. The price is the search: the hardware hashes (pid, page) into an anchor table, then follows a chain of entries comparing each one. The frame number is the position of the matching entry.',
    inputs: [
      { id: 'frames', kind: 'choice', label: 'Frames', def: '8', options: ['8', '16'].map((v) => ({ value: v, label: v })) },
      { id: 'anchors', kind: 'choice', label: 'Anchors', def: '4', options: ['4', '8'].map((v) => ({ value: v, label: v })) },
      { id: 'res', kind: 'list', label: 'Resident pages (pid:page@frame), in order', def: ['1:0@3', '1:1@0', '2:0@5', '1:4@6', '2:3@1', '3:2@4', '2:8@2'], min: 1, max: 16 },
      { id: 'look', kind: 'list', label: 'Lookups (pid:page)', def: ['2:3', '1:4', '3:5', '2:0'], min: 1, max: 5 },
      { id: 'va', kind: 'choice', label: 'Virtual address bits (for the size)', def: '48', options: ['32', '48', '64'].map((v) => ({ value: v, label: v + ' bits' })) },
    ],
    check(inp) {
      const fr = new Set(), pp = new Set();
      for (const x of inp.res) {
        const m = /^(\d+):(\d+)@(\d+)$/.exec(x);
        if (!m) return 'Resident pages: pid:page@frame ("' + x + '")';
        if (+m[3] >= +inp.frames) return 'Resident pages: frames 0 to ' + (+inp.frames - 1) + ' ("' + x + '")';
        if (fr.has(m[3])) return 'Resident pages: frame ' + m[3] + ' is used twice';
        if (pp.has(m[1] + ':' + m[2])) return 'Resident pages: ' + m[1] + ':' + m[2] + ' is resident twice';
        fr.add(m[3]); pp.add(m[1] + ':' + m[2]);
      }
      for (const x of inp.look) if (!/^\d+:\d+$/.test(x)) return 'Lookups: pid:page ("' + x + '")';
      return null;
    },
    presets: [
      { label: 'Three processes, eight frames', values: {} },
      { label: 'Eight anchors: shorter chains', values: { anchors: '8' } },
      { label: 'The same page number in three processes', values: { res: ['1:5@0', '2:5@1', '3:5@2', '1:6@3'], look: ['3:5', '2:5', '4:5'] } },
      { label: 'A 64-bit machine', values: { va: '64', frames: '16', anchors: '8', res: ['1:0@0', '1:1@1', '2:0@2', '2:7@3', '3:1@4', '3:9@5', '4:2@6', '4:3@7', '5:0@8', '5:4@9'], look: ['4:3', '5:4', '2:9'] } },
    ],
    counters: [{ id: 'acc', label: 'memory accesses' }],
    run(inp) {
      const nF = +inp.frames, nA = +inp.anchors, T = M().ipt({ frames: nF, anchors: nA, pageBytes: 4096, vaBits: +inp.va });
      for (const x of inp.res) { const m = /^(\d+):(\d+)@(\d+)$/.exec(x); T.place(+m[3], +m[1], +m[2]); }
      const F = new S.Frames(['acc']), view = H.box(0, 0, 790, 480), rh = nF > 8 ? 26 : 44, pids = [...new Set(inp.res.map((x) => +x.split(':')[0]))];
      const ent = (f) => T.entries[f];
      const draw = (o) => {
        o = o || {};
        const items = [H.text('at', 20, 18, 'anchors', 'title'), H.text('it', 200, 18, 'inverted table: one entry per frame', 'title')];
        const ah = Math.min(rh, Math.floor(440 / nA));
        for (let a = 0; a < nA; a++) items.push(H.cellL('a' + a, 20, 30 + a * ah, 90, ah - 6, [a + ': ' + (T.anchor[a] < 0 ? '—' : '→ ' + T.anchor[a])], 'mb-idx' + (o.slot === a ? ' sel lv0' : ''), 13, { rx: 3 }));
        items.push(H.cell('hf', 200, 30, 60, 22, 'frame', 'mb-colh', 12, { rx: 0 }), H.cell('hp', 260, 30, 70, 22, 'pid', 'mb-colh', 12, { rx: 0 }), H.cell('hg', 330, 30, 70, 22, 'page', 'mb-colh', 12, { rx: 0 }), H.cell('hn', 400, 30, 70, 22, 'next', 'mb-colh', 12, { rx: 0 }));
        for (let f = 0; f < nF; f++) {
          const e = ent(f), y = 54 + f * rh, on = o.seen && o.seen.includes(f), cur = f === o.cur;
          const cls = 'mb-ent' + (cur ? (o.hit ? ' good' : ' act') : on ? ' seen' : '');
          items.push(H.cell('ef' + f, 200, y, 60, rh - 4, f, 'mb-fno' + (cur && o.hit ? ' good' : ''), 13, { rx: 0 }));
          items.push(H.cell('ep' + f, 260, y, 70, rh - 4, e ? e.pid : '', cls + (e ? ' ' + H.pc(pids.indexOf(e.pid)) : ' nil'), 13, { rx: 0 }));
          items.push(H.cell('eg' + f, 330, y, 70, rh - 4, e ? e.vpn : 'free', cls + (e ? '' : ' nil'), 13, { rx: 0 }));
          items.push(H.cell('en' + f, 400, y, 70, rh - 4, e ? (e.next < 0 ? '—' : e.next) : '', cls + (e ? '' : ' nil'), 13, { rx: 0 }));
        }
        if (o.slot !== undefined && o.slot >= 0 && T.anchor[o.slot] >= 0 && o.seen && o.seen.length) {
          // drafted wires in the empty corridors, so no arrow crosses a cell: anchor to its first entry, then link to link
          const ah2 = Math.min(rh, Math.floor(440 / nA)), ya = 30 + o.slot * ah2 + (ah2 - 6) / 2, yf = (f) => 54 + f * rh + (rh - 4) / 2;
          items.push(H.wire('ar:a', [[110, ya], [155, ya], [155, yf(o.seen[0])], [200, yf(o.seen[0])]], 'act'));
          for (let j = 1; j < o.seen.length; j++) { const x = 484 + ((j - 1) % 3) * 9; items.push(H.wire('ar:' + j, [[470, yf(o.seen[j - 1]) - 5], [x, yf(o.seen[j - 1]) - 5], [x, yf(o.seen[j]) + 5], [470, yf(o.seen[j]) + 5]], 'act')); }
        }
        (o.lines || []).forEach((l, k) => items.push(H.text('r' + k, 524, 80 + k * 30, l[0], l[1], 14)));
        return items;
      };
      F.add({ items: draw(), say: `${H.plural(inp.res.length, 'page')} of ${H.plural(pids.length, 'process', 'processes')} are resident. Entry f says which (pid, page) is in frame f; each was placed at the head of the chain of anchor (page + ${T.mult} × pid) mod ${nA}.`, meta: { phase: 'start', n: inp.res.length, procs: pids.length, mult: T.mult, nA }, view, hl: { d: [0, 1] } });
      for (const x of inp.look) {
        const [pid, page] = x.split(':').map(Number), r = T.lookup(pid, page, 0x2a4), seen = [];
        r.steps.forEach((st) => {
          if (st.kind === 'hash') F.add({ items: draw({ slot: st.slot, lines: [['look up pid ' + pid + ', page ' + page, 'strong'], ['(' + page + ' + ' + T.mult + ' × ' + pid + ') mod ' + nA + ' = ' + st.slot, 'p10-sum']] }), say: st.say, meta: { phase: 'hash', pid, page, slot: st.slot, mult: T.mult, nA }, view, hl: { d: [1] } });
          if (st.kind === 'anchor') { F.count('acc'); if (st.frame < 0) F.add({ items: draw({ slot: st.slot, lines: [['anchor ' + st.slot + ' is empty', 'p10-sum bad'], ['page fault', 'p10-sum bad']] }), say: st.say, meta: { phase: 'fault', pid, page, slot: st.slot }, view, hl: { d: [4] } }); }
          if (st.kind === 'compare') { seen.push(st.frame); F.count('acc'); F.add({ items: draw({ slot: r.slot, seen: seen.slice(), cur: st.frame, hit: st.hit, lines: [['look up pid ' + pid + ', page ' + page, 'strong'], ['entry ' + st.frame + ': pid ' + st.entry.pid + ', page ' + st.entry.vpn, st.hit ? 'good' : 'p10-sum']] }), say: st.say, meta: { phase: 'compare', pid, page, frame: st.frame, epid: st.entry.pid, epage: st.entry.vpn, next: st.entry.next, hit: st.hit, access: st.access }, view, hl: { d: [2] } }); }
          if (st.kind === 'frame') { F.count('acc'); F.add({ items: draw({ slot: r.slot, seen, cur: st.frame, hit: true, lines: [['pid ' + pid + ', page ' + page + ' → frame ' + st.frame, 'p10-sum good'], [H.plural(st.accesses, 'memory access', 'memory accesses'), 'strong']] }), say: st.say, meta: { phase: 'found', pid, page, frame: st.frame, pa: st.pa, accesses: st.accesses, page4: 4096, off: 0x2a4 }, view, hl: { d: [3] } }); }
          if (st.kind === 'fault') F.add({ items: draw({ slot: r.slot, seen, cur: -1, lines: [['pid ' + pid + ', page ' + page, 'p10-sum bad'], ['not resident: page fault', 'p10-sum bad']] }), say: st.say, meta: { phase: 'fault', pid, page, slot: r.slot, accesses: st.accesses }, view, hl: { d: [4] } });
        });
      }
      const sz = T.size(), fwd = M().forwardBytes({ vaBits: +inp.va, pageBytes: 4096, pteBytes: 8, procs: pids.length });
      F.add({ items: draw({ lines: [['inverted: ' + M().bytes(sz.total), 'p10-sum good'], [pids.length + ' flat tables: ' + M().bytes(fwd), 'p10-sum bad']] }), say: `This inverted table takes ${sz.total} bytes (${nF} entries of ${sz.entryBytes} bytes and ${nA} anchors of 4) for every process together. Flat tables for the same ${H.plural(pids.length, 'process', 'processes')} in a ${inp.va}-bit space would take ${M().bytes(fwd)}.`, meta: { phase: 'end', anchorB: 4, total: sz.total, nF, nA, eb: sz.entryBytes, procs: pids.length, va: +inp.va, sz: [M().bytes(fwd)] }, view, hl: { d: [5] } });
      return { frames: F.list, def: H.def('Inverted table', ['entry f = (pid, page) held in frame f', 'anchor = (page + 7 × pid) mod anchors', 'follow the chain, comparing pid and page', 'a match at entry f: the page is in frame f', 'the chain ends: a page fault', 'size: frames × entry + anchors, one per machine']) };
    },
    predict: [
      { at: (f) => f.meta.phase === 'hash', pick: 'option', ask: (fr, i) => `Which frame holds pid ${fr[i].meta.pid}, page ${fr[i].meta.page}?`, options: (fr, i) => { const fs = fr.find((f, j) => j > i && (f.meta.phase === 'found' || f.meta.phase === 'fault')); return [...new Set([...fr[0].items.filter((it) => /^ef\d+$/.test(it.key)).map((it) => it.text).slice(0, 4), fs.meta.phase === 'found' ? String(fs.meta.frame) : 'none: a page fault', 'none: a page fault'])]; }, answer: (fr, i) => { const fs = fr.find((f, j) => j > i && (f.meta.phase === 'found' || f.meta.phase === 'fault')); return fs.meta.phase === 'found' ? String(fs.meta.frame) : 'none: a page fault'; }, explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'An inverted table on a machine with 2^20 frames has how many entries?', options: ['2^20', 'one per virtual page', 'one per process', '2^52'], answer: 0, why: 'One per physical frame.' },
      { q: 'With anchors = 4 and the hash (page + 7 × pid) mod 4, where does pid 2, page 3 go?', options: ['anchor 1', 'anchor 3', 'anchor 2', 'anchor 0'], answer: 0, why: '(3 + 14) mod 4 = 1.' },
      { q: 'Why must an entry store the pid?', options: ['the same page number exists in many processes', 'to find the disk block', 'for the TLB reach', 'it need not'], answer: 0, why: 'Page 5 of process 1 and page 5 of process 2 are different pages.' },
      { q: 'What makes sharing a page between processes awkward here?', options: ['each frame has one entry, naming one (pid, page)', 'frames are too small', 'the anchors are full', 'pids are reused'], answer: 0, why: 'A shared frame would need several owners; systems add extra mechanisms for it.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
