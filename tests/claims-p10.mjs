// Part 10 (main memory): the narration claims check. Every topic with its default, its presets and random valid
// inputs; every quoted number must come from the frame's engine values, and each topic's values are worked out again
// here by a second method. Prints "claims-p10 N passed, M failed".
import { runClaims, pick, int } from './claims/mem-lib.mjs';
import { P10A } from './claims/p10-a.mjs';

const MEM = 65536, OS = 8192;

export const P10 = Object.assign({
  'mem-base-bounds': {
    constants: [MEM, OS, OS - 1],
    names: ['P1', 'P2'],
    random: (rnd) => {
      const l1 = int(rnd, 1, 16) * 512, l2 = int(rnd, 1, 16) * 512, b1 = OS + int(rnd, 0, 20) * 512, b2 = b1 + l1 + int(rnd, 0, 40) * 256;
      const refs = Array.from({ length: int(rnd, 3, 10) }, () => (rnd() < 0.2 ? pick(rnd, ['P1', 'P2']) : String(int(rnd, -10, 9000))));
      return { base1: b1, limit1: l1, base2: b2, limit2: l2, refs };
    },
    check({ input, r, ok, near }) {
      // replay the addresses here: legal iff 0 <= a < limit, physical = base + a
      const P = [[input.base1, input.limit1], [input.base2, input.limit2]];
      let cur = 0, k = 0, good = 0, bad = 0;
      const steps = r.frames.filter((f) => ['compare', 'relocate', 'fault', 'switch', 'same'].includes(f.meta.phase));
      for (const x of input.refs) {
        if (/^P/.test(x)) { const to = x === 'P1' ? 0 : 1; const f = steps[k++]; ok(f.meta.phase === (to === cur ? 'same' : 'switch'), 'a switch frame'); cur = to; if (f.meta.phase === 'switch') near([f.meta.base, f.meta.limit], P[cur], 'the registers loaded'); continue; }
        const a = +x, [b, l] = P[cur], c = steps[k++], o = steps[k++], legal = a >= 0 && a < l;
        ok(c.meta.phase === 'compare' && c.meta.ok === legal, 'the limit check of ' + a);
        if (legal) { good++; ok(o.meta.phase === 'relocate', 'relocated'); near(o.meta.pa, b + a, 'base + address'); ok(o.meta.pa >= b && o.meta.pa < b + l, 'inside the partition'); }
        else { bad++; ok(o.meta.phase === 'fault', 'a fault'); }
      }
      const e = r.frames[r.frames.length - 1].meta;
      near([e.ok, e.faults], [good, bad], 'the totals');
    },
  },
}, P10A);

import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) runClaims('claims-p10', /^p10-/, P10);
