// Part 12, catching errors (2): a CRC as polynomial long division over GF(2), sent and checked with errors
// flipped in; and Hamming(7,4) drawn as three overlapping checks that find and mend one flipped bit.
// Every value comes from the codes engine (src/core/st-g-codes.js).
(function (S) {
  'use strict';
  const T = () => S.T12;
  const R = Math.round;
  const BITS = /^[01]+$/;
  const GENS = [{ value: '1011', label: 'x³ + x + 1 (1011)' }, { value: '10011', label: 'x⁴ + x + 1 (10011)' }, { value: '11001', label: 'x⁴ + x³ + 1 (11001)' }, { value: '100000111', label: 'CRC-8: x⁸ + x² + x + 1' }];

  S.topic({
    id: 'codes-crc', family: 'p12-codes', order: 20, title: 'A CRC as long division',
    blurb: 'Read the message bits as a polynomial, append as many zeros as the generator’s degree, and divide by the generator, XORing it in under every leading 1 (subtraction without borrows). The remainder is the check, and message plus check divides exactly. The receiver divides again: any remainder means damage, and every burst shorter than the check is caught.',
    inputs: [
      { id: 'msg', kind: 'string', label: 'message bits', def: '1011100101', alphabet: '01', min: 2, max: 16 },
      { id: 'gen', kind: 'choice', label: 'generator', def: '10011', options: GENS },
      { id: 'flip', kind: 'list', label: 'bits flipped in transit (0 = first)', def: ['4'], min: 0, max: 6, check: (v) => (v.every((x) => /^\d+$/.test(x)) ? null : 'bits flipped: positions such as 3') },
    ],
    check(inp) { const n = inp.msg.length + inp.gen.length - 1; if (inp.flip.some((x) => +x >= n)) return 'bits flipped: the codeword has positions 0 to ' + (n - 1); return null; },
    presets: [
      { label: 'One bit flipped: caught', values: { msg: '1011100101', gen: '10011', flip: ['4'] } },
      { label: 'Nothing flipped', values: { msg: '1011100101', gen: '10011', flip: [] } },
      { label: 'A burst of three: caught', values: { msg: '1011100101', gen: '10011', flip: ['6', '7', '8'] } },
      { label: 'An error the generator divides: missed', values: { msg: '1011100101', gen: '10011', flip: ['1', '4', '5'] } },
      { label: 'A short generator', values: { msg: '100111010110', gen: '1011', flip: ['7'] } },
      { label: 'CRC-8 on two bytes', values: { msg: '0100100001101001', gen: '100000111', flip: ['0', '15'] } },
    ],
    counters: [{ id: 'xors', label: 'XOR steps' }],
    run(inp) {
      const t = T(), C = S.Codes, g = inp.gen, k = g.length - 1, d = C.crcDivide(inp.msg, g), n = d.codeword.length;
      const rx = d.codeword.split('').map((c, i) => (inp.flip.map(Number).filter((x) => x === i).length % 2 ? (c === '1' ? '0' : '1') : c)).join('');
      const chk = C.crcCheck(rx, g);
      const F = new S.Frames(['xors']);
      const cw = Math.min(30, Math.floor(700 / (n + 4))), X0 = 120, size = 14;
      const bitRow = (key, y, str, o) => {
        const its = [];
        [...str].forEach((c, i) => { if (c === ' ') return; its.push(t.cell(key + ':' + i, X0 + i * cw, y, cw - 2, 24, c, 'dk bit mono ' + (c === '1' ? 'one ' : 'zero ') + (o.cls ? o.cls(i) : ''), size, { rx: 3 })); });
        if (o.label) its.push(t.text(key + ':l', X0 - 12, y + 17, o.label, 'tick', 13, 'end'));
        return its;
      };
      const pos = [...Array(n).keys()].map((i) => t.text('cr:p' + i, X0 + i * cw + cw / 2 - 1, 14, String(i), 'tick', 12, 'middle'));
      const head = (str, label, cls) => bitRow('cr:top', 26, str, { label, cls });
      const WIN = 4, rows = d.rows;
      const div = (upTo, act) => {
        const its = [], from = Math.max(0, upTo - WIN);
        for (let j = from; j < upTo; j++) {
          const r = rows[j], y = 74 + (j - from) * 64;
          its.push(...bitRow('cr:x' + j, y, r.xor.padEnd(n, ' '), { label: '⊕ 1 at ' + r.at, cls: () => (j === act ? 'res' : '') }));
          its.push(...bitRow('cr:a' + j, y + 30, r.after, { label: '=', cls: (i) => (i >= inp.msg.length ? 'par' : '') }));
        }
        return its;
      };
      const msgPad = inp.msg + '0'.repeat(k);
      const base = { n, k, m: inp.msg.length, nr: rows.length, rem: d.remainder, gen: g, flips: inp.flip.map(Number) };
      F.add({ items: [...pos, ...head(msgPad, 'message + zeros', (i) => (i >= inp.msg.length ? 'par' : ''))], say: `The message has ${t.plural(inp.msg.length, 'bit')}; the generator ${g} has degree ${k}, so ${t.plural(k, 'zero')} ${k === 1 ? 'is' : 'are'} appended and the check will be ${t.plural(k, 'bit')} long.`, meta: Object.assign({ phase: 'start' }, base) });
      rows.forEach((r, j) => {
        F.set('xors', j + 1);
        F.add({ items: [...pos, ...head(msgPad, 'message + zeros', (i) => (i >= inp.msg.length ? 'par' : '')), ...div(j + 1, j)], title: 'XOR ' + (j + 1), say: `The leading 1 is at position ${r.at}: XOR the generator in there. ${j === rows.length - 1 ? 'No 1 is left in the message part.' : ''}`.trim(), meta: Object.assign({ phase: 'xor', j, at: r.at }, base) });
      });
      F.add({ items: [...pos, ...head(d.codeword, 'sent', (i) => (i >= inp.msg.length ? 'res' : '')), ...div(rows.length, -1)], title: 'the check', say: `The remainder ${d.remainder} is the check. It replaces the zeros, and ${d.codeword} is sent: it divides by ${g} with no remainder.`, meta: Object.assign({ phase: 'sent', code: d.codeword }, base) });
      const flipped = inp.flip.map(Number).filter((x, i, a) => a.indexOf(x) === i && a.filter((y) => y === x).length % 2).sort((a, b) => a - b);
      F.add({ items: [...pos, ...head(d.codeword, 'sent', (i) => (i >= inp.msg.length ? 'res' : '')), ...bitRow('cr:rx', 74, rx, { label: 'received', cls: (i) => (flipped.includes(i) ? 'col' : '') })], title: 'received', say: flipped.length ? `In transit ${t.plural(flipped.length, 'bit')} flip${flipped.length === 1 ? 's' : ''} (position${flipped.length === 1 ? '' : 's'} ${t.list(flipped.map(String))}); the receiver gets ${rx}.` : `Nothing is damaged in transit: the receiver gets ${rx}.`, meta: Object.assign({ phase: 'rx', rx, flipped, nFlip: flipped.length }, base) });
      const ok = chk.ok;
      F.add({ items: [...pos, ...bitRow('cr:rx', 26, rx, { label: 'received', cls: (i) => (flipped.includes(i) ? 'col' : '') }), t.text('cr:rr', X0, 100, `${rx} divided by ${g} leaves ${chk.remainder}`, 'calc', 14), t.text('cr:ok', X0, 132, ok ? (flipped.length ? 'no remainder: the damage slips through' : 'no remainder: accepted') : 'a remainder: the damage is detected', ok && flipped.length ? 'bad' : 'good', 15)], title: 'checked', say: ok ? (flipped.length ? `Dividing the received bits by ${g} leaves ${chk.remainder}: the error pattern is itself a multiple of the generator, so it slips through. Such patterns are rare; every burst of ${k} or fewer bits is caught.` : `Dividing by ${g} leaves ${chk.remainder}: the block is accepted.`) : `Dividing the received bits by ${g} leaves ${chk.remainder}, not zero: the receiver knows the block is damaged and asks again, or reports a read error.`, meta: Object.assign({ phase: 'check', remRx: chk.remainder, ok }, base) });
      return { frames: F.list, def: { sections: [{ id: 'm', kind: 'math', title: 'CRC', text: ['M(x) · x^k = Q(x) · G(x) + R(x)', 'send T(x) = M(x) · x^k + R(x)   (divisible by G)', 'arithmetic over GF(2): + and − are XOR', 'received T + E: detected unless G divides E', 'every burst of length ≤ k is caught'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'rx', pick: 'option', ask: 'Will the receiver’s division leave a remainder?', options: ['yes: the damage is detected', 'no'], answer: (fr) => (fr[fr.length - 1].meta.ok ? 'no' : 'yes: the damage is detected'), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'A generator of degree 4 gives a check of how many bits?', options: ['4', '5', '3', '8'], answer: 0, why: 'The remainder has degree below 4: four bits.' },
      { q: 'In CRC arithmetic, 1 + 1 is…', options: ['0, with no carry', '2', '10', '1'], answer: 0, why: 'Coefficients are in GF(2): addition is XOR.' },
      { q: 'An error pattern escapes a CRC exactly when…', options: ['it is a multiple of the generator', 'it flips one bit', 'it is in the check bits', 'it is shorter than the check'], answer: 0, why: 'Then the received word still divides by G.' },
      { q: 'Why do disks and networks prefer CRCs to simple sums?', options: ['they catch all short bursts and swapped data, at a low cost in hardware', 'they correct errors', 'they are shorter', 'they need no computation'], answer: 0, why: 'A CRC is cheap shift-and-XOR logic with strong detection.' },
    ],
  });

  // =================================================================================================================
  S.topic({
    id: 'codes-hamming', family: 'p12-codes', order: 30, title: 'Hamming(7,4): find and mend a flipped bit',
    blurb: 'Seven bits carry four data bits and three checks. Check p1 covers positions 1, 3, 5, 7; p2 covers 2, 3, 6, 7; p3 covers 4, 5, 6, 7 — the positions whose binary number has that bit set. After a flip, the checks that fail spell out, in binary, the position of the bad bit. Memory and some disks use codes built this way.',
    inputs: [
      { id: 'data', kind: 'string', label: 'four data bits', def: '1011', alphabet: '01', min: 4, max: 4 },
      { id: 'flip', kind: 'number', label: 'flip position (0 = none)', def: 5, min: 0, max: 7 },
    ],
    presets: [
      { label: 'A data bit flips', values: { data: '1011', flip: 5 } },
      { label: 'A check bit flips', values: { data: '1011', flip: 2 } },
      { label: 'Nothing flips', values: { data: '0110', flip: 0 } },
      { label: 'The last bit', values: { data: '1111', flip: 7 } },
      { label: 'All zeros, bit 3', values: { data: '0000', flip: 3 } },
    ],
    counters: [{ id: 'fails', label: 'checks failing' }],
    run(inp) {
      const t = T(), C = S.Codes, d = inp.data.split('').map(Number), enc = C.hamming74(d), code = enc.code;
      const rx = inp.flip ? C.flip(code, inp.flip - 1) : code.slice(), dec = C.hamming74decode(rx);
      const F = new S.Frames(['fails']);
      const NAMES = ['p1', 'p2', 'd1', 'p3', 'd2', 'd3', 'd4'], COVER = { p1: [1, 3, 5, 7], p2: [2, 3, 6, 7], p3: [4, 5, 6, 7] };
      // three circles: p1 top-left, p2 top-right, p3 bottom; each position sits in the circles that cover it
      const cx = 230, cy = 210, rr = 112, ctr = { p1: [cx - 62, cy - 44], p2: [cx + 62, cy - 44], p3: [cx, cy + 60] };
      const spot = { 1: [cx - 112, cy - 74], 2: [cx + 112, cy - 74], 4: [cx, cy + 128], 3: [cx, cy - 70], 5: [cx - 58, cy + 40], 6: [cx + 58, cy + 40], 7: [cx, cy + 6] };
      const venn = (bits, o) => {
        const its = [];
        for (const p of ['p1', 'p2', 'p3']) {
          const [x, y] = ctr[p], f = o.fail && o.fail.includes(p);
          its.push({ key: 'hm:c' + p, kind: 'ellipse', x, y, rx: rr, ry: rr, cls: 'hm-ring ' + p + (f ? ' fail' : o.lit === p ? ' lit' : ''), audit: 'group' });
          const lp = p === 'p1' ? [x - rr + 6, y - rr + 30] : p === 'p2' ? [x + rr - 6, y - rr + 30] : [x - rr + 2, y + rr - 12];
          its.push(t.text('hm:cl' + p, lp[0], lp[1], 'check ' + p, 'strong' + (f ? ' bad' : ''), 14, p === 'p2' ? 'end' : 'start'));
        }
        for (let pos = 1; pos <= 7; pos++) {
          const [x, y] = spot[pos], v = bits[pos - 1];
          its.push(t.cell('hm:b' + pos, x - 21, y - 16, 42, 32, v, 'dk bit mono ' + (v ? 'one ' : 'zero ') + (/^p/.test(NAMES[pos - 1]) ? 'par ' : '') + (o.hot === pos ? 'col ' : '') + (o.act && o.act.includes(pos) ? 'res' : ''), 16, { rx: 5, audit: 'overlap-ok' }));
          its.push(t.text('hm:n' + pos, x, y + 30, pos + ' ' + NAMES[pos - 1], 'tick', 12, 'middle'));
        }
        return its;
      };
      const RX = 470;
      const side = (lines, act) => lines.map((l, i) => t.text('hm:s' + i, RX, 40 + i * 30, l, 'calc' + (i === act ? ' act' : '') + (l.startsWith('→') ? ' good' : ''), 14));
      const word = (bits, y, label, hot) => [t.text('hm:wl' + y, RX, y, label, 'tick', 13), ...bits.map((v, i) => t.cell('hm:w' + y + '.' + i, RX + i * 36, y + 10, 32, 30, v, 'dk bit mono ' + (v ? 'one ' : 'zero ') + (i === hot - 1 ? 'col' : ''), 15, { rx: 4 }))];
      const P = enc.parity, base = { d, code, P, flip: inp.flip, strs: [code.join(''), rx.join(''), dec.syndrome.join(''), dec.corrected.join(''), dec.data.join('')], positions: [1, 2, 3, 4, 5, 6, 7] };
      const lines0 = [`data d1 d2 d3 d4 = ${inp.data}`];
      F.add({ items: [...venn([0, 0, d[0], 0, d[1], d[2], d[3]], {}), ...side(lines0, 0)], say: `Four data bits, ${inp.data}, go to positions 3, 5, 6 and 7. Positions 1, 2 and 4, the powers of two, will hold the checks.`, meta: Object.assign({ phase: 'data' }, base) });
      const xs = { p1: [3, 5, 7], p2: [3, 6, 7], p3: [5, 6, 7] }, pv = { p1: P.p1, p2: P.p2, p3: P.p3 };
      const lines = lines0.slice();
      ['p1', 'p2', 'p3'].forEach((p, j) => {
        lines.push(`${p} = ${xs[p].map((q) => NAMES[q - 1]).join(' ⊕ ')} = ${pv[p]}`);
        const bits = [0, 0, d[0], 0, d[1], d[2], d[3]]; if (j >= 0) bits[0] = P.p1; if (j >= 1) bits[1] = P.p2; if (j >= 2) bits[3] = P.p3;
        if (j < 1) bits[1] = 0; if (j < 2) bits[3] = 0;
        F.add({ items: [...venn(bits, { lit: p, act: COVER[p] }), ...side(lines, lines.length - 1)], title: p, say: `${p} covers positions ${t.list(COVER[p].map(String))}. It is set so that its circle holds an even number of ones: ${xs[p].map((q) => NAMES[q - 1]).join(' ⊕ ')} = ${pv[p]}.`, meta: Object.assign({ phase: 'check', p, v: pv[p], cover: COVER[p] }, base) });
      });
      F.add({ items: [...venn(code, {}), ...side(lines, -1), ...word(code, 170, 'stored codeword, positions 1 to 7')], title: 'stored', say: `The codeword ${code.join('')} is stored: data in positions 3, 5, 6 and 7, checks in 1, 2 and 4. Every circle now holds an even number of ones.`, meta: Object.assign({ phase: 'stored' }, base) });
      F.add({ items: [...venn(rx, { hot: inp.flip }), ...side(lines, -1), ...word(code, 170, 'stored'), ...word(rx, 240, 'read back', inp.flip)], title: 'read back', say: inp.flip ? `On reading, bit ${inp.flip} (${NAMES[inp.flip - 1]}) has flipped: ${rx.join('')} comes back.` : `Nothing has flipped: ${rx.join('')} comes back.`, meta: Object.assign({ phase: 'rx', rx }, base) });
      const syn = dec.syndrome, fails = ['p1', 'p2', 'p3'].filter((p, i) => syn[2 - i] === 1);
      F.set('fails', fails.length);
      const sLines = [`check p1: ${syn[2] ? 'odd, fails' : 'even'}`, `check p2: ${syn[1] ? 'odd, fails' : 'even'}`, `check p3: ${syn[0] ? 'odd, fails' : 'even'}`, `syndrome p3 p2 p1 = ${syn.join('')} = ${dec.position}`];
      F.add({ items: [...venn(rx, { hot: inp.flip, fail: fails }), ...side(sLines, 3), ...word(rx, 170 + 70, 'read back', inp.flip)], title: 'syndrome', say: dec.position ? `Recount each circle: ${t.list(fails)} ${fails.length === 1 ? 'is' : 'are'} odd. Reading the failures as bits p3 p2 p1 gives ${syn.join('')}, which is ${dec.position}: the one position inside exactly those circles.` : 'Every circle still holds an even number of ones: the syndrome is 000, so no bit flipped.', meta: Object.assign({ phase: 'syndrome', syn, position: dec.position, nf: fails.length }, base) });
      F.add({ items: [...venn(dec.corrected, {}), ...side(sLines.concat([dec.position ? `→ flip bit ${dec.position} back` : '→ nothing to mend', `→ data ${dec.data.join('')}`]), -1), ...word(dec.corrected, 240 + 70, 'mended', dec.position)], title: 'mended', say: dec.position ? `Flipping bit ${dec.position} back gives ${dec.corrected.join('')}, and the data bits are ${dec.data.join('')} again${dec.data.join('') === inp.data ? ', as stored' : ''}.` : `The data bits are ${dec.data.join('')}, as stored.`, meta: Object.assign({ phase: 'mended', corrected: dec.corrected, data: dec.data }, base) });
      return { frames: F.list, def: { sections: [{ id: 'm', kind: 'math', title: 'Hamming(7,4)', text: ['positions 1 2 3 4 5 6 7 = p1 p2 d1 p3 d2 d3 d4', 'p1 covers 1 3 5 7  (bit 0 of the position)', 'p2 covers 2 3 6 7  (bit 1)', 'p3 covers 4 5 6 7  (bit 2)', 'syndrome = failing checks as p3 p2 p1 = the bad position'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'rx', pick: 'option', ask: 'Which checks will fail?', options: ['none', 'p1', 'p2', 'p3', 'p1 and p2', 'p1 and p3', 'p2 and p3', 'all three'], answer: (fr) => { const s = fr.find((f) => f.meta.phase === 'syndrome').meta.syn; const fl = ['p1', 'p2', 'p3'].filter((p, i) => s[2 - i] === 1); return fl.length === 0 ? 'none' : fl.length === 3 ? 'all three' : fl.join(' and '); }, explain: (fr) => fr.find((f) => f.meta.phase === 'syndrome').say },
    ],
    quiz: [
      { q: 'Checks p1 and p3 fail, p2 passes. Which bit flipped?', options: ['5', '3', '6', '2'], answer: 0, why: 'p3 p2 p1 = 101 in binary, which is 5.' },
      { q: 'Why do the check bits sit at positions 1, 2 and 4?', options: ['each is the only position with just its own bit of the position number set', 'they are read first', 'it saves space', 'by convention only'], answer: 0, why: 'So each check bit is covered only by its own check, and the syndrome names any position.' },
      { q: 'Two bits flip. Hamming(7,4) alone will…', options: ['point at a wrong position and “mend” the wrong bit', 'mend both', 'always notice and stop', 'see nothing'], answer: 0, why: 'Its distance is 3: one error is corrected, two are mistaken for a different single error.' },
      { q: 'How many check bits protect 4 data bits here?', options: ['3', '4', '1', '7'], answer: 0, why: 'Three checks name 8 cases: no error, or one of 7 positions.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
