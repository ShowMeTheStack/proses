// Challenges: a task with a story, a target to reach and limits on what may be used, scored on cases the reader
// cannot see (a hidden workload, a hidden test of a program). S.Challenges holds what the pages and the checkers
// share: the goal in words, the scoring through the challenge's kind, medals, the reader's attempts kept in this
// browser, and the content check.
//
// A challenge (S.Content.challenge) is {id, n, title, level, kind, story, task, metricName, unit, higher (default
// true: a bigger score is better), target, marks: {silver, gold}, limits, hints: [3], solution, wrong: [..]}.
// Its kind does the work, registered as
//   S.Challenges.kinds.name = {
//     workspace(host, x, draft, onChange) -> {get() -> answer, load(answer), dispose?(), redraw?()}   the page's editor
//     start(x) -> answer                                     a fresh starting answer
//     evaluate(x, answer) -> {score, n?, problems?: [..], details?: [..]}      scored at once (node and the page)
//     evaluateAsync?(x, answer) -> Promise of the same       the page, for kinds that score in a worker
//     limitsProblems?(x, answer) -> [sentences]              what in the answer breaks the limits
//     limitSentences?(x) -> [sentences]                      the limits in words, for the task card
//     lint?(x) -> [problems]                                 the kind's own content check
//     example?() -> a complete sample challenge of this kind (S.Challenges.examples() lists them)
//   }
(function (S) {
  'use strict';
  const store = () => (S.UI && S.UI.storage) || { get: (k, d) => d, set() {} };
  const fmt = (v) => (v === null || v === undefined || !isFinite(v) ? '—' : String(+(+v).toFixed(3)));
  const kindOf = (x) => (x && C.kinds[x.kind]) || null;

  const C = (S.Challenges = {
    kinds: {},
    fmt,
    metricLabel: (x) => x.metricName || 'score',
    higher: (x) => x.higher !== false,
    /** is this score at least the target (or at most, when lower is better)? */
    reaches(x, score, target) { if (score === null || score === undefined || !isFinite(score)) return false; const t = target === undefined ? x.target : target; return C.higher(x) ? score >= t - 1e-12 : score <= t + 1e-12; },
    /** 'gold' | 'silver' | 'bronze' (the target) | null */
    medal(x, score) {
      if (!C.reaches(x, score)) return null;
      const m = x.marks || {};
      if (m.gold !== undefined && C.reaches(x, score, m.gold)) return 'gold';
      if (m.silver !== undefined && C.reaches(x, score, m.silver)) return 'silver';
      return 'bronze';
    },
    /** the goal in words: "mean response time ≤ 6 ticks" */
    goal(x) { return C.metricLabel(x) + ' ' + (C.higher(x) ? '≥ ' : '≤ ') + x.target + (x.unit ? ' ' + x.unit : ''); },
    /** the limits as sentences a reader can follow */
    limitSentences(x) { const k = kindOf(x); return k && k.limitSentences ? k.limitSentences(x) : []; },
    /** what in an answer breaks the limits: [sentences] (empty when it keeps to them) */
    limitsProblems(x, answer) { const k = kindOf(x); return k && k.limitsProblems ? k.limitsProblems(x, answer) : []; },
    /** the result of a scored answer, as the pages and checkers use it */
    result(x, sc, limits) {
      const problems = limits.concat(sc.problems || []);
      const reached = !limits.length && C.reaches(x, sc.score);
      return { ok: reached, reached, score: sc.score, n: sc.n, problems, limits, details: sc.details || [], medal: limits.length ? null : C.medal(x, sc.score) };
    },
    /** score an answer at once */
    evaluate(x, answer) {
      const k = kindOf(x);
      if (!k) return { ok: false, reached: false, score: null, problems: ['this challenge has an unknown kind, ' + x.kind], limits: [], medal: null };
      return C.result(x, k.evaluate(x, answer), C.limitsProblems(x, answer));
    },
    /** score an answer the way the page does: in a worker when the kind has one */
    async evaluateAsync(x, answer) {
      const k = kindOf(x);
      // kinds that run C over many schedules (remote: true) score in a worker, off the page
      if (k && k.remote && S.Remote && S.Remote.available()) {
        try { return await S.Remote.run('challenge', x, answer); } catch (e) { if (e && e.cancelled) throw e; if (!(e && e.fallback)) throw e; }
      }
      if (!k || !k.evaluateAsync) return C.evaluate(x, answer);
      return C.result(x, await k.evaluateAsync(x, answer), C.limitsProblems(x, answer));
    },
    /** each kind's sample challenge (kind.example()), for tests and for helpers starting a new challenge */
    examples() { return Object.entries(C.kinds).filter(([, k]) => typeof k.example === 'function').flatMap(([name, k]) => (k.examples ? k.examples() : [k.example()]).map((x) => Object.assign({ kind: name }, x))); },
    /** a fresh starting answer */
    starter(x) { const k = kindOf(x); return k && k.start ? k.start(x) : null; },

    // ---- the reader's attempts, kept in this browser --------------------------------------------------------------
    all() { try { return Object.assign({}, store().get('challenges', {})); } catch (e) { return {}; } },
    attempts(id) { const a = C.all()[id]; return (a && a.attempts) || []; },
    best(id) {
      const x = S.Content && S.Content.challenges.get(id), list = C.attempts(id).filter((a) => !a.limits && a.score !== null && isFinite(a.score));
      if (!list.length) return null;
      return list.reduce((b, a) => (!b || (x && !C.higher(x) ? a.score < b.score : a.score > b.score) ? a : b), null);
    },
    solved(id) { return C.attempts(id).some((a) => a.reached); },
    /** keep an attempt: its rank among the reader's own attempts (1 is best) */
    record(id, res) {
      const all = C.all(), x = S.Content && S.Content.challenges.get(id);
      const a = all[id] = all[id] || { attempts: [] };
      const at = { t: Date.now(), score: res.score, reached: !!res.reached, medal: res.medal || null, limits: res.limits && res.limits.length ? res.limits.length : 0 };
      a.attempts.push(at);
      if (a.attempts.length > 50) a.attempts = a.attempts.slice(-50);
      try { store().set('challenges', all); } catch (e) { /* storage may be off: the result still shows */ }
      const ok = a.attempts.filter((q) => !q.limits && q.score !== null && isFinite(q.score));
      const better = (p, q) => (x && !C.higher(x) ? p.score < q.score : p.score > q.score);
      return { rank: at.limits || at.score === null ? null : 1 + ok.filter((q) => q !== at && better(q, at)).length, of: ok.length };
    },
    saveDraft(id, answer) { try { const all = C.all(); (all[id] = all[id] || { attempts: [] }).draft = answer; store().set('challenges', all); } catch (e) { /* off */ } },
    draft(id) { const a = C.all()[id]; return a && a.draft !== undefined && a.draft !== null ? a.draft : null; },

    // ---- the content check ----------------------------------------------------------------------------------------
    lint(x) {
      const problems = [], notes = [];
      let answers = 0;
      const k = kindOf(x);
      if (!x.story) problems.push('no story');
      if (!k) { problems.push('unknown kind ' + x.kind + ' (the kinds: ' + (Object.keys(C.kinds).join(', ') || 'none yet') + ')'); return { problems, notes, answers }; }
      if (!(typeof x.target === 'number' && isFinite(x.target))) problems.push('the target is not a number');
      if (k.lint) problems.push(...(k.lint(x) || []));
      if (x.solution === undefined) problems.push('no reference solution');
      else {
        answers++;
        const r = C.evaluate(x, typeof x.solution === 'function' ? x.solution() : x.solution);
        if (!r.ok) problems.push('the reference solution does not reach ' + C.goal(x) + ': ' + (r.problems.length ? r.problems.join('; ') : 'it scores ' + fmt(r.score)));
        notes.push('solution: ' + C.metricLabel(x) + ' ' + fmt(r.score) + (r.medal ? ' (' + r.medal + ')' : ''));
      }
      const wrong = x.wrong || [];
      if (wrong.length < 2) problems.push('at least two wrong answers are needed (it has ' + wrong.length + ')');
      wrong.forEach((w, i) => {
        answers++;
        const r = C.evaluate(x, typeof w === 'function' ? w() : w);
        if (r.ok) problems.push('wrong answer ' + (i + 1) + ' reaches the target: ' + fmt(r.score));
        notes.push('wrong ' + (i + 1) + ': ' + (r.problems.length ? r.problems.join('; ') : C.metricLabel(x) + ' ' + fmt(r.score)));
      });
      return { problems, notes, answers };
    },
  });
})(globalThis.Proses = globalThis.Proses || {});
