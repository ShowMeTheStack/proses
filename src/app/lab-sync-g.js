// The Sync lab, part seven: what each beat says and the panels every picture shares. The sentence for a beat is
// built from the kernel's own events (lock, block, unlock, sem, signal-cond, wake, thread, join, error ...) with the
// program's own names: thread P1 rather than thread 102, forks[1] rather than an address.
//   SL.say(beat, prev, P) -> one plain sentence with the actual values (backticks round them)
//   SL.panels: cards(prefix, x, y, w, beat, C) · objects(prefix, x, y, beat, C) · vars(prefix, x, y, beat, C) ·
//     strip(prefix, x, y, w, sched, upto, C, o) · verdict(prefix, x, y, w, R)    each -> {items, w, h}
//   SL.context(beats, P, o) -> C   what stays the same over a run (every thread ever seen, widths, the scene)
(function (S) {
  'use strict';
  const SL = (S.SyncLab = S.SyncLab || {});
  const K7 = () => S.Kit.sync7, KS = () => S.Kit.sync;
  const tw = (t, size, o) => S.textWidth(String(t), size || 13, o);
  const q = (v) => '`' + v + '`';
  const C_MAX = 230;

  /** the program's names for the threads and objects in a kernel sentence */
  function rename(text, b, P) {
    const nm = (tid) => (b.names[tid] ? b.names[tid].name : 'thread ' + tid);
    return String(text || '')
      .replace(/[Tt]hread `(\d+)` of process `\d+`(?: \([^)]*\))?/g, (m, t) => q(nm(+t)))
      .replace(/[Pp]rocess `(\d+)`(?: \([^)]*\))?/g, () => q('main'))
      .replace(/thread `(\d+)`/g, (m, t) => q(nm(+t)))
      .replace(/(mutex|semaphore|condition) at (\d+)/g, (m, k, a) => k + ' ' + q(P.I.at(+a)));
  }
  SL.rename = rename;
  const lineText = (P, line) => { const t = (P.I.lines[line - 1] || '').trim(); return t.length <= 44 ? t : t.slice(0, 42) + '…'; };
  const memName = (P, key) => { const a = +String(key).split(':')[2]; return P.I.at(a - (a % 4)); };

  SL.say = function (b, prev, P) {
    if (!b.rec) return 'Before anything runs: main is about to start at line ' + q(b.world.threads[0] ? b.world.threads[0].line : 1) + '. Every lock is free and no thread waits.';
    const nm = (tid) => (b.names[tid] ? b.names[tid].name : 'thread ' + tid);
    const who = nm(b.rec.tid), evs = b.rec.events.filter((e) => e.kind !== 'buffer');
    const lines = b.rec.lines, ran = lines.length > 1 ? 'runs from line ' + q(lines[0]) : lines.length ? 'runs line ' + q(lines[0]) : 'runs';
    const main = evs.filter((e) => e.kind !== 'step');
    const obj = (e) => q(P.I.at(+String(e.obj).split(':')[2]));
    const parts = [];
    for (const e of main) {
      switch (e.kind) {
        case 'lock': parts.push(/handed/.test(e.say) ? 'now holds ' + obj(e) + ', handed over by its last owner' : 'locks ' + obj(e) + ': it was free'); break;
        case 'unlock': parts.push(e.to ? 'unlocks ' + obj(e) + ', and ' + q(nm(e.to)) + ', first in its queue, gets it' : 'unlocks ' + obj(e) + ': nobody waits, so it is free'); break;
        case 'block':
          if (e.why === 'mutex') parts.push('tries to lock ' + obj(e) + ', but ' + q(nm(e.owner)) + ' holds it, so ' + q(who) + ' sleeps in its queue');
          else if (e.why === 'sem') parts.push('waits on ' + obj(e) + ': its value is ' + q(0) + ', so ' + q(who) + ' sleeps in its queue');
          else if (e.why === 'cond') parts.push('waits on ' + obj(e) + ': it lets go of the mutex and sleeps');
          else if (e.why === 'join') parts.push('waits for ' + q(nm(e.on)) + ' to end');
          else parts.push(rename(e.say, b, P).replace(/\.$/, ''));
          break;
        case 'sem':
          if (/sets up/.test(e.say)) parts.push('sets ' + obj(e) + ' to ' + q(e.value));
          else if (/gets past/.test(e.say)) parts.push('gets past its wait on ' + obj(e) + ': a post handed it the count');
          else if (/sem_post/.test(e.say)) parts.push(e.woke ? 'posts ' + obj(e) + ': ' + q(nm(e.woke)) + ' was waiting and goes on, and the value stays ' + q(e.value) : 'posts ' + obj(e) + ': the value rises to ' + q(e.value));
          else parts.push('waits on ' + obj(e) + ': the value was ' + q(e.value + 1) + ', so it goes on and the value drops to ' + q(e.value));
          break;
        case 'signal-cond': parts.push((/broadcast/.test(lineText(P, e.line)) ? 'broadcasts on ' : 'signals ') + obj(e) + (e.woke && e.woke.length ? ': ' + e.woke.map((t) => q(nm(t))).join(' and ') + ' leave' + (e.woke.length > 1 ? '' : 's') + ' its queue and queue' + (e.woke.length > 1 ? '' : 's') + ' for the mutex' : ': nobody sleeps on it, so nothing happens')); break;
        case 'wake': {
          const other = e.tid && e.tid !== b.rec.tid ? q(nm(e.tid)) + ' ' : '';
          parts.push(other + (e.why === 'cond' ? 'returns from its wait holding the mutex again' : e.why === 'join' ? 'is woken: the thread it joins has ended' : rename(e.say, b, P).replace(/^.*? is woken/, 'is woken').replace(/\.$/, '')));
          break;
        }
        case 'thread': parts.push('starts thread ' + q(nm(e.tid)) + ' in ' + e.fn + '(' + e.arg + ')'); break;
        case 'join': parts.push('collects ' + q(nm(e.joined)) + ', which has ended'); break;
        case 'thread-exit': parts.push('returns from its function and ends'); break;
        case 'exit': if (!main.some((x) => x.kind === 'error')) parts.push('returns from main: the program exits'); break;
        case 'reap': case 'wait': case 'zombie': case 'reparent': break;
        case 'error': parts.push('fails at line ' + q(e.line) + ': ' + rename(e.say, b, P).replace(/^.*? fails at line `\d+`: /, '').replace(/\.$/, '')); break;
        default: if (e.say) parts.push(rename(e.say, b, P).replace(/^`?[\w ]+`? /, '').replace(/\.$/, ''));
      }
    }
    // a trylock that finds the mutex taken fails without a kernel event of its own
    const tl = lines.find((l) => /pthread_mutex_trylock/.test(P.I.lines[l - 1] || ''));
    if (tl && !main.some((e) => e.kind === 'lock')) { const m = /trylock\s*\(\s*&?\s*([\w\[\]]+)/.exec(P.I.lines[tl - 1]); parts.unshift('tries ' + q(m ? m[1] : 'the mutex') + ' with trylock at line ' + q(tl) + ': it is taken, so trylock fails at once'); }
    const ms = evs.filter((e) => e.mstep).map((e) => e.mstep);
    if (!parts.length && ms.length) {
      const m = ms[ms.length - 1], nmA = P.I.at(m.addr);
      parts.push(m.what === 'load' ? 'loads ' + q(nmA + ' = ' + m.value) + ' into its register' : m.what === 'store' ? 'stores ' + q(m.value) + ' into ' + q(nmA) : m.what === 'op' ? 'computes ' + q(m.value) + ' in its register' : 'copies memory');
    }
    if (!parts.length) {
      const fp = b.rec.fp || { r: [], w: [] }, w = [...new Set(fp.w.filter((k) => /^mem:/.test(k)).map((k) => memName(P, k)))], r = [...new Set(fp.r.filter((k) => /^mem:/.test(k)).map((k) => memName(P, k)))].filter((x) => !w.includes(x));
      const last = lines[lines.length - 1], code = last ? lineText(P, last) : '';
      const vals = (names) => names.map((n) => { const base = n.replace(/\[.*$/, ''), v = b.world.vars.find((x) => x.name === base); if (!v) return q(n); if (!v.arr) return q(n + ' = ' + v.value); const i = +((/\[(\d+)\]/.exec(n) || [])[1]); return q(n + ' = ' + (v.value[i] === undefined ? '?' : v.value[i])); });
      if (w.length) parts.push('writes ' + vals(w).join(' and ') + (code ? ' (' + code + ')' : ''));
      else if (r.length) parts.push('reads ' + vals(r).join(' and ') + (code ? ' (' + code + ')' : ''));
    }
    const lead = main.find((e) => ['lock', 'unlock', 'block', 'sem', 'signal-cond', 'thread', 'join'].includes(e.kind));
    const evLine = lead && lead === main[0] && lead.line ? lead.line : null;
    const at = evLine && lines.length > 1 && evLine !== lines[0] && !main.some((e) => e.kind === 'error') ? ' and, at line ' + q(evLine) + ',' : ' and';
    let s = q(who) + ' ' + ran + (parts.length ? at + ' ' + parts.join('; then ') : '') + '.';
    if (b.status === 'deadlock') s += ' Now no thread can move, yet some are blocked: a deadlock.';
    else if (b.status === 'done') s += ' Every thread has finished.';
    return s.replace(/ and runs/, ' and');
  };

  // ---- what stays the same over a run --------------------------------------------------------------------------
  SL.context = function (beats, P, o) {
    o = o || {};
    const tids = [], subs = ['done', 'running'], regs = {}, regAt = [];
    for (const b of beats) {
      for (const t of b.world.threads) { if (!tids.includes(t.tid)) tids.push(t.tid); subs.push(SL.sub(t, null)); }
      if (b.rec) for (const e of b.rec.events) if (e.mstep && (e.mstep.what === 'load' || e.mstep.what === 'op')) regs[e.tid || b.rec.tid] = e.mstep.value;
      regAt.push(Object.assign({}, regs));
    }
    const machine = P.gran === 'machine';
    const cardW = Math.min(C_MAX, Math.max(80, Math.ceil(Math.max(...subs.map((s) => tw(s, 13, { bold: true, mono: true })))) + 16 + (machine ? 56 : 0)));
    const last = beats[beats.length - 1];
    const varNames = last.world.vars.map((v) => v.name);
    const valW = Math.max(56, ...beats.flatMap((b) => b.world.vars.map((v) => tw(SL.showVal(v.value), 15, { mono: true }) + 22)));
    const nameW = Math.max(70, ...varNames.map((n) => tw(n, 14, { mono: true }) + 18));
    const objNames = last.world.mutexes.map((m) => m.name).concat(last.world.sems.map((s) => s.name), last.world.conds.map((c) => c.name));
    const objW = Math.max(64, ...objNames.map((n) => tw(n, 16, { mono: true, bold: true }) + 14));
    const maxQ = Math.max(1, ...beats.flatMap((b) => b.world.mutexes.map((m) => m.queue.length).concat(b.world.sems.map((s) => s.queue.length), b.world.conds.map((c) => c.queue.length))));
    return { P, tids, cardW, valW: Math.min(valW, 300), nameW, objW, maxQ, machine, regAt, scene: P.machine ? P.machine.scene : SL.sceneOf ? SL.sceneOf(P, last) : null, narrow: !!o.narrow };
  };
  SL.showVal = (v) => (Array.isArray(v) ? '[' + v.map((x) => (x === null ? '?' : x)).join(', ') + ']' : v === null || v === undefined ? '–' : String(v));
  SL.sub = function (t) {
    if (t.state === 'done') return 'done';
    if (t.state === 'error') return 'failed at line ' + t.line;
    if (t.state === 'blocked' && t.on) return (t.on.kind === 'cond' ? 'sleeps on ' : t.on.kind === 'join' ? 'joins ' : 'waits for ') + t.on.name;
    if (!t.line) return t.cur || t.state;
    return 'line ' + t.line + (t.cur && t.cur !== t.fn && t.cur !== 'main' ? ' · ' + t.cur : '');
  };

  // ---- the panels ------------------------------------------------------------------------------------------------
  const P_ = (SL.panels = {});
  P_.cards = function (prefix, x, y, w, b, C, k) {
    const gap = 12, cw = C.cardW, per = Math.max(1, Math.floor((w + gap) / (cw + gap)));
    const ths = C.tids.map((tid) => {
      const t = b.world.threads.find((x) => x.tid === tid);
      if (!t) return { id: tid, name: '·', state: 'done', sub: 'not started', subCls: '', cls: 'future' };
      const act = b.rec && b.rec.tid === tid;
      let sub = SL.sub(t);
      if (C.machine && C.regAt[k] && C.regAt[k][tid] !== undefined && t.state !== 'done') sub += ' · r ' + C.regAt[k][tid];
      return { id: tid, name: t.name, state: t.state === 'ready' && act ? 'running' : t.state, act, sub, subCls: t.state === 'blocked' ? 'hot' : '', pcls: t.cls };
    });
    const r = K7().threads({ prefix, x, y, threads: ths, w: cw, h: 38, gap, perRow: per, size: 15, subSize: 13 });
    // colour each card by its thread as well as by its state
    r.items.forEach((it) => { const m = /:c(\d+)$/.exec(it.key); if (m) { const t = ths.find((z) => String(z.id) === m[1]); if (t && t.pcls) it.cls += ' ' + t.pcls; if (t && t.cls === 'future') it.dim = true; } });
    return r;
  };
  P_.objects = function (prefix, x, y, b, C, lit) {
    const items = [], W = b.world, nameW = C.objW, rh = C.narrow ? 44 : 50;
    let yy = y;
    W.mutexes.forEach((m, i) => {
      const r = K7().mutex({ prefix: prefix + 'm' + m.name, x, y: yy + (i ? 4 : 14), name: m.name, owner: m.owner, ownerCls: m.ownerCls, queue: m.queue, act: lit.has(m.name), nameW });
      // the column's caption once, over the first owner
      items.push(...r.items.filter((it) => i === 0 || !/:lab$/.test(it.key))); yy += rh - (i ? 6 : 0);
    });
    W.sems.forEach((s) => {
      const r = KS().sem({ prefix: prefix + 's' + s.name, x, y: yy + 4, name: s.name, value: s.value === null ? '–' : s.value, queue: s.queue, act: lit.has(s.name), nameW, perRow: 5 });
      items.push(...r.items); yy += Math.max(rh, r.h + 10);
    });
    W.conds.forEach((c) => {
      const r = K7().mutex({ prefix: prefix + 'c' + c.name, x, y: yy + 8, name: c.name, owner: null, queue: c.queue, kind: 'cond', act: lit.has(c.name), nameW, label: 'condition', none: 'no one sleeps here' });
      r.items[1].text = c.queue.length + ' asleep'; r.items[1].cls = 'mxown free'; r.items[1].size = 13;
      r.items.splice(2, 1);
      items.push(...r.items); yy += rh;
    });
    return { items, h: yy - y, w: nameW + 72 + Math.max(2, C.maxQ) * 46 };
  };
  P_.vars = function (prefix, x, y, b, C, prev, title) {
    const rows = b.world.vars.map((v, i) => {
      const was = prev && prev.world.vars[i] ? SL.showVal(prev.world.vars[i].value) : null, now = SL.showVal(v.value);
      return { name: v.name, value: now, act: was !== null && was !== now };
    });
    if (!rows.length) return { items: [], h: 0, w: 0 };
    const r = K7().vars({ prefix, x, y, rows, nameW: C.nameW, valW: C.valW, rowH: 34, title: title || 'shared variables', size: 15 });
    return r;
  };
  /** a schedule as a strip of steps, a window round the current one when it is long */
  P_.strip = function (prefix, x, y, w, sched, upto, C, o) {
    o = o || {};
    const cw = 34, per = Math.max(8, Math.floor(w / cw)), most = per * (o.rows || 2);
    let from = 0;
    if (sched.length > most) from = Math.max(0, Math.min(sched.length - most, upto - Math.floor(most / 2)));
    const part = sched.slice(from, from + most);
    const steps = part.map((s) => ({ tid: s.k, text: s.name, cls: 'stepcell-' + s.cls }));
    const lit = (o.lit || []).filter((k) => k >= from && k < from + most).map((k) => k - from);
    const r = K7().strip({ prefix, x, y, w: per * cw, steps, upto: Math.max(0, Math.min(part.length, upto - from)), cw, ch: 26, title: o.title, size: 13, lit, maxCols: per });
    // the thread colours: replace the strip's own index colours by each thread's
    r.items.forEach((it) => { const m = /:k(\d+)$/.exec(it.key); if (m) { const s = part[+m[1]]; it.cls = it.cls.replace(/stepcell-\S+/, s.cls); } });
    if (from > 0 || from + most < sched.length) { r.items.push({ key: prefix + ':win', kind: 'text', x, y: y + r.h + 18, text: 'showing steps ' + (from + 1) + '–' + Math.min(sched.length, from + most) + ' of ' + sched.length, size: 13, cls: 'p7note' }); r.h += 24; }
    return r;
  };
  P_.verdict = function (prefix, x, y, w, R, short) {
    const v = SL.verdictBox(R);
    return K7().verdict({ prefix, x, y, w, kind: v.kind, head: v.head, lines: short ? v.lines.slice(0, 1) : v.lines, size: 14 });
  };
})(globalThis.Proses = globalThis.Proses || {});
