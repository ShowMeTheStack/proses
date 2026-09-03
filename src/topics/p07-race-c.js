// Part 7, the race in real C: a program whose threads each do count++ runs on the simulated kernel at machine
// granularity (a thread can be switched between the load, the add and the store). S.Kern.outcomes lists every
// output any schedule can print; the model checker (S.MC.check over S.MC.kernel) looks for a schedule that prints
// the value asked for, and that schedule is replayed event by event: the loads and stores of count, each thread's
// register, the joins and the final printf.
(function (S) {
  'use strict';
  const H = S.P07, K7 = () => S.Kit.sync7, KP = () => S.Kit.proc;
  const HDR = '#include <stdio.h>\n#include <pthread.h>\n';
  function source(n, k, lock) {
    return [
      'int count = 0;',
      lock ? 'pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;' : null,
      'void *bump(void *arg) {',
      '    for (int i = 0; i < ' + k + '; i++) {',
      lock ? '        pthread_mutex_lock(&m);' : null,
      '        count++;',
      lock ? '        pthread_mutex_unlock(&m);' : null,
      '    }',
      '    return NULL;',
      '}',
      'int main(void) {',
      '    pthread_t t[' + n + '];',
      '    for (int i = 0; i < ' + n + '; i++)',
      '        pthread_create(&t[i], NULL, bump, NULL);',
      '    for (int i = 0; i < ' + n + '; i++)',
      '        pthread_join(t[i], NULL);',
      '    printf("%d\\n", count);',
      '    return 0;',
      '}',
    ].filter((x) => x !== null);
  }
  const SHOW = new Set(['thread', 'thread-exit', 'join', 'print', 'lock', 'unlock', 'block', 'wake']);
  // the program's own lines start after the two #include lines the kernel compiles with
  const OFF = 2;

  H.topic({
    id: 'sync-race-c', family: 'p07-race', order: 30, title: 'The race in real C',
    blurb: 'The same race in a C program with pthreads. The simulated kernel runs it a machine step at a time, so a thread can lose the CPU between the load and the store of count++. First every possible output is listed; then the model checker searches the schedules for one that prints the value you ask for, and replays it.',
    inputs: [
      { id: 'threads', kind: 'choice', label: 'Threads', def: '2', options: [{ value: '2', label: '2 threads' }, { value: '3', label: '3 threads' }] },
      { id: 'iters', kind: 'choice', label: 'count++ per thread', def: '2', options: [{ value: '1', label: 'once' }, { value: '2', label: 'twice' }, { value: '3', label: '3 times' }] },
      { id: 'lock', kind: 'choice', label: 'Around count++', def: 'none', options: [{ value: 'none', label: 'nothing' }, { value: 'mutex', label: 'a mutex' }] },
      { id: 'hunt', kind: 'choice', label: 'Hunt for', def: 'min', options: [{ value: 'min', label: 'the smallest output' }, { value: 'any', label: 'any wrong output' }] },
    ],
    check: (inp) => (+inp.threads === 3 && +inp.iters > 1 ? 'With 3 threads, one count++ each keeps the search small' : null),
    presets: [
      { label: 'Two threads, once each', values: { threads: '2', iters: '1', lock: 'none', hunt: 'min' } },
      { label: 'Twice each: can it print 2?', values: { threads: '2', iters: '2', lock: 'none', hunt: 'min' } },
      { label: 'Three threads', values: { threads: '3', iters: '1', lock: 'none', hunt: 'min' } },
      { label: 'With a mutex', values: { threads: '2', iters: '2', lock: 'mutex', hunt: 'min' } },
    ],
    counters: [{ id: 'events', label: 'events shown' }, { id: 'states', label: 'states searched' }],
    run(inp) {
      const n = +inp.threads, k = +inp.iters, lock = inp.lock === 'mutex', want = n * k;
      const lines = source(n, k, lock), src = HDR + lines.join('\n');
      const K = S.Kern, outs = K.outcomes(src, { granularity: 'machine' });
      const values = [...outs.outputs.keys()].map((x) => +x.trim()).sort((a, b) => a - b);
      const target = inp.hunt === 'min' && values[0] !== want ? values[0] : null;
      const make = S.MC.kernel(src, { granularity: 'machine' });
      const name = target === null ? 'the program prints ' + want : 'the program never prints ' + target;
      const spec = { invariants: [{ name, holds: (s) => s.status() !== 'done' || (target === null ? s.out === want + '\n' : s.out !== target + '\n') }] };
      const res = S.MC.check(make, spec, { minimal: false });
      const F = new S.Frames(['events', 'states']);
      const prog = make().sys.prog, addr = prog.globals.get('count').addr;
      const codeW = 430, rx = 460;
      const view = H.box(-8, -8, 900, 560);
      const outChips = (got) => { const items = [H.title('ot', rx, 292, 'every output a schedule can give')]; values.forEach((v, i) => items.push({ key: 'oc' + v, kind: 'cell', x: rx + i * 62, y: 302, w: 54, h: 30, rx: 15, text: String(v), size: 15, cls: 'stepcell ' + (v === want ? 'ok' : 'bad') + (got === v ? ' act' : '') })); return items; };

      function picture(sys, o) {
        o = o || {};
        const items = [], ths = sys.threads.filter((t) => t.pid === 100);
        const marks = {};
        for (const t of ths) if (t.state !== 'done') { const ln = (t.vm && t.vm.line) - OFF; if (ln > 0) (marks[ln] = marks[ln] || []).push({ pid: t.tid, cls: 's-' + (t.state === 'running' || o.act === t.tid ? 'running' : t.state) + (o.act === t.tid ? ' act' : '') + ' big13' }); }
        items.push(...KP().code({ prefix: 'cd', x: 0, y: 0, w: codeW, src: lines, lineH: 22, size: 13, tagSize: 13, title: 'race.c', act: o.line ? o.line - OFF : 0, marks }).items);
        items.push(...outChips(o.got));
        items.push(H.title('mt', rx, 14, 'shared memory'));
        const cnt = ths.length && ths[0].vm ? S.CLang.ld(ths[0].vm, addr, 'i') : null;
        items.push(...K7().vars({ prefix: 'mem', x: rx, y: 26, rows: [{ name: 'count', value: cnt === null ? '–' : cnt, act: o.what === 'store', sub: 'at address ' + addr }], nameW: 70, valW: 64 }).items);
        items.push(H.title('rt', rx, 98, 'threads and their registers'));
        ths.forEach((t, i) => {
          const reg = o.regs[t.tid];
          items.push(...K7().regs({ prefix: 'rg' + t.tid, x: rx, y: 110 + i * 40, name: String(t.tid), cls: 's-' + (o.act === t.tid ? 'running' : t.state === 'running' ? 'ready' : t.state), act: o.act === t.tid, regs: [['r', reg === undefined ? '–' : reg]], hot: o.act === t.tid && (o.what === 'load' || o.what === 'op') ? 0 : undefined, nameW: 52, cw: 66 }).items);
          items.push(H.text('rs' + t.tid, rx + 140, 130 + i * 40, t.tid === 100 ? 'main' : t.state === 'done' ? 'ended' : 'bump()', 'p7note', 13));
        });
        if (o.verdict) items.push(...K7().verdict(Object.assign({ prefix: 'vd', x: rx, y: 356, w: 420 }, o.verdict)).items);
        return items;
      }
      const s0 = make().sys;
      F.add({ items: picture(s0, { regs: {} }), say: `${H.plural(n, 'thread')} each run count++ ${k === 1 ? 'once' : k + ' times'}${lock ? ', each time inside the mutex' : ''}; main joins them and prints count, which should be \`${want}\`. At machine granularity a thread can be switched out between the load, the add and the store of count++.`, meta: { vals: [n, k, want] } });
      F.set('states', outs.states);
      F.add({ items: picture(s0, { regs: {} }), say: `Over every schedule (${outs.states} states, ${outs.complete ? 'all of them' : 'the search was cut short'}), the program can print ${H.list(values.map((v) => '`' + v + '`'))}${values.length > 1 ? `: ${values.filter((v) => v !== want).length} of these ${values.length} answers are wrong` : ': always right'}.`, meta: { vals: [outs.states, ...values, values.length, values.filter((v) => v !== want).length], values, want } });
      F.set('states', res.stats.states);
      if (!res.violation) {
        F.add({ items: picture(s0, { regs: {}, verdict: { kind: 'ok', head: 'No wrong output', lines: [res.stats.states + ' states searched', 'every schedule prints ' + want] } }), say: `The model checker searched ${res.stats.states} states and found no schedule that breaks "${name}": the mutex makes the load, add and store of each count++ one piece no other thread can cut into.`, meta: { vals: [res.stats.states, want] } });
        return { frames: F.list, def: def() };
      }
      const sched = res.violation.schedule, sys = make(), regs = {};
      let shown = 0, stores = 0, lostAt = [];
      F.add({ items: picture(sys.sys, { regs, verdict: { kind: 'bad', head: 'Found: a schedule printing ' + (target === null ? 'a wrong count' : target), lines: [res.stats.states + ' states searched', sched.length + ' kernel steps in the schedule'] } }), say: `The model checker searched ${res.stats.states} states and found a schedule of ${sched.length} kernel steps that breaks "${name}". Here it is again, event by event.`, meta: { vals: [res.stats.states, sched.length, want, target === null ? want : target] } });
      sched.forEach((c, si) => {
        const st = sys.step(c), evs = st.events.filter((e) => (e.kind === 'step' && e.mstep && (e.mstep.addr === addr || e.mstep.what === 'op')) || SHOW.has(e.kind));
        for (const e of st.events) if (e.mstep && e.mstep.what === 'load' && e.mstep.addr === addr) regs[e.tid] = e.mstep.value; else if (e.mstep && e.mstep.what === 'op' && regs[e.tid] !== undefined) regs[e.tid] = e.mstep.value;
        if (!evs.length) return;
        const e = evs[evs.length - 1], ms = e.mstep;
        let say = e.say.charAt(0).toUpperCase() + e.say.slice(1);
        if (ms && ms.what === 'load') say = `Thread \`${e.tid}\` loads count (\`${ms.value}\`) into its register.`;
        if (ms && ms.what === 'op') say = `Thread \`${e.tid}\` adds 1 in its register: \`${ms.value}\`.`;
        if (ms && ms.what === 'store') { stores++; say = `Thread \`${e.tid}\` stores \`${ms.value}\` into count${ms.value <= stores - 1 ? `: that is store number ${stores}, so ${H.plural(stores - ms.value, 'update')} ${stores - ms.value === 1 ? 'is' : 'are'} lost by now` : ''}.`; if (ms.value <= stores - 1) lostAt.push(shown + 1); }
        shown++;
        F.set('events', shown);
        F.add({ items: picture(sys.sys, { regs, act: e.tid, line: e.line, what: ms && ms.what }), say, meta: { vals: [e.tid, ms ? ms.value : 0, stores, stores - (ms ? ms.value : 0), e.line - OFF].concat(numsIn(e.say)), step: si, next: null } });
      });
      const out = +sys.out.trim();
      F.add({ items: picture(sys.sys, { regs, got: out, verdict: { kind: 'bad', head: 'It printed ' + out + ', not ' + want, lines: [H.plural(want - out, 'update') + ' lost', 'no error, no warning: just a wrong answer'] } }), say: `The program prints \`${out}\` where \`${want}\` was due: ${H.plural(want - out, 'update')} lost, and nothing in the run reported a problem. Testing would show this only if a run happened to take a schedule like this one.`, meta: { vals: [out, want, want - out], printed: out } });
      return { frames: F.list, def: def() };
      function def() { return H.def('Machine granularity', ['count++ compiles to:', '  load  r, count', '  add   r, r, 1', '  store count, r', 'the kernel may switch threads after', '  each load or store of shared memory', 'outcomes: every output of every schedule', 'model checker: a schedule for one']); }
    },
    predict: [
      { at: (f, i, fr) => i === 0, pick: 'option', ask: 'What is the smallest value this program can print?', options: (fr) => { const f = fr[1]; const all = f.meta.vals.slice(1, -2); const want = fr[0].meta.vals[2]; return [...new Set([1, 2, want, ...all])].sort((a, b) => a - b).map(String); }, answer: (fr) => String(Math.min(...fr[1].meta.vals.slice(1, -2))), explain: (fr) => fr[1].say },
    ],
    quiz: [
      { q: 'Two threads each do count++ twice. Why can the program print 2?', options: ['a thread can load early, sleep through all the other\'s stores, then overwrite them twice', 'count++ can subtract', 'the printf runs too early', 'join can be skipped'], answer: 0, why: 'T0 loads 0; T1 finishes its first update; T0 stores 1 over it; T1 loads 1, T0 finishes, T1 stores 2 over everything.' },
      { q: 'At statement granularity the same program always prints the right value here. Why?', options: ['a whole statement then runs without a switch, which is not how real hardware behaves', 'statements are atomic in C', 'the kernel locks count', 'the compiler adds a mutex'], answer: 0, why: 'Real CPUs can be interrupted (or run another core) between the instructions of one statement.' },
      { q: 'What does the model checker give that a test run does not?', options: ['the exact schedule that fails, to replay', 'a faster program', 'a proof for any number of threads', 'nothing'], answer: 0, why: 'It searches the schedules systematically and keeps the failing one.' },
      { q: 'With the mutex around count++, the outputs are…', options: ['only the right total', 'any value', 'the total or one less', 'always 0'], answer: 0, why: 'No other thread can run between the load and the store while the lock is held.' },
    ],
  });
  const numsIn = (s) => [...String(s).matchAll(/\d+/g)].map((m) => +m[0]);
})(globalThis.Proses = globalThis.Proses || {});
