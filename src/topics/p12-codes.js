// Part 12, catching errors: parity bits and checksums on a block, and what each catches when the block is damaged;
// a cyclic redundancy check worked as long division; and Hamming(7,4), which finds and mends one flipped bit.
// Every value comes from the codes engine (src/core/st-g-codes.js).
(function (S) {
  'use strict';
  const T = () => S.T12;
  const R = Math.round;
  const hex = (v, n) => (v >>> 0).toString(16).padStart(n || 2, '0');
  const bin = (v) => v.toString(2).padStart(8, '0');

  const METHODS = [
    { id: 'parity', name: 'a parity bit a byte', of: (C, b) => ({ value: [...b].map((v) => C.parity(bin(v).split('').map(Number), 'even').bit).join(''), show: (v) => v }) },
    { id: 'sum8', name: '8-bit sum', of: (C, b) => { const r = C.sum8(b); return { value: r.value, show: (v) => hex(v), r }; } },
    { id: 'internet', name: 'Internet checksum', of: (C, b) => { const r = C.internet(b); return { value: r.value, show: (v) => hex(v, 4), r }; } },
    { id: 'fletcher16', name: 'Fletcher-16', of: (C, b) => { const r = C.fletcher16(b); return { value: r.value, show: (v) => hex(v, 4), r }; } },
    { id: 'adler32', name: 'Adler-32', of: (C, b) => { const r = C.adler32(b); return { value: r.value, show: (v) => hex(v, 8), r }; } },
    { id: 'crc32', name: 'CRC-32', of: (C, b) => { const v = C.crc32(b); return { value: v, show: (x) => hex(x, 8) }; } },
  ];

  // =================================================================================================================
  S.topic({
    id: 'codes-checksum', family: 'p12-codes', order: 10, title: 'Parity and checksums: what each one catches',
    blurb: 'A disk stores a check value next to each block and recomputes it on every read. A parity bit counts ones; a plain sum adds the bytes; the Internet checksum adds 16-bit words; Fletcher and Adler keep a second sum that remembers the order; a CRC divides by a polynomial. Damage the block in different ways and see which checks notice.',
    inputs: [
      { id: 'text', kind: 'string', spaces: true, label: 'the block', def: 'PAY 0040 TO BOB', min: 2, max: 24 },
      { id: 'damage', kind: 'choice', label: 'damage', def: 'flip', options: [{ value: 'flip', label: 'flip one bit' }, { value: 'two', label: 'flip two bits of one byte' }, { value: 'swap', label: 'swap two bytes' }, { value: 'column', label: 'flip the same bit in two bytes' }] },
      { id: 'at', kind: 'number', label: 'at byte', def: 5, min: 0, max: 23 },
      { id: 'at2', kind: 'number', label: 'second byte (swap, same bit)', def: 7, min: 0, max: 23 },
      { id: 'bit', kind: 'number', label: 'bit (0 = lowest)', def: 2, min: 0, max: 7 },
    ],
    check(inp) { const n = inp.text.length; if (inp.at >= n || inp.at2 >= n) return 'bytes: below ' + n; if ((inp.damage === 'swap' || inp.damage === 'column') && inp.at === inp.at2) return 'the second byte must differ from the first'; if (inp.damage === 'swap' && inp.text[inp.at] === inp.text[inp.at2]) return 'swap: those two bytes are equal, so swapping them changes nothing'; return null; },
    presets: [
      { label: 'One flipped bit', values: { text: 'PAY 0040 TO BOB', damage: 'flip', at: 5, bit: 2 } },
      { label: 'Two flips in one byte', values: { text: 'PAY 0040 TO BOB', damage: 'two', at: 5, bit: 2 } },
      { label: 'Two bytes swapped', values: { text: 'PAY 0040 TO BOB', damage: 'swap', at: 5, at2: 6 } },
      { label: 'The same bit in two bytes', values: { text: 'PAY 0040 TO BOB', damage: 'column', at: 1, at2: 9, bit: 4 } },
      { label: 'A longer block', values: { text: 'SECTOR 7741 OF THE LOG', damage: 'swap', at: 7, at2: 10 } },
    ],
    counters: [{ id: 'caught', label: 'checks that caught it' }],
    run(inp) {
      const t = T(), C = S.Codes, b = C.bytes(inp.text), n = b.length;
      const bad = Uint8Array.from(b);
      let what;
      if (inp.damage === 'flip') { bad[inp.at] ^= 1 << inp.bit; what = `bit ${inp.bit} of byte ${inp.at} flips`; }
      else if (inp.damage === 'two') { const b2 = (inp.bit + 3) % 8; bad[inp.at] ^= (1 << inp.bit) | (1 << b2); what = `bits ${Math.min(inp.bit, b2)} and ${Math.max(inp.bit, b2)} of byte ${inp.at} flip`; }
      else if (inp.damage === 'swap') { const x = bad[inp.at]; bad[inp.at] = bad[inp.at2]; bad[inp.at2] = x; what = `bytes ${inp.at} and ${inp.at2} change places`; }
      else { bad[inp.at] ^= 1 << inp.bit; bad[inp.at2] ^= 1 << inp.bit; what = `bit ${inp.bit} flips in bytes ${inp.at} and ${inp.at2}`; }
      const changed = [...b.keys()].filter((i) => b[i] !== bad[i]);
      const res = METHODS.map((m) => { const a = m.of(C, b), z = m.of(C, bad); return { id: m.id, name: m.name, before: a.show(a.value), after: z.show(z.value), caught: a.value !== z.value, r: a.r }; });
      const F = new S.Frames(['caught']);
      const cw = Math.min(46, Math.floor(760 / n)), X0 = 20;
      const strip = (u, y, hot, key) => S.Kit.disk.bytes({ prefix: key, x: X0, y, cw, ch: 40, size: 13, cells: [...u].map((v, i) => ({ text: S.T12.ch(v), sub: hex(v), cls: hot.includes(i) ? 'act' : '' })) }).items;
      const idx = [...b.keys()].map((i) => t.text('cs:i' + i, X0 + i * cw + cw / 2, 14, String(i), 'tick', 12, 'middle'));
      const TY = 150;
      const table = (k, withAfter) => {
        const its = [t.text('cs:h0', X0, TY, 'check', 'tick', 13), t.text('cs:h1', X0 + 330, TY, 'stored', 'tick', 13, 'end')];
        if (withAfter) its.push(t.text('cs:h2', X0 + 520, TY, 'on reading', 'tick', 13, 'end'), t.text('cs:h3', X0 + 560, TY, 'caught?', 'tick', 13));
        res.slice(0, k).forEach((x, i) => {
          const y = TY + 28 + i * 28;
          its.push(t.text('cs:n' + i, X0, y, x.name, 'strong' + (i === k - 1 && !withAfter ? ' act-t' : ''), 14));
          its.push(t.text('cs:b' + i, X0 + 330, y, x.before, 'calc', 13, 'end'));
          if (withAfter) { its.push(t.text('cs:a' + i, X0 + 520, y, x.after, 'calc' + (x.caught ? ' act' : ''), 13, 'end'), t.text('cs:c' + i, X0 + 560, y, x.caught ? 'yes' : 'no', x.caught ? 'good' : 'bad', 14)); }
        });
        return its;
      };
      const base = { n, hexes: [...b].map((v) => hex(v)), res, mods: [255, 65521, 33, 8] };
      F.add({ items: [...idx, ...strip(b, 24, [], 'cs:s')], say: `The block is ${t.plural(n, 'byte')}: “${inp.text}”. Before it is written, the disk computes check values over it and stores them alongside.`, meta: Object.assign({ phase: 'block' }, base) });
      const says = {
        parity: () => `A parity bit for each byte makes its count of ones even: ${res[0].before}, one bit a byte. One flipped bit changes a count; two flips in the same byte do not.`,
        sum8: () => `Add the bytes: ${res[1].r.sum}; kept to 8 bits that is ${res[1].r.value}, ${res[1].before} in hex. A sum does not care about order.`,
        internet: () => `The Internet checksum adds the block as ${t.plural(res[2].r.words.length, '16-bit word')}, folds any carry back in, and complements the result: ${res[2].before}.`,
        fletcher16: () => `Fletcher-16 keeps two running sums mod 255: A = ${res[3].r.a} adds the bytes, B = ${res[3].r.b} adds up the values of A, so a byte early in the block counts more often than one late. Together: ${res[3].before}.`,
        adler32: () => `Adler-32 does the same mod 65521, with A starting at 1: A = ${res[4].r.a}, B = ${res[4].r.b}, giving ${res[4].before}.`,
        crc32: () => `CRC-32 treats the block as one long binary number and keeps the remainder of dividing it by a fixed 33-bit polynomial: ${res[5].before}.`,
      };
      METHODS.forEach((m, k) => F.add({ items: [...idx, ...strip(b, 24, [], 'cs:s'), ...table(k + 1, false)], title: m.name, say: says[m.id](), meta: Object.assign({ phase: 'method', k, r: res[k].r, words: res[k].r && res[k].r.words ? res[k].r.words.length : null }, base) }));
      F.add({ items: [...idx, ...strip(bad, 24, changed, 'cs:s'), t.text('cs:dm', X0, 104, 'damaged: ' + what, 'bad', 14), ...table(METHODS.length, false)], title: 'damage', say: `Now the block is damaged on the disk: ${what}. It reads back as “${[...bad].map(S.T12.ch).join('')}”.`, meta: Object.assign({ phase: 'damage', changed, at: inp.at, at2: inp.at2, bit: inp.bit, bit2: (inp.bit + 3) % 8 }, base) });
      const caught = res.filter((x) => x.caught), missed = res.filter((x) => !x.caught), SN = { parity: 'the parity bits', sum8: 'the 8-bit sum', internet: 'the Internet checksum', fletcher16: 'Fletcher-16', adler32: 'Adler-32', crc32: 'CRC-32' };
      F.set('caught', caught.length);
      F.add({ items: [...idx, ...strip(bad, 24, changed, 'cs:s'), t.text('cs:dm', X0, 104, 'damaged: ' + what, 'bad', 14), ...table(METHODS.length, true)], title: 'checked', say: `On reading, every check is computed again and compared. ${caught.length ? t.cap(t.list(caught.map((x) => SN[x.id]))) + (caught.length === 1 && caught[0].id !== 'parity' ? ' notices' : ' notice') + ' the damage' : 'None notices the damage'}${missed.length ? '; ' + t.list(missed.map((x) => SN[x.id])) + ' ' + (missed.length === 1 ? 'gives' : 'give') + ' the same value as before and ' + (missed.length === 1 ? 'misses' : 'miss') + ' it' : ''}.`, meta: Object.assign({ phase: 'checked', nCaught: caught.length }, base) });
      return { frames: F.list, def: { sections: [{ id: 'm', kind: 'math', title: 'Checks', text: ['parity bit: ones count made even', 'sum: Σ bytes mod 256 (order does not matter)', 'Internet: Σ 16-bit words, carries folded, complemented', 'Fletcher: A = Σ bytes, B = Σ A (mod 255)', 'Adler: the same mod 65521, A from 1', 'CRC: remainder of dividing by a polynomial over GF(2)'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'damage', pick: 'option', ask: 'Will the 8-bit sum notice this damage?', options: ['yes', 'no'], answer: (fr) => (fr[fr.length - 1].meta.res[1].caught ? 'yes' : 'no'), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'Which change can a plain sum of the bytes never detect?', options: ['two bytes swapped', 'one bit flipped', 'a byte set to zero', 'a byte doubled'], answer: 0, why: 'Addition does not depend on order.' },
      { q: 'One parity bit per byte misses…', options: ['two flipped bits in the same byte', 'one flipped bit', 'any change', 'nothing'], answer: 0, why: 'Two flips leave the count of ones even again.' },
      { q: 'Fletcher’s second sum B catches swapped bytes because…', options: ['each byte is added into B a number of times that depends on its place', 'it is larger', 'it uses XOR', 'it is stored twice'], answer: 0, why: 'B is the sum of the running sums, so position matters.' },
      { q: 'A checksum mismatch on a read tells the disk…', options: ['that the block is damaged, not how to repair it', 'which bit to flip back', 'which sector to use instead', 'nothing'], answer: 0, why: 'Detection codes only detect; correcting needs more redundancy, such as a Hamming code or RAID.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
