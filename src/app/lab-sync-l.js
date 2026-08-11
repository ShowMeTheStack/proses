// The Sync lab's checks off the page: "Check it" runs in a Web Worker made from the page's own scripts (the core
// engines and the lab's first three files), so a search of some seconds never freezes the page; the page shows the
// states made so far and a Cancel button. Where no worker can be made, the check runs on the page as before.
//   SL.remote.available() -> bool
//   SL.remote.check(v, o, onProgress(n)) -> Promise of R (without its beats: the page replays the schedule)
//   SL.remote.cancel()   stops the check running (its promise is rejected with {cancelled: true})
(function (S) {
  'use strict';
  const SL = (S.SyncLab = S.SyncLab || {});
  const MINE = /(^|\/)src\/(core\/[^/]+|app\/lab-sync-[abc])\.js$/;
  const SERVE = `
;(function () {
  var SL = self.Proses.SyncLab;
  self.onmessage = function (e) {
    var m = e.data;
    try {
      var P = SL.prepare(m.v);
      if (P.error) { self.postMessage({ type: 'error', id: m.id, message: String(P.error.msg || P.error.message || P.error) }); return; }
      m.o.progress = function (n) { self.postMessage({ type: 'progress', id: m.id, n: n }); };
      var R = SL.check(P, m.o);
      delete R.beats; delete R.names;
      self.postMessage({ type: 'done', id: m.id, R: JSON.parse(JSON.stringify(R)) });
    } catch (err) { self.postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) }); }
  };
})();
`;
  /** the worker's code: importScripts of the page's own files (the dev page), or their text cut from the bundle */
  function source() {
    if (typeof document === 'undefined') return null;
    const tags = [...document.querySelectorAll('script[src]')].filter((s) => MINE.test(s.getAttribute('src')));
    if (tags.length) return 'self.Proses = {};\nimportScripts(' + tags.map((s) => JSON.stringify(new URL(s.getAttribute('src'), location.href).href)).join(', ') + ');\n' + SERVE;
    const text = [...document.scripts].map((s) => s.textContent || '').find((t) => t.includes('// ==== core/'));
    if (!text) return null;
    const parts = text.split(/\n(?=\/\/ ==== [^\n]+ ====\n)/).filter((p) => { const m = /^\/\/ ==== ([^\n]+) ====/.exec(p); return m && MINE.test('src/' + m[1]); });
    return parts.length ? 'self.Proses = {};\n' + parts.join('\n') + SERVE : null;
  }
  let url = null, worker = null, job = null, n = 0;
  const R = (SL.remote = {
    available() { if (url === null) { try { const s = typeof Worker !== 'undefined' && source(); url = s ? URL.createObjectURL(new Blob([s], { type: 'text/javascript' })) : false; } catch (e) { url = false; } } return !!url; },
    check(v, o, onProgress) {
      R.cancel();
      return new Promise((ok, no) => {
        if (!R.available()) { no(new Error('no worker')); return; }
        if (!worker) {
          worker = new Worker(url);
          worker.onmessage = (e) => {
            const m = e.data;
            if (!job || m.id !== job.id) return;
            if (m.type === 'progress') { if (job.onProgress) job.onProgress(m.n); return; }
            const j = job; job = null;
            if (m.type === 'done') j.ok(m.R); else j.no(new Error(m.message));
          };
          worker.onerror = (e) => { e.preventDefault(); const j = job; job = null; worker = null; if (j) j.no(new Error('the checker stopped: ' + (e.message || 'unknown'))); };
        }
        job = { id: ++n, ok, no, onProgress };
        worker.postMessage({ id: job.id, v: JSON.parse(JSON.stringify(v)), o: JSON.parse(JSON.stringify(o, (k, x) => (x === Infinity ? null : x))) });
      });
    },
    /** stop the check; by: 'user' (the Cancel button), else a newer run took over */
    cancel(by) {
      if (!job) return;
      const j = job; job = null;
      if (worker) { worker.terminate(); worker = null; }
      j.no(Object.assign(new Error('cancelled'), { cancelled: true, user: by === 'user' }));
    },
    busy: () => !!job,
  });
})(globalThis.Proses = globalThis.Proses || {});
