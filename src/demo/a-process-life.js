// The life of one process, drawn on the state diagram: created, admitted, dispatched, preempted by the timer,
// blocked on a read, woken when the disk answers, run again, exited as a zombie, and reaped by its parent. A
// placeholder scene that proves the pipeline (scene, player, demo page, hero, diagram check) end to end; the
// kernel engine will produce traces of this shape for real programs.
(function (S) {
  'use strict';
  const D = S.Demo, box = D.box;
  const NAMES = { new: 'new', ready: 'ready', running: 'running', blocked: 'blocked', zombie: 'zombie' };
  const CLS = { new: 's-new', ready: 's-ready', running: 's-running', blocked: 's-blocked', zombie: 's-zombie' };
  // the transitions of the diagram: [from, to, the event's name]
  const ARCS = [['new', 'ready', 'admitted'], ['ready', 'running', 'dispatch'], ['running', 'ready', 'timer'], ['running', 'blocked', 'read()'], ['blocked', 'ready', 'I/O done'], ['running', 'zombie', 'exit(0)']];

  /** the trace: one step per event, with the time it happens at and a sentence naming the values */
  function trace() {
    const steps = [{ kind: 'create', state: 'new', t: 0, say: 'The shell calls fork at t = `0`: the kernel builds a PCB for P1 with pid `1042` and puts it in the new state.' }];
    const go = (to, t, ev, say) => { steps.push({ kind: 'transition', from: steps[steps.length - 1].state, state: to, ev, t, say }); };
    go('ready', 1, 'admitted', 'At t = `1` P1 is admitted: it joins the ready queue, which holds only P1, so it is first in line.');
    go('running', 2, 'dispatch', 'At t = `2` the scheduler dispatches P1: its saved registers are loaded and it runs, with a quantum of `4` ticks.');
    go('ready', 6, 'timer', 'At t = `6` the timer interrupt fires after `4` ticks: P1 has used its whole quantum, so it goes back to the ready queue.');
    go('running', 7, 'dispatch', 'At t = `7` P1 is dispatched again: it was the only process ready.');
    go('blocked', 9, 'read()', 'At t = `9` P1 calls read on a file that is not in memory: it blocks until the disk answers, and the CPU is free for others.');
    go('ready', 15, 'I/O done', 'At t = `15` the disk interrupt says the block has arrived: P1 is woken and joins the ready queue again.');
    go('running', 16, 'dispatch', 'At t = `16` P1 runs for the third time, and reaches the end of main.');
    go('zombie', 18, 'exit(0)', 'At t = `18` P1 calls exit(0): its memory is freed, but its PCB stays as a zombie, holding the status `0` until its parent asks.');
    steps.push({ kind: 'reap', from: 'zombie', state: null, t: 19, say: 'At t = `19` the shell’s waitpid collects status `0`: the zombie is reaped and pid `1042` is free again.' });
    return steps;
  }

  /** where each state sits, wide or narrow, and how each arc bends */
  // label: where an arc's name sits ([x, y], its centre), when the default spot beside its middle is too close to
  // another line; tok: where P1's marker sits beside each state
  function layout(narrow) {
    if (narrow) return {
      pos: { new: [80, 60], ready: [80, 230], running: [290, 230], blocked: [185, 420], zombie: [290, 590] },
      bend: { 'ready>running': 26, 'running>ready': 26 }, r: 40, size: 16,
      label: { 'new>ready': [128, 145], 'ready>running': [185, 186], 'running>ready': [185, 277], 'running>blocked': [186, 336], 'blocked>ready': [88, 340], 'running>zombie': [334, 410] },
      tok: { new: [142, 60], ready: [80, 168], running: [290, 168], blocked: [185, 482], zombie: [228, 590] },
      clock: [290, 64], view: box(-10, 10, 400, 680),
    };
    return {
      pos: { new: [70, 90], ready: [270, 90], running: [530, 90], blocked: [400, 260], zombie: [730, 90] },
      bend: { 'ready>running': 30, 'running>ready': 30 }, r: 40, size: 14,
      label: { 'running>blocked': [522, 182], 'blocked>ready': [280, 182] },
      tok: { new: [70, 30], ready: [270, 30], running: [530, 30], blocked: [400, 322], zombie: [730, 30] },
      clock: [90, 280], view: box(0, 0, 800, 350),
    };
  }

  function frames(narrow) {
    const L = layout(narrow), steps = trace(), sz = L.size;
    return steps.map((st, i) => {
      const items = [];
      for (const k of Object.keys(NAMES)) {
        const [x, y] = L.pos[k];
        items.push({ key: 's:' + k, kind: 'state', x, y, r: L.r, text: NAMES[k], size: sz, cls: st.state === k ? CLS[k] + ' act' : CLS[k] });
      }
      for (const [a, b, name] of ARCS) {
        const taken = st.kind === 'transition' && st.from === a && st.state === b;
        const at = L.label[a + '>' + b];
        items.push(Object.assign({ key: 'e:' + a + '>' + b, kind: 'edge', from: 's:' + a, to: 's:' + b, bend: L.bend[a + '>' + b] || 0, label: name, size: sz, cls: taken ? 'act' : '' }, at ? { lx: at[0], ly: at[1] } : {}));
      }
      // P1 rides beside the state it is in
      if (st.state) {
        const [x, y] = L.tok[st.state];
        items.push({ key: 'p1', kind: 'token', x, y, r: 17, text: 'P1', cls: 'proc' });
      }
      const [cx, cy] = L.clock;
      items.push({ key: 'clock', kind: 'text', x: cx, y: cy, text: 't = ' + st.t, anchor: 'middle', size: 18, cls: 'mono' });
      if (st.kind === 'reap') items.push({ key: 'reaped', kind: 'text', x: L.pos.zombie[0], y: L.pos.zombie[1] + L.r + 26, text: 'reaped', anchor: 'middle', size: sz, cls: 'good' });
      return { items, say: st.say, view: L.view, title: st.kind === 'transition' ? st.ev : st.kind === 'create' ? 'fork' : 'waitpid', trace: st, i };
    });
  }

  D.add({
    id: 'process-life', order: 10, tag: 'Processes · states', short: 'A process’s life', title: 'The life of a process, state by state',
    blurb: 'One process from fork to reaping: every transition it takes on the state diagram, with the time it happens and the event that causes it.',
    frames({ narrow }) { return frames(narrow); },
    trace,
  });
})(globalThis.Proses = globalThis.Proses || {});
