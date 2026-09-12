// Part 12, RAID (3): a disk fails, reads go on in degraded mode, and the disk is rebuilt stripe by stripe from the
// others (a mirror copied, XOR of the rest, or P and Q for two losses); and RAID 6's second parity worked out in
// GF(2⁸), with two lost chunks solved from P and Q. Everything comes from src/core/st-a-raid.js and st-b-gf.js.
(function (S) {
  'use strict';
  const T = () => S.T12;
  const R = Math.round;
  const minDisks = { 1: 2, 10: 4, 4: 3, 5: 3, 6: 4 };

  S.topic({
    id: 'raid-rebuild', family: 'p12-raid', order: 30, title: 'A disk fails: degraded reads and the rebuild',
    blurb: 'When a disk dies the array keeps answering: a lost chunk is read from its mirror, or worked out as the XOR of the rest of its stripe. A new disk is then filled stripe by stripe from the survivors. RAID 6 survives two failures by solving for two unknowns from P and Q; one failure too many and the data is gone.',
    inputs: [
      { id: 'level', kind: 'choice', label: 'level', def: '5', options: [{ value: '1', label: 'RAID 1' }, { value: '10', label: 'RAID 1+0' }, { value: '4', label: 'RAID 4' }, { value: '5', label: 'RAID 5' }, { value: '6', label: 'RAID 6' }] },
      { id: 'disks', kind: 'number', label: 'disks', def: 4, min: 2, max: 6 },
      { id: 'chunk', kind: 'number', label: 'chunk (bytes)', def: 2, min: 1, max: 4 },
      { id: 'msg', kind: 'string', spaces: true, label: 'message', def: 'MEET AT THE OLD MILL', min: 1, max: 32 },
      { id: 'fail', kind: 'list', label: 'disks that fail', def: ['2'], min: 1, max: 2, check: (v, inp) => (v.every((x) => /^\d+$/.test(x) && +x < inp.disks) && new Set(v).size === v.length ? null : 'disks that fail: different disk numbers below ' + inp.disks) },
    ],
    check(inp) {
      const L = +inp.level;
      if (inp.disks < minDisks[L]) return 'disks: RAID ' + (L === 10 ? '1+0' : L) + ' needs at least ' + minDisks[L];
      if (L === 10 && inp.disks % 2) return 'disks: RAID 1+0 needs an even number';
      const w = L === 1 ? 1 : L === 10 ? inp.disks / 2 : L === 6 ? inp.disks - 2 : inp.disks - 1;
      if (Math.ceil(inp.msg.length / (w * inp.chunk)) > 6) return 'message: at most ' + 6 * w * inp.chunk + ' bytes on this array';
      return null;
    },
    presets: [
      { label: 'RAID 5 loses disk 2', values: { level: '5', disks: 4, chunk: 2, msg: 'MEET AT THE OLD MILL', fail: ['2'] } },
      { label: 'RAID 4 loses its parity disk', values: { level: '4', disks: 4, chunk: 2, msg: 'MEET AT THE OLD MILL', fail: ['3'] } },
      { label: 'RAID 1: a mirror', values: { level: '1', disks: 2, chunk: 4, msg: 'KEEP TWO COPIES', fail: ['0'] } },
      { label: 'RAID 1+0 loses one of each pair', values: { level: '10', disks: 4, chunk: 2, msg: 'PAIRS OF DISKS', fail: ['0', '3'] } },
      { label: 'RAID 1+0 loses a whole pair', values: { level: '10', disks: 4, chunk: 2, msg: 'PAIRS OF DISKS', fail: ['0', '1'] } },
      { label: 'RAID 6 loses two disks', values: { level: '6', disks: 5, chunk: 2, msg: 'TWO MAY FAIL AT ONCE', fail: ['1', '3'] } },
      { label: 'RAID 5 loses two disks', values: { level: '5', disks: 4, chunk: 2, msg: 'MEET AT THE OLD MILL', fail: ['0', '2'] } },
    ],
    counters: [{ id: 'rebuilt', label: 'stripes rebuilt' }],
    run(inp) {
      const t = T(), Rd = S.Raid, L = +inp.level, n = inp.disks, C = inp.chunk, failed = inp.fail.map(Number);
      const A0 = Rd.create({ level: L, disks: n, chunk: C, stripes: 1 }), w = Rd.width(A0), per = w * C, stripes = Math.ceil(inp.msg.length / per);
      const A = Rd.create({ level: L, disks: n, chunk: C, stripes });
      const buf = new Uint8Array(stripes * per).fill(32);
      for (let i = 0; i < inp.msg.length; i++) buf[i] = inp.msg.charCodeAt(i) & 255;
      Rd.write(A, 0, buf);
      const full = A.disk.map((u) => u.slice());
      const F = new S.Frames(['rebuilt']);
      const cw = Math.min(118, Math.floor(626 / n) - 6), BY = 30 + stripes * 52 + 34;
      const name = L === 10 ? 'RAID 1+0' : 'RAID ' + L, tol = Rd.tolerance(A);
      const bytesAt = (d, s) => full[d].subarray(s * C, (s + 1) * C);
      const g = (o) => S.T12.byteGrid({ prefix: 'rb:g', x: 10, y: 0, n, rows: stripes, cw, failed: o.failed, cell: (s, d) => (o.failed && o.failed.includes(d) && !(o.rebuilt !== undefined && s <= o.rebuilt) ? { lost: true } : { bytes: bytesAt(d, s), role: Rd.role(A, s, d).role }), cls: (s, d) => (o.failed && o.failed.includes(d) && o.rebuilt !== undefined && s <= o.rebuilt ? 'rd-new' : '') + (o.act && o.act(s, d) ? ' act' : '') + (o.src && o.src(s, d) ? ' src' : '') }).items;
      F.add({ items: g({}), say: `${name} on ${t.plural(n, 'disk')} holds “${inp.msg}” in ${t.plural(stripes, 'stripe')}. It is built to survive ${tol === 1 ? 'any one disk failing' : 'any ' + tol + ' disks failing'}${L === 10 ? ' (and more, if no pair loses both its disks)' : L === 1 && n > 2 ? '' : ''}.`, meta: { phase: 'start', n, stripes, tol, w } });
      failed.forEach((d) => Rd.fail(A, d));
      let readable = true, degraded = null, why = '';
      try { degraded = Rd.read(A, 0, inp.msg.length); } catch (e) { readable = false; why = e.message; }
      const fsay = `Disk${failed.length > 1 ? 's ' + t.list(failed.map(String)) + ' fail' : ' ' + failed[0] + ' fails'}: every chunk on ${failed.length > 1 ? 'them' : 'it'} is lost.`;
      if (!readable) {
        F.add({ items: g({ failed }), title: 'too many', say: `${fsay} That is more than ${name} can bear here (${why}): some stripe has lost more chunks than its redundancy can give back, and the message is gone. Only a backup can help now.`, meta: { phase: 'lost', failed } });
        return { frames: F.list, def: def() };
      }
      const nRb = degraded.steps.filter((s) => s.kind === 'rebuild-read').length;
      F.add({ items: g({ failed }), title: 'failed', say: `${fsay} Reads still work in degraded mode: ${nRb ? `${t.plural(nRb, 'chunk')} of the message ${nRb === 1 ? 'is' : 'are'} worked out on the fly from the other disks` : 'no data chunk of the message was on the lost disk'}, and the array reads back “${String.fromCharCode(...degraded.bytes)}”.`, meta: { phase: 'failed', nRb } });
      const rb = Rd.rebuild(A, failed.length === 1 ? failed[0] : failed);
      rb.steps.forEach((st, k) => {
        const s = st.stripe, from = st.from || [];
        let extra = [], say = st.say;
        const hx = [];
        for (const c of st.chunks || []) hx.push(...[...c.bytes].map(S.T12.hex));
        if (st.how === 'xor' || (st.how === 'p' && L !== 6)) {
          const rows = from.map((d) => ({ label: 'disk ' + d + (Rd.role(A, s, d).role === 'parity' ? ' P' : ' ‘' + S.T12.ch(bytesAt(d, s)[0]) + '’'), v: bytesAt(d, s)[0], cls: Rd.role(A, s, d).role === 'parity' ? 'par' : '' }));
          const bt = S.T12.bitTable('rb:bt', 10, BY, rows, null, 'disk ' + st.disk);
          extra = [t.title('rb:btt', 10, BY - 10, 'stripe ' + s + ', byte 0 rebuilt'), ...bt.items];
          say = `Stripe ${s}: the lost ${st.role === 'parity' ? 'parity' : 'data'} on disk ${st.disk} is the XOR of disks ${t.list(from.map(String))}. Byte 0: ${rows.map((r) => S.T12.hex(r.v)).join(' ⊕ ')} = ${S.T12.hex(bt.xb.out)}; the chunk is ${S.T12.hexes(st.bytes)}.`;
          hx.push(...rows.map((r) => S.T12.hex(r.v)), S.T12.hex(bt.xb.out));
        } else if (st.how !== 'mirror') {
          const what = (st.chunks || []).map((c) => 'disk ' + c.disk + ' (' + (c.role === 'parity' ? 'P' : c.role === 'q' ? 'Q' : 'data chunk ' + c.chunk) + ')');
          const how = { p: 'the data from P, the XOR of the rest, and any lost parity computed again', q: 'the data from Q, since P is lost too, then P computed again', pq: 'both data chunks solved from P and Q together in GF(2⁸)', recompute: 'only parity was lost, so it is computed again from the data', none: 'nothing was lost' }[st.how] || st.how;
          say = `Stripe ${s}: lost ${t.list(what)}; back come ${how}: ${(st.chunks || []).map((c) => S.T12.hexes(c.bytes)).join(' and ')}.`;
        } else if (st.how === 'mirror') say = `Stripe ${s}: disk ${st.disk} gets a copy of the chunk from disk ${from[0]}: ${S.T12.hexes(st.bytes)} (‘${S.T12.chars(st.bytes)}’).`;
        F.set('rebuilt', k + 1);
        F.add({ items: g({ failed, rebuilt: s, act: (s2, d) => s2 === s && failed.includes(d), src: (s2, d) => s2 === s && from.includes(d) }).concat(extra), title: 'stripe ' + s, say, meta: { phase: 'rebuild', st, hx, work: st.work } });
      });
      const exact = failed.every((d) => full[d].every((v, i) => v === A.disk[d][i]));
      const back = Rd.read(A, 0, inp.msg.length);
      F.add({ items: g({ failed, rebuilt: stripes - 1 }), title: 'whole again', say: `The new disk${failed.length > 1 ? 's are' : ' is'} ${exact ? 'equal, byte for byte, to what was lost' : 'different from what was lost'}, and the array reads “${String.fromCharCode(...back.bytes)}” with no help from parity.`, meta: { phase: 'done', exact } });
      return { frames: F.list, def: def() };
      function def() { return { sections: [{ id: 'm', kind: 'math', title: 'Getting a chunk back', text: ['mirror: copy it from the other disk of its pair', 'one lost chunk: the XOR of the rest of the stripe', 'RAID 6, two lost: solve D_x ⊕ D_y = P′ and g^x D_x ⊕ g^y D_y = Q′', 'more lost than the redundancy: the data is gone'].join('\n') }] }; }
    },
    predict: [
      { at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'Will the array survive these failures?', options: ['yes', 'no: the data is lost'], answer: (fr) => (fr.some((f) => f.meta.phase === 'lost') ? 'no: the data is lost' : 'yes'), explain: (fr) => fr[1].say },
    ],
    quiz: [
      { q: 'In RAID 5, the lost chunk of a stripe is…', options: ['the XOR of every other chunk of the stripe, parity included', 'the parity alone', 'copied from the next stripe', 'unrecoverable'], answer: 0, why: 'XORing all the survivors cancels everything but the missing chunk.' },
      { q: 'During a rebuild, why is a RAID 5 array at risk?', options: ['a second failure before it finishes loses data', 'reads are impossible', 'the parity is wrong', 'writes are forbidden'], answer: 0, why: 'Until the new disk is full the array has no redundancy left.' },
      { q: 'Four disks in RAID 1+0 lose disks 0 and 1, which mirror each other. The result?', options: ['the chunks of that pair are lost', 'nothing is lost', 'only parity is lost', 'the array rebuilds from parity'], answer: 0, why: 'Both copies of those chunks were on the failed pair.' },
      { q: 'Reading a lost chunk in degraded RAID 5 costs…', options: ['a read of every surviving disk in its stripe', 'one read', 'nothing', 'a full rebuild first'], answer: 0, why: 'Every other chunk of the stripe is needed for the XOR.' },
    ],
  });

  // =================================================================================================================
  const GFX = /^[0-9a-fA-F]{1,2}$/;
  S.topic({
    id: 'raid6-pq', family: 'p12-raid', order: 40, title: 'RAID 6: the second parity in GF(2⁸)',
    blurb: 'XOR parity can give back one lost chunk, not two: with two unknowns one equation is not enough. RAID 6 adds Q, where each chunk is first multiplied by its own power of g = 2 in the field GF(2⁸) (multiplying shifts the bits left and folds a carry back in with 0x1d). P and Q are two independent equations, so any two lost chunks can be solved.',
    inputs: [
      { id: 'bytes', kind: 'list', label: 'data bytes D0, D1 … (hex)', def: ['53', '4f', '53', '21'], min: 2, max: 6, check: (v) => (v.every((x) => GFX.test(x)) ? null : 'data bytes: hex bytes such as 4f') },
      { id: 'lose', kind: 'list', label: 'lose (two of D0 … and P, Q)', def: ['D1', 'D3'], min: 2, max: 2, check: (v, inp) => { const ok = (x) => x === 'P' || x === 'Q' || (/^D\d$/.test(x) && +x.slice(1) < inp.bytes.length); return v.every(ok) && v[0] !== v[1] ? null : 'lose: two different names among D0 … D' + (inp.bytes.length - 1) + ', P and Q'; } },
    ],
    presets: [
      { label: 'Lose two data bytes', values: { bytes: ['53', '4f', '53', '21'], lose: ['D1', 'D3'] } },
      { label: 'Lose a data byte and P', values: { bytes: ['53', '4f', '53', '21'], lose: ['D2', 'P'] } },
      { label: 'Six bytes, lose the first and last', values: { bytes: ['48', '65', '6c', '6c', '6f', '21'], lose: ['D0', 'D5'] } },
      { label: 'Carries in every product', values: { bytes: ['ff', 'c3', '9a', '81'], lose: ['D0', 'D2'] } },
      { label: 'Lose P and Q: just recompute', values: { bytes: ['10', '20', '30'], lose: ['P', 'Q'] } },
    ],
    counters: [{ id: 'terms', label: 'terms of Q' }],
    run(inp) {
      const t = T(), G = S.GF, D = inp.bytes.map((x) => parseInt(x, 16)), w = D.length, hx = S.T12.hex;
      const chunks = D.map((v) => Uint8Array.from([v])), pq = G.pq(chunks, 1), P = pq.p[0], Q = pq.q[0];
      const F = new S.Frames(['terms']);
      const terms = D.map((v, k) => G.mul(G.gpow(k), v));
      const CX = 20, TX = 330;
      const col = (opts) => {
        const its = [t.title('q6:ct', CX, 14, 'the stripe')];
        const rows = D.map((v, k) => ({ id: 'd' + k, label: 'D' + k, value: hx(v) + '  ' + bits8(v), cls: (opts.lost || []).includes('D' + k) ? 'bad' : (opts.back || []).includes('D' + k) ? 'new' : opts.act === 'D' + k ? 'act' : '' }));
        if (opts.p) rows.push({ id: 'p', label: 'P', value: hx(P) + '  ' + bits8(P), cls: (opts.lost || []).includes('P') ? 'bad' : opts.act === 'P' ? 'act' : 'new' });
        if (opts.q) rows.push({ id: 'q', label: 'Q', value: hx(Q) + '  ' + bits8(Q), cls: (opts.lost || []).includes('Q') ? 'bad' : opts.act === 'Q' ? 'act' : 'new' });
        its.push(...S.Kit.disk.slots({ prefix: 'q6:s', x: CX, y: 26, w: 250, labelW: 50, rh: 34, rows }).items);
        return its;
      };
      const bits8 = (v) => v.toString(2).padStart(8, '0');
      const sup = (k) => String(k).split('').map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c]).join('');
      const base = { D, P, Q, w, hexD: D.map(hx), hexP: hx(P), hexQ: hx(Q), terms, hexT: terms.map(hx), g: 2, poly: 0x11d };
      F.add({ items: col({}), say: `${t.plural(w, 'data byte')}, one from each data disk of a stripe: ${D.map(hx).join(', ')} (hex). RAID 6 adds two more disks to the stripe, P and Q.`, meta: Object.assign({ phase: 'start' }, base) });
      {
        const bt = S.T12.bitTable('q6:bt', TX, 40, D.map((v, k) => ({ label: 'D' + k, v })), null, 'P');
        F.add({ items: col({ p: true, act: 'P' }).concat([t.title('q6:bt0', TX, 14, 'P: the plain XOR'), ...bt.items]), title: 'P', say: `P is the XOR of the data, as in RAID 5: ${D.map(hx).join(' ⊕ ')} = ${hx(P)}. Lose any one data byte and P gives it back; lose two and P only tells you their XOR.`, meta: Object.assign({ phase: 'P' }, base) });
      }
      D.forEach((v, k) => {
        F.set('terms', k + 1);
        const gk = G.gpow(k);
        if (k === 0) { F.add({ items: col({ p: true, act: 'D0' }).concat([t.text('q6:mt', TX, 14, 'g⁰ · D0', 'strong', 14), t.text('q6:m0', TX, 50, `g⁰ = 1, so the term is D0 itself: ${hx(v)}`, 'calc', 14)]), title: 'term 0', say: `Q weighs each byte by a power of g = 2 in GF(2⁸). The first weight is g⁰ = 1, so the first term is D0 itself: ${hx(v)}.`, meta: Object.assign({ phase: 'term', k, gk, term: terms[k] }, base) }); return; }
        const mb = G.mulBits(v, gk), its = [t.text('q6:mt', TX, 14, `g${sup(k)} · D${k} = ${hx(gk)} · ${hx(v)}, bit by bit`, 'strong', 14)];
        its.push(t.text('q6:h0', TX, 42, 'bit i', 'tick', 13), t.text('q6:h1', TX + 70, 42, 'of ' + hx(gk), 'tick', 13), t.text('q6:h2', TX + 140, 42, 'D' + k + ' · 2ⁱ', 'tick', 13), t.text('q6:h3', TX + 270, 42, 'sum', 'tick', 13));
        mb.rows.forEach((r, i) => {
          const y = 66 + i * 24, on = r.bit === 1;
          its.push(t.text('q6:r0' + i, TX + 14, y, String(r.i), 'calc muted', 13, 'middle'), t.text('q6:r1' + i, TX + 90, y, String(r.bit), 'calc' + (on ? ' act' : ' muted'), 13, 'middle'), t.text('q6:r2' + i, TX + 140, y, hx(r.term) + (i && mb.rows[i - 1].carry ? ' ↺' : ''), 'calc' + (on ? '' : ' muted'), 13), t.text('q6:r3' + i, TX + 270, y, hx(r.acc), 'calc' + (on ? ' act' : ' muted'), 13));
        });
        its.push(t.text('q6:res', TX + 270, 66 + 8 * 24 + 8, '= ' + hx(mb.out), 'calc good', 14), t.text('q6:note', TX, 66 + 8 * 24 + 36, 'a ↺ marks a doubling that carried out of the top byte, so 1d was XORed in', 'tick', 13));
        F.add({ items: col({ p: true, act: 'D' + k }).concat(its), title: 'term ' + k, say: `Term ${k}: g^${k} = ${hx(gk)}, times D${k} = ${hx(v)}. Doubling D${k} once per row (folding in 1d when a bit carries out) and adding the rows where ${hx(gk)} has a 1 bit gives ${hx(mb.out)}.`, meta: Object.assign({ phase: 'term', k, gk, term: terms[k], hexGk: hx(gk), out: mb.out, hexOut: hx(mb.out) }, base) });
      });
      {
        const bt = S.T12.bitTable('q6:bt', TX, 40, terms.map((v, k) => ({ label: 'g^' + k + '·D' + k, v })), null, 'Q');
        F.add({ items: col({ p: true, q: true, act: 'Q' }).concat([t.title('q6:bt0', TX, 14, 'Q: the XOR of the weighted bytes'), ...bt.items]), title: 'Q', say: `Q is the XOR of the weighted terms: ${terms.map(hx).join(' ⊕ ')} = ${hx(Q)}. Because each byte has its own weight, Q tells the data bytes apart where P cannot.`, meta: Object.assign({ phase: 'Q' }, base) });
      }
      const lost = inp.lose, data = chunks.map((c, k) => (lost.includes('D' + k) ? null : c));
      const rec = G.recover({ data, p: lost.includes('P') ? null : pq.p, q: lost.includes('Q') ? null : pq.q, len: 1 });
      F.add({ items: col({ p: true, q: true, lost }), title: 'two lost', say: `Now ${lost[0]} and ${lost[1]} are lost. ${rec.how === 'pq' ? 'Two unknowns, and P and Q give two equations.' : rec.how === 'q' ? 'P is gone too, so the data byte must come from Q.' : rec.how === 'recompute' ? 'Only parity is gone: compute it again from the data.' : 'P alone is enough here.'}`, meta: Object.assign({ phase: 'lose', how: rec.how }, base) });
      const wk = rec.work || {}, lines = [];
      if (rec.how === 'pq') {
        lines.push(`P′ = P ⊕ the other data = ${hx(wk.Pxy)}`, `Q′ = Q ⊕ the other terms = ${hx(wk.Qxy)}`, `D${wk.x} = (Q′ ⊕ g${sup(wk.y)}·P′) / (g${sup(wk.x)} ⊕ g${sup(wk.y)})`, `   = (${hx(wk.Qxy)} ⊕ ${hx(wk.gy)}·${hx(wk.Pxy)}) / ${hx(wk.den)} = ${hx(wk.outX)}`, `D${wk.y} = P′ ⊕ D${wk.x} = ${hx(wk.outY)}`);
      } else if (rec.how === 'q') lines.push(`D${wk.x} = (Q ⊕ the other terms) · g⁻${sup(wk.x)}`, `   = (${hx(wk.Q)} ⊕ ${hx(wk.sum)}) · ${hx(wk.ginv)} = ${hx(wk.out)}`, 'P is computed again from the data');
      else lines.push('every data byte survived', 'P and Q are computed again');
      const solvedSay = (rc, k) => {
        if (rc.how === 'pq') return `${rc.lost[0]} and ${rc.lost[1]} are lost. Remove the surviving data from P and from Q: P′ = ${hx(k.Pxy)}, Q′ = ${hx(k.Qxy)}. Then D${k.x} = (Q′ ⊕ g^${k.y}·P′) / (g^${k.x} ⊕ g^${k.y}) = (${hx(k.Qxy)} ⊕ ${hx(k.gy)}·${hx(k.Pxy)}) / ${hx(k.den)} = ${hx(k.outX)}, and D${k.y} = P′ ⊕ D${k.x} = ${hx(k.outY)}.`;
        if (rc.how === 'q') return `With P lost too, D${k.x} comes from Q alone: take the other terms out of Q (${hx(k.Q)} ⊕ ${hx(k.sum)}) and divide by g^${k.x}, which is multiplying by ${hx(k.ginv)}: D${k.x} = ${hx(k.out)}. P is then computed again.`;
        if (rc.how === 'p') return `The lost data byte is the XOR of P and the surviving data, ${hx(rc.data[rc.lost.map((x) => +x.slice(1)).find((x) => !isNaN(x))][0])}; Q is then computed again.`;
        return 'No data byte was lost: P and Q are simply computed again from the data.';
      };
      const ok = rec.data.every((c, k) => c[0] === D[k]) && rec.p[0] === P && rec.q[0] === Q;
      const its = [t.title('q6:rt', TX, 14, 'solving'), ...lines.map((l, i) => t.text('q6:l' + i, TX, 46 + i * 28, l, 'calc' + (i === lines.length - 1 ? ' good' : ''), 14))];
      F.add({ items: col({ p: true, q: true, back: lost }).concat(its), title: 'solved', say: solvedSay(rec, wk) + (ok ? ' Every byte is back, equal to the original.' : ' The bytes differ from the original.'), meta: Object.assign({ phase: 'solved', work: wk, hexW: Object.values(wk).filter((v) => typeof v === 'number').map(hx), ok }, base) });
      return { frames: F.list, def: { sections: [{ id: 'm', kind: 'math', title: 'P and Q', text: ['P = D₀ ⊕ D₁ ⊕ … ⊕ D_w−1', 'Q = g⁰·D₀ ⊕ g¹·D₁ ⊕ … ⊕ g^(w−1)·D_w−1', 'in GF(2⁸): + is XOR; · is shift-and-XOR mod 0x11d', 'two lost data bytes x < y:', 'D_x = (Q′ ⊕ g^y·P′) / (g^x ⊕ g^y),  D_y = P′ ⊕ D_x'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'lose', pick: 'option', ask: 'Can both lost bytes be recovered?', options: ['yes', 'no'], answer: 'yes', explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'In GF(2⁸), what is 0x57 + 0x83?', options: ['0xd4', '0xda', '0x01', '0x2e'], answer: 0, why: 'Addition is XOR: 0x57 ⊕ 0x83 = 0xd4.' },
      { q: 'Multiplying by g = 2 in RAID 6’s field is…', options: ['a left shift, XORing in 0x1d if a bit falls off the top', 'adding 2', 'a right shift', 'XOR with 2'], answer: 0, why: 'x times a polynomial, reduced modulo x⁸ + x⁴ + x³ + x² + 1.' },
      { q: 'Why is plain XOR parity not enough for two failures?', options: ['it gives only the XOR of the two lost chunks, not each one', 'it is too slow', 'it cannot be stored', 'XOR is not reversible'], answer: 0, why: 'One equation cannot fix two unknowns.' },
      { q: 'Why does each data chunk get a different weight g^k in Q?', options: ['so the equations from P and Q are independent', 'to compress the data', 'to encrypt it', 'to spread wear'], answer: 0, why: 'With equal weights Q would just repeat P.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
