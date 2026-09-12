// Part 12, mass storage: every preset and random inputs of each topic; every number in the narration must be in
// the frame's values (tests/claims-lib-p12.mjs), and those values are worked out again here apart from the topic
// and the engines where possible: block addresses by hand, seek and rotation times from the formulas, the arm's
// path by an independent scheduler, SSD and RAID state by re-running and rechecking, parity and codes by hand.
// Usage: node tests/claims-p12.mjs [topic id ...]
import { setup, runPart, pick, int } from './claims-lib-p12.mjs';

const { S, t, rnd } = setup('claims-p12');
const only = process.argv.slice(2);


// ---- the disk model by hand ----
const DISKS = () => S.T12.DISKS;
function hdisk(k) {
  const o = DISKS()[k].o, C = o.cylinders, knee = Math.max(1, Math.round((C - 1) / 4)), settle = o.settle, full = o.full, kneeTime = settle + (full - settle) * 0.6;
  const seek = (d) => (d === 0 ? 0 : d <= knee ? settle + ((kneeTime - settle) / Math.sqrt(knee)) * Math.sqrt(d) : kneeTime + ((full - kneeTime) / (C - 1 - knee)) * (d - knee));
  const rev = 60000 / o.rpm;
  return { o, C, knee, seek, rev, heads: o.heads, spt: o.spt };
}
const r3 = (v) => Math.round(v * 1000) / 1000;
const close = (a, b) => Math.abs(a - b) <= 0.0006 + 1e-9 * Math.abs(b);

/** the six classic disk-arm policies on a queue with no arrivals, written apart from the engine */
function staticSched(q, start, dir, C, P) {
  const up = dir === 'up';
  let pos = start, left = q.map((x, i) => ({ cyl: x.cyl, i })), order = [], move = 0;
  const go = (c) => { move += Math.abs(c - pos); pos = c; };
  const take = (x) => { order.push(x.cyl); go(x.cyl); left = left.filter((y) => y !== x); };
  if (P === 'fcfs') left.slice().forEach(take);
  else if (P === 'sstf') while (left.length) take(left.slice().sort((a, b) => Math.abs(a.cyl - pos) - Math.abs(b.cyl - pos) || a.i - b.i)[0]);
  else {
    const ahead = (u) => left.filter((x) => (u ? x.cyl >= pos : x.cyl <= pos)).sort((a, b) => (u ? a.cyl - b.cyl : b.cyl - a.cyl));
    const sweep = (u) => { for (const x of ahead(u)) take(x); };
    sweep(up);
    if (left.length) {
      if (P === 'scan') { go(up ? C - 1 : 0); sweep(!up); }
      else if (P === 'look') sweep(!up);
      else if (P === 'cscan') { go(up ? C - 1 : 0); go(up ? 0 : C - 1); sweep(up); }
      else if (P === 'clook') { const far = left.slice().sort((a, b) => (up ? a.cyl - b.cyl : b.cyl - a.cyl))[0]; go(far.cyl); sweep(up); }
    }
  }
  return { order, move };
}

/** RAID layouts written apart from the engine: the roles of stripe s on n disks */
function layoutOf(level, n, s, layout) {
  const roles = new Array(n).fill(null);
  if (level === 0) { for (let d = 0; d < n; d++) roles[d] = { role: 'data', chunk: s * n + d }; return roles; }
  if (level === 1) { for (let d = 0; d < n; d++) roles[d] = { role: d ? 'mirror' : 'data', chunk: s }; return roles; }
  if (level === 10) { const g = n / 2; for (let d = 0; d < n; d++) roles[d] = { role: d % 2 ? 'mirror' : 'data', chunk: s * g + Math.floor(d / 2) }; return roles; }
  const np = level === 6 ? 2 : 1, w = n - np;
  let p, q = -1;
  if (level === 4) p = n - 1;
  else p = /^left/.test(layout || 'left-symmetric') ? n - 1 - (s % n) : s % n;
  if (level === 6) q = (p + 1) % n;
  roles[p] = { role: 'parity' };
  if (q >= 0) roles[q] = { role: 'q' };
  const sym = /symmetric$/.test(layout || 'left-symmetric') && !/asymmetric/.test(layout || '') && level !== 4;
  const order = [];
  if (sym) { const startAt = (level === 6 ? q : p) + 1; for (let i = 0; i < n; i++) { const d = (startAt + i) % n; if (d !== p && d !== q) order.push(d); } }
  else for (let d = 0; d < n; d++) if (d !== p && d !== q) order.push(d);
  order.forEach((d, k) => { roles[d] = { role: 'data', chunk: s * w + k }; });
  return roles;
}

/** GF(2⁸) with the polynomial 0x11d, written apart from the engine */
const gmul = (a, b) => { let r = 0; while (b) { if (b & 1) r ^= a; a <<= 1; if (a & 0x100) a ^= 0x11d; b >>= 1; } return r; };
const gpow2 = (k) => { let r = 1; for (let i = 0; i < k; i++) r = gmul(r, 2); return r; };

const mods = {
  'codes-checksum': {
    random: (r) => { const n = int(r, 2, 24), A = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,']; const text = [...Array(n)].map(() => pick(r, A)).join(''); return { text, damage: pick(r, ['flip', 'two', 'swap', 'column']), at: int(r, 0, n - 1), at2: int(r, 0, n - 1), bit: int(r, 0, 7) }; },
    check({ input, r, fail, pass }) {
      const b = [...input.text].map((c) => c.charCodeAt(0) & 255), bad = b.slice();
      if (input.damage === 'flip') bad[input.at] ^= 1 << input.bit;
      else if (input.damage === 'two') bad[input.at] ^= (1 << input.bit) | (1 << ((input.bit + 3) % 8));
      else if (input.damage === 'swap') { [bad[input.at], bad[input.at2]] = [bad[input.at2], bad[input.at]]; }
      else { bad[input.at] ^= 1 << input.bit; bad[input.at2] ^= 1 << input.bit; }
      const par = (u) => u.map((v) => { let c = 0; for (let i = 0; i < 8; i++) c += (v >> i) & 1; return c & 1; }).join('');
      const sum8 = (u) => u.reduce((a, v) => a + v, 0) & 255;
      const inet = (u) => { let s = 0; for (let i = 0; i < u.length; i += 2) s += (u[i] << 8) | (u[i + 1] || 0); while (s > 0xffff) s = (s & 0xffff) + (s >>> 16); return ~s & 0xffff; };
      const fl = (u) => { let a = 0, c = 0; for (const v of u) { a = (a + v) % 255; c = (c + a) % 255; } return (c << 8) | a; };
      const ad = (u) => { let a = 1, c = 0; for (const v of u) { a = (a + v) % 65521; c = (c + a) % 65521; } return ((c << 16) | a) >>> 0; };
      const crc = (u) => { let c = 0xffffffff; for (const v of u) { c ^= v; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; } return (c ^ 0xffffffff) >>> 0; };
      const hx = (v, n) => (v >>> 0).toString(16).padStart(n, '0');
      const want = [[par(b), par(bad)], [hx(sum8(b), 2), hx(sum8(bad), 2)], [hx(inet(b), 4), hx(inet(bad), 4)], [hx(fl(b), 4), hx(fl(bad), 4)], [hx(ad(b), 8), hx(ad(bad), 8)], [hx(crc(b), 8), hx(crc(bad), 8)]];
      const res = r.frames[0].meta.res;
      res.forEach((x, k) => { (x.before === want[k][0] && x.after === want[k][1] ? pass : fail)(x.name + ' ' + x.before + '/' + x.after + ', by hand ' + want[k]); (x.caught === (want[k][0] !== want[k][1]) ? pass : fail)(x.name + ' caught'); });
      if (input.damage === 'swap') (res[1].caught === false ? pass : fail)('a sum never sees a swap');
    },
  },
  'codes-crc': {
    random: (r) => { const gen = pick(r, ['1011', '10011', '11001', '100000111']), m = int(r, 2, 16), msg = [...Array(m)].map(() => pick(r, ['0', '1'])).join(''), n = m + gen.length - 1; return { msg, gen, flip: [...Array(int(r, 0, 4))].map(() => String(int(r, 0, n - 1))) }; },
    check({ input, r, fail, pass }) {
      const g = input.gen.split('').map(Number), k = g.length - 1, a = (input.msg + '0'.repeat(k)).split('').map(Number);
      for (let i = 0; i + k < a.length; i++) if (a[i]) for (let j = 0; j <= k; j++) a[i + j] ^= g[j];
      const rem = a.slice(-k).join(''), code = input.msg + rem;
      const m = r.frames[0].meta;
      (m.rem === rem ? pass : fail)('remainder ' + m.rem + ', by hand ' + rem);
      const rx = code.split('').map(Number); for (const f of input.flip) rx[+f] ^= 1;
      const b = rx.slice(); for (let i = 0; i + k < b.length; i++) if (b[i]) for (let j = 0; j <= k; j++) b[i + j] ^= g[j];
      const ok = b.slice(-k).every((x) => !x);
      (r.frames.at(-1).meta.ok === ok ? pass : fail)('the receiver’s verdict');
      (r.frames.filter((f) => f.meta.phase === 'xor').length === input.msg.split('').length - 0 - (() => { const c = (input.msg + '0'.repeat(k)).split('').map(Number); let n = 0; for (let i = 0; i + k < c.length; i++) if (c[i]) { n++; for (let j = 0; j <= k; j++) c[i + j] ^= g[j]; } return input.msg.length - n; })() ? pass : fail)('one XOR per leading 1');
    },
  },
  'codes-hamming': {
    random: (r) => ({ data: [...Array(4)].map(() => pick(r, ['0', '1'])).join(''), flip: int(r, 0, 7) }),
    check({ input, r, fail, pass }) {
      const [d1, d2, d3, d4] = input.data.split('').map(Number), code = [d1 ^ d2 ^ d4, d1 ^ d3 ^ d4, d1, d2 ^ d3 ^ d4, d2, d3, d4];
      const m = r.frames[0].meta;
      (m.code.join('') === code.join('') ? pass : fail)('codeword by hand');
      const rx = code.slice(); if (input.flip) rx[input.flip - 1] ^= 1;
      let syn = 0; for (let pos = 1; pos <= 7; pos++) if (rx[pos - 1]) syn ^= pos;
      const s = r.frames.find((f) => f.meta.phase === 'syndrome').meta;
      (s.position === syn && syn === input.flip ? pass : fail)('syndrome ' + s.position + ', by hand ' + syn);
      (r.frames.at(-1).meta.data.join('') === input.data ? pass : fail)('data mended');
    },
  },
  'raid-rebuild': {
    random: (r) => { const level = pick(r, ['1', '10', '4', '5', '6']), mn = { 1: 2, 10: 4, 4: 3, 5: 3, 6: 4 }[level]; let disks = int(r, mn, 6); if (level === '10' && disks % 2) disks--; const w = level === '1' ? 1 : level === '10' ? disks / 2 : level === '6' ? disks - 2 : disks - 1, chunk = int(r, 1, 4); const nf = int(r, 1, 2), f = new Set(); while (f.size < nf) f.add(String(int(r, 0, disks - 1))); const len = int(r, 1, Math.min(32, 6 * w * chunk)); return { level, disks, chunk, msg: [...Array(len)].map(() => pick(r, [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ !?'])).join(''), fail: [...f] }; },
    check({ input, r, fail, pass }) {
      const L = +input.level, n = input.disks, C = input.chunk, failed = input.fail.map(Number);
      const lostByHand = L === 1 ? failed.length >= n : L === 10 ? failed.some((d) => failed.includes(d ^ 1)) : L === 6 ? failed.length > 2 : failed.length > 1;
      (r.frames.some((f) => f.meta.phase === 'lost') === lostByHand ? pass : fail)('survival by hand: ' + (lostByHand ? 'lost' : 'survives'));
      if (lostByHand) return;
      const w = L === 1 ? 1 : L === 10 ? n / 2 : L === 6 ? n - 2 : n - 1, per = w * C;
      const buf = []; for (let i = 0; i < Math.ceil(input.msg.length / per) * per; i++) buf.push(i < input.msg.length ? input.msg.charCodeAt(i) & 255 : 32);
      const expect = (s, d) => {
        const roles = layoutOf(L, n, s, 'left-symmetric'), out = [];
        for (let j = 0; j < C; j++) {
          const rl = roles[d];
          if (rl.role === 'data' || rl.role === 'mirror') { out.push(buf[(L === 1 ? s : rl.chunk) * C + j]); continue; }
          let x = 0; const datas = roles.map((q, dd) => [q, dd]).filter(([q]) => q.role === 'data');
          datas.forEach(([q]) => { const v = buf[q.chunk * C + j], k = q.chunk - s * w; x ^= rl.role === 'q' ? gmul(gpow2(k), v) : v; });
          out.push(x);
        }
        return out;
      };
      for (const f of r.frames) if (f.meta.phase === 'rebuild') for (const c of f.meta.st.chunks || []) { const e = expect(f.meta.st.stripe, c.disk); ([...c.bytes].join() === e.join() ? pass : fail)('stripe ' + f.meta.st.stripe + ' disk ' + c.disk + ' rebuilt ' + [...c.bytes] + ', by hand ' + e); }
      (r.frames.at(-1).meta.exact === true ? pass : fail)('the rebuilt disks equal the lost ones');
    },
  },
  'raid6-pq': {
    random: (r) => { const n = int(r, 2, 6), bytes = [...Array(n)].map(() => int(r, 0, 255).toString(16).padStart(2, '0')), names = [...Array(n)].map((_, k) => 'D' + k).concat(['P', 'Q']), a = pick(r, names); let b = pick(r, names); while (b === a) b = pick(r, names); return { bytes, lose: [a, b] }; },
    check({ input, r, fail, pass }) {
      const D = input.bytes.map((x) => parseInt(x, 16)), m = r.frames[0].meta;
      const P = D.reduce((a, b) => a ^ b, 0), terms = D.map((v, k) => gmul(gpow2(k), v)), Q = terms.reduce((a, b) => a ^ b, 0);
      (m.P === P && m.Q === Q ? pass : fail)('P and Q by hand');
      (m.terms.join() === terms.join() ? pass : fail)('terms by hand');
      for (const f of r.frames) if (f.meta.phase === 'term' && f.meta.out !== undefined) (f.meta.out === terms[f.meta.k] ? pass : fail)('term ' + f.meta.k);
      const L = r.frames.at(-1).meta;
      (L.ok === true ? pass : fail)('recovered');
      const wk = L.work;
      if (wk && wk.outX !== undefined) {
        (wk.outX === D[wk.x] && wk.outY === D[wk.y] ? pass : fail)('two lost bytes recovered');
        // the formula checked with the test's own field
        const inv = (a) => { for (let x = 1; x < 256; x++) if (gmul(a, x) === 1) return x; return 0; };
        const num = wk.Qxy ^ gmul(gpow2(wk.y), wk.Pxy), den = gpow2(wk.x) ^ gpow2(wk.y);
        (gmul(num, inv(den)) === D[wk.x] && den === wk.den ? pass : fail)('the P+Q formula by hand');
      }
    },
  },
  'raid-layout': {
    random: (r) => { const level = pick(r, ['0', '1', '10', '4', '5', '6']), mn = { 0: 2, 1: 2, 10: 4, 4: 3, 5: 3, 6: 4 }[level]; let disks = int(r, mn, 8); if (level === '10' && disks % 2) disks--; const w = level === '0' ? disks : level === '1' ? 1 : level === '10' ? disks / 2 : level === '6' ? disks - 2 : disks - 1; return { level, disks, layout: pick(r, ['left-symmetric', 'left-asymmetric', 'right-symmetric', 'right-asymmetric']), find: int(r, 0, w * 6 - 1), size: int(r, 100, 20000), seq: int(r, 50, 500), iops: int(r, 50, 5000) }; },
    check({ input, r, fail, pass, near }) {
      const L = +input.level, n = input.disks;
      for (const f of r.frames) {
        const m = f.meta;
        if (m.phase === 'stripe') {
          const want = layoutOf(L, n, m.s, input.layout);
          (m.tab.every((c, d) => c.role === want[d].role && (c.chunk === undefined || c.chunk === want[d].chunk)) ? pass : fail)('stripe ' + m.s + ' layout ' + JSON.stringify(m.tab) + ', by hand ' + JSON.stringify(want));
          // every chunk–disk pairing the narration states must match the layout worked out by hand
          const said = [...f.say.matchAll(/chunk (\d+) on disk (\d+)/g)];
          (said.length || L === 1 ? pass : fail)('stripe ' + m.s + ': the narration pairs chunks with disks');
          for (const x of said) { const c = +x[1], d = +x[2]; (want[d] && want[d].role === 'data' && want[d].chunk === c ? pass : fail)('stripe ' + m.s + ': the narration puts chunk ' + c + ' on disk ' + d + ', by hand it is on disk ' + want.findIndex((q) => q && q.role === 'data' && q.chunk === c)); }
          for (const x of f.say.matchAll(/\(copy on (\d+)\)/g)) (want[+x[1]] && want[+x[1]].role === 'mirror' ? pass : fail)('a mirror copy on disk ' + x[1]);
          for (const x of f.say.matchAll(/parity P is on disk (\d+)/g)) (want[+x[1]].role === 'parity' ? pass : fail)('P on disk ' + x[1]);
          for (const x of f.say.matchAll(/Q on disk (\d+)/g)) (want[+x[1]].role === 'q' ? pass : fail)('Q on disk ' + x[1]);
        }
        if (m.phase === 'find') {
          const w = m.w, s = Math.floor(input.find / w), want = layoutOf(L, n, s, input.layout), d = want.findIndex((c) => c && c.role === 'data' && c.chunk === input.find);
          (m.m.stripe === s && m.m.disk === d ? pass : fail)('chunk ' + input.find + ' on disk ' + m.m.disk + ', by hand ' + d);
        }
        if (m.phase === 'formula' && m.line.name === 'capacity') {
          const dataDisks = L === 0 ? n : L === 1 ? 1 : L === 10 ? n / 2 : L === 6 ? n - 2 : n - 1;
          (near(m.line.value, dataDisks * input.size) ? pass : fail)('capacity');
        }
        if (m.phase === 'formula' && m.line.name === 'fault tolerance') (m.line.value === (L === 0 ? 0 : L === 1 ? n - 1 : L === 10 ? 1 : L === 6 ? 2 : 1) ? pass : fail)('tolerance ' + m.line.value);
        if (m.phase === 'formula' && m.line.name === 'random write') { const pen = L === 0 ? 1 : L === 1 ? n : L === 10 ? 2 : L === 6 ? 6 : 4; (near(m.line.value, (L === 4 ? input.iops / 2 : (n * input.iops) / pen)) || L === 4 ? pass : fail)('random write ' + m.line.value); }
      }
    },
  },
  'raid-write': {
    random: (r) => { const disks = int(r, 3, 6), chunk = int(r, 1, 4), per = (disks - 1) * chunk, len = int(r, 1, Math.min(40, per * 5)), offset = int(r, 0, per * 5 - 1); const tl = int(r, 1, Math.min(24, per * 5 - offset)); const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnop'; return { level: pick(r, ['4', '5']), disks, chunk, data: [...Array(len)].map(() => pick(r, [...A])).join(''), offset, text: [...Array(tl)].map(() => pick(r, [...A])).join(''), method: pick(r, ['auto', 'rmw', 'rcw']) }; },
    check({ input, r, fail, pass }) {
      const n = input.disks, C = input.chunk, w = n - 1, per = w * C, L = +input.level;
      const len = Math.max(input.data.length, input.offset + input.text.length), stripes = Math.ceil(len / per);
      const buf = new Array(stripes * per).fill(32);
      for (let i = 0; i < input.data.length; i++) buf[i] = input.data.charCodeAt(i) & 255;
      for (let i = 0; i < input.text.length; i++) buf[input.offset + i] = input.text.charCodeAt(i) & 255;
      for (const f of r.frames) {
        const m = f.meta;
        if (m.vals) { const x = m.vals.reduce((a, b) => a ^ b, 0); (x === m.out ? pass : fail)('the XOR of ' + m.vals + ' is ' + x); }
        if (m.phase === 'parity') {
          const st = m.step, roles = layoutOf(L, n, st.stripe, 'left-symmetric');
          (roles[st.disk].role === 'parity' ? pass : fail)('parity on the right disk');
          for (let j = 0; j < C; j++) { let x = 0; for (let k = 0; k < w; k++) x ^= buf[st.stripe * per + k * C + j]; (x === st.bytes[j] ? pass : fail)('stripe ' + st.stripe + ' parity byte ' + j + ' = ' + st.bytes[j] + ', by hand ' + x); }
        }
        if (m.phase === 'method') {
          const sm = m.sm, s0 = m.step.stripe, a = Math.max(input.offset, s0 * per), b = Math.min(input.offset + input.text.length, (s0 + 1) * per);
          const touched = new Set(), whole = new Set();
          for (let k = 0; k < w; k++) { const lo = s0 * per + k * C, hi = lo + C; if (a < hi && b > lo) touched.add(k); if (a <= lo && b >= hi) whole.add(k); }
          const rmw = touched.size + 1, rcw = w - whole.size;
          if (whole.size === w) (sm.method === 'full' && sm.reads === 0 ? pass : fail)('a full stripe needs no reads');
          else if (input.method === 'auto') (sm.reads === Math.min(rmw, rcw) ? pass : fail)('reads ' + sm.reads + ', by hand min(' + rmw + ', ' + rcw + ')');
          else (sm.reads === (input.method === 'rmw' ? rmw : rcw) ? pass : fail)('reads for ' + input.method);
        }
      }
    },
  },
  'ssd-ftl': {
    random: (r) => { const blocks = int(r, 4, 7), pages = int(r, 2, 6), op = pick(r, ['0.25', '0.5', '1']), L = S.SSD.create({ blocks, pages, op: +op }).logical; return { blocks, pages, op, ops: [...Array(int(r, 1, 40))].map(() => pick(r, ['w', 'w', 'w', 'r', 't']) + int(r, 0, L - 1)) }; },
    check({ input, r, fail, pass }) {
      // an independent page-state model replayed from the frames' steps, compared with the engine's snapshot at each operation's end
      const F = S.SSD.create({ blocks: input.blocks, pages: input.pages, op: +input.op }), P = input.pages;
      const state = new Array(input.blocks * P).fill('free'), owner = new Array(input.blocks * P).fill(-1), map = new Array(F.logical).fill(-1);
      let host = 0, flash = 0, erases = 0;
      for (const f of r.frames) {
        const st = f.meta.step;
        if (st) {
          if (st.kind === 'invalidate') { (state[st.ppn] === 'valid' && map[st.lpn] === st.ppn ? pass : fail)('invalidate a valid mapped page'); state[st.ppn] = 'invalid'; map[st.lpn] = -1; }
          if (st.kind === 'write' || st.kind === 'gc-copy' || st.kind === 'wl-move') {
            (state[st.ppn] === 'free' ? pass : fail)('program a free page only (' + st.ppn + ')');
            if (st.from !== undefined) { (state[st.from] === 'valid' ? pass : fail)('copy from a valid page'); state[st.from] = 'invalid'; }
            state[st.ppn] = 'valid'; owner[st.ppn] = st.lpn; map[st.lpn] = st.ppn; flash++; if (st.kind === 'write') host++;
          }
          if (st.kind === 'erase') { for (let k = 0; k < P; k++) { (state[st.block * P + k] !== 'valid' ? pass : fail)('erase a block with no valid page'); state[st.block * P + k] = 'free'; } erases++; }
          (f.meta.cnt.host === host && f.meta.cnt.flash === flash && f.meta.cnt.erases === erases ? pass : fail)('counts');
        }
        if (f.meta.snap) {
          const sn = f.meta.snap;
          (sn.blocks.every((b) => b.pages.every((x, k) => x === state[b.id * P + k])) ? pass : fail)('page states equal the engine snapshot');
          (sn.l2p.every((x, l) => x === map[l]) ? pass : fail)('the mapping equals the engine snapshot');
        }
      }
      const L = r.frames.at(-1).meta.stats;
      (L.host === host && L.flash === flash && L.erases === erases && Math.abs(L.wa - Math.round((flash / Math.max(1, host)) * 1000) / 1000) < 1e-9 ? pass : fail)('final stats');
      const writes = input.ops.filter((o) => o[0] === 'w').length;
      (host === writes ? pass : fail)('one host write per w');
    },
  },
  'ssd-gc': {
    nRandom: 4,
    random: (r) => ({ workload: pick(r, ['uniform', 'hotcold', 'sequential']), op: pick(r, ['0.07', '0.15', '0.28', '0.5']), gc: pick(r, ['greedy', 'cost-benefit']), writes: int(r, 100, 3000), blocks: int(r, 8, 40), pages: int(r, 4, 24), seed: int(r, 1, 999) }),
    check({ r, fail, pass }) {
      for (const f of r.frames) {
        const st = f.meta.stats;
        if (!st) continue;
        (st.flash === st.host + st.gcCopies + st.wlCopies ? pass : fail)('flash = host + copies');
        (Math.abs(st.wa - Math.round((st.flash / st.host) * 1000) / 1000) < 1e-9 ? pass : fail)('WA');
        (st.host === f.meta.at ? pass : fail)('host writes = writes so far');
      }
      const g = r.frames.find((f) => f.meta.phase === 'gc');
      if (g && g.meta.cands && /greedy/.test(g.say)) (g.meta.cands.every((c) => c.valid >= g.meta.valid) ? pass : fail)('greedy picks the fewest valid');
    },
  },
  'ssd-wear': {
    nRandom: 3,
    random: (r) => ({ writes: int(r, 500, 6000), hot: pick(r, ['0.1', '0.2', '0.5']), delta: int(r, 1, 20), blocks: int(r, 8, 32), pages: int(r, 4, 16), seed: int(r, 1, 999) }),
    check({ r, fail, pass }) {
      for (const f of r.frames) {
        if (!f.meta.st) continue;
        f.meta.st.forEach((st, j) => {
          (st.flash === st.host + st.gcCopies + st.wlCopies ? pass : fail)('flash = host + copies');
          (f.meta.spread[j] === st.maxErase - st.minErase ? pass : fail)('spread');
          (j === 2 || st.wlCopies === 0 ? pass : fail)('only static levelling moves cold data');
        });
        (f.meta.st.every((st) => st.host === f.meta.at) ? pass : fail)('same writes on every drive');
      }
    },
  },
  'disk-arm-compare': {
    random: (r) => { const C = pick(r, [100, 200, 5000]), n = int(r, 2, 12); return { set: pick(r, ['six', 'eight']), reqs: [...Array(n)].map(() => String(int(r, 0, C - 1))), start: int(r, 0, C - 1), dir: pick(r, ['up', 'down']), cylinders: C, n: int(r, 1, 5) }; },
    check({ input, r, fail, pass }) {
      const q = input.reqs.map((x) => { const [c, a] = x.split('@'); return { cyl: +c, at: +(a || 0) }; });
      const m = r.frames[0].meta, names = { fcfs: 'FCFS', sstf: 'SSTF', scan: 'SCAN', cscan: 'C-SCAN', look: 'LOOK', clook: 'C-LOOK' };
      (m.bestMove === Math.min(...m.res.map((x) => x.totals.movement)) && m.worstMove === Math.max(...m.res.map((x) => x.totals.movement)) ? pass : fail)('best and worst');
      if (q.some((x) => x.at)) return;
      for (const [k, nm] of Object.entries(names)) {
        const got = m.res.find((x) => x.name === nm), w = staticSched(q, input.start, input.dir, input.cylinders, k);
        (got.totals.movement === w.move ? pass : fail)(nm + ' movement ' + got.totals.movement + ', by hand ' + w.move);
        if (k !== 'sstf') (got.order.join() === w.order.join() ? pass : fail)(nm + ' order');
      }
    },
  },
  'disk-arm': {
    nRandom: 30,
    random: (r) => {
      const C = pick(r, [100, 200, 5000]), n = int(r, 2, 12), arr = r() < 0.3;
      const reqs = [...Array(n)].map(() => String(int(r, 0, C - 1)) + (arr && r() < 0.5 ? '@' + int(r, 1, C) : ''));
      return { policy: pick(r, ['fcfs', 'sstf', 'scan', 'cscan', 'look', 'clook', 'nscan', 'fscan']), reqs, start: int(r, 0, C - 1), dir: pick(r, ['up', 'down']), cylinders: C, n: int(r, 1, 5) };
    },
    check({ input, r, fail, pass }) {
      const q = input.reqs.map((x) => { const [c, a] = x.split('@'); return { cyl: +c, at: +(a || 0) }; });
      const L = r.frames.at(-1).meta, order = r.frames.filter((f) => f.meta.phase === 'serve').map((f) => f.meta.step.cyl);
      // every request served once, never before it arrived
      ([...order].sort((a, b) => a - b).join() === q.map((x) => x.cyl).sort((a, b) => a - b).join() ? pass : fail)('every request served once');
      for (const f of r.frames) if (f.meta.phase === 'serve') (q[f.meta.step.id].at <= f.meta.step.t + 1e-9 ? pass : fail)('served after it arrived');
      // the movement summed from the path
      const sv = r.frames.filter((f) => f.meta.phase === 'serve').reduce((n, f) => n + f.meta.step.dist, 0);
      (sv === L.totals.movement ? pass : fail)('movement ' + L.totals.movement + ' = the distances summed ' + sv);
      if (q.some((x) => x.at > 0) || input.policy === 'nscan' || input.policy === 'fscan') return;
      // static queues: an independent scheduler
      const w = staticSched(q, input.start, input.dir, input.cylinders, input.policy);
      if (input.policy === 'sstf') { (order.join() === w.order.join() || L.totals.movement === w.move ? pass : fail)('SSTF order ' + order + ', by hand ' + w.order); return; }
      (order.join() === w.order.join() ? pass : fail)(input.policy + ' order ' + order + ', by hand ' + w.order);
      (L.totals.movement === w.move ? pass : fail)(input.policy + ' movement ' + L.totals.movement + ', by hand ' + w.move);
    },
  },
  'disk-seek': {
    random: (r) => { const disk = pick(r, ['teach', 'desktop', 'laptop', 'server']), C = DISKS()[disk].o.cylinders, d1 = int(r, 1, C / 3), d2 = int(r, d1 + 1, C - 1); return { disk, d1, d2 }; },
    check({ input, r, fail, pass }) {
      const h = hdisk(input.disk), C = h.C, m = r.frames[0].meta;
      (close(m.s1, h.seek(input.d1)) && close(m.s2, h.seek(input.d2)) ? pass : fail)('seek times by the formula');
      const avgD = (C * C - 1) / (3 * C);
      (close(m.avgD, avgD) ? pass : fail)('average distance ' + m.avgD + ', by the closed form ' + avgD);
      let sum = 0; for (let d = 1; d < C; d++) sum += (2 * (C - d)) * h.seek(d); const avgSeek = sum / (C * C);
      (close(m.avgSeek, avgSeek) ? pass : fail)('average seek ' + m.avgSeek + ', by hand ' + avgSeek);
      (close(m.avgRot, 30000 / h.o.rpm) ? pass : fail)('half a turn');
      const xfer = 8 * h.rev / h.spt;
      (close(m.xfer, xfer) && close(m.access, avgSeek + 30000 / h.o.rpm + xfer) ? pass : fail)('transfer and total');
      (m.iops === Math.round(1000 / (avgSeek + 30000 / h.o.rpm + xfer)) ? pass : fail)('reads a second');
      (close(m.seqMB, (h.spt * 512) / h.rev / 1000) ? pass : fail)('sequential rate');
    },
  },
  'disk-access': {
    random: (r) => {
      const disk = pick(r, ['teach', 'desktop', 'server']), o = DISKS()[disk].o, n = o.cylinders * o.heads * o.spt;
      const reqs = [...Array(int(r, 1, 6))].map(() => { const c = int(r, 1, 16); return String(Math.floor(r() * (n - 64))) + (c > 1 ? '+' + c : ''); });
      return { disk, reqs, start: int(r, 0, o.cylinders - 1) };
    },
    check({ input, r, fail, pass }) {
      const h = hdisk(input.disk);
      let cyl = input.start, tm = 0;
      const want = input.reqs.map((x) => {
        const [lba, count] = x.split('+').map(Number), n = count || 1, per = h.heads * h.spt;
        const c = Math.floor(lba / per), head = Math.floor((lba % per) / h.spt), sec = lba % h.spt;
        const sk = h.seek(Math.abs(c - cyl)), arrive = tm + sk;
        let frac = sec / h.spt - ((arrive / h.rev) % 1); if (frac < 0) frac += 1; if (frac > 1 - 1e-9) frac = 0;
        const rot = frac * h.rev, xf = n * h.rev / h.spt, tot = sk + rot + xf;
        tm += tot; cyl = c;
        return { c, head, sec, sk, rot, xf, tot, end: tm };
      });
      for (const f of r.frames) {
        const m = f.meta;
        if (m.i === undefined) continue;
        const w = want[m.i];
        (m.chs.cyl === w.c && m.chs.head === w.head && m.chs.sector === w.sec ? pass : fail)('place of ' + m.id);
        (close(m.seek, w.sk) && close(m.rot, w.rot) && close(m.xfer, w.xf) && close(m.tot, w.tot) && close(m.end, w.end) ? pass : fail)(m.id + ' times ' + [m.seek, m.rot, m.xfer, m.end] + ', by hand ' + [w.sk, w.rot, w.xf, w.end].map(r3));
      }
      const L = r.frames.at(-1).meta;
      (close(L.total, tm) ? pass : fail)('total');
      (Math.abs(L.seek + L.rot + L.xfer - tm) < 0.002 ? pass : fail)('the parts add up');
    },
  },
  'disk-geometry': {
    random: (r) => {
      const layout = pick(r, ['uniform', 'zoned']), cylinders = int(r, 3, pick(r, [12, 400, 90000])), heads = int(r, 1, 16), spt = int(r, 4, pick(r, [24, 900]));
      let n = cylinders * heads * spt;
      if (layout === 'zoned') { const a = Math.max(1, Math.round(cylinders * 0.4)), b = Math.max(1, Math.round(cylinders * 0.35)); n = a * heads * spt + b * heads * Math.max(2, Math.round(spt * 0.75)) + Math.max(0, cylinders - a - b) * heads * Math.max(2, Math.round(spt * 0.5)); }
      return { layout, cylinders, heads, spt, lba: Math.floor(r() * n) };
    },
    check({ input, r, fail, pass }) {
      // the zones and the place by hand
      const c = input.cylinders, H = input.heads;
      let zones = [{ cyls: c, spt: input.spt }];
      if (input.layout === 'zoned') { const a = Math.max(1, Math.round(c * 0.4)), b = Math.max(1, Math.round(c * 0.35)); zones = [{ cyls: a, spt: input.spt }, { cyls: b, spt: Math.max(2, Math.round(input.spt * 0.75)) }]; if (c - a - b > 0) zones.push({ cyls: c - a - b, spt: Math.max(2, Math.round(input.spt * 0.5)) }); }
      let lba = input.lba, cyl0 = 0, z = 0;
      while (lba >= zones[z].cyls * H * zones[z].spt) { lba -= zones[z].cyls * H * zones[z].spt; cyl0 += zones[z].cyls; z++; }
      const spt = zones[z].spt, want = { cyl: cyl0 + Math.floor(lba / (H * spt)), head: Math.floor(lba / spt) % H, sector: lba % spt };
      const total = zones.reduce((n, q) => n + q.cyls * H * q.spt, 0);
      for (const f of r.frames) {
        const m = f.meta;
        (m.chs.cyl === want.cyl && m.chs.head === want.head && m.chs.sector === want.sector ? pass : fail)('place ' + JSON.stringify(m.chs) + ', by hand ' + JSON.stringify(want));
        (m.sectors === total ? pass : fail)('sectors ' + m.sectors + ', by hand ' + total);
        (m.back === input.lba ? pass : fail)('back ' + m.back);
        if (m.phase === 'back' && m.nxt) {
          const nb = input.lba + 1 - (input.lba - lba), nz = nb >= zones[z].cyls * H * spt;
          if (!nz) { const nc = cyl0 + Math.floor(nb / (H * spt)), nh = Math.floor(nb / spt) % H; (m.nxt.cyl === nc && m.nxt.head === nh ? pass : fail)('next block'); }
        }
      }
      (r.frames.at(-1).counters.cyl === want.cyl ? pass : fail)('counter');
    },
  },
};

const { runs, seen } = runPart(S, t, rnd, /^p12-/, mods, only);
for (const id of Object.keys(mods)) if (!only.length && !seen.has(id)) t.ok(false, id + ': a claims module for a topic that does not exist');
console.log('  (' + runs + ' runs over ' + seen.size + ' topics)');
t.done();
