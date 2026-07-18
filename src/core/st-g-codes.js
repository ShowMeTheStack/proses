// Error detection and correction for storage: a parity bit, CRC-32 (and a CRC worked bit by bit as long division),
// checksums, Hamming(7,4), and a bad-block remap table.
//   S.Codes.bytes(text | bytes | [numbers]) -> Uint8Array (text as Latin-1 / ASCII)
//   S.Codes.parity(bits | bytes, 'even'|'odd') -> {ones, bit, say}   bits: a string of 0/1 or an array of 0/1
//   S.Codes.crc32(data) -> unsigned 32-bit CRC (the common reflected CRC-32, polynomial 0x04c11db7, reflected
//       0xedb88320, initial value and final XOR 0xffffffff); crc32("123456789") = 0xcbf43926
//   S.Codes.crc32Bits(data) -> {crc, rows: [{byte, bit, lsb, before, after}], say}  the same CRC one bit at a time:
//       XOR the byte into the low bits, then for each of 8 bits shift right and XOR 0xedb88320 when a 1 falls out
//   S.Codes.crcDivide(message bits, generator bits) -> {remainder, codeword, rows: [{at, before, xor, after}], say}
//       polynomial long division over GF(2): append degree zeros, XOR the generator under each leading 1
//   S.Codes.crcCheck(codeword bits, generator bits) -> {remainder, ok}
//   S.Codes.sum8(data), S.Codes.internet(data) (16-bit ones' complement, as in IP/TCP/UDP), S.Codes.fletcher16(data),
//   S.Codes.adler32(data) -> {value, steps?, say}; S.Codes.internet(...) also gives {words, sum, folds}
//   S.Codes.hamming74(d: 4 bits [d1 d2 d3 d4]) -> {code: [p1 p2 d1 p3 d2 d3 d4], parity: {p1, p2, p3}, say}
//   S.Codes.hamming74decode(code: 7 bits) -> {syndrome, position (0 = no error), corrected, data, say}
//       positions 1..7; p1 covers 1 3 5 7, p2 covers 2 3 6 7, p3 covers 4 5 6 7; the syndrome p3 p2 p1 names the bad bit
//   S.Codes.flip(bits, i) -> a copy with bit i (0-based) flipped
//   S.Codes.remap({sectors, spares}) -> M; S.Codes.markBad(M, lba) -> step; S.Codes.resolve(M, lba) -> {lba, phys,
//       remapped, step}   grown defects: a bad sector is mapped to the next spare at the end of the disk
(function (S) {
  'use strict';
  const K = (S.Codes = S.Codes || {});
  const hex = (v, n) => (v >>> 0).toString(16).padStart(n || 8, '0');
  const bitsOf = (x) => (typeof x === 'string' ? [...x].filter((c) => c === '0' || c === '1').map(Number) : Array.from(x, Number));
  K.bytes = (x) => (x instanceof Uint8Array ? x : typeof x === 'string' ? Uint8Array.from(x, (c) => c.charCodeAt(0) & 255) : Uint8Array.from(x));

  K.parity = function (x, kind) {
    const odd = kind === 'odd';
    let ones = 0;
    if (typeof x === 'string' && /^[01\s]*$/.test(x)) ones = bitsOf(x).reduce((n, b) => n + b, 0);
    else if (Array.isArray(x) && x.every((b) => b === 0 || b === 1)) ones = x.reduce((n, b) => n + b, 0);
    else for (const v of K.bytes(x)) for (let i = 0; i < 8; i++) ones += (v >> i) & 1;
    const bit = odd ? 1 - (ones & 1) : ones & 1;
    return { ones, bit, say: `${ones} one${ones === 1 ? '' : 's'}, so the ${odd ? 'odd' : 'even'} parity bit is ${bit}: with it the count of ones is ${odd ? 'odd' : 'even'}. Any single flipped bit changes that, but two flips cancel.` };
  };

  const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  K.crc32 = function (data) {
    let c = 0xffffffff;
    for (const v of K.bytes(data)) c = TABLE[(c ^ v) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  K.crc32Bits = function (data) {
    const rows = [];
    let c = 0xffffffff;
    K.bytes(data).forEach((v, j) => {
      c = (c ^ v) >>> 0;
      for (let i = 0; i < 8; i++) { const before = c, lsb = c & 1; c = (lsb ? (c >>> 1) ^ 0xedb88320 : c >>> 1) >>> 0; rows.push({ byte: j, bit: i, lsb, before, after: c }); }
    });
    const crc = (c ^ 0xffffffff) >>> 0;
    return { crc, rows, say: `Start from ffffffff; XOR in each byte, then 8 times shift right, XORing edb88320 whenever a 1 falls out; ${rows.length} shifts, and the final XOR with ffffffff gives ${hex(crc)}.` };
  };
  K.crcDivide = function (msg, gen) {
    const m = bitsOf(msg), g = bitsOf(gen), deg = g.length - 1;
    if (g[0] !== 1) throw new Error('the generator must start with a 1');
    const w = m.concat(Array(deg).fill(0)), rows = [];
    for (let i = 0; i + deg < w.length; i++) {
      if (!w[i]) continue;
      const before = w.join('');
      for (let k = 0; k <= deg; k++) w[i + k] ^= g[k];
      rows.push({ at: i, before, xor: ' '.repeat(i) + g.join(''), after: w.join('') });
    }
    const remainder = w.slice(w.length - deg).join(''), codeword = m.join('') + remainder;
    return { remainder, codeword, rows, say: `Append ${deg} zero${deg === 1 ? '' : 's'} to ${m.join('')} and divide by ${g.join('')}, XORing it under each leading 1 (${rows.length} time${rows.length === 1 ? '' : 's'}): the remainder ${remainder} is the check, so ${codeword} is sent.` };
  };
  K.crcCheck = function (code, gen) {
    const w = bitsOf(code), g = bitsOf(gen), deg = g.length - 1;
    for (let i = 0; i + deg < w.length; i++) if (w[i]) for (let k = 0; k <= deg; k++) w[i + k] ^= g[k];
    const remainder = w.slice(w.length - deg).join('');
    return { remainder, ok: !/1/.test(remainder) };
  };

  K.sum8 = function (data) {
    const b = K.bytes(data), sum = b.reduce((s, v) => s + v, 0), value = sum & 0xff;
    return { value, sum, say: `The bytes add up to ${sum}; kept to 8 bits, the checksum is ${value} (0x${hex(value, 2)}). Swapping two bytes goes unnoticed.` };
  };
  K.internet = function (data) {
    const b = K.bytes(data), words = [];
    for (let i = 0; i < b.length; i += 2) words.push((b[i] << 8) | (i + 1 < b.length ? b[i + 1] : 0));
    let sum = words.reduce((s, w) => s + w, 0), folds = 0;
    const raw = sum;
    while (sum > 0xffff) { sum = (sum & 0xffff) + (sum >>> 16); folds++; }
    const value = ~sum & 0xffff;
    return { value, words, sum: raw, folded: sum, folds, say: `Add the ${words.length} 16-bit word${words.length === 1 ? '' : 's'} (${raw.toString(16)}), fold the carries back in (${sum.toString(16).padStart(4, '0')}), and take the ones' complement: ${hex(value, 4)}.` };
  };
  K.fletcher16 = function (data) {
    let a = 0, b = 0;
    const steps = [];
    for (const v of K.bytes(data)) { a = (a + v) % 255; b = (b + a) % 255; steps.push({ v, a, b }); }
    const value = (b << 8) | a;
    return { value, a, b, steps, say: `Two running sums mod 255: A = ${a} (the bytes), B = ${b} (the sum of the A's, so the order counts); the checksum is B·256 + A = ${hex(value, 4)}.` };
  };
  K.adler32 = function (data) {
    let a = 1, b = 0;
    for (const v of K.bytes(data)) { a = (a + v) % 65521; b = (b + a) % 65521; }
    const value = ((b << 16) | a) >>> 0;
    return { value, a, b, say: `A starts at 1 and adds each byte, B adds each A, both mod 65521: A = ${a}, B = ${b}, so the checksum is ${hex(value)}.` };
  };

  K.hamming74 = function (d) {
    const [d1, d2, d3, d4] = bitsOf(d);
    const p1 = d1 ^ d2 ^ d4, p2 = d1 ^ d3 ^ d4, p3 = d2 ^ d3 ^ d4, code = [p1, p2, d1, p3, d2, d3, d4];
    return { code, parity: { p1, p2, p3 }, say: `Data ${d1}${d2}${d3}${d4}: p1 = d1⊕d2⊕d4 = ${p1}, p2 = d1⊕d3⊕d4 = ${p2}, p3 = d2⊕d3⊕d4 = ${p3}, so the codeword in positions 1..7 is ${code.join('')}.` };
  };
  K.hamming74decode = function (c) {
    const b = bitsOf(c), at = (i) => b[i - 1];
    const s1 = at(1) ^ at(3) ^ at(5) ^ at(7), s2 = at(2) ^ at(3) ^ at(6) ^ at(7), s3 = at(4) ^ at(5) ^ at(6) ^ at(7);
    const position = s3 * 4 + s2 * 2 + s1, corrected = b.slice();
    if (position) corrected[position - 1] ^= 1;
    const data = [corrected[2], corrected[4], corrected[5], corrected[6]];
    return { syndrome: [s3, s2, s1], position, corrected, data, say: position ? `The checks give syndrome ${s3}${s2}${s1} = ${position}: bit ${position} was flipped; flipping it back gives ${corrected.join('')} and the data ${data.join('')}.` : `All three checks pass (syndrome 000): no single-bit error, and the data is ${data.join('')}.` };
  };
  K.flip = (bits, i) => { const b = bitsOf(bits); b[i] ^= 1; return b; };

  K.remap = (o) => { const a = Object.assign({ sectors: 1000, spares: 8 }, o || {}); return { sectors: a.sectors, spares: a.spares, map: new Map(), used: 0, bad: [] }; };
  K.markBad = function (M, lba) {
    if (M.map.has(lba)) return { kind: 'remap', lba, phys: M.map.get(lba), say: `Sector ${lba} is already remapped to spare ${M.map.get(lba)}.` };
    if (M.used >= M.spares) return { kind: 'no-spare', lba, say: `Sector ${lba} has gone bad and ${M.spares === 1 ? 'the only spare is' : 'every one of the ' + M.spares + ' spares is'} in use: the disk must report the error.` };
    const phys = M.sectors + M.used++;
    M.map.set(lba, phys); M.bad.push(lba);
    return { kind: 'remap', lba, phys, say: `Sector ${lba} fails its check: the drive maps it to spare sector ${phys}, and every later access to ${lba} goes there (${M.spares - M.used} spare${M.spares - M.used === 1 ? '' : 's'} left).` };
  };
  K.resolve = function (M, lba) {
    const phys = M.map.has(lba) ? M.map.get(lba) : lba;
    return { lba, phys, remapped: phys !== lba, step: { kind: 'resolve', lba, phys, say: phys !== lba ? `Sector ${lba} is in the remap table: the access goes to spare ${phys}, a long seek away.` : `Sector ${lba} is good: it is read in place.` } };
  };
  (S.engines = S.engines || []).push({ name: 'Error detection codes' });
})(globalThis.Proses = globalThis.Proses || {});
