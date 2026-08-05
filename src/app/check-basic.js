// Checking exercise answers. S.Check.answer(exercise, answer) -> {ok, message, details?, cells?} runs the checker
// of the exercise's kind; S.Check.answerAsync does the same for kinds that need a worker (a C program run in the interpreter). The basic kinds:
//
//   choice    options: [..], answer: index | [indexes] (several right). Answer: index or [indexes].
//   string    answer: 'text' | ['text', ...], or accept(text) -> true | false | 'why not' | {ok, why};
//             set: true compares as sets {a, b}; caseless: true; placeholder (the empty box's hint).
//   number    answer (a number, or a BigInt / a string of digits for big integers), tolerance, higherLower;
//             whyNot: 'sentence' | {value: 'sentence', '*': 'any other wrong value'}.
//   set       answer: '{a, b}' | '(1, 2), (2, 3)' | '{{a, b}, {c}}' (or several), or accept(value, canonical).
//   table     rows, cols, cells {'row|col': expected}, cellKind 'text' | 'number' | 'bit' | 'set', tolerance, or a
//             kind registered in S.Check.tables. Answer: {key: text}.                          check-table.js
// Every kind with all its fields is listed in src/app/check-index.js (the reference for content writers).
// More kinds register as S.Check.kinds.name = { check(x, answer) -> result, checkAsync?(x, answer) -> Promise }.
// Every exercise also has solution (an answer that must pass), wrong: [answers that must fail] and hints.
(function (S) {
  'use strict';
  const K = (S.Check = S.Check || {});
  K.kinds = K.kinds || {};

  const show = (w) => (w === '' ? 'ε' : w);
  K.show = show;
  K.plural = (n, w, ws) => n + ' ' + (n === 1 ? w : ws || w + 's');
  /** The alphabet of an exercise as a list of symbols ('ab' or ['a', 'b']) */
  K.alphabet = (a) => (!a ? null : Array.isArray(a) ? a.slice() : [...String(a)].filter((c) => !/[\s,]/.test(c)));

  K.answer = function (x, a) {
    const kind = K.kinds[x.kind];
    if (!kind) return { ok: false, message: 'This exercise has an unknown kind, ' + x.kind + '.' };
    try { return kind.check(x, a); } catch (e) { return { ok: false, message: 'Your answer could not be checked: ' + (e.message || e) + '.' }; }
  };
  /** The same, for kinds that check in a worker: always a promise */
  K.answerAsync = async function (x, a) {
    const kind = K.kinds[x.kind];
    if (!kind) return { ok: false, message: 'This exercise has an unknown kind, ' + x.kind + '.' };
    // a kind that may search for long (remote: true) checks in a worker, off the page; cancelled checks reject
    if (kind.remote && S.Remote && S.Remote.available()) {
      try { return await S.Remote.run('exercise', x, a); } catch (e) { if (e && e.cancelled) throw e; if (!(e && e.fallback)) return { ok: false, message: 'Your answer could not be checked: ' + (e.message || e) + '.' }; }
    }
    try { return await (kind.checkAsync ? kind.checkAsync(x, a) : kind.check(x, a)); } catch (e) { return { ok: false, message: 'Your answer could not be checked: ' + (e.message || e) + '.' }; }
  };
  /** Is the answer empty (nothing typed or chosen)? */
  K.blank = (a) => a === undefined || a === null || (typeof a === 'string' && !a.trim()) || (Array.isArray(a) && !a.length);

  // ---- multiple choice ---------------------------------------------------------------------------------
  K.kinds.choice = {
    check(x, a) {
      const want = [].concat(x.answer).map(Number).sort();
      const got = [].concat(a === undefined || a === null ? [] : a).map(Number).sort();
      if (!got.length) return { ok: false, message: 'Choose ' + (want.length > 1 ? 'the right options' : 'an option') + ' first.' };
      if (want.length === got.length && want.every((v, i) => v === got[i])) return { ok: true, message: 'Right.' + (x.why ? ' ' + x.why : '') };
      if (want.length > 1) {
        const right = got.filter((v) => want.includes(v)).length;
        return { ok: false, message: 'Not quite: ' + right + ' of your choices ' + (right === 1 ? 'is' : 'are') + ' right, and ' + K.plural(want.length, 'option is', 'options are') + ' right in all.' };
      }
      const why = x.whyNot && x.whyNot[got[0]];
      return { ok: false, message: 'Not quite.' + (why ? ' ' + why : '') };
    },
  };

  // ---- a string or a number ------------------------------------------------------------------------------
  const norm = (s, x) => {
    let t = String(s === undefined || s === null ? '' : s).trim().replace(/\s+/g, ' ');
    if (/^(eps|epsilon|ε|λ)$/i.test(t) || t === '""') t = 'ε';
    if (x.caseless) t = t.toLowerCase();
    return t;
  };
  /**
   * synonyms: [['system call', 'syscall', 'sys call'], ..] (the first of a group is the one the answer uses) or
   * {'system call': ['syscall', ..]}: an answer (or a set's element) that is one of a group reads as its first word;
   * compared ignoring case and spacing when the exercise is caseless, else exactly but for spacing
   */
  const groupsOf = (x) => (!x.synonyms ? [] : Array.isArray(x.synonyms) ? x.synonyms : Object.entries(x.synonyms).map(([k, v]) => [k].concat(v)));
  K.synonym = function (x, t) {
    const key = (v) => { const w = String(v).trim().replace(/\s+/g, ' '); return x.caseless ? w.toLowerCase() : w; };
    const k = key(t);
    for (const g of groupsOf(x)) if (g.some((v) => key(v) === k)) return String(g[0]);
    return t;
  };
  const asSet = (s) => String(s).replace(/^\s*\{|\}\s*$/g, '').split(/[\s,]+/).filter(Boolean).map((v) => (/^(eps|epsilon|λ)$/i.test(v) ? 'ε' : v)).filter((v) => v !== '∅').sort();
  K.asSet = asSet;
  /** What an accept hook said, as a result: true, false, a sentence saying why not, or {ok, why} */
  K.accepted = function (x, r) {
    if (r && typeof r === 'object') return r.ok ? { ok: true, message: 'Right.' + (r.why ? ' ' + r.why : x.why ? ' ' + x.why : '') } : { ok: false, message: r.why || (x.whyNot ? x.whyNot : 'Not quite.') };
    if (typeof r === 'string') return { ok: false, message: r };
    return r ? { ok: true, message: 'Right.' + (x.why ? ' ' + x.why : '') } : { ok: false, message: x.whyNot ? x.whyNot : 'Not quite.' };
  };
  K.kinds.string = {
    check(x, a) {
      if (K.blank(a)) return { ok: false, message: 'Type an answer first (ε for the empty string).' };
      let ok;
      if (x.accept) return K.accepted(x, x.accept(norm(a, x) === 'ε' ? '' : norm(a, x)));
      else if (x.set) { const S1 = (v) => asSet(v).map((e) => K.synonym(x, e)).map((e) => (x.caseless ? e.toLowerCase() : e)).sort().join(','); const g = S1(a); ok = [].concat(x.answer).some((w) => S1(w) === g); }
      else { const one = (v) => norm(K.synonym(x, v), x).replace(/\s/g, x.spaces ? ' ' : ''); const g = one(a); ok = [].concat(x.answer).some((w) => one(w) === g); }
      return ok ? { ok: true, message: 'Right.' + (x.why ? ' ' + x.why : '') } : { ok: false, message: 'Not quite.' + (x.whyNot ? ' ' + x.whyNot : '') };
    },
  };
  // whyNot for a number: one sentence for every wrong answer, or {value: sentence} for the likely slips, with
  // '*' (optional) for any other wrong value
  const numWhy = (x, key) => {
    const w = x.whyNot;
    if (!w) return '';
    if (typeof w === 'string') return ' ' + w;
    const hit = Object.prototype.hasOwnProperty.call(w, key) ? w[key] : w['*'];
    return hit ? ' ' + hit : '';
  };
  const numKey = (v) => { const t = String(v); return /e/i.test(t) ? t : t.replace(/\.0+$/, ''); };
  K.kinds.number = {
    check(x, a) {
      if (K.blank(a)) return { ok: false, message: 'Type a number first.' };
      if (typeof a === 'string') a = (K.unminus ? K.unminus(a) : a.replace(/\u2212/g, '-'));
      // a trailing % reads as the number before it (66.7% is 66.7, for an answer asked as a percentage); an exercise
      // whose answer is a fraction says percent: 'fraction', and then 66.7% reads as 0.667
      if (typeof a === 'string' && /%\s*$/.test(a)) { const v = a.replace(/%\s*$/, '').trim(); a = x.percent === 'fraction' && v && isFinite(+v.replace(/,/g, '')) ? String(+v.replace(/,/g, '') / 100) : v; }
      // big integers (a modulus, a key) are compared exactly
      if (typeof x.answer === 'bigint' || (typeof x.answer === 'string' && /^-?\d+$/.test(x.answer))) {
        const t = String(a).trim().replace(/[,_\s]/g, '');
        if (!/^-?\d+$/.test(t)) return { ok: false, message: String(a).trim() + ' is not a whole number.' };
        const g = BigInt(t), w = BigInt(x.answer);
        if (g === w) return { ok: true, message: 'Right.' + (x.why ? ' ' + x.why : '') };
        return { ok: false, message: 'Not quite' + (x.higherLower ? (g < w ? ': it is more than ' + t : ': it is less than ' + t) : '') + '.' + numWhy(x, g.toString()) };
      }
      const v = typeof a === 'number' ? a : Number(String(a).trim().replace(/,/g, ''));
      if (!Number.isFinite(v)) return { ok: false, message: String(a).trim() + ' is not a number.' };
      const ok = Math.abs(v - x.answer) <= (x.tolerance || 0);
      return ok ? { ok: true, message: 'Right.' + (x.why ? ' ' + x.why : '') } : { ok: false, message: 'Not quite' + (x.higherLower ? (v < x.answer ? ': it is more than ' + v : ': it is less than ' + v) : '') + '.' + numWhy(x, numKey(v)) };
    },
  };


  // ---- sets, pairs, tuples and partitions -------------------------------------------------------------------
  /**
   * Read set notation: {a, b}, (1, 2) and ⟨1, 2⟩ for tuples, a-b (or a→b) for a pair, ∅ or {} for the empty
   * set, and sets of these at any depth, so a partition is {{a, b}, {c}}. Items are separated by commas (or
   * spaces). Several items with no braces round them are read as a set: (a,b), (b,c) is a relation.
   * Returns {v} with v = {t: 'set'|'tuple', items} or {t: 'atom', v}, or {error: 'a sentence'}.
   */
  K.parseValue = function (text, opts) {
    opts = opts || {};
    const src = String(text === undefined || text === null ? '' : text).trim();
    if (!src) return { error: 'The answer is empty.' };
    const OPEN = { '{': '}', '(': ')', '[': ']', '⟨': '⟩', '<': '>' };
    const CLOSE = new Set(Object.values(OPEN));
    let i = 0;
    const atom = (raw) => {
      let a = raw.trim().replace(/^["']|["']$/g, '');
      if (/^(eps|epsilon|λ|ε|"")$/i.test(a)) a = 'ε';
      if (a === '∅') return { t: 'set', items: [] };
      const pair = opts.dash !== false && /^([^\s\-→]+)\s*(?:-|→|->)\s*([^\s\-→>]+)$/.exec(a);
      if (pair) return { t: 'tuple', items: [{ t: 'atom', v: pair[1] }, { t: 'atom', v: pair[2] }] };
      return { t: 'atom', v: a };
    };
    function list(close) {
      const items = [];
      let cur = '';
      const flush = () => { if (cur.trim()) for (const w of cur.trim().split(/\s+(?![-→]|->)(?<![-→]\s*|->\s*)/)) if (w) items.push(atom(w)); cur = ''; };
      while (i < src.length) {
        const c = src[i];
        if (OPEN[c] && !(c === '<' && src[i + 1] === '-')) {
          if (cur.trim()) throw new Error('"' + cur.trim() + c + '" needs a comma before the ' + c);
          i++;
          const inner = list(OPEN[c]);
          items.push({ t: c === '{' ? 'set' : 'tuple', items: inner });
          continue;
        }
        if (CLOSE.has(c) && !(c === '>' && (src[i - 1] === '-'))) {
          if (c !== close) throw new Error(close ? 'a ' + c + ' closes what was opened with the bracket that needs ' + close : 'there is a ' + c + ' with nothing to close');
          flush(); i++; return items;
        }
        if (c === ',' || c === ';') { flush(); i++; continue; }
        cur += c; i++;
      }
      if (close) throw new Error('a bracket is opened but never closed: add ' + close);
      flush();
      return items;
    }
    try {
      const top = list(null);
      if (!top.length) return { error: 'There is nothing between the brackets to read; write ∅ or {} for the empty set.' };
      return { v: top.length === 1 && !opts.topSet ? top[0] : { t: 'set', items: top } };
    } catch (e) { return { error: 'This cannot be read: ' + e.message + '.' }; }
  };
  /** A value in one canonical text: sets sorted with repeats dropped, tuples in their order */
  K.canonValue = function canon(v, caseless) {
    if (v.t === 'atom') return caseless ? v.v.toLowerCase() : v.v;
    const parts = v.items.map((x) => canon(x, caseless));
    if (v.t === 'tuple') return '(' + parts.join(',') + ')';
    return '{' + [...new Set(parts)].sort().join(',') + '}';
  };
  const asTop = (v) => (v.t === 'set' ? v : { t: 'set', items: [v] });
  K.kinds.set = {
    check(x, a) {
      if (K.blank(a)) return { ok: false, message: 'Type an answer first, like {a, b}, (1, 2) or {{a, b}, {c}}.' };
      const got = K.parseValue(a, x);
      if (got.error) return { ok: false, message: got.error };
      if (x.accept) return K.accepted(x, x.accept(got.v, K.canonValue(got.v)));
      const syn = (v) => (v.t === 'atom' ? { t: 'atom', v: K.synonym(x, v.v) } : { t: v.t, items: v.items.map(syn) });
      const wants = [].concat(x.answer).map((w) => K.parseValue(w, x)).filter((w) => !w.error).map((w) => syn(w.v));
      got.v = syn(got.v);
      // one element typed without braces (a, or P1) is read as the set {a} when a set is wanted
      if (got.v.t === 'atom' && wants.some((w) => w.t === 'set')) got.v = { t: 'set', items: [got.v] };
      const g = K.canonValue(got.v, x.caseless);
      if (wants.some((w) => K.canonValue(w, x.caseless) === g)) return { ok: true, message: 'Right.' + (x.why ? ' ' + x.why : '') };
      // say how far off, without giving the answer away
      const w = wants[0];
      if (!w) return { ok: false, message: 'The exercise has no readable answer.' };
      if (w.t === 'tuple') {
        const same = got.v.t === 'tuple' && K.canonValue({ t: 'set', items: got.v.items }) === K.canonValue({ t: 'set', items: w.items });
        return { ok: false, message: same ? 'Not quite: the parts are right, but in a tuple their order matters.' : 'Not quite.' + (x.whyNot ? ' ' + x.whyNot : '') };
      }
      const A = new Set(asTop(w).items.map((v) => K.canonValue(v, x.caseless))), B = new Set(asTop(got.v).items.map((v) => K.canonValue(v, x.caseless)));
      const missing = [...A].filter((v) => !B.has(v)).length, extra = [...B].filter((v) => !A.has(v)).length;
      const thing = w.t === 'set' && w.items.length && w.items.every((v) => v.t === 'set') ? ['block', 'blocks'] : w.t === 'set' && w.items.length && w.items.every((v) => v.t === 'tuple') ? ['pair', 'pairs'] : ['element', 'elements'];
      const bits = [];
      if (missing) bits.push(K.plural(missing, thing[0], thing[1]) + (missing === 1 ? ' is' : ' are') + ' missing');
      if (extra) bits.push(K.plural(extra, thing[0], thing[1]) + (extra === 1 ? ' does' : ' do') + ' not belong');
      return { ok: false, message: 'Not quite' + (bits.length ? ': ' + bits.join(', and ') : '') + '.', details: x.whyNot ? [x.whyNot] : [] };
    },
  };

})(globalThis.Proses = globalThis.Proses || {});
