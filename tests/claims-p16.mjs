// Part 16, distributed file systems: every preset and random inputs of each topic. Every number in the narration must
// be in the frame's meta (tests/claims-p15-lib.mjs: times, versions, xids, tries, ages, counts), and the runs behind
// the frames are checked again here: messages arrive one latency after they leave unless lost, every request that
// reaches a running server is answered with the same xid, the state worked out from the messages agrees with the
// engine's final state, and each topic's own claim (a stale read, a retried request, a lost update, a callback broken)
// is reasoned out from the script by hand. Usage: node tests/claims-p16.mjs [topic id ...]
import { setup, runPart } from './claims-p15-lib.mjs';
import { mods as modsA } from './claims-p16-a.mjs';

const { S, t, rnd } = setup('claims-p16');
const only = process.argv.slice(2);
const runs = runPart(S, t, rnd, /^p16-/, modsA(S), only);
t.ok(runs > 0, 'some runs');
t.done();
