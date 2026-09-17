// Part 15, file-system implementation: every preset and random inputs of each topic. Every number in the narration
// must be in the frame's meta (tests/claims-p15-lib.mjs), and the meta values are worked out again here by a second
// route: the layout from the formulas, allocation by replaying the same commands on a fresh image and walking the
// structures by hand, the walk to byte N by arithmetic, the costs and the cache by a small model of their own, crash
// outcomes by fsck and by reading the files back. Usage: node tests/claims-p15.mjs [topic id ...]
import { setup, runPart } from './claims-p15-lib.mjs';
import { mods as modsA } from './claims-p15-a.mjs';
import { mods as modsB } from './claims-p15-b.mjs';

const { S, t, rnd } = setup('claims-p15');
const only = process.argv.slice(2);
const runs = runPart(S, t, rnd, /^p15-/, Object.assign({}, modsA(S), modsB(S)), only);
t.ok(runs > 0, 'some runs');
t.done();
