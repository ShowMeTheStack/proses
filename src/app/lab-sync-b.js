// The Sync lab, part two: the specification. A program's properties are plain lines the student reads and edits,
// each a kind and a C expression over the program's globals:
//   always  <expr>     holds in every state (an invariant)          e.g. count >= 0 && count <= N
//   never   <expr>     is false in every state                      e.g. in(write_book) > 0 && in(read_book) > 0
//   at end  <expr>     holds once every thread has finished         e.g. total == 4
//   eventually  A calls B   every thread that starts in A calls B again and again (no starvation; checked over the
//                           reachable states with weak fairness)     e.g. philosopher calls eat
//   no deadlock        no state where every thread left is blocked
// Expressions: numbers, the program's integer #defines, global ints and int arrays (a[i]), the operators of C
// (! ~ - * / % + - << >> < <= > >= == != & ^ | && || ?:), and in(f) (how many threads are running inside function f
// now), value(s) (a semaphore's value), sum(a), max(a), min(a), count(a, v) and len(a). An assert() in the code is
// part of the specification too.
//   SL.expr(text, I) -> {fn(env), error, uses: {globals: [..], fns: [..]}}
//   SL.evalIn(x, sys, vm) -> number           x: a compiled expression; sys: an SL.Sys; vm: a context with memory
//   SL.spec(rows, I, names) -> {rows: [{kind, what, text (the plain sentence), error, x}], invariants, finals,
//     liveness(names) -> props for S.MC.live, deadlock, errors, endExprs}
//   SL.holdsNow(spec, sys) -> [{row, ok}]      each row's truth in the current state (the side table)
(function (S) {
  'use strict';
  const SL = (S.SyncLab = S.SyncLab || {});

  // ---- expressions ----------------------------------------------------------------------------------------------
  const BIN = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '<=': 7, '>': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };
  const FUNCS = { in: 1, sum: 1, count: 2, len: 1, max: 1, min: 1, value: 1 };
  SL.expr = function (text, I) {
    let toks;
    try { toks = S.CLang.lex(String(text)).filter((t) => t.t !== 'eof'); } catch (e) { return { error: 'it cannot be read: ' + (e.msg || e.message) }; }
    if (!toks.length) return { error: 'it is empty' };
    let k = 0;
    const uses = { globals: new Set(), fns: new Set() };
    const peek = () => toks[k], is = (s) => toks[k] && toks[k].t === 'op' && toks[k].s === s;
    const fail = (msg) => { throw new Error(msg); };
    const want = (s) => { if (!is(s)) fail('"' + s + '" expected' + (toks[k] ? ' before "' + toks[k].s + '"' : ' at the end')); k++; };
    const gl = (name) => I.globals.find((g) => g.name === name && (g.kind === 'int' || g.kind === 'arr'));
    function primary() {
      const t = peek();
      if (!t) fail('the expression stops too soon');
      if (t.t === 'num' || t.t === 'chr') { k++; const v = Number(t.v); return () => v; }
      if (t.t === 'op' && t.s === '(') { k++; const e = cond(); want(')'); return e; }
      if (t.t === 'id' || (t.t === 'kw' && t.v === 'in')) {
        k++;
        const name = t.s;
        if (is('(') && FUNCS[name]) {
          k++;
          const args = [];
          if (name === 'in') { const f = peek(); if (!f || f.t !== 'id') fail('in( ) takes a function name'); k++; if (!I.fns.some((x) => x.name === f.s)) fail('there is no function ' + f.s + ' in the program'); uses.fns.add(f.s); want(')'); const fn = f.s; return (env) => env.inFn(fn); }
          if (name === 'value') {
            const f = peek(), g = f && f.t === 'id' && I.globals.find((x) => x.name === f.s && x.kind === 'sem');
            if (!g) fail('value( ) takes a semaphore of the program');
            k++; uses.globals.add(f.s);
            let ix = () => 0;
            if (g.arr) { want('['); ix = cond(); want(']'); }
            want(')');
            return (env) => { const i = ix(env); return i >= 0 && i < (g.arr ? g.n : 1) ? env.sem(g.addr + i * (g.arr ? g.es : 0)) : NaN; };
          }
          const a = peek();
          if (!a || a.t !== 'id' || !gl(a.s) || !gl(a.s).arr) fail(name + '( ) takes an array of the program');
          k++; uses.globals.add(a.s); const g = gl(a.s);
          while (is(',')) { k++; args.push(cond()); }
          want(')');
          if (args.length !== FUNCS[name] - 1) fail(name + '( ) takes ' + FUNCS[name] + ' argument' + (FUNCS[name] > 1 ? 's' : ''));
          if (name === 'len') return () => g.n;
          if (name === 'sum') return (env) => { let s = 0; for (let i = 0; i < g.n; i++) s += env.load(g, i); return s; };
          if (name === 'max') return (env) => { let s = -Infinity; for (let i = 0; i < g.n; i++) s = Math.max(s, env.load(g, i)); return s; };
          if (name === 'min') return (env) => { let s = Infinity; for (let i = 0; i < g.n; i++) s = Math.min(s, env.load(g, i)); return s; };
          const v = args[0];
          return (env) => { const x = v(env); let s = 0; for (let i = 0; i < g.n; i++) if (env.load(g, i) === x) s++; return s; };
        }
        if (I.consts[name] !== undefined) { const v = I.consts[name]; return () => v; }
        if (name === 'true' || name === 'false') { const v = name === 'true' ? 1 : 0; return () => v; }
        const g = gl(name);
        if (!g) {
          const other = I.globals.find((x) => x.name === name);
          fail(other ? name + ' is ' + (other.kind === 'mutex' ? 'a mutex' : other.kind === 'sem' ? 'a semaphore' : other.kind === 'cond' ? 'a condition variable' : 'not a number or an array of numbers') : 'there is no global ' + name + (S.CLang.suggest ? (() => { const s = S.CLang.suggest(name, I.globals.map((x) => x.name).concat(Object.keys(I.consts))); return s ? ' (did you mean ' + s + '?)' : ''; })() : ''));
        }
        uses.globals.add(name);
        if (g.arr) {
          if (!is('[')) fail(name + ' is an array: write ' + name + '[i]');
          k++; const ix = cond(); want(']');
          return (env) => { const i = ix(env); if (!(i >= 0 && i < g.n)) return NaN; return env.load(g, i); };
        }
        return (env) => env.load(g, 0);
      }
      fail('"' + t.s + '" cannot start a value');
    }
    function unary() {
      if (is('!') || is('-') || is('~') || is('+')) { const op = peek().s; k++; const a = unary(); return op === '!' ? (e) => (a(e) ? 0 : 1) : op === '-' ? (e) => -a(e) : op === '~' ? (e) => ~a(e) : a; }
      return primary();
    }
    function binary(min) {
      let a = unary();
      for (;;) {
        const t = peek();
        if (!t || t.t !== 'op' || BIN[t.s] === undefined || BIN[t.s] < min) return a;
        const op = t.s, p = BIN[op]; k++;
        const b = binary(p + 1), x = a;
        a = ({
          '||': (e) => (x(e) || b(e) ? 1 : 0), '&&': (e) => (x(e) && b(e) ? 1 : 0), '|': (e) => x(e) | b(e), '^': (e) => x(e) ^ b(e), '&': (e) => x(e) & b(e),
          '==': (e) => (x(e) === b(e) ? 1 : 0), '!=': (e) => (x(e) !== b(e) ? 1 : 0), '<': (e) => (x(e) < b(e) ? 1 : 0), '<=': (e) => (x(e) <= b(e) ? 1 : 0), '>': (e) => (x(e) > b(e) ? 1 : 0), '>=': (e) => (x(e) >= b(e) ? 1 : 0),
          '<<': (e) => x(e) << b(e), '>>': (e) => x(e) >> b(e), '+': (e) => x(e) + b(e), '-': (e) => x(e) - b(e), '*': (e) => x(e) * b(e),
          '/': (e) => { const d = b(e); return d ? Math.trunc(x(e) / d) : NaN; }, '%': (e) => { const d = b(e); return d ? x(e) % d : NaN; },
        })[op];
      }
    }
    function cond() {
      const c = binary(1);
      if (!is('?')) return c;
      k++; const a = cond(); want(':'); const b = cond();
      return (e) => (c(e) ? a(e) : b(e));
    }
    try {
      const fn = cond();
      if (k < toks.length) fail('"' + toks[k].s + '" is left over');
      return { fn, uses: { globals: [...uses.globals], fns: [...uses.fns] } };
    } catch (e) { return { error: e.message }; }
  };
  /** the value of x in the state of sys (an SL.Sys), reading memory through vm */
  SL.evalIn = function (x, sys, vm) {
    const I = sys.ctx.I, K = sys.sys;
    const env = {
      load: (g, i) => { const v = SL.loadNum(vm, g, i); return v === null ? NaN : v; },
      sem: (addr) => { const p = K.procs.find((q) => q.role === 'prog'), o = p && K.objs['sem:' + p.pid + ':' + addr]; return o && o.value !== undefined ? o.value : 0; },
      inFn: (f) => { let n = 0; const p = K.procs.find((q) => q.role === 'prog'); for (const t of K.threads) if (p && t.pid === p.pid && t.state !== 'done' && I.fnOfLine(t.line) === f) n++; return n; },
    };
    return x.fn(env);
  };

  // ---- the specification ----------------------------------------------------------------------------------------
  SL.KINDS = [
    { value: 'always', label: 'always' }, { value: 'never', label: 'never' }, { value: 'end', label: 'at the end' },
    { value: 'live', label: 'eventually' }, { value: 'deadlock', label: 'no deadlock' },
  ];
  const LIVE = /^\s*(?:every\s+)?([A-Za-z_]\w*)(?:\s+threads?)?\s*(?:calls|->|→|reaches|enters)\s*([A-Za-z_]\w*)\s*(?:\(\s*\))?\s*(?:eventually)?\s*$/;
  SL.spec = function (rows, I) {
    const out = { rows: [], invariants: [], finals: [], live: [], deadlock: false, errors: [], endExprs: [] };
    (rows || []).forEach((r, i) => {
      const kind = r.kind, what = String(r.what || '').trim(), row = { kind, what, i };
      out.rows.push(row);
      if (kind === 'deadlock') { out.deadlock = true; row.text = 'no deadlock: never a state where every thread left is blocked'; return; }
      if (kind === 'live') {
        const m = LIVE.exec(what);
        if (!m) { row.error = 'write it as "producer calls put": every thread that starts in producer calls put again and again'; out.errors.push('Property ' + (i + 1) + ': ' + row.error); return; }
        const [, A, B] = m;
        if (!I.fns.some((f) => f.name === A)) row.error = 'there is no function ' + A;
        else if (!I.fns.some((f) => f.name === B)) row.error = 'there is no function ' + B;
        if (row.error) { out.errors.push('Property ' + (i + 1) + ': ' + row.error); return; }
        row.A = A; row.B = B; row.text = 'every ' + A + ' thread eventually calls ' + B + ', again and again';
        out.live.push(row);
        return;
      }
      const x = SL.expr(what, I);
      if (x.error) { row.error = x.error; out.errors.push('Property ' + (i + 1) + ' (' + what + '): ' + x.error); return; }
      row.x = x;
      if (kind === 'always' || kind === 'never') {
        row.text = (kind === 'always' ? 'always ' : 'never ') + what;
        const neg = kind === 'never';
        out.invariants.push({ name: row.text, row, holds: (sys) => { const vm = sys.mem(); if (!vm) return true; const v = SL.evalIn(x, sys, vm); return Number.isNaN(v) ? false : neg ? !v : !!v; } });
      } else if (kind === 'end') {
        row.text = 'at the end, ' + what;
        const k = out.endExprs.length;
        out.endExprs.push(x);
        out.invariants.push({ name: row.text, row, holds: (sys) => sys.status() !== 'done' || !sys.end || !!sys.end[k] });
      }
    });
    /** the liveness properties for S.MC.live, one a thread that starts in A (names: tid -> {fn, name}) */
    out.props = function (names) {
      const props = [];
      for (const row of out.live) for (const [tid, x] of Object.entries(names)) {
        if (x.fn !== row.A) continue;
        const t = +tid;
        props.push({ name: x.name + ' eventually calls ' + row.B, thread: t, row, progress: (st) => st && st.tid === t && (st.enter || []).includes(row.B), trying: (sys) => { const th = sys.sys.thread(t); return !!th && th.state !== 'done'; } });
      }
      return props;
    };
    return out;
  };
  /** each row's truth now: true, false, or null when it does not apply in this state */
  SL.holdsNow = function (spec, sys) {
    const vm = sys.mem();
    return spec.rows.map((row) => {
      if (row.error) return { row, ok: null, why: row.error };
      if (row.kind === 'deadlock') { const st = sys.status(); return { row, ok: st !== 'deadlock', why: st === 'deadlock' ? 'every thread left is blocked' : '' }; }
      if (row.kind === 'live') return { row, ok: null, why: 'checked over every schedule by Check it' };
      if (row.kind === 'end') { if (sys.status() !== 'done') return { row, ok: null, why: 'not finished yet' }; const k = spec.endExprs.indexOf(row.x); return { row, ok: sys.end ? !!sys.end[k] : null, why: '' }; }
      if (!vm) return { row, ok: null, why: 'the program has exited' };
      const v = SL.evalIn(row.x, sys, vm);
      return { row, ok: Number.isNaN(v) ? false : row.kind === 'never' ? !v : !!v, why: Number.isNaN(v) ? 'an index is out of range or a division by zero' : '' };
    });
  };
  /** why a broken property is broken, with the values it reads in this beat: 'count is 3' */
  SL.explain = function (spec, b, name) {
    const row = spec.rows.find((r) => r.text === name);
    if (!row || !row.x) return '';
    const parts = [];
    for (const g of row.x.uses.globals) { const v = b.world.vars.find((x) => x.name === g); if (v) parts.push('`' + g + '` is `' + SL.showVal(v.value) + '`'); }
    for (const f of row.x.uses.fns) { const n = b.world.threads.filter((t) => t.state !== 'done' && t.cur === f); parts.push('`' + n.length + '` thread' + (n.length === 1 ? '' : 's') + ' inside ' + f + (n.length ? ' (' + n.map((t) => t.name).join(', ') + ')' : '')); }
    return parts.length ? parts.join(', ') : '';
  };
  /** the assertions written in the code: [{line, text}] */
  SL.asserts = function (src) {
    const out = [];
    String(src).split('\n').forEach((l, i) => { const m = /\bassert\s*\((.*)\)\s*;/.exec(l); if (m && !/^\s*(\/\/|\*)/.test(l)) out.push({ line: i + 1, text: m[1].trim() }); });
    return out;
  };
})(globalThis.Proses = globalThis.Proses || {});
