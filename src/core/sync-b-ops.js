// The primitives of the thread-step machine (sync-a-machine.js), one step each. S.Sync.ops[name] = {run(M, th, o)
// -> {kind, say, woke}, fp(M, th, o) -> {r, w}} where r and w name the shared objects read and written ('m:id' a
// mutex, 's:id' a semaphore, 'c:id' a condition, 'rw:id', 'b:id' a barrier, 'v:name' a variable); a step with an
// empty footprint touches only its own thread and commutes with every other thread's step.
// Values: idx is a number, a variable's name, or fn(reg, th); val is a value (a string is a literal) or fn(reg, th);
// jump and local tests
// see only the thread's registers (reg), so they stay local.
//   locks       lock m · unlock m · trylock m into          (a mutex: an owner and a sleep queue, handed over on unlock;
//                                                            m may be fn(reg, th) naming the mutex at run time)
//   semaphores  wait s · post s                             (counting; binary: true in the spec caps the value at 1)
//   conditions  cwait c m · signal c · broadcast c          (Mesa by default; spec.hoare: the signaller waits instead)
//   rw locks    rlock l · wlock l · runlock l · wunlock l    (policy 'reader', 'writer' or 'fair', from the spec)
//   barrier     barrier b                                   (the n-th arrival releases all)
//   memory      read v idx into · write v idx val · update v idx (fn | by, mod) · log v val (append)
//   atomics     tas v idx into · cas v idx expect val into · faa v idx by (mod) into · xchg v idx val into · fence
//               (each drains the thread's store buffer first; cas sets into to 1 on success, 0 on failure)
//   control     jump to if(reg, th) · local fn(reg, th) · assert fn(vars, th) · enter · leave (the critical section)
//               · choose n into (a value 0..n−1 the schedule picks: see M.choices) · atomic fn(vars, reg, th) w
//               (a block of shared updates done as one step: a modelling shortcut for code already under a lock;
//               w and r list the variables it writes and reads)
//   activity    think · work · eat (eat counts a meal)
(function (S) {
  'use strict';
  const Y = (S.Sync = S.Sync || {});
  const show = (v) => (v === null || v === undefined ? '–' : Array.isArray(v) ? '[' + v.map(show).join(', ') + ']' : String(v));
  const NONE = { r: [], w: [] };
  const val = (M, th, x) => (typeof x === 'function' ? x(th.reg, th) : x);
  const at = (M, th, o) => (o.idx === undefined ? null : typeof o.idx === 'string' ? M.load(th, o.idx, null) : val(M, th, o.idx));
  const where = (o, i) => o.v + (i === null ? '' : '[' + i + ']');
  const idxReads = (o) => (typeof o.idx === 'string' ? ['v:' + o.idx] : []);
  /** a memory op's footprint: under tso a plain store only reaches the thread's own buffer (unless the buffer is
   *  full, when its oldest store goes to memory first) */
  const memW = (M, th, o) => ({ r: idxReads(o), w: M.tso ? (th.sb.length >= M.sbCap ? ['v:' + th.sb[0][0]] : []) : ['v:' + o.v] });
  const drained = (M, th, extra) => ({ r: [], w: [...new Set(th.sb.map((s) => 'v:' + s[0]).concat(extra))] });

  /** a mutex named in the op, or computed from the registers (a lock per list node: m: (reg) => 'n' + reg.c) */
  const mid = (o, th) => (typeof o.m === 'function' ? o.m(th.reg, th) : o.m);
  Y.mid = mid;
  const ops = (Y.ops = {});
  ops.lock = {
    fp: (M, th, o) => ({ r: [], w: ['m:' + mid(o, th)] }),
    run(M, th, o) {
      const mx = M.mutex[mid(o, th)], name = th.name;
      if (mx.owner === th.id) return { kind: 'error', say: `${name} locks ${mx.name} again, but it already owns it: a mutex is not recursive, so this thread would wait for itself forever.` };
      if (mx.owner === null) { mx.owner = th.id; M.advance(th); return { kind: 'acquire', say: `${name} locks ${mx.name}: it was free, so ${name} now owns it.` }; }
      mx.queue.push(th.id); M.block(th, 'mutex', mx.id);
      return { kind: 'block', say: `${name} tries to lock ${mx.name}, but ${M.nm(mx.owner)} owns it: ${name} blocks, and the queue of ${mx.name} is ${M.qs(mx.queue)}.` };
    },
  };
  ops.trylock = {
    fp: (M, th, o) => ({ r: [], w: ['m:' + mid(o, th)] }),
    run(M, th, o) {
      const mx = M.mutex[mid(o, th)], ok = mx.owner === null;
      if (ok) mx.owner = th.id;
      th.reg[o.into || 'ok'] = ok ? 1 : 0; M.advance(th);
      return { kind: ok ? 'acquire' : 'try-fail', say: ok ? `${th.name} tries ${mx.name}: it was free, so ${th.name} owns it now.` : `${th.name} tries ${mx.name}, but ${M.nm(mx.owner)} owns it: the try fails at once and ${th.name} does not block.` };
    },
  };
  ops.unlock = {
    fp: (M, th, o) => ({ r: [], w: ['m:' + mid(o, th)] }),
    run(M, th, o) {
      const mx = M.mutex[mid(o, th)];
      if (mx.owner !== th.id) return { kind: 'error', say: `${th.name} unlocks ${mx.name}, which it does not own (${mx.owner === null ? 'nobody does' : M.nm(mx.owner) + ' does'}): an error.` };
      M.advance(th);
      const w = M.giveMutex(mx);
      if (w === null) return { kind: 'release', say: `${th.name} unlocks ${mx.name}: nobody waits, so ${mx.name} is free.` };
      return { kind: 'handoff', woke: w, say: `${th.name} unlocks ${mx.name} and hands it to ${M.nm(w)}, first in line, which wakes owning it; the queue is now ${M.qs(mx.queue)}.` };
    },
  };
  ops.wait = {
    fp: (M, th, o) => ({ r: [], w: ['s:' + o.s] }),
    run(M, th, o) {
      const s = M.sem[o.s];
      if (s.value > 0) { s.value--; M.advance(th); return { kind: 'pass', say: `${th.name} waits on ${s.name}: its value is above 0, so it goes from \`${s.value + 1}\` to \`${s.value}\` and ${th.name} goes on.` }; }
      s.queue.push(th.id); M.block(th, 'sem', s.id);
      return { kind: 'block', say: `${th.name} waits on ${s.name}: its value is \`0\`, so ${th.name} blocks; the queue of ${s.name} is ${M.qs(s.queue)}.` };
    },
  };
  ops.post = {
    fp: (M, th, o) => ({ r: [], w: ['s:' + o.s] }),
    run(M, th, o) {
      const s = M.sem[o.s];
      M.advance(th);
      if (!s.queue.length) {
        const was = s.value;
        s.value = s.binary ? 1 : s.value + 1;
        return { kind: 'post', say: s.binary && was === 1 ? `${th.name} posts ${s.name}, which is binary and already \`1\`: the post is lost.` : `${th.name} posts ${s.name}: nobody waits, so its value goes from \`${was}\` to \`${s.value}\`.` };
      }
      const w = s.queue.shift(); M.wake(M.T(w));
      return { kind: 'wake', woke: w, say: `${th.name} posts ${s.name}: ${M.nm(w)} was waiting, so it wakes and passes its wait; the value stays \`${s.value}\` and the queue is ${M.qs(s.queue)}.` };
    },
  };
  ops.cwait = {
    fp: (M, th, o) => ({ r: [], w: ['c:' + o.c, 'm:' + o.m] }),
    run(M, th, o) {
      const c = M.cond[o.c], mx = M.mutex[o.m];
      if (mx.owner !== th.id) return { kind: 'error', say: `${th.name} waits on ${c.name} without holding ${mx.name}: an error, since the test and the wait would not be atomic.` };
      c.queue.push(th.id); M.block(th, 'cond', c.id); th.reacquire = mx.id;
      const w = M.giveMutex(mx);
      return { kind: 'cwait', woke: w, say: `${th.name} waits on ${c.name}: it releases ${mx.name}${w === null ? ', now free,' : ' (to ' + M.nm(w) + ')'} and sleeps; the queue of ${c.name} is ${M.qs(c.queue)}.` };
    },
  };
  const condFp = (M, th, o) => ({ r: [], w: ['c:' + o.c, ...new Set(M.cond[o.c].queue.map((w) => 'm:' + M.T(w).reacquire))] });
  function condWake(M, th, o, all) {
    const c = M.cond[o.c], verb = all ? 'broadcasts' : 'signals';
    if (!c.queue.length) { M.advance(th); return { kind: 'lost', say: `${th.name} ${verb} ${c.name}, but nobody waits: the ${all ? 'broadcast' : 'signal'} is lost (a condition variable keeps no count).` }; }
    if (M.hoare && !all) {
      // Hoare: the woken thread runs at once, holding the monitor; the signaller waits first in line to get it back
      const w = c.queue.shift(), wt = M.T(w), mx = M.mutex[wt.reacquire];
      if (mx.owner !== th.id) return { kind: 'error', say: `${th.name} signals ${c.name} without holding ${mx.name}: with Hoare semantics the signaller must hand the monitor over.` };
      wt.reacquire = null; mx.owner = w; M.wake(wt);
      M.advance(th); th.resume = true; M.block(th, 'mutex', mx.id); mx.urgent.push(th.id);
      return { kind: 'csignal', woke: [w], say: `${th.name} signals ${c.name}: with Hoare semantics ${M.nm(w)} takes ${mx.name} at once and runs, while ${th.name} waits to get it back.` };
    }
    M.advance(th);
    const moved = all ? c.queue.splice(0) : [c.queue.shift()];
    for (const w of moved) {
      const wt = M.T(w), mx = M.mutex[wt.reacquire];
      wt.reacquire = null;
      if (mx.owner === null) { mx.owner = w; M.wake(wt); } else { mx.queue.push(w); wt.on = { kind: 'mutex', id: mx.id }; }
    }
    return { kind: 'csignal', woke: moved, say: `${th.name} ${verb} ${c.name}: ${moved.map((w) => M.nm(w)).join(', ')} ${moved.length > 1 ? 'leave' : 'leaves'} its queue and must take the mutex back before returning from the wait (Mesa: by then the condition may be false again).` };
  }
  ops.signal = { fp: condFp, run: (M, th, o) => condWake(M, th, o, false) };
  ops.broadcast = { fp: condFp, run: (M, th, o) => condWake(M, th, o, true) };

  // ---- reader–writer locks ---------------------------------------------------------------------------------------
  const writersWaiting = (l) => l.queue.some((q) => q.mode === 'w');
  function canRead(l) { return l.writer === null && (l.policy === 'reader' ? true : l.policy === 'writer' ? !writersWaiting(l) : !l.queue.length); }
  function canWrite(l) { return l.writer === null && !l.readers.length && (l.policy === 'fair' ? !l.queue.length : true); }
  /** after a release: hand the lock to whoever the policy prefers; returns the threads woken */
  function grant(M, l) {
    const woke = [], take = (q) => { l.queue.splice(l.queue.indexOf(q), 1); if (q.mode === 'r') l.readers.push(q.tid); else l.writer = q.tid; M.wake(M.T(q.tid)); woke.push(q.tid); };
    if (l.policy === 'fair') {
      while (l.queue.length) { const q = l.queue[0]; if (q.mode === 'r' && l.writer === null) take(q); else if (q.mode === 'w' && l.writer === null && !l.readers.length) { take(q); break; } else break; }
    } else if (l.policy === 'writer' && writersWaiting(l)) {
      if (l.writer === null && !l.readers.length) take(l.queue.find((q) => q.mode === 'w'));
    } else {
      if (l.writer === null) for (const q of l.queue.filter((x) => x.mode === 'r')) take(q);
      if (!woke.length && l.writer === null && !l.readers.length && l.queue.length) take(l.queue.find((q) => q.mode === 'w'));
    }
    return woke;
  }
  const rwFp = (M, th, o) => ({ r: [], w: ['rw:' + o.l] });
  const holders = (M, l) => (l.writer !== null ? M.nm(l.writer) + ' writing' : l.readers.length ? l.readers.map((i) => M.nm(i)).join(', ') + ' reading' : 'nobody');
  ops.rlock = {
    fp: rwFp,
    run(M, th, o) {
      const l = M.rw[o.l];
      if (canRead(l)) { l.readers.push(th.id); M.advance(th); return { kind: 'acquire', say: `${th.name} takes ${l.name} to read; readers now ${l.readers.map((i) => M.nm(i)).join(', ')}.` }; }
      l.queue.push({ tid: th.id, mode: 'r' }); M.block(th, 'rw', l.id);
      return { kind: 'block', say: `${th.name} wants to read ${l.name}, but ${l.writer !== null ? M.nm(l.writer) + ' is writing' : 'a writer is waiting and this lock favours ' + (l.policy === 'fair' ? 'arrival order' : 'writers')}: it blocks.` };
    },
  };
  ops.wlock = {
    fp: rwFp,
    run(M, th, o) {
      const l = M.rw[o.l];
      if (canWrite(l)) { l.writer = th.id; M.advance(th); return { kind: 'acquire', say: `${th.name} takes ${l.name} to write: nobody else holds it.` }; }
      l.queue.push({ tid: th.id, mode: 'w' }); M.block(th, 'rw', l.id);
      return { kind: 'block', say: `${th.name} wants to write ${l.name}, but it is held (${holders(M, l)}): it blocks.` };
    },
  };
  function rwUnlock(M, th, o, mode) {
    const l = M.rw[o.l];
    if (mode === 'r' ? !l.readers.includes(th.id) : l.writer !== th.id) return { kind: 'error', say: `${th.name} releases ${l.name} without holding it to ${mode === 'r' ? 'read' : 'write'}.` };
    if (mode === 'r') l.readers.splice(l.readers.indexOf(th.id), 1); else l.writer = null;
    M.advance(th);
    const woke = grant(M, l);
    return { kind: woke.length ? 'handoff' : 'release', woke, say: `${th.name} stops ${mode === 'r' ? 'reading' : 'writing'} ${l.name}${woke.length ? '; the lock passes to ' + woke.map((i) => M.nm(i)).join(', ') : ''}; now ${holders(M, l)}.` };
  }
  ops.runlock = { fp: rwFp, run: (M, th, o) => rwUnlock(M, th, o, 'r') };
  ops.wunlock = { fp: rwFp, run: (M, th, o) => rwUnlock(M, th, o, 'w') };

  ops.barrier = {
    fp: (M, th, o) => ({ r: [], w: ['b:' + o.b] }),
    run(M, th, o) {
      const b = M.barrier[o.b];
      if (b.waiting.length + 1 < b.n) { b.waiting.push(th.id); M.block(th, 'barrier', b.id); return { kind: 'block', say: `${th.name} reaches ${b.name}: ${b.waiting.length} of ${b.n} have arrived, so it waits.` }; }
      const woke = b.waiting.splice(0);
      for (const w of woke) M.wake(M.T(w));
      b.gen++; M.advance(th);
      return { kind: 'release', woke, say: `${th.name} is the last of ${b.n} to reach ${b.name}: everyone passes together.` };
    },
  };

  // ---- memory and atomics --------------------------------------------------------------------------------------
  ops.read = {
    fp: (M, th, o) => ({ r: ['v:' + o.v, ...idxReads(o)], w: [] }),
    run(M, th, o) {
      const i = at(M, th, o), v = M.load(th, o.v, i);
      th.reg[o.into || o.v] = Array.isArray(v) ? v.slice() : v; M.advance(th);
      return { kind: 'read', say: `${th.name} reads ${where(o, i)}: \`${show(v)}\`${M.tso && th.sb.some((s) => s[0] === o.v) ? ' (from its own store buffer)' : ''}.` };
    },
  };
  ops.write = {
    fp: memW,
    run(M, th, o) {
      const i = at(M, th, o), v = val(M, th, o.val === undefined ? null : o.val);
      M.store(th, o.v, i, v); M.advance(th);
      const buf = M.tso ? ' into its store buffer: other threads cannot see it yet' : '';
      if (v === null) return { kind: 'write', say: `${th.name} clears ${where(o, i)}${buf}.` };
      return { kind: 'write', say: `${th.name} writes \`${show(v)}\` to ${where(o, i)}${buf}.` };
    },
  };
  ops.update = {
    fp: (M, th, o) => { const d = drained(M, th, ['v:' + o.v]); d.r = idxReads(o); return d; },
    run(M, th, o) {
      M.drain(th);
      const i = at(M, th, o), old = M.load(th, o.v, i);
      let nv = o.fn ? o.fn(old, th.reg, th) : old + (o.by === undefined ? 1 : o.by);
      if (o.mod) nv = ((nv % o.mod) + o.mod) % o.mod;
      M.store(th, o.v, i, nv, true); M.advance(th);
      return { kind: 'update', say: `${th.name} updates ${where(o, i)} from \`${show(old)}\` to \`${show(nv)}\` in one step.` };
    },
  };
  ops.log = {
    fp: (M, th, o) => drained(M, th, ['v:' + o.v]),
    run(M, th, o) {
      const v = val(M, th, o.val); M.drain(th);
      M.vars[o.v] = M.vars[o.v].concat([v]); M.advance(th);
      return { kind: 'log', say: `${th.name} ${o.label || 'records'} \`${show(v)}\`.` };
    },
  };
  ops.tas = {
    fp: (M, th, o) => drained(M, th, ['v:' + o.v]),
    run(M, th, o) {
      M.drain(th);
      const i = at(M, th, o), old = M.load(th, o.v, i);
      M.store(th, o.v, i, 1, true); th.reg[o.into || 'old'] = old; M.advance(th);
      return { kind: 'atomic', say: `${th.name} test-and-sets ${where(o, i)}: it was \`${old}\`, now \`1\`, in one indivisible step${old ? ', so the lock was taken already' : ', so the lock is ' + th.name + "'s"}.` };
    },
  };
  ops.cas = {
    fp: (M, th, o) => drained(M, th, ['v:' + o.v]),
    run(M, th, o) {
      M.drain(th);
      const i = at(M, th, o), old = M.load(th, o.v, i), exp = val(M, th, o.expect), nv = val(M, th, o.val), ok = old === exp;
      if (ok) M.store(th, o.v, i, nv, true);
      th.reg[o.into || 'ok'] = ok ? 1 : 0; if (o.old) th.reg[o.old] = old; M.advance(th);
      return { kind: 'atomic', say: ok ? `${th.name} compare-and-swaps ${where(o, i)}: it holds the expected \`${exp}\`, so it becomes \`${nv}\`.` : `${th.name} compare-and-swaps ${where(o, i)}: it holds \`${old}\`, not the expected \`${exp}\`, so nothing changes.` };
    },
  };
  ops.faa = {
    fp: (M, th, o) => drained(M, th, ['v:' + o.v]),
    run(M, th, o) {
      M.drain(th);
      const i = at(M, th, o), old = M.load(th, o.v, i), by = o.by === undefined ? 1 : o.by, nv = o.mod ? (old + by) % o.mod : old + by;
      M.store(th, o.v, i, nv, true); th.reg[o.into || 'old'] = old; M.advance(th);
      return { kind: 'atomic', say: `${th.name} fetch-and-adds ${where(o, i)}: it gets \`${old}\` and leaves \`${nv}\`, in one step.` };
    },
  };
  ops.xchg = {
    fp: (M, th, o) => drained(M, th, ['v:' + o.v]),
    run(M, th, o) {
      M.drain(th);
      const i = at(M, th, o), old = M.load(th, o.v, i), nv = val(M, th, o.val);
      M.store(th, o.v, i, nv, true); th.reg[o.into || 'old'] = old; M.advance(th);
      return { kind: 'atomic', say: `${th.name} swaps \`${show(nv)}\` into ${where(o, i)} and gets back \`${show(old)}\`, in one step.` };
    },
  };
  ops.fence = {
    fp: (M, th) => drained(M, th, []),
    run(M, th) { const n = th.sb.length; M.drain(th); M.advance(th); return { kind: 'fence', say: `${th.name} runs a fence: ${n ? 'its ' + n + ' buffered store' + (n > 1 ? 's reach' : ' reaches') + ' memory first' : 'its store buffer is already empty'}.` }; },
  };

  // ---- control and activity ---------------------------------------------------------------------------------------
  ops.jump = {
    fp: () => NONE,
    run(M, th, o) {
      const go = !o.if || o.if(th.reg, th);
      if (go) { if (o.to >= th.prog.length) { th.pc = th.prog.length - 1; M.advance(th); } else th.pc = o.to; } else M.advance(th);
      return { kind: 'jump', taken: go, say: o.say ? o.say(go, th.reg, th) : o.if ? `${th.name} tests ${o.label || 'its condition'}: ${go ? 'true, so it jumps' : 'false, so it goes straight on'}.` : `${th.name} jumps (${o.label || 'to another line'}).` };
    },
  };
  ops.atomic = {
    fp: (M, th, o) => { const d = drained(M, th, (o.w || []).map((v) => 'v:' + v)); d.r = (o.r || []).map((v) => 'v:' + v); return d; },
    run(M, th, o) {
      M.drain(th); o.fn(M.vars, th.reg, th); M.advance(th);
      return { kind: 'atomic', say: o.say ? o.say(M.vars, th.reg, th) : `${th.name} ${o.label || 'updates the shared counts'} in one step.` };
    },
  };
  ops.choose = { fp: () => NONE, run() { throw new Error('a choose op is stepped through its choices'); } };
  ops.local = { fp: () => NONE, run(M, th, o) { o.fn(th.reg, th); M.advance(th); return { kind: 'local', say: o.say ? o.say(th.reg, th) : `${th.name} ${o.label || 'computes in its registers'}.` }; } };
  ops.assert = {
    fp: (M, th, o) => ({ r: (o.reads || Object.keys(M.vars)).map((v) => 'v:' + v), w: [] }),
    run(M, th, o) {
      const ok = o.fn(M.vars, th, M);
      if (!ok) return { kind: 'assert', say: `Assertion failed in ${th.name}: ${o.label || 'a check'} does not hold.` };
      M.advance(th); return { kind: 'check', say: `${th.name} checks that ${o.label || 'all is well'}: it holds.` };
    },
  };
  ops.enter = { fp: () => NONE, run(M, th) { th.cs++; M.advance(th); return { kind: 'enter', say: `${th.name} enters its critical section.` }; } };
  ops.leave = { fp: () => NONE, run(M, th) { th.cs--; M.advance(th); return { kind: 'leave', say: `${th.name} leaves its critical section.` }; } };
  ops.think = { fp: () => NONE, run(M, th, o) { M.advance(th); return { kind: 'think', say: `${th.name} ${o.label || 'thinks'}.` }; } };
  ops.work = { fp: () => NONE, run(M, th, o) { M.advance(th); return { kind: 'work', say: `${th.name} ${o.label || 'works on its own data'}.` }; } };
  ops.eat = { fp: () => NONE, run(M, th, o) { th.meals++; M.advance(th); return { kind: 'eat', say: `${th.name} ${o.label || 'eats'}: meal \`${th.meals}\`.` }; } };
})(globalThis.Proses = globalThis.Proses || {});
