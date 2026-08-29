// Part 4, thread cancellation, on the thread-step machine (S.Sync) with the model checker (S.MC). Asynchronous
// cancellation may stop a thread between any two steps, so the model lets the worker stop after any of them;
// deferred cancellation stops it only at a cancellation point, here outside the lock. The checker searches every
// schedule: it finds the one where the worker dies holding the mutex and the reader waits for ever, and it proves
// the deferred version clean.
(function (S) {
  'use strict';
  const H = S.P04, P7 = () => S.P07, K7 = () => S.Kit.sync7;

  function spec(mode) {
    const chk = (k) => [{ op: 'read', v: 'cancel', into: 'c', label: 'cancelled yet?' }, { op: 'jump', to: 'dead', if: (r) => r.c === 1, label: 'if so, stop here' }];
    const body = [{ op: 'lock', m: 'm', label: 'lock(m)' }, { op: 'write', v: 'acct', val: 'half', label: 'acct = half-updated' }, { op: 'write', v: 'acct', val: 'whole', label: 'acct = updated' }, { op: 'unlock', m: 'm', label: 'unlock(m)' }];
    let w;
    if (mode === 'async') { w = []; body.forEach((o, i) => { if (i) w.push(...chk(i)); w.push(o); }); w.unshift(...chk(0)); }
    else w = [...chk(0), ...body, ...chk(9)];
    w.push({ op: 'jump', to: 'end', label: 'return normally' }, { label: 'dead' }, { op: 'work', label: 'exits, cancelled' }, { label: 'end' });
    const threads = [
      { name: 'W', prog: w },
      { name: 'C', prog: [{ op: 'write', v: 'cancel', val: 1, label: 'pthread_cancel(W)' }] },
      { name: 'R', prog: [{ op: 'lock', m: 'm', label: 'lock(m)' }, { op: 'read', v: 'acct', into: 'a', label: 'a = acct' }, { op: 'assert', label: 'assert(acct is whole)', reads: [], fn: (V, th) => th.reg.a !== 'half' }, { op: 'unlock', m: 'm', label: 'unlock(m)' }] },
    ];
    const sp = { threads, mutexes: [{ id: 'm', name: 'm' }], vars: { cancel: 0, acct: 'old' } };
    sp.check = { invariants: [], liveness: [], deadlock: true };
    return sp;
  }

  H.topic({
    id: 'thr-cancel', family: 'p04-api', order: 30, title: 'Cancelling a thread: asynchronous or deferred',
    blurb: 'pthread_cancel asks another thread to stop. Stopped asynchronously, at any instruction, a thread can die in the middle of an update while holding a lock, and the lock is never released. Deferred cancellation, the default, waits until the thread reaches a cancellation point, a place where stopping is safe. The model checker tries every moment the cancel could land.',
    inputs: [{ id: 'mode', kind: 'choice', label: 'Cancellation', def: 'async', options: [{ value: 'async', label: 'asynchronous: at any step' }, { value: 'deferred', label: 'deferred: at cancellation points' }] }],
    presets: [{ label: 'Asynchronous', values: { mode: 'async' } }, { label: 'Deferred', values: { mode: 'deferred' } }],
    counters: [{ id: 'step', label: 'step' }],
    run(inp) {
      const sp = spec(inp.mode), C = P7().check(sp), F = new S.Frames(['step']);
      const vd = P7().verdictText(C);
      const sched = C.sched || [];
      const strip = sched.length ? P7().stripSteps(sp, sched) : [];
      function picture(st, o) {
        o = o || {};
        const items = [];
        items.push(...P7().code('cw', 0, 0, sp, st, [0], { act: o.act, line: o.line, title: 'W, the worker', textW: 220, lh: 26, size: 13, markW: 26 }).items);
        items.push(...P7().code('cc', 310, 0, sp, st, [1], { act: o.act, line: o.line, title: 'C, the canceller', textW: 200, lh: 26, size: 13, markW: 26 }).items);
        items.push(...P7().code('cr', 310, 80, sp, st, [2], { act: o.act, line: o.line, title: 'R, the reader', textW: 200, lh: 26, size: 13, markW: 26 }).items);
        items.push(...K7().threads({ prefix: 'tc', x: 590, y: 6, threads: P7().cards(sp, st, o.act, { sub: (th) => (th.state === 'done' ? (th.id === 0 && st.mutex.m.owner === 0 ? 'died' : 'done') : th.state === 'blocked' ? 'blocked' : 'line ' + (th.pc + 1)) }), w: 58, h: 32, gap: 8, perRow: 3 }).items);
        items.push(...K7().mutex({ prefix: 'mx', x: 590, y: 104, name: 'm', owner: st.mutex.m.owner === null ? null : st.threads[st.mutex.m.owner].name, ownerCls: st.mutex.m.owner !== null && st.threads[st.mutex.m.owner].state === 'done' ? 'ghost' : '', queue: st.mutex.m.queue.map((i) => st.threads[i].name), act: o.obj === 'm', nameW: 26, ownerW: 52 }).items);
        items.push(...K7().vars({ prefix: 'vv', x: 590, y: 170, rows: [{ name: 'cancel', value: st.vars.cancel, act: o.obj === 'cancel' }, { name: 'acct', value: st.vars.acct, act: o.obj === 'acct', hot: st.vars.acct === 'half' && st.threads[0].state === 'done' }], nameW: 64, valW: 80, rowH: 34 }).items);
        if (strip.length) items.push(...K7().strip({ prefix: 'sc', x: 310, y: 250, w: 490, steps: strip, upto: o.upto === undefined ? 0 : o.upto, cw: 34, ch: 26, title: 'the schedule the checker found' }).items);
        if (o.verdict) items.push(...K7().verdict({ prefix: 'vd', x: 310, y: strip.length ? 340 : 250, w: 490, kind: vd.kind, head: vd.head, lines: o.verdict }).items);
        return items;
      }
      const M0 = S.Sync.machine(sp), st0 = M0.snap();
      F.add({ items: picture(st0), say: inp.mode === 'async' ? `W updates acct under the lock m. C cancels W. R then reads acct under m. Cancelled asynchronously, W may stop after any of its steps, so the model gives it a check before each one: ${sp.threads[0]._asm.length} lines in all.` : `W updates acct under the lock m, and looks for a cancel only before taking m and after releasing it: those are its cancellation points. C cancels W; R reads acct under m.`, meta: { vals: [sp.threads[0]._asm.length] } });
      const stl = C.stats;
      F.add({ items: picture(st0, { verdict: C.res.safety.violation ? ['searched ' + stl.states + ' states', 'a schedule of ' + sched.length + ' steps fails'] : ['all ' + stl.states + ' reachable states checked', 'no deadlock, R never sees half'] }), say: C.res.safety.violation ? `The checker searches the schedules and finds a failure after ${stl.states} states: a schedule of ${sched.length} steps ends in a deadlock. Step through it.` : `The checker explores every schedule: all ${stl.states} reachable states, and in none of them is a thread stuck or R shown a half-updated account. Wherever the cancel lands, W stops only where it holds nothing.`, meta: { vals: [stl.states, sched.length] } });
      (C.steps || []).forEach((s, k) => {
        F.set('step', k + 1);
        const nxt = C.steps[k + 1];
        F.add({ items: picture(s.state, { act: s.tid, line: s.pc, obj: s.obj, upto: k + 1 }), say: s.say + (s.label === 'exits, cancelled' && s.state.mutex.m.owner === 0 ? ' It still owns m: nobody will ever unlock it.' : ''), meta: { vals: [k + 1, s.pc + 1], next: nxt ? nxt.name : null, options: nxt ? ['W', 'C', 'R'] : null } });
      });
      if (!C.res.safety.violation) {
        const run = S.Sync.run(sp, { policy: 'rr', quantum: 2 });
        run.steps.forEach((s, k) => {
          F.set('step', k + 1);
          F.add({ items: picture(s.state, { act: s.tid, line: s.pc, obj: s.obj }), say: (k === 0 ? 'One schedule of them, round robin with 2 steps each: ' : '') + s.say + (s.label === 'exits, cancelled' ? ' It stops here, at a cancellation point, holding nothing.' : ''), meta: { vals: [k + 1, 2, s.pc + 1] } });
        });
        F.add({ items: picture(run.machine.snap(), { verdict: ['all ' + stl.states + ' reachable states checked', 'no deadlock, R never sees half'] }), say: `${run.end.say} acct is \`${run.machine.vars.acct}\` and m is free: W saw the cancel only at a cancellation point.`, meta: { vals: [stl.states, run.end.t] } });
      }
      if (C.res.safety.violation) {
        const last = C.steps[C.steps.length - 1].state;
        F.add({ items: picture(last, { upto: sched.length, verdict: ['W died owning m', 'R waits for m for ever'] }), say: `${C.res.safety.violation.say} W was cancelled between lock(m) and unlock(m), so m stays locked by a thread that no longer exists, and acct is left \`${last.vars.acct}\`. Deferred cancellation, or a cleanup handler that unlocks m, prevents this.`, meta: { vals: [] } });
      }
      return { frames: F.list, def: H.def('Cancellation', ['pthread_cancel(t): a request', '', 'asynchronous', '  t may stop at any instruction', 'deferred (the default)', '  t stops at a cancellation point:', '  sleep, read, cond wait,', '  pthread_testcancel', 'pthread_cleanup_push', '  code to run on the way out,', '  such as unlock(m)']) };
    },
    predict: [{ at: (f) => !!(f.meta && f.meta.next && f.meta.options), pick: 'option', once: true, ask: 'Which thread does the failing schedule run next?', options: (fr, i) => fr[i].meta.options, answer: (fr, i) => fr[i].meta.next, explain: (fr, i) => fr[i + 1].say }, { at: (f, i) => i === 0, pick: 'option', ask: 'Can some schedule leave R waiting for ever?', options: ['yes', 'no'], answer: (fr) => (fr.some((f) => f.say.includes('deadlock')) ? 'yes' : 'no'), explain: (fr) => fr[1].say }],
    quiz: [
      { q: 'Why is asynchronous cancellation dangerous?', options: ['the thread can stop in the middle of an update, holding locks', 'it is slow', 'it cannot stop a thread', 'it kills the whole process'], answer: 0, why: 'Nothing guarantees the thread\'s invariants are restored or its locks released.' },
      { q: 'Under deferred cancellation, when does the target stop?', options: ['at its next cancellation point', 'at once', 'never', 'when it is joined'], answer: 0, why: 'Calls like sleep, read and pthread_testcancel are cancellation points.' },
      { q: 'What is pthread_cleanup_push for?', options: ['to register code, like an unlock, that runs if the thread is cancelled', 'to free the stack', 'to start a thread', 'to block cancellation for ever'], answer: 0, why: 'Cleanup handlers undo what the thread holds.' },
      { q: 'A thread is cancelled while it owns a mutex and has no cleanup handler. The mutex…', options: ['stays locked: waiters wait for ever', 'is released by the kernel', 'passes to the canceller', 'is destroyed'], answer: 0, why: 'A plain mutex has no idea its owner is gone.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
