// Part 2, the address space of a running program: a C program runs a statement at a time (S.CLang.runProgram)
// and its memory is drawn as the usual map, high addresses at the top: the stack with one frame per call, the free
// gap, the heap with its blocks, the globals, the code, and the unmapped page at address 0. Each step says what the
// last line changed, with the addresses the machine used.
(function (S) {
  'use strict';
  const H = S.PX, P = S.P02;
  const PROGS = {
    both: {
      label: 'recursion and malloc', file: 'grow.c',
      src: `#include <stdio.h>
#include <stdlib.h>

int total = 0;
char name[] = "proc";

int sum(int n) {
    if (n == 0)
        return 0;
    return n + sum(n - 1);
}

int main(void) {
    int *a = malloc(4 * sizeof(int));
    char *s = malloc(32);
    total = sum(3);
    free(a);
    printf("%d %s\\n", total, name);
    return 0;
}`,
    },
    heap: {
      label: 'the heap grows, and a hole opens', file: 'blocks.c',
      src: `#include <stdio.h>
#include <stdlib.h>

int made = 0;

int main(void) {
    char *p[3];
    for (int i = 0; i < 3; i++) {
        p[i] = malloc(24 * (i + 1));
        made++;
    }
    free(p[1]);
    char *q = malloc(16);
    printf("q at %p\\n", (void *)q);
    return 0;
}`,
    },
    deep: {
      label: 'the stack grows with each call', file: 'deep.c',
      src: `#include <stdio.h>

int depth = 0;

int down(int k) {
    int here[4];
    here[0] = k;
    depth++;
    if (k > 0)
        return down(k - 1) + here[0];
    return 0;
}

int main(void) {
    int r = down(4);
    printf("%d %d\\n", r, depth);
    return 0;
}`,
    },
  };
  P.PROGS_LAYOUT = PROGS;
  const ROW = 24;

  /** the snapshots of a run, one a statement */
  const memo = new Map();
  function steps(src) {
    if (memo.has(src)) return memo.get(src);
    const r = S.CLang.runProgram(src, { snap: true }), prog = S.CLang.compile(src);
    const out = r.trace.filter((e) => e.snap && e.kind === 'step').map((e) => ({ line: e.line, snap: e.snap }));
    const v = { out, prog, stdout: r.out };
    memo.set(src, v);
    return v;
  }
  const heapList = (sn) => sn.heap.blocks.map((b) => ({ addr: b.addr, size: b.size, req: b.req, free: b.free, top: b.top, line: b.line }));
  const short = (t) => (String(t).length > 12 ? String(t).slice(0, 11) + '…' : String(t));

  function map(prog, sn, prev, maxF, maxB, x, y, w) {
    const items = [], aw = 92, bx = x + aw, bw = w - aw;
    const frames = sn.frames.slice(), blocks = heapList(sn), gl = sn.globals;
    let yy = y;
    const seg = (key, h, cls, label, lo, hi) => {
      items.push(H.cell('sg' + key, bx, yy, bw, h, '', 'seg ' + cls));
      items.push(H.text('sl' + key, bx + 8, yy + 17, label, 'strong', 13));
      if (hi !== undefined) items.push(H.text('sh' + key, bx - 6, yy + 13, H.hex(hi, 5), 'addr', 13, 'end'));
      if (lo !== undefined) items.push(H.text('so' + key, bx - 6, yy + h - 3, H.hex(lo, 5), 'addr', 13, 'end'));
      const top = yy; yy += h; return top;
    };
    const inner = (key, top, k, text, cls) => items.push(H.cell(key, bx + 92, top + 4 + k * ROW, bw - 100, ROW - 3, text, 'blk ' + cls, { size: 13 }));
    // the stack, frames from the top down
    const st = seg('st', 8 + Math.max(1, maxF) * ROW, 'stack', 'stack ↓', undefined, prog.memSize);
    frames.forEach((f, k) => {
      const vals = f.locals.slice(0, 2).map((v) => v.name + '=' + short(v.text)).join(' ');
      const isNew = !prev || prev.frames.length < frames.length && k === frames.length - 1;
      inner('fr' + k, st, k, f.fn + (vals ? '  ' + vals : ''), 'frame' + (isNew && prev ? ' act' : ''));
    });
    seg('gap', 30, 'gap', 'free: stack and heap grow toward each other');
    // the heap, low addresses at the bottom
    const used = blocks.filter((b) => !b.top);
    const hp = seg('hp', 8 + Math.max(1, maxB) * ROW, 'heap', 'heap ↑', prog.heapBase, undefined);
    const prevB = prev ? heapList(prev) : [];
    used.forEach((b, k) => {
      const was = prevB.find((c) => c.addr === b.addr), changed = prev && (!was || was.free !== b.free || was.size !== b.size);
      inner('hb' + b.addr, hp, Math.max(1, maxB) - 1 - k, (b.free ? 'free ' : '') + b.size + ' B at ' + H.hex(b.addr, 4), b.free ? 'free' : 'heap' + (changed ? ' act' : ''));
    });
    // the globals
    const dt = seg('dt', 8 + Math.max(1, gl.length) * ROW, 'data', 'data', prog.dataBase + 256, undefined);
    gl.forEach((g, k) => { const was = prev && prev.globals.find((c) => c.name === g.name); inner('gv' + g.name, dt, k, g.name + ' = ' + short(g.text), 'heap' + (was && was.text !== g.text ? ' act' : '')); });
    const names = [...prog.funcs.keys()];
    seg('tx', 30, 'text', 'text: ' + names.join(', ') + ' (code)');
    seg('nl', 26, 'null', 'page 0, unmapped: NULL faults', 0, undefined);
    return { items, h: yy - y, frames: frames.length, blocks: used };
  }

  /** what the last statement changed, in a sentence */
  function change(prev, sn, line) {
    if (!prev) return 'main starts at line ' + line + '. Its frame is the only one on the stack, at ' + H.hex(sn.frames[0] ? sn.frames[0].fp : 0, 5) + '; the heap holds no block yet.';
    const out = [], pf = prev.frames, nf = sn.frames;
    if (nf.length > pf.length) { const f = nf[nf.length - 1]; out.push('a call pushes a frame for ' + f.fn + ' at ' + H.hex(f.fp, 5) + (f.locals.length ? ', with ' + f.locals.slice(0, 2).map((v) => v.name + ' = ' + v.text).join(' and ') : '') + ', below the caller\'s: the stack grows down'); }
    if (nf.length < pf.length) out.push(!nf.length ? 'main returns, and its frame is popped' : H.plural(pf.length - nf.length, 'frame is', 'frames are') + ' popped as the calls return: the stack shrinks back to ' + H.plural(nf.length, 'frame'));
    const pb = heapList(prev), nb = heapList(sn);
    for (const b of nb) { const was = pb.find((c) => c.addr === b.addr); if (b.top) continue; if (!b.free && (!was || was.free || was.top)) out.push('the call to malloc carves a ' + b.size + '-byte block at ' + H.hex(b.addr, 4) + ' out of the heap (' + b.req + ' bytes asked, the rest is its header and rounding)'); if (b.free && was && !was.free) out.push('the call to free gives the ' + b.size + '-byte block at ' + H.hex(b.addr, 4) + ' back: it stays in the heap as free space'); }
    for (const g of sn.globals) { const w = prev.globals.find((c) => c.name === g.name); if (w && w.text !== g.text) out.push('the global ' + g.name + ' changes from ' + w.text + ' to ' + g.text + ', in the data segment'); }
    if (pf.length === nf.length && nf.length) { const a = pf[pf.length - 1], b = nf[nf.length - 1]; for (const v of b.locals) { const u = a.locals.find((x) => x.name === v.name); if (u && u.text !== v.text && v.text !== '?') out.push('the local ' + v.name + ' of ' + b.fn + ' becomes ' + v.text + ', in its frame on the stack'); } }
    return 'Line ' + line + ' runs: ' + (out.length ? H.list(out) + '.' : 'nothing in the map changes.');
  }

  S.topic({
    id: 'p02-layout', family: 'p02-image', order: 10, title: 'A process\'s address space',
    blurb: 'A running program sees one range of addresses laid out the same way every time: its code (text) low down, its globals (data) above it, then the heap, which grows upward as malloc hands out blocks, and at the top the stack, which grows downward a frame per call. The gap between heap and stack is room for both. Page 0 is left unmapped, so a NULL pointer faults instead of reading something.',
    inputs: [{ id: 'prog', kind: 'choice', label: 'Program', def: 'both', options: P.options(PROGS) }],
    presets: [
      { label: 'Recursion and malloc', values: { prog: 'both' } },
      { label: 'The heap grows, a hole opens', values: { prog: 'heap' } },
      { label: 'The stack grows with each call', values: { prog: 'deep' } },
    ],
    counters: [{ id: 'frames', label: 'stack frames' }, { id: 'blocks', label: 'heap blocks in use' }],
    run(inp) {
      const pr = PROGS[inp.prog], R = steps(pr.src), F = new S.Frames(['frames', 'blocks']);
      const maxF = Math.max(...R.out.map((s) => s.snap.frames.length)), maxB = Math.max(1, ...R.out.map((s) => heapList(s.snap).filter((b) => !b.top).length));
      R.out.forEach((s, i) => {
        const prev = i ? R.out[i - 1].snap : null;
        const code = S.Kit.pcode.code({ prefix: 'cd', x: 0, y: 0, w: 420, src: pr.src.split('\n'), lineH: 19, title: pr.file, act: s.line, marks: {}, size: 13, indent: 0.75 });
        const m = map(R.prog, s.snap, prev, maxF, maxB, 444, 0, 426);
        const used = m.blocks.filter((b) => !b.free).length;
        F.set('frames', m.frames).set('blocks', used);
        const say = change(prev, s.snap, s.line);
        if (prev && i < R.out.length - 1 && /nothing in the map changes/.test(say)) return;
        F.add({ items: code.items.concat(m.items), say, meta: { phase: 'step', line: s.line, frames: s.snap.frames.map((f) => ({ fn: f.fn, fp: f.fp, locals: f.locals.map((v) => [v.name, v.text, v.addr]) })), blocks: heapList(s.snap), globals: s.snap.globals.map((g) => [g.name, g.text, g.addr]), prevLine: i ? R.out[i - 1].line : null, nFrames: m.frames, used, popped: prev ? Math.max(0, prev.frames.length - s.snap.frames.length) : 0 }, title: 'line ' + s.line });
      });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'The map, top to bottom', text: ['stack: a frame per call (locals,', '  the return address); grows down', 'free gap', 'heap: malloc\'s blocks; grows up', 'data: globals and static variables', 'text: the code, read-only', 'page 0: unmapped, so *NULL faults', '(this machine keeps its code', '  apart, at 0x40000000)'].join('\n') }] }, result: { out: R.stdout } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.nFrames > f.meta.nFrames, once: true, pick: 'option', ask: 'The next line calls a function. Where does its frame go?', options: ['below the caller\'s frame (lower addresses)', 'above the caller\'s frame', 'in the heap', 'in the data segment'], answer: 'below the caller\'s frame (lower addresses)', explain: (fr, i) => fr[i + 1].say },
      { at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.used > f.meta.used, once: true, pick: 'option', ask: 'The next line calls malloc. Which part of the map grows?', options: ['the heap', 'the stack', 'the data segment', 'the text'], answer: 'the heap', explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'Where does a local variable of a function live?', options: ['in that call\'s frame on the stack', 'in the heap', 'in the data segment', 'in the text'], answer: 0, why: 'Each call gets its own frame, so a recursive call has its own copy.' },
      { q: 'Where does a global int live?', options: ['in the data segment, for the whole run', 'on the stack', 'in the heap', 'in a register'], answer: 0, why: 'Globals are laid out when the program is loaded.' },
      { q: 'free(p) is called. What happens to the block?', options: ['it becomes free space in the heap, for a later malloc', 'it is returned to the disk', 'the heap shrinks at once', 'p is set to NULL'], answer: 0, why: 'The allocator keeps it for reuse; p still holds the old address.' },
      { q: 'Why is page 0 left unmapped?', options: ['so dereferencing NULL faults at once instead of reading data', 'to save memory', 'because the kernel lives there', 'for the stack'], answer: 0, why: 'A crash at the bad line is far easier to debug than a silent wrong value.' },
      { q: 'Deep recursion keeps calling. What eventually happens?', options: ['the stack grows into its limit and the program crashes (stack overflow)', 'the heap shrinks', 'the data segment grows', 'nothing: frames are free'], answer: 0, why: 'Each call takes another frame of stack space.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
