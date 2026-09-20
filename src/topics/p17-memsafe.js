// Part 17, memory-safety defences as models (prot-d-memsafe.js): a copy into a stack buffer, unchecked or bounded,
// with and without a canary; then pages that refuse to execute (NX, W^X) and bases shuffled at every run (ASLR).
// The weakness is shown only as a concept (bytes running past a buffer); every frame teaches the defence.
(function (S) {
  'use strict';
  const H = S.P09, Pr = () => S.Prot;
  const hex = (n) => '0x' + n.toString(16).padStart(8, '0');

  S.topic({
    id: 'prot-canary', family: 'p17-memsafe', order: 10, title: 'A buffer, a canary, and a bounded copy',
    blurb: 'A function\'s stack frame holds its local buffer and, above it, the saved frame pointer and the address to return to. A copy that does not check the buffer\'s size can run past its end and overwrite them; the program then misbehaves or crashes. The real cure is a bounded copy that never writes past the end. A second line of defence is the stack canary: a random value placed just above the buffer at every call and checked before returning, so damage is caught before the return address is used.',
    inputs: [
      { id: 'buffer', kind: 'number', label: 'Buffer size (bytes)', def: 16, min: 8, max: 32 },
      { id: 'len', kind: 'number', label: 'Input length (bytes)', def: 28, min: 0, max: 48 },
      { id: 'canary', kind: 'choice', label: 'Canary', def: 'yes', options: [{ value: 'yes', label: 'on' }, { value: 'no', label: 'off' }] },
      { id: 'copy', kind: 'choice', label: 'Copy', def: 'unchecked', options: [{ value: 'unchecked', label: 'unchecked' }, { value: 'bounded', label: 'bounded to the buffer' }] },
      { id: 'seed', kind: 'number', label: 'Run (canary seed)', def: 5, min: 1, max: 999 },
    ],
    presets: [
      { label: 'Fits: 12 bytes into 16', values: { buffer: 16, len: 12, canary: 'yes', copy: 'unchecked' } },
      { label: 'Too long, canary on: caught', values: { buffer: 16, len: 28, canary: 'yes', copy: 'unchecked' } },
      { label: 'Too long, no canary: a crash', values: { buffer: 16, len: 36, canary: 'no', copy: 'unchecked' } },
      { label: 'Too long, but a bounded copy', values: { buffer: 16, len: 36, canary: 'yes', copy: 'bounded' } },
      { label: 'Only the frame pointer damaged', values: { buffer: 16, len: 22, canary: 'no', copy: 'unchecked' } },
    ],
    counters: [{ id: 'over', label: 'bytes past the buffer' }],
    run(inp) {
      const fr = Pr().frame({ buffer: inp.buffer, canary: inp.canary === 'yes', seed: inp.seed }), R = Pr().copyInto(fr, inp.len, { bounded: inp.copy === 'bounded' });
      const F = new S.Frames(['over']), BY = 7, X0 = 170, W = 200, total = fr.slots.reduce((a, s) => a + s.size, 0), top = 60, bottom = top + total * BY;
      const yOf = (at) => bottom - (at - fr.slots[0].at) * BY;
      const CLS = { buffer: 'buf', canary: 'canary', 'saved frame pointer': 'ret', 'return address': 'ret' };
      const pic = (slots, written, o) => {
        o = o || {};
        const items = [H.title('tt', 0, 4, 'the stack frame (higher addresses at the top)')];
        slots.slice().reverse().forEach((s) => {
          const y = yOf(s.at + s.size);
          items.push({ key: 'sl' + s.name, kind: 'cell', x: X0, y, w: W, h: s.size * BY, rx: 3, text: s.name, size: 14, cls: 'slot ' + CLS[s.name] + (s.damaged ? ' damaged' : '') + (o.lit === s.name ? ' act' : '') });
          items.push(H.text('ad' + s.name, X0 - 12, y + 16, hex(s.at), 'mono', 13, 'end'));
          items.push(H.text('va' + s.name, X0 + W + 50, y + s.size * BY / 2 + 5, s.name === 'buffer' ? s.size + ' bytes: ' + s.value : s.value, s.damaged ? 'hot' : 'mono', 13));
        });
        if (written > 0) {
          const shown = Math.min(written, total), y = bottom - shown * BY, inBuf = Math.min(shown, inp.buffer);
          items.push({ key: 'fill', kind: 'cell', x: X0 + W + 10, y: bottom - inBuf * BY, w: 26, h: inBuf * BY, rx: 2, text: '', cls: 'fill', audit: 'overlap-ok' });
          if (shown > inp.buffer) items.push({ key: 'fillo', kind: 'cell', x: X0 + W + 10, y, w: 26, h: (shown - inp.buffer) * BY, rx: 2, text: '', cls: 'fill over', audit: 'overlap-ok' });
          items.push(H.text('fl', X0 + W + 10, top - 18, written + ' bytes written' + (written > total ? ' (more than the frame shown)' : ''), written > inp.buffer ? 'hot' : 'strong', 13));
        }
        if (o.verdict) items.push(H.text('vd', 0, bottom + 40, o.verdict, 'verdict2 ' + o.vcls, 16));
        return items;
      };
      const written = inp.copy === 'bounded' ? Math.min(inp.len, inp.buffer) : inp.len;
      const OUTCOME = { ok: ['returns normally', 'good'], truncated: ['returns normally: the input was cut short', 'good'], stopped: ['stopped by the canary before returning', 'good'], crash: ['damaged: the program crashes', 'hot'] };
      // the canary's verdict, worded from what this run really overwrote
      const others = R.damaged.filter((d) => d !== 'canary');
      const sayOf = (st) => st.kind !== 'canary' ? st.say : 'Before returning, the function compares the canary with the copy kept elsewhere: it changed, so the program reports "stack smashing detected" and stops before returning, so ' + (others.length ? 'the overwritten ' + H.list(others) + (others.length > 1 ? ' are' : ' is') + ' never used' : 'nothing past the canary was reached') + (others.includes('return address') ? '' : '; the return address was never touched') + '.';
      R.steps.forEach((st, k) => {
        const after = st.kind !== 'call';
        if (after) F.set('over', Math.max(0, written - inp.buffer));
        const last = k === R.steps.length - 1;
        F.add({ items: pic(st.slots, after ? written : 0, { lit: st.kind === 'canary' ? 'canary' : st.kind === 'crash' ? 'return address' : null, verdict: last ? OUTCOME[R.outcome][0] : null, vcls: last ? OUTCOME[R.outcome][1] : '' }), say: sayOf(st), meta: { phase: st.kind, damaged: R.damaged, len: inp.len, buffer: inp.buffer, over: Math.max(0, inp.len - inp.buffer), written, canary: fr.canary, at: fr.slots[0].at, outcome: R.outcome }, title: st.kind });
      });
      F.last().hold = 3000;
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Defences, best first', text: ['bounded copies: never write past the end', 'checked languages and libraries', 'stack canary: random, checked before return', 'non-executable stack (NX)', 'randomised addresses (ASLR)', 'each later line only limits the damage'].join('\n') }] } };
    },
    predict: [{ at: (f) => f.meta.phase === 'call', pick: 'option', ask: 'How will this call end?', options: ['returns normally', 'returns normally: the input was cut short', 'stopped by the canary before returning', 'damaged: the program crashes'], answer: (fr) => ({ ok: 'returns normally', truncated: 'returns normally: the input was cut short', stopped: 'stopped by the canary before returning', crash: 'damaged: the program crashes' }[fr[0].meta.outcome]), explain: (fr) => fr[fr.length - 1].say }],
    quiz: [
      { q: 'What does an unchecked copy of too many bytes into a stack buffer overwrite?', options: ['whatever lies above the buffer: other locals, the saved frame pointer, the return address', 'the heap only', 'nothing: the CPU stops it', 'the code of the program'], answer: 0, why: 'The stack frame is contiguous; the extra bytes land in the next slots.' },
      { q: 'A stack canary works because…', options: ['damage that reaches the return address must pass over it first, and it is checked before returning', 'it encrypts the stack', 'it makes the buffer larger', 'it prevents every bug'], answer: 0, why: 'It sits between the buffer and the saved values.' },
      { q: 'Why is the canary random at each program start?', options: ['so it cannot be known in advance and written back unchanged', 'to save memory', 'to make debugging easier', 'it is the same everywhere'], answer: 0, why: 'A fixed, known value would be easy to preserve.' },
      { q: 'Which defence removes the bug rather than limiting its effect?', options: ['a bounded copy', 'a canary', 'NX pages', 'ASLR'], answer: 0, why: 'The others catch or blunt the damage after the bug has happened.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  const PAGES = {
    wx: { label: 'W^X: no page both writable and executable', pages: [{ name: 'text', perms: 'r-x' }, { name: 'data', perms: 'rw-' }, { name: 'heap', perms: 'rw-' }, { name: 'stack', perms: 'rw-' }] },
    rwx: { label: 'An old layout: an executable stack', pages: [{ name: 'text', perms: 'r-x' }, { name: 'data', perms: 'rw-' }, { name: 'heap', perms: 'rw-' }, { name: 'stack', perms: 'rwx' }] },
    jit: { label: 'A code generator: write, then flip to execute', pages: [{ name: 'text', perms: 'r-x' }, { name: 'buffer', perms: 'rw-' }, { name: 'generated', perms: 'r-x' }, { name: 'stack', perms: 'rw-' }] },
  };
  const ACC = { wx: [['text', 'exec'], ['stack', 'write'], ['stack', 'exec'], ['text', 'write'], ['heap', 'exec']], rwx: [['text', 'exec'], ['stack', 'write'], ['stack', 'exec'], ['text', 'write']], jit: [['buffer', 'write'], ['buffer', 'exec'], ['generated', 'exec'], ['generated', 'write']] };
  S.topic({
    id: 'prot-nx-aslr', family: 'p17-memsafe', order: 20, title: 'Non-executable pages and shuffled addresses',
    blurb: 'Two defences that do not fix bugs but make their damage far harder to use. NX: each page-table entry says whether the page may be executed, and data pages (the stack, the heap) are not; W^X goes further, so no page is both writable and executable. ASLR: the stack, heap, libraries and program are placed at different random addresses at every run, so a mistake that depends on knowing where something is usually just crashes instead.',
    inputs: [
      { id: 'layout', kind: 'choice', label: 'Page permissions', def: 'wx', options: Object.entries(PAGES).map(([value, p]) => ({ value, label: p.label })) },
      { id: 'runs', kind: 'number', label: 'Runs to compare', def: 3, min: 1, max: 5 },
      { id: 'seed', kind: 'number', label: 'First run\'s seed', def: 1, min: 1, max: 999 },
    ],
    presets: [
      { label: 'W^X, three runs', values: { layout: 'wx', runs: 3, seed: 1 } },
      { label: 'An executable stack', values: { layout: 'rwx', runs: 3, seed: 1 } },
      { label: 'A code generator', values: { layout: 'jit', runs: 2, seed: 4 } },
      { label: 'Five runs', values: { layout: 'wx', runs: 5, seed: 11 } },
    ],
    counters: [{ id: 'faults', label: 'refused by NX' }],
    run(inp) {
      const L = PAGES[inp.layout], R = Pr().nx({ pages: L.pages, accesses: ACC[inp.layout].map(([page, op]) => ({ page, op })) });
      const REG = [{ name: 'text', base: 0x00400000, bits: 8 }, { name: 'heap', base: 0x01000000, bits: 13 }, { name: 'libraries', base: 0x70000000, bits: 12 }, { name: 'stack', base: 0x7f700000, bits: 11 }];
      const A = Pr().aslr({ runs: inp.runs, seed: inp.seed, regions: REG }), F = new S.Frames(['faults']);
      const pageTable = (lit) => {
        const items = [H.title('pt', 0, 6, 'page-table entries: r w x')];
        L.pages.forEach((p, i) => {
          const y = 22 + i * 38;
          items.push(H.text('pn' + i, 0, y + 22, p.name, 'strong', 14));
          [...p.perms].forEach((c, j) => {
            const isLit = lit && lit.page === p.name && j === { read: 0, write: 1, exec: 2 }[lit.op];
            items.push({ key: 'pp' + i + '_' + j, kind: 'cell', x: 100 + j * 40, y, w: 36, h: 30, rx: 4, text: c === '-' ? '–' : c, size: 14, cls: 'perm ' + (isLit ? (lit.ok ? 'on act' : 'hot') : c === '-' ? 'off' : 'on') });
          });
          if (R.wx.includes(p.name)) items.push({ key: 'wx' + i, kind: 'cell', x: 230, y: y + 3, w: 120, h: 24, rx: 10, text: 'writable + exec', size: 12, cls: 'tag hot' });
        });
        return items;
      };
      const acc = (upto, cur) => [H.title('al', 400, 6, 'accesses')].concat(R.results.slice(0, upto).map((r, k) => H.text('ac' + k, 400, 30 + k * 26, ({ read: 'read', write: 'write', exec: 'execute' }[r.op]) + ' ' + r.page + ': ' + (r.ok ? 'allowed' : 'fault'), k === cur ? 'stepline act' : r.ok ? 'good' : 'hot', 14)));
      const nxSay0 = H.plain(R.steps[0].say);
      F.add({ items: [...pageTable(null), ...acc(0, -1)], say: nxSay0 + ' Each access is checked against its page\'s bits by the hardware, on every instruction.', meta: { phase: 'nx-start', wx: R.wx.length } });
      R.steps.slice(1).forEach((st, k) => {
        if (!R.results[k].ok) F.count('faults');
        F.add({ items: [...pageTable({ page: st.page, op: st.op, ok: R.results[k].ok }), ...acc(k + 1, k)], say: st.say, meta: { phase: 'nx', k, ok: R.results[k].ok }, title: st.op + ' ' + st.page });
      });
      // ASLR: a column per region, its range of possible bases; a mark per run where the region landed
      const CW = 170, AX = 70;
      const aslr = (upto) => {
        const items = [H.title('ast', 0, 236, 'where each region lands, run by run: one column per region, its whole range of possible places')];
        REG.forEach((rg, j) => {
          const x0 = AX + j * CW, span = 2 ** rg.bits * 4096;
          items.push(H.text('rh' + j, x0 + 70, 268, rg.name + ' (' + (2 ** rg.bits) + ' places)', 'strong', 13, 'middle'));
          items.push({ key: 'rb' + j, kind: 'cell', x: x0, y: 280, w: 140, h: 24 + 32 * Math.max(1, A.runs.length), rx: 6, text: '', cls: 'panel' });
          A.runs.slice(0, upto).forEach((run, k) => {
            const fx = (run.bases[rg.name] - rg.base) / span;
            items.push({ key: 'mk' + j + '_' + k, kind: 'cell', x: x0 + 6 + Math.round(fx * 104), y: 292 + k * 32, w: 22, h: 22, rx: 11, text: String(k + 1), size: 12, cls: 'region' + j });
          });
        });
        A.runs.slice(0, upto).forEach((run, k) => items.push(H.text('rn' + k, 0, 308 + k * 32, 'run ' + (k + 1), 'strong', 13)));
        return items;
      };
      const nxAll = [...pageTable(null), ...acc(R.results.length, -1)];
      A.steps.forEach((st, k) => {
        const runs = st.kind === 'run' ? k + 1 : A.runs.length;
        F.add({ items: [...nxAll, ...aslr(runs)], say: st.say, meta: { phase: st.kind === 'run' ? 'aslr' : 'odds', k, run: k + 1, radix: 2, bases: st.bases || null, bits: [8, 13, 12, 11], odds: Object.values(A.odds).map((x) => Math.round(1 / x)) }, title: st.kind === 'run' ? 'run ' + (k + 1) : 'the odds' });
      });
      F.last().hold = 3000;
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'NX, W^X and ASLR', text: ['NX bit in each page-table entry: no execute', 'W^X: writable or executable, never both', '  code generators write, then flip to execute', 'ASLR: random bases at every run', '  k bits of randomness: 1 chance in 2^k', 'neither fixes the bug; both blunt it'].join('\n') }] } };
    },
    predict: [{ at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'nx' && fr[i + 1].meta.k === 2, pick: 'option', ask: 'Will the next access be allowed, or fault?', options: ['allowed', 'fault'], answer: (fr, i) => (fr[i + 1].meta.ok ? 'allowed' : 'fault'), explain: (fr, i) => fr[i + 1].say }],
    quiz: [
      { q: 'The NX bit marks a page as…', options: ['not executable', 'not readable', 'not present', 'read-only'], answer: 0, why: 'Running bytes from it raises a fault.' },
      { q: 'W^X means a page may be…', options: ['writable or executable, but never both at once', 'both writable and executable', 'neither', 'executable only by root'], answer: 0, why: 'Code that is written is never run from the same mapping without a change of permission.' },
      { q: 'ASLR helps because…', options: ['addresses differ at every run, so damage that relies on a fixed address usually just crashes', 'it encrypts memory', 'it prevents all bugs', 'it makes programs faster'], answer: 0, why: 'Knowing where things are is hard when they move.' },
      { q: 'A region placed with 8 bits of randomness is at a given address once in…', options: ['256 runs', '8 runs', '16 runs', '65536 runs'], answer: 0, why: '2^8 = 256 equally likely places.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
