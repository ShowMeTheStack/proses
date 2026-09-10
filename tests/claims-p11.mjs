// Part 11 (virtual memory): the narration claims check. Every topic with its default, its presets and random valid
// inputs; every quoted number must come from the frame's engine values, and each topic's values are worked out again
// here by a second method (tests/claims/p11-a.mjs and p11-b.mjs). Prints "claims-p11 N passed, M failed".
import { runClaims } from './claims/mem-lib.mjs';
import { P11A } from './claims/p11-a.mjs';
import { P11B } from './claims/p11-b.mjs';
import { pathToFileURL } from 'node:url';

export const P11 = Object.assign({}, P11A, P11B);
if (import.meta.url === pathToFileURL(process.argv[1]).href) runClaims('claims-p11', /^p11-/, P11);
