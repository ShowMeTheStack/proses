// The lab shell: the page every lab registered with S.Labs.add gets. A setup panel (the lab's inputs and typed data),
// the stage with its narration line and a control bar (run, step, step back, reset, play, speed, seed), and a side
// panel with tabs for tables, metrics and the trace. Share by link (the whole setup in the hash, compressed), export
// the trace as JSON and the picture as SVG or PNG. On a phone the stage comes first, then the controls, the setup
// and the side panel, one under another.
// A lab is {id, title, blurb, part, icon, order, hidden,
//   setup: {fields, presets, check} (lab-setup.js),
//   run(values, ctx) -> result | Promise of result     ctx = {seed, narrow, lab}
//     result: {frames: [frame..], trace: [{kind, say, ..}], tables, metrics, error}
//     frame:  {items, say, view, narrowView, title, at (its step in the trace), tables, metrics (this step's, else
//             the result's), marks: [{line, tag, cls, act}] (the code editor's process tags), hold (ms)}
//     error:  a CError or {line, col, msg, hint, field}: shown in the code editor (of that code field; else the
//             first) and under the stage; frame.editor names the code field that frame.marks go to (default the first)
//   views: [{id, label, render(host, ctx)}]   extra side-panel tabs (an id of tables, metrics or trace replaces that tab)
//   seed: false (no seed control), autoRun: false (only Run runs), wide: true (a wider setup column, for code),
//   about: 'a sentence under the title'}
// Keys: Space play or pause, ← → step, Home back to the start, R run.
(function (S) {
  'use strict';
  const SPEEDS = [['Slow', 2600], ['Normal', 1500], ['Fast', 800], ['Fastest', 300]];
  const PHONE = 600;
  const store = () => S.UI.storage;

  class LabPage {
    constructor(app, main, lab, rest) {
      const { h, icon } = S.UI;
      this.app = app; this.lab = lab; this.i = 0; this.res = null; this.frames = []; this.timer = null; this.tab = null;
      const saved = store().get('lab:' + lab.id, null) || {};
      const preset = S.Labs.takePreset(lab.id);
      this.values = S.LabSetup.merge(lab, preset || saved.values || null);
      this.seed = Math.max(1, Math.round(+(saved.seed || 1)) || 1);
      this.speed = Math.max(0, Math.min(SPEEDS.length - 1, +store().get('labSpeed', 1) || 1));
      const root = (this.root = h('div.lab-page' + (lab.wide ? '.wide-setup' : ''), { id: 'labView', dataset: { lab: lab.id } }));
      // head
      const btn = (id, ic, label, fn, cls) => { const b = h('button.btn' + (cls || ''), { type: 'button', id, title: label }, icon(ic), h('span.lbl', label)); b.addEventListener('click', fn); return b; };
      const part = lab.part && S.partOf ? S.partOf(lab.part) : null;
      root.appendChild(h('div.lab-head',
        h('div', h('div.crumbs', h('a', { href: '#labs' }, 'Labs'), part ? ' › Part ' + part.n + ': ' + part.title : ''), h('h1.page-title', lab.title), lab.blurb ? h('p.lab-blurb', lab.blurb) : null),
        h('div.lab-actions', btn('btnLabShare', 'link', 'Share', () => this.share()), btn('btnLabExport', 'download', 'Export', (e) => this.exportMenu(e.currentTarget)), btn('btnLabDefaults', 'restart', 'Defaults', () => this.defaults()))));
      // setup
      const setupCard = h('section.card.lab-setup-card', { 'aria-label': 'Setup' }, h('div.lab-card-h', icon('cog'), h('span', 'Setup')));
      this.setup = S.LabSetup.build(setupCard, lab, this.values, (v, live) => this.changed(v, live));
      this.setup.onRun = () => this.runNow(true);
      this.runBtn = h('button.btn.primary.lab-run', { type: 'button', id: 'btnLabRun', title: 'Run with this setup (R; Ctrl+Enter in the editor)' }, icon('run'), 'Run');
      this.runBtn.addEventListener('click', () => this.runNow(true));
      setupCard.appendChild(h('div.lab-runbar', this.runBtn, h('span.lab-dirty', { id: 'labDirty' })));
      // stage, narration and controls
      this.stageWrap = h('div.stage-wrap.lab-stage', { id: 'labStage' });
      this.stage = new S.Stage(this.stageWrap, { label: lab.title, minText: () => (innerWidth < PHONE ? 10 : 11) });
      if (this.stage.enableZoom) this.stage.enableZoom();
      this.sayEl = h('div.say.lab-say', { id: 'labSay', 'aria-live': 'polite' });
      const ib = (id, ic, label, fn, cls) => { const b = h('button.icon-btn' + (cls || ''), { type: 'button', id, title: label, 'aria-label': label }, icon(ic)); b.addEventListener('click', fn); return b; };
      this.bReset = ib('btnLabReset', 'restart', 'Back to the start (Home)', () => { this.pause(); this.go(0); });
      this.bBack = ib('btnLabBack', 'stepBack', 'Step back (←)', () => { this.pause(); this.go(this.i - 1); });
      this.bPlay = ib('btnLabPlay', 'run', 'Play (Space)', () => this.toggle(), '.play');
      this.bStep = ib('btnLabStep', 'stepOver', 'Step (→)', () => { this.pause(); this.go(this.i + 1); });
      this.scrub = h('input', { type: 'range', id: 'labScrub', min: '0', max: '0', value: '0', 'aria-label': 'Step' });
      this.scrub.addEventListener('input', () => { this.pause(); this.go(+this.scrub.value, true); });
      this.posEl = h('span.pos', { id: 'labPos' });
      this.speedSel = h('select', { id: 'labSpeed', 'aria-label': 'Speed' }, ...SPEEDS.map(([n], k) => h('option', { value: String(k) }, n)));
      this.speedSel.value = String(this.speed);
      this.speedSel.addEventListener('change', () => { this.speed = +this.speedSel.value; store().set('labSpeed', this.speed); });
      const seedBox = lab.seed === false ? null : (() => {
        this.seedIn = h('input.mono', { type: 'text', id: 'labSeed', inputmode: 'numeric', 'aria-label': 'Seed', value: String(this.seed), size: '4' });
        this.seedIn.addEventListener('change', () => { const n = Math.round(+this.seedIn.value); if (n >= 1 && n <= 99999) { this.seed = n; this.save(); this.runNow(false); } else this.seedIn.value = String(this.seed); });
        const dice = ib('btnLabDice', 'shuffle', 'Another seed', () => { this.seed = 1 + Math.floor(Math.random() * 9999); this.seedIn.value = String(this.seed); this.save(); this.runNow(false); });
        return h('label.lab-seed', h('span', 'Seed'), this.seedIn, dice);
      })();
      this.controls = h('div.controls.lab-controls', { id: 'labControls' }, this.bReset, this.bBack, this.bPlay, this.bStep, h('div.timeline', this.scrub), this.posEl, h('label.lab-speed', h('span', 'Speed'), this.speedSel), seedBox);
      const stageCard = h('section.card.lab-stage-card', this.stageWrap, this.sayEl, this.controls);
      // the side panel
      this.tabBar = h('div.tabs', { role: 'tablist', 'aria-label': 'Views' });
      this.tabBody = h('div.tab-body.lab-tabbody', { id: 'labTabBody', role: 'tabpanel' });
      const side = h('section.card.lab-side', { id: 'labSide' }, this.tabBar, this.tabBody);
      root.appendChild(h('div.lab-grid', setupCard, h('div.lab-main', stageCard), side));
      main.appendChild(root);
      this.builtNarrow = this.narrow;
      // a share link opens with its setup; else the setup saved in this browser, a preset, or the defaults
      if (/(?:^|[?&])s=/.test(rest || '')) {
        this.async = true;
        S.LabViews.readLink(rest).then((d) => {
          if (d && d.values) { this.values = S.LabSetup.merge(lab, d.values); this.setup.set(this.values); if (d.seed) { this.seed = d.seed; if (this.seedIn) this.seedIn.value = String(d.seed); } }
          history.replaceState(null, '', '#labs/' + lab.id);
          S.UI.toast('Opened the shared setup.', 'ok', 2200);
        }).catch((e) => S.UI.toast(e.message, 'err', 4000)).then(() => this.runNow(false)).then(() => { window.__prosesReady = true; });
      } else this.runNow(false);
      this.onResize = S.UI.debounce(() => this.resized(), 120);
      window.addEventListener('resize', this.onResize);
    }
    get narrow() { return (this.stageWrap.clientWidth || innerWidth) < PHONE; }

    // ---- setup -------------------------------------------------------------------------------------------------
    changed(v, live) {
      this.values = v;
      this.save();
      const auto = this.lab.autoRun !== false && live;
      const d = document.getElementById('labDirty');
      if (auto) { clearTimeout(this.autoT); this.autoT = setTimeout(() => this.runNow(false, true), 160); if (d) d.textContent = ''; }
      else if (d) d.textContent = 'Changed: Run to see it.';
    }
    save() { if (!S.Shell || !S.Shell.autosave || S.Shell.autosave()) store().set('lab:' + this.lab.id, { values: this.values, seed: this.seed }); }
    async defaults() {
      if (!(await S.UI.confirm('Back to the defaults?', 'The setup goes back to the lab’s own. Programs you saved by name are kept.', 'Use the defaults', 'Keep mine'))) return;
      this.values = S.LabSetup.defaults(this.lab); this.setup.set(this.values); this.seed = 1; if (this.seedIn) this.seedIn.value = '1'; this.save(); this.runNow(false);
    }

    // ---- running -----------------------------------------------------------------------------------------------
    /** run the lab with the setup; play: start playing; keep: stay on the same step (a field moved) */
    async runNow(play, keep) {
      const errs = this.setup.errors();
      const d = document.getElementById('labDirty');
      if (d) d.textContent = '';
      if (errs.length) { this.sayEl.innerHTML = ''; this.sayEl.append(S.UI.h('span.step', 'Setup'), errs[0]); this.sayEl.classList.add('bad'); return; }
      this.sayEl.classList.remove('bad');
      this.pause();
      const at = keep ? this.i : 0;
      const narrow = this.narrow;
      this.builtNarrow = narrow;
      let res;
      try { res = await this.lab.run(S.LabSetup.merge(this.lab, this.values), { seed: this.seed, narrow, lab: this.lab }); }
      catch (e) { res = { frames: [], error: e }; }
      if (this.disposed) return;
      res = res || { frames: [] };
      this.res = res;
      const err = res.error || null;
      const ed = (err && err.field && this.setup.editors && this.setup.editors[err.field]) || this.setup.editor;
      for (const e of Object.values(this.setup.editors || {})) if (e !== ed) e.setError(null);
      if (ed) ed.setError(err && (err.line !== undefined) ? err : null);
      this.frames = (res.frames || []).filter(Boolean);
      if (!this.frames.length) this.frames = [{ items: err ? [{ key: 'err:t', kind: 'text', x: 0, y: 0, text: err.line ? 'The program does not compile' : 'The lab could not run', size: 20, cls: 'bad strong', anchor: 'middle' }, { key: 'err:w', kind: 'text', x: 0, y: 34, text: err.line ? 'line ' + err.line + (err.col ? ', column ' + err.col : '') + ': see the editor' : String(err.msg || err.message || err).slice(0, 80), size: 15, anchor: 'middle' }] : [], view: { x: -260, y: -60, w: 520, h: 140 }, say: err ? 'The program does not run: ' + (err.msg || err.message || err) + (err.line ? ' (line ' + err.line + ')' : '') + '.' : 'Nothing to show with this setup.', title: err ? 'error' : '' }];
      // frames with no view of their own share one box round everything any frame draws, so nothing jumps
      if (this.frames.some((f) => !f.view)) {
        const all = this.frames.flatMap((f) => f.items || []).map((it, k) => Object.assign({}, it, { key: (it.key || 'k') + '#' + k }));
        const b = S.stageBounds(all, { margin: 18, minW: 200, minH: 120 });
        if (b) for (const f of this.frames) if (!f.view) f.view = b;
      }
      this.scrub.max = String(this.frames.length - 1);
      this.stage.clear();
      this.size();
      this.buildTabs();
      this.go(Math.min(at, this.frames.length - 1), true);
      if (play && this.frames.length > 1) this.play();
    }
    /** the stage as tall as the pictures need: the widest-to-tallest view of any frame, within the window */
    size() {
      const W = this.stageWrap.clientWidth || 800, narrow = this.narrow;
      // as tall as the widest-to-tallest view needs, but never blown up past 1.3 times its own size
      let want = 0;
      for (const f of this.frames) { const v = (narrow && f.narrowView) || f.view; if (v && v.w) want = Math.max(want, Math.min(W, v.w * 1.3) * v.h / v.w); }
      if (!want) want = W * 0.55;
      const most = Math.max(320, Math.min(640, innerHeight * (narrow ? 0.62 : 0.66)));
      this.stageWrap.style.height = Math.round(Math.max(220, Math.min(most, want + 24))) + 'px';
      if (this.stage.applyView) this.stage.applyView();
    }
    go(i, instant) {
      if (!this.frames.length) return;
      i = Math.max(0, Math.min(this.frames.length - 1, i));
      this.i = i;
      const f = this.frames[i];
      const narrowView = this.narrow && f.narrowView;
      this.stage.show(narrowView ? Object.assign({}, f, { view: f.narrowView }) : f, { instant: instant || (S.app && S.app.settings.animate === false), duration: f.duration || 600 });
      this.sayEl.innerHTML = '';
      this.sayEl.append(S.UI.h('span.step', 'Step ' + (i + 1) + ' of ' + this.frames.length + (f.title ? ' · ' + f.title : '')), ...String(f.say || '').split('`').map((p, k) => (k % 2 ? S.UI.h('span.v', p) : document.createTextNode(p))));
      this.scrub.value = String(i);
      this.posEl.textContent = (i + 1) + ' / ' + this.frames.length;
      this.bBack.disabled = this.bReset.disabled = i === 0;
      this.bStep.disabled = i === this.frames.length - 1;
      // the editor tags go to the code field the frame names (frame.editor), else the first; the others are cleared
      for (const [id, ed] of Object.entries(this.setup.editors || {})) ed.setMarks(id === (f.editor || Object.keys(this.setup.editors)[0]) ? f.marks || [] : []);
      this.showTab(this.tab, true);
    }
    toggle() { if (this.timer) this.pause(); else this.play(); }
    play() {
      if (this.i >= this.frames.length - 1) this.go(0);
      const tick = () => { if (this.i >= this.frames.length - 1) { this.pause(); return; } this.go(this.i + 1); this.timer = setTimeout(tick, this.frames[this.i].hold || SPEEDS[this.speed][1]); };
      this.timer = setTimeout(tick, 400);
      this.bPlay.replaceChildren(S.UI.icon('pause')); this.bPlay.title = 'Pause (Space)'; this.bPlay.setAttribute('aria-label', 'Pause');
    }
    pause() {
      clearTimeout(this.timer); this.timer = null;
      if (this.bPlay) { this.bPlay.replaceChildren(S.UI.icon('run')); this.bPlay.title = 'Play (Space)'; this.bPlay.setAttribute('aria-label', 'Play'); }
    }
    stop() { this.pause(); }

    // ---- the side panel ----------------------------------------------------------------------------------------
    tabsWanted() {
      const r = this.res || {}, own = this.lab.views || [];
      const has = (k) => own.some((v) => v.id === k) || r[k] !== undefined || this.frames.some((f) => f[k] !== undefined);
      const list = [];
      if (has('tables')) list.push({ id: 'tables', label: 'Tables' });
      if (has('metrics')) list.push({ id: 'metrics', label: 'Metrics' });
      for (const v of own) if (!['tables', 'metrics', 'trace'].includes(v.id)) list.push(v);
      list.push({ id: 'trace', label: 'Trace' });
      return list;
    }
    buildTabs() {
      const { h } = S.UI;
      const list = this.tabsWanted();
      this.tabList = list;
      this.tabBar.innerHTML = '';
      this.tabBtns = {};
      for (const t of list) {
        const b = h('button', { type: 'button', role: 'tab', id: 'labTab-' + t.id, 'aria-selected': 'false' }, t.label);
        b.addEventListener('click', () => this.showTab(t.id));
        b.addEventListener('keydown', (e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          e.preventDefault(); e.stopPropagation();
          const k = list.findIndex((x) => x.id === t.id), n = list[(k + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
          this.showTab(n.id); this.tabBtns[n.id].focus();
        });
        this.tabBar.appendChild(b);
        this.tabBtns[t.id] = b;
      }
      if (!this.tab || !this.tabBtns[this.tab]) this.tab = store().get('labTab:' + this.lab.id, list[0].id);
      if (!this.tabBtns[this.tab]) this.tab = list[0].id;
    }
    showTab(id, quiet) {
      if (!this.tabBtns || !this.tabBtns[id]) return;
      this.tab = id;
      if (!quiet) store().set('labTab:' + this.lab.id, id);
      for (const [k, b] of Object.entries(this.tabBtns)) { const on = k === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
      this.tabBody.setAttribute('aria-labelledby', 'labTab-' + id);
      const top = this.tabBody.scrollTop;
      this.tabBody.innerHTML = '';
      const f = this.frames[this.i] || {}, r = this.res || {};
      const own = (this.lab.views || []).find((v) => v.id === id);
      const ctx = { lab: this.lab, values: this.values, seed: this.seed, result: r, frame: f, i: this.i, go: (k) => { this.pause(); this.go(k); } };
      if (own) { try { own.render(this.tabBody, ctx); } catch (e) { this.tabBody.appendChild(S.UI.empty('warn', 'This view could not be drawn', String(e.message || e))); } }
      else if (id === 'tables') S.LabViews.tables(this.tabBody, f.tables || r.tables);
      else if (id === 'metrics') S.LabViews.metrics(this.tabBody, f.metrics || r.metrics);
      else if (id === 'trace') S.LabViews.trace(this.tabBody, r.trace, f.at === undefined ? -1 : f.at, (k) => { const j = this.frames.findIndex((x) => x.at !== undefined && x.at >= k); if (j >= 0) { this.pause(); this.go(j); } });
      if (quiet) this.tabBody.scrollTop = top;
      S.UI.fitTables(this.tabBody);
      // a table wider than the panel scrolls, with a fade on the side that has more
      for (const w of this.tabBody.querySelectorAll('.lab-tscroll')) S.UI.scrollRow(w);
    }

    // ---- share and export --------------------------------------------------------------------------------------
    async share() {
      try {
        const hash = await S.LabViews.link(this.lab, this.values, this.seed);
        const url = location.href.replace(/#.*$/, '') + '#' + hash;
        this.lastLink = url;
        S.Share.copy(url, url.length > 6000 ? 'Copied. The link is long (' + Math.round(url.length / 1000) + ' KB): some apps cut long links.' : 'Link copied: whoever opens it gets this exact setup and seed.');
        return url;
      } catch (e) { S.UI.toast('The link could not be made: ' + e.message, 'err'); return null; }
    }
    exportMenu(anchor) {
      const r = anchor.getBoundingClientRect();
      S.UI.showMenu([
        { label: 'The trace (JSON)', icon: 'file', action: () => this.exportTrace() },
        { label: 'The picture (SVG)', icon: 'image', action: () => this.exportSVG() },
        { label: 'The picture (PNG)', icon: 'camera', action: () => this.exportPNG() },
      ], r.left, r.bottom + 4);
    }
    exportTrace() { S.UI.download(this.lab.id + '-trace.json', S.LabViews.traceJSON(this.lab, this.values, this.seed, this.res), 'application/json'); }
    exportSVG() { this.stage.finish(); S.UI.download(this.lab.id + '-step-' + (this.i + 1) + '.svg', S.LabViews.svgText(this.stage.root), 'image/svg+xml'); }
    async exportPNG() { this.stage.finish(); try { S.UI.download(this.lab.id + '-step-' + (this.i + 1) + '.png', await S.LabViews.png(this.stage.root, 2), 'image/png'); } catch (e) { S.UI.toast(e.message, 'err'); } }

    // ---- the page --------------------------------------------------------------------------------------------
    resized() {
      if (this.disposed) return;
      if (this.narrow !== this.builtNarrow) { this.runNow(false, true); return; }
      this.size();
      S.UI.fitTables(this.tabBody);
    }
    redraw() { if (this.frames.length) this.go(this.i, true); for (const ed of Object.values(this.setup.editors || {})) ed.redraw(); }
    onKey(e, typing) {
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return false;
      const k = e.key;
      if (k === ' ') { e.preventDefault(); this.toggle(); return true; }
      if (k === 'ArrowRight') { e.preventDefault(); this.pause(); this.go(this.i + 1); return true; }
      if (k === 'ArrowLeft') { e.preventDefault(); this.pause(); this.go(this.i - 1); return true; }
      if (k === 'Home') { e.preventDefault(); this.pause(); this.go(0); return true; }
      if (k === 'r' || k === 'R') { e.preventDefault(); this.runNow(true); return true; }
      return false;
    }
    dispose() { this.pause(); this.disposed = true; clearTimeout(this.autoT); window.removeEventListener('resize', this.onResize); }
  }

  S.LabShell = {
    LabPage,
    SPEEDS,
    open(app, main, lab, rest) {
      main.classList.add('wide');
      const p = new LabPage(app, main, lab, rest);
      return {
        lab: p, async: !!p.async,
        dispose: () => p.dispose(), redraw: () => p.redraw(), resized: () => p.resized(),
        onKey: (e, typing) => p.onKey(e, typing),
        keys: [['This lab', [['Space', 'Play or pause'], ['←', 'Step back'], ['→', 'Step'], ['Home', 'Back to the start'], ['R', 'Run with this setup'], ['Ctrl  Enter', 'Run, in the code editor']]]],
      };
    },
  };
})(globalThis.Proses = globalThis.Proses || {});
