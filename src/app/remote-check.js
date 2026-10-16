// Checks off the page: a code exercise, a fork-outputs enumeration or a challenge's hidden tests can take many
// seconds, so they run in a Web Worker made from the page's own scripts (the dev page's files, or the bundle's one
// script), never freezing the page. The page shows how long it has been checking and a Cancel button. Where no
// worker can be made, or the worker does not know the exercise and it cannot be sent (it holds functions), the
// check runs on the page as before.
//   S.Remote.available() -> bool
//   S.Remote.run(what: 'exercise' | 'challenge', x, answer) -> Promise of the result (S.Check.answer's, or
//     S.Challenges.evaluate's); rejected with {fallback: true} when the page should check it itself, and with
//     {cancelled: true} after S.Remote.cancel()
//   S.Remote.cancel()   stops the check running; S.Remote.busy() -> bool
//   S.Remote.progress(box, onCancel) -> stop()   the "Checking… 3 s" line with a Cancel button, in box
// A kind opts in with remote: true (S.Check.kinds.code, the challenge kinds that run C).
(function (S) {
  'use strict';
  const SERVE = `
;(function () {
  var S = self.Proses;
  self.onmessage = function (e) {
    var m = e.data, x = null;
    try {
      if (m.what === 'exercise') x = (S.Content && S.Content.exercises.get(m.id)) || m.x;
      else x = (S.Content && S.Content.challenges.get(m.id)) || m.x;
      if (!x) { self.postMessage({ type: 'missing', id: m.job }); return; }
      var r = m.what === 'exercise' ? S.Check.answer(x, m.answer) : S.Challenges.evaluate(x, m.answer);
      self.postMessage({ type: 'done', id: m.job, r: JSON.parse(JSON.stringify(r)) });
    } catch (err) { self.postMessage({ type: 'error', id: m.job, message: String(err && err.message || err) }); }
  };
})();
`;
  /** the worker's code: importScripts of the dev page's files, or the bundle's script text */
  function source() {
    if (typeof document === 'undefined') return null;
    const tags = [...document.querySelectorAll('script[src]')].filter((s) => /(^|\/)src\/[^?#]+\.js$/.test(s.getAttribute('src')));
    if (tags.length) return 'self.Proses = {};\nimportScripts(' + tags.map((s) => JSON.stringify(new URL(s.getAttribute('src'), location.href).href)).join(', ') + ');\n' + SERVE;
    const text = [...document.scripts].map((s) => s.textContent || '').find((t) => t.includes('// ==== core/'));
    return text ? 'self.Proses = {};\n' + text + '\n' + SERVE : null;
  }
  /** can a value cross to the worker as it is (no functions anywhere in it)? */
  const plain = (v) => { try { let ok = true; JSON.stringify(v, (k, x) => { if (typeof x === 'function' || typeof x === 'bigint') ok = false; return x; }); return ok; } catch (e) { return false; } };
  let url = null, worker = null, job = null, n = 0;
  const R = (S.Remote = {
    available() {
      if (url === null) { try { const s = typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && source(); url = s ? URL.createObjectURL(new Blob([s], { type: 'text/javascript' })) : false; } catch (e) { url = false; } }
      return !!url;
    },
    run(what, x, answer) {
      R.cancel();
      return new Promise((ok, no) => {
        const fallback = () => no(Object.assign(new Error('checked on the page'), { fallback: true }));
        if (!R.available() || !plain(answer)) { fallback(); return; }
        if (!worker) {
          try { worker = new Worker(url); } catch (e) { url = false; fallback(); return; }
          worker.onmessage = (e) => {
            const m = e.data;
            if (!job || m.id !== job.id) return;
            const j = job; job = null;
            if (m.type === 'done') j.ok(m.r);
            else if (m.type === 'missing') j.no(Object.assign(new Error('unknown here'), { fallback: true }));
            else j.no(new Error(m.message));
          };
          // a worker that cannot even load leaves the page to check for itself from now on
          worker.onerror = (e) => { if (e.preventDefault) e.preventDefault(); const j = job; job = null; worker = null; url = false; if (j) j.no(Object.assign(new Error('the checker stopped'), { fallback: true })); };
        }
        job = { id: ++n, ok, no };
        worker.postMessage({ job: job.id, what, id: x.id, x: plain(x) ? x : null, answer });
      });
    },
    cancel() {
      if (!job) return;
      const j = job; job = null;
      if (worker) { worker.terminate(); worker = null; }
      j.no(Object.assign(new Error('cancelled'), { cancelled: true }));
    },
    busy: () => !!job,
    progress(box, onCancel) {
      const { h, icon } = S.UI;
      const t0 = Date.now();
      const secs = h('span.mono', '0 s');
      const stop = h('button.btn.small', { type: 'button', id: 'btnCancelCheck' }, icon('x'), 'Cancel');
      stop.addEventListener('click', () => { R.cancel(); if (onCancel) onCancel(); });
      const line = h('div.ex-v.checking', { id: 'checkProgress', role: 'status' }, icon('history'), h('b', 'Checking… '), h('span', 'every schedule is being searched; '), secs, ' ', stop);
      box.appendChild(line);
      const timer = setInterval(() => { secs.textContent = Math.round((Date.now() - t0) / 1000) + ' s'; }, 500);
      return () => { clearInterval(timer); line.remove(); };
    },
  });
})(globalThis.Proses = globalThis.Proses || {});
