// Virtual-memory engines, part 1: demand paging. The page-fault path step by step, each step with its cost in
// microseconds, and the effective access time a fault rate gives; then a whole reference string run under demand
// paging, each fault priced by its own path.
//   S.VM.COSTS  default costs in µs: {mem: 0.1, trap: 1, check: 0.5, find: 1, writeBack: 8000, read: 8000,
//               zero: 2, update: 0.2, restart: 1}
//   S.VM.faultPath({page, write, legal, freeFrame: frame number | false | null, victim: {page, frame, dirty}, source: 'swap' | 'zero' | 'file',
//                   costs}) -> {steps: [{kind, cost, t, say}], total, killed, frame}
//     kinds: 'trap', 'check', 'kill' (an illegal address ends it), 'frame' (a free one, or the victim chosen),
//     'writeBack' (a dirty victim goes to swap first), 'read' or 'zero' (bring the page in, or fill it with zeros),
//     'update' (the PTE gets the frame and the valid bit), 'restart' (the instruction runs again)
//   S.VM.eat({mem, fault, p}) -> {us, say}   (1 − p)·mem + p·fault, in µs
//   S.VM.maxFaultRate({mem, fault, slowdown}) -> p   the largest fault rate that keeps the slowdown below the
//     given fraction (0.1: ten percent)
//   S.VM.demand({refs, frames, policy, opts, anon: [pages], costs}) -> {steps, faults, writeBacks, total, eat,
//     rate, run}   refs as for S.Mem.replace; an anonymous page fills with zeros the first time (and again while
//     it has never been written out), any other page is read from its file or from swap
(function (S) {
  'use strict';
  const V = (S.VM = S.VM || {});
  V.COSTS = { mem: 0.1, trap: 1, check: 0.5, find: 1, writeBack: 8000, read: 8000, zero: 2, update: 0.2, restart: 1 };
  const us = (v) => (v >= 1000 ? +(v / 1000).toFixed(3) + ' ms' : +v.toFixed(2) + ' µs');

  V.faultPath = function (o) {
    const c = Object.assign({}, V.COSTS, o.costs || {}), steps = [];
    let t = 0;
    const add = (kind, cost, say, more) => { t += cost; steps.push(Object.assign({ kind, cost, t, say: say + ' (' + us(cost) + ')' }, more || {})); };
    add('trap', c.trap, 'The ' + (o.write ? 'write' : 'read') + ' to page ' + o.page + ' finds its valid bit clear: the MMU traps to the kernel, which saves the registers');
    if (o.legal === false) {
      add('check', c.check, 'The kernel looks the address up in the process’s memory map: it lies in no region');
      add('kill', 0, 'An illegal address: the process gets a segmentation fault, and nothing is paged in');
      return { steps, total: t, killed: true, frame: -1 };
    }
    add('check', c.check, 'The kernel checks the process’s memory map: page ' + o.page + ' is legal, just not in memory');
    let frame;
    if (typeof o.freeFrame === 'number' && o.freeFrame >= 0) { frame = o.freeFrame; add('frame', c.find, 'A free frame is on the free list: frame ' + frame); }
    else {
      const v = o.victim;
      frame = v.frame;
      add('frame', c.find, 'No frame is free: the replacement policy picks page ' + v.page + ' in frame ' + v.frame + ' and clears its PTE’s valid bit', { victim: v.page });
      if (v.dirty) add('writeBack', c.writeBack, 'Page ' + v.page + ' is dirty, so it is written to swap first; the process waits and another runs');
    }
    if (o.source === 'zero') add('zero', c.zero, 'Page ' + o.page + ' is anonymous and new: frame ' + frame + ' is filled with zeros, with no disk read');
    else add('read', c.read, 'Page ' + o.page + ' is read from ' + (o.source === 'file' ? 'its file' : 'swap') + ' into frame ' + frame + '; the process sleeps until the disk interrupt');
    add('update', c.update, 'The PTE for page ' + o.page + ' gets frame ' + frame + ' and its valid bit' + (o.write ? ', and the dirty bit as the write lands' : ''));
    add('restart', c.restart, 'The process is ready again; the faulting instruction restarts and this time finds the page');
    return { steps, total: t, killed: false, frame };
  };

  V.eat = function (o) {
    const v = (1 - o.p) * o.mem + o.p * o.fault;
    return { us: v, say: 'EAT = (1 − ' + o.p + ') × ' + us(o.mem) + ' + ' + o.p + ' × ' + us(o.fault) + ' = ' + us(v) + ', ' + +(v / o.mem).toFixed(1) + ' times a memory access.' };
  };
  V.maxFaultRate = (o) => (o.slowdown * o.mem) / (o.fault - o.mem);

  V.demand = function (o) {
    const M = S.Mem, c = Object.assign({}, V.COSTS, o.costs || {}), run = M.replace(o.policy || 'lru', o.refs, o.frames, o.opts);
    const anon = new Set(o.anon || []), onDisk = new Set();
    let total = 0;
    const steps = run.steps.map((st) => {
      if (st.hit) { total += c.mem; return { kind: 'hit', i: st.i, page: st.page, us: c.mem, rep: st, say: 'Reference ' + (st.i + 1) + ': page ' + st.page + ' is resident, ' + us(c.mem) + '.' }; }
      const victim = st.victim === null ? null : { page: st.victim, frame: st.victimSlot, dirty: st.writeBack };
      if (victim && victim.dirty) onDisk.add(victim.page);
      const source = anon.has(st.page) && !onDisk.has(st.page) ? 'zero' : anon.has(st.page) ? 'swap' : 'file';
      const p = V.faultPath({ page: st.page, write: st.write, freeFrame: st.free ? st.slot : null, victim, source, costs: c });
      total += p.total + c.mem;
      return { kind: 'fault', i: st.i, page: st.page, us: p.total + c.mem, path: p.steps, rep: st, say: 'Reference ' + (st.i + 1) + ': page ' + st.page + ' faults; the path costs ' + us(p.total) + (victim ? (victim.dirty ? ', with a write-back of page ' + victim.page : ', evicting clean page ' + victim.page) : '') + (source === 'zero' ? ', zero-filled' : '') + '.' };
    });
    const n = steps.length;
    return { steps, faults: run.faults, writeBacks: run.writeBacks, total, eat: n ? total / n : 0, rate: n ? run.faults / n : 0, run, say: S.Mem.count(run.faults, 'fault') + ' in ' + S.Mem.count(n, 'reference') + ' (' + run.writeBacks + ' write-backs): ' + us(total) + ' in all, an effective access time of ' + us(n ? total / n : 0) + '.' };
  };

  (S.engines = S.engines || []).push({ name: 'Demand paging' });
})(globalThis.Proses = globalThis.Proses || {});
