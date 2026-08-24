// Part 1, how a kernel is built: the same request (an app reads a block) through a monolithic kernel, a layered
// one, a microkernel, a kernel with modules and a hybrid. One topic follows the request hop by hop through one
// design; the other draws all five side by side with what one request costs each. From S.Os.request and
// S.Os.compareStructures.
(function (S) {
  'use strict';
  const H = S.PX;
  const NAMES = () => Object.keys(S.Os.STRUCTURES);
  const HOW = { call: 'call', 'indirect call': 'call via table', 'system call': 'system call', 'return to user': 'return', message: 'message', 'reply message': 'reply' };

  /** the parts of a structure as boxes in a column: user parts above the line, kernel parts below */
  function column(prefix, def, x, w, o) {
    const items = [], pos = {}, bh = o.bh || 34, gap = o.gap || 12;
    let y = o.y;
    const users = def.parts.filter((p) => p.space === 'user'), kern = def.parts.filter((p) => p.space === 'kernel');
    // user parts in the order of the path, then the kernel; a microkernel draws its own small kernel at the bottom
    const order = def.parts.map((p, i) => ({ p, i }));
    const uy = y;
    order.filter((q) => q.p.space === 'user').forEach((q) => { pos[q.i] = y + bh / 2; y += bh + gap; });
    const lineY = y + 4;
    y += 18;
    order.filter((q) => q.p.space === 'kernel').forEach((q) => { pos[q.i] = y + bh / 2; y += bh + gap; });
    if (!kern.length) { pos.micro = y + bh / 2; y += bh + gap; }
    items.push({ key: prefix + ':ur', kind: 'region', x: x - 8, y: uy - 8, w: w + 16, h: lineY - uy + 4, rx: 8, text: '', cls: 'uspace', audit: 'group', layer: 'back' });
    items.push({ key: prefix + ':kr', kind: 'region', x: x - 8, y: lineY + 6, w: w + 16, h: y - lineY - 6, rx: 8, text: '', cls: 'kspace', audit: 'group', layer: 'back' });
    def.parts.forEach((p, i) => items.push({ key: prefix + ':p' + i, kind: 'state', x: x + w / 2, y: pos[i], w, h: bh, rx: 7, text: p.name + (p.via === 'module' ? ' ⧉' : ''), cls: 'layer ' + (p.space === 'user' ? 'user' : 'kern') + (o.lit && o.lit.includes(i) ? ' act' : ''), size: 13 }));
    if (pos.micro) items.push({ key: prefix + ':mk', kind: 'state', x: x + w / 2, y: pos.micro, w, h: bh, rx: 7, text: 'microkernel: IPC', cls: 'layer kern' + (o.litMicro ? ' act' : ''), size: 13 });
    return { items, pos, h: y - o.y, users: users.length };
  }

  S.topic({
    id: 'p01-structure', family: 'p01-structure', order: 10, title: 'One request through a kernel design',
    blurb: 'Where the services live decides what one request costs. In a monolithic kernel the file system and the driver are functions in one address space, so the request crosses into the kernel once and back once. In a microkernel they are separate user processes, and every step between them is a message the small kernel delivers: safer when one of them crashes, but each message costs two mode switches and an address-space switch.',
    inputs: [{ id: 'st', kind: 'choice', label: 'Design', def: 'monolithic', options: () => [], check: null }],
    presets: [],
    counters: [{ id: 'modes', label: 'mode switches' }, { id: 'msgs', label: 'messages' }, { id: 'calls', label: 'in-kernel calls' }],
    run(inp) {
      const def = S.Os.STRUCTURES[inp.st], r = S.Os.request(inp.st, { op: 'read' });
      const F = new S.Frames(['modes', 'msgs', 'calls']);
      const X = 110, W = 280;
      const idx = (name) => def.parts.findIndex((p) => p.name === name);
      let calls = 0;
      r.steps.forEach((s, k) => {
        const lit = [idx(s.at)], hop = s.hop;
        if (hop && (hop.how === 'call' || hop.how === 'indirect call')) calls++;
        const col = column('c', def, X, W, { y: 62, lit, litMicro: hop && hop.messages > 0 && hop.modeSwitches === 2 });
        const items = [H.text('t', X - 8, 16, def.name, 'strong', 16), H.text('t2', X - 8, 36, def.blurb, '', 13)].concat(col.items);
        if (hop) {
          const a = idx(hop.from), b = idx(hop.to);
          const viaMicro = hop.how === 'message' && hop.modeSwitches === 2 && col.pos.micro;
          const ya = col.pos[a], yb = col.pos[b], R = X + W + 8, L = X - 8;
          if (viaMicro) {
            // a message between two servers: sent into the kernel on the right, delivered out of it on the left
            const my = col.pos.micro;
            items.push({ key: 'w', kind: 'wire', pts: [[R, ya], [R + 30, ya], [R + 30, my], [R, my]], head: true, cls: 'act' });
            items.push({ key: 'w2', kind: 'wire', pts: [[L, my], [L - 30, my], [L - 30, yb], [L, yb]], head: true, cls: 'act' });
            items.push(H.text('hl', R + 40, (ya + my) / 2 + 5, 'send', 'act', 14), H.text('hl2', L - 40, (my + yb) / 2 + 5, 'deliver', 'act', 14, 'end'));
          } else {
            const side = hop.dir === 'down' ? R : L, d = hop.dir === 'down' ? 30 : -30;
            items.push({ key: 'w', kind: 'wire', pts: [[side, ya], [side + d, ya], [side + d, yb], [side, yb]], head: true, cls: 'act' });
            items.push(H.text('hl', hop.dir === 'down' ? R + 40 : L - 40, (ya + yb) / 2 + 5, HOW[hop.how] || hop.how, 'act', 14, hop.dir === 'down' ? undefined : 'end'));
          }
        }
        // the running totals
        const ty = 92;
        items.push(H.title('tt', 540, ty - 10, 'cost so far'));
        [['mode switches', s.modeSwitches], ['messages', s.messages], ['in-kernel calls', calls]].forEach(([n, v], j) => items.push(H.cell('tn' + j, 540, ty + j * 36, 150, 30, n, 'regname', { size: 13 }), H.cell('tv' + j, 694, ty + j * 36, 70, 30, v, 'reg' + (hop && ((j === 0 && hop.modeSwitches) || (j === 1 && hop.messages) || (j === 2 && (hop.how === 'call' || hop.how === 'indirect call'))) ? ' changed' : ''), { size: 14 })));
        F.set('modes', s.modeSwitches).set('msgs', s.messages).set('calls', calls);
        F.add({ items, say: H.say(s.say), meta: { phase: s.kind, kind: s.kind, modeSwitches: s.modeSwitches, messages: s.messages, calls, total: [r.modeSwitches, r.messages, r.calls, r.spaceSwitches], hop: hop || null }, title: s.kind });
      });
      const sec = { id: 'd', kind: 'math', title: 'What each crossing costs', text: ['kernel → kernel: a function call', 'user → kernel: a system call,', '  1 mode switch', 'user → user: a message through', '  the kernel: 2 mode switches,', '  1 message, a new address space'].join('\n') };
      return { frames: F.list, def: { sections: [sec] }, result: r };
    },
    predict: [
      { at: (f) => f.meta.kind === 'start', pick: 'option', ask: 'How many mode switches will this one read cost in all?', options: (fr) => [...new Set([fr[0].meta.total[0], 2, 4, 8, 0])].sort((a, b) => a - b).map(String), answer: (fr) => String(fr[0].meta.total[0]), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'In a monolithic kernel, how does the file system ask the disk driver for a block?', options: ['an ordinary function call inside the kernel', 'a message through the kernel', 'a system call', 'a signal'], answer: 0, why: 'They share one address space and one privilege level.' },
      { q: 'What does a microkernel gain by running the file system as a user process?', options: ['a crash in it cannot corrupt the kernel, and it can be restarted', 'faster reads', 'fewer mode switches', 'no need for messages'], answer: 0, why: 'Isolation is the point; the price is more crossings per request.' },
      { q: 'A loadable module is called…', options: ['through a table of function pointers, still inside the kernel', 'by a message', 'by a system call', 'from user space only'], answer: 0, why: 'The module is linked into the running kernel; the indirect call costs almost nothing.' },
      { q: 'Which design pays an address-space switch on most hops?', options: ['microkernel', 'monolithic', 'layered', 'modules'], answer: 0, why: 'Each server is its own process with its own page table.' },
    ],
  });
  // the design choice lists the structures (filled here, once the engine is loaded)
  const t = S.byId('p01-structure');
  t.inputs[0].options = Object.keys(S.Os.STRUCTURES).map((k) => ({ value: k, label: S.Os.STRUCTURES[k].name }));
  t.presets = Object.keys(S.Os.STRUCTURES).map((k) => ({ label: S.Os.STRUCTURES[k].name, values: { st: k } }));

  S.topic({
    id: 'p01-structures', family: 'p01-structure', order: 20, title: 'Kernel designs side by side',
    blurb: 'Five ways to arrange the same services, drawn next to each other: what runs in user mode and what in kernel mode, and what one read costs in each. Monolithic and modular kernels pay the least; layered kernels add calls but no crossings; microkernels and hybrids pay in messages and mode switches for the isolation they buy.',
    inputs: [{ id: 'op', kind: 'choice', label: 'The request', def: 'read', options: [{ value: 'read', label: 'read a block' }, { value: 'write', label: 'write a block' }] }],
    presets: [{ label: 'One read', values: { op: 'read' } }, { label: 'One write', values: { op: 'write' } }],
    counters: [],
    run(inp) {
      const all = S.Os.compareStructures({ op: inp.op }), keys = NAMES(), F = new S.Frames([]);
      const CW = 154, G = 22;
      const cols = keys.map((k, i) => column('s' + i, S.Os.STRUCTURES[k], i * (CW + G), CW, { y: 58, bh: 32, gap: 8 }));
      const maxH = Math.max(...cols.map((c) => c.h));
      const ty = 58 + maxH + 26;
      keys.forEach((k, upto) => {
        const items = [];
        keys.forEach((kk, i) => {
          items.push(H.text('n' + i, i * (CW + G) + CW / 2, 24, S.Os.STRUCTURES[kk].name, i === upto ? 'act' : 'strong', 15, 'middle'));
          items.push(...cols[i].items.map((it) => (i === upto && it.kind === 'state' ? Object.assign({}, it, { cls: it.cls + ' act' }) : i > upto ? Object.assign({}, it, { dim: true }) : it)));
          const c = all[i];
          if (i <= upto) items.push(H.cell('cm' + i, i * (CW + G), ty, CW, 28, c.modeSwitches + ' mode sw.', 'vec' + (i === upto ? ' act' : ''), { size: 13 }), H.cell('cg' + i, i * (CW + G), ty + 32, CW, 28, c.messages + ' messages', 'vec' + (i === upto ? ' act' : ''), { size: 13 }), H.cell('cc' + i, i * (CW + G), ty + 64, CW, 28, c.calls + ' calls', 'vec' + (i === upto ? ' act' : ''), { size: 13 }));
        });
        const c = all[upto];
        const say = c.name + ': one ' + inp.op + ' costs ' + H.plural(c.modeSwitches, 'mode switch', 'mode switches') + ', ' + H.plural(c.messages, 'message') + ', ' + H.plural(c.calls, 'in-kernel call') + ' and ' + H.plural(c.spaceSwitches, 'address-space switch', 'address-space switches') + '.' + (upto === keys.length - 1 ? ' The cheapest in mode switches: ' + H.list(all.filter((x) => x.modeSwitches === Math.min(...all.map((y) => y.modeSwitches))).map((x) => x.name)) + '.' : '');
        F.add({ items, say, meta: { phase: 'col', id: k, row: c, all } });
      });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Reading the columns', text: ['green: user mode', 'copper: kernel mode', '⧉: a loadable module', 'counts: one request, there and back'].join('\n') }] }, result: all };
    },
    predict: [
      { at: (f, i) => i === 1, once: true, pick: 'option', ask: 'Next is the microkernel. Will one request cost more mode switches than in the monolithic kernel, or fewer?', options: ['more', 'fewer', 'the same'], answer: (fr) => { const a = fr[0].meta.all; const m = a.find((x) => x.id === 'microkernel'), mo = a.find((x) => x.id === 'monolithic'); return m.modeSwitches > mo.modeSwitches ? 'more' : m.modeSwitches < mo.modeSwitches ? 'fewer' : 'the same'; }, explain: (fr) => fr[2].say },
    ],
    quiz: [
      { q: 'Which design keeps the file system and the drivers in one kernel address space?', options: ['monolithic', 'microkernel', 'none of them', 'only the hybrid'], answer: 0, why: 'Everything is called directly, which is fast but means one bug can bring down the whole kernel.' },
      { q: 'What does a layered kernel give up for its order?', options: ['extra calls through every layer, even when a lower layer could be called directly', 'isolation', 'the ability to run programs', 'mode switches'], answer: 0, why: 'Each layer may use only the one below it.' },
      { q: 'A hybrid kernel…', options: ['keeps most services inside but runs some drivers as user processes', 'is two kernels at once', 'runs only in user mode', 'has no system calls'], answer: 0, why: 'It pays messages only where it chose isolation.' },
      { q: 'Why can a microkernel survive a crashing driver?', options: ['the driver is an ordinary process: the kernel notices it died and can restart it', 'drivers never crash', 'it copies the driver', 'it runs the driver twice'], answer: 0, why: 'Its memory is separate from the kernel\'s.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
