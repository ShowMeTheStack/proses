// The topic player: the inputs and presets, the stage with its narration and controls (play, pause, step,
// scrub, speed, zoom, keyboard), the definition panel (the formal definition or table, with what the step
// uses lit), the list of steps, the counters, predictions on the way and the quiz at the end.
// On a phone the stage comes first with the narration under it, the inputs follow, and the definition
// and steps open in a drawer from the bottom.
// Other pages embed the same player (opts.embed): lessons, courses. (The demo page's scenes have their own small
// player, S.Player in player.js.) This file also registers the Topics page
// (#topics, #topic=id?input, #part=n): the catalogue of parts, families and topics, and one topic open.
// Input kinds drawn here besides those in topics.js: 'select' ({options: [{value, label}]}, values keep their type)
// and 'toggle' ({on, off}, default true and false); both run the topic again as soon as they change.
(function (S) {
  'use strict';
  const { h, icon } = S.UI;
  const store = S.UI.storage;
  const SPEEDS = [1800, 1250, 880, 620, 420, 260];
  S.SPEEDS = SPEEDS;
  class TopicPlayer {
    /**
     * opts: {topic, input, embed (no head, inputs or quiz), side: false (no side panel), bare (no controls:
     * Compare drives it), counters: true (counters under the narration), idp (id prefix), onFrame(i)}
     */
    constructor(app, main, opts) {
      this.app = app;
      this.t = opts.topic;
      this.f = S.familyOf(this.t);
      this.opts = opts;
      this.input = opts.input || S.inputOf(this.t);
      this.i = 0;
      this.frames = [];
      this.playing = false;
      this.timer = null;
      this.answered = new Set();
      this.root = h('div.topic' + (opts.embed ? '.embed' : ''), { dataset: { topic: this.t.id } });
      main.appendChild(this.root);
      this.build();
      // embedded players are many to a page: their element ids get a prefix
      if (opts.idp) this.root.querySelectorAll('[id]').forEach((e) => { if (!e.closest('svg')) e.id = opts.idp + e.id; });
      this.run();
      this.onResize = S.UI.debounce(() => { if (this.disposed) return; if (this.tabBody) S.UI.fitTables(this.tabBody); this.stage.applyView(); if (this.frames[this.i] && this.frames[this.i].narrowView) this.go(this.i, true); }, 120);
      window.addEventListener('resize', this.onResize);
    }
    dispose() { this.pause(); this.disposed = true; window.removeEventListener('resize', this.onResize); }

    // ---- layout -------------------------------------------------------------------------------------
    build() {
      const t = this.t;
      if (!this.opts.embed) {
        const part = S.topicPart(t);
        const quiz = h('button.btn', { type: 'button', id: 'btnQuiz', disabled: !(t.quiz && t.quiz.length), title: 'Questions on this topic (Q)' }, icon('check'), h('span.lbl', 'Quiz'));
        quiz.addEventListener('click', () => this.quiz());
        const share = h('button.btn', { type: 'button', id: 'btnShare', title: 'Copy a link to this topic with this input' }, icon('link'), h('span.lbl', 'Share'));
        share.addEventListener('click', () => this.share());
        const crumbs = h('div.crumbs', h('a', { href: '#topics' }, 'Topics'), part ? [' › ', h('a', { href: '#part=' + part.id }, 'Part ' + part.n + ': ' + part.title)] : null, this.f ? ' › ' + this.f.title : '');
        this.root.appendChild(h('div.t-head', h('div', crumbs, h('h1', t.title), h('p', t.blurb || '')), h('div.t-actions', quiz, share)));
        this.inputsEl = h('div.inputs', { id: 'inputs' });
        this.root.appendChild(this.inputsEl);
        this.buildInputs();
      } else if (this.opts.inputs && (t.inputs || []).length) {
        // an embedded player may show its inputs too (a lesson that wants the reader to try things)
        this.inputsEl = h('div.inputs.embed-inputs', { id: 'inputs' });
        this.root.appendChild(this.inputsEl);
        this.buildInputs();
      }
      this.stageWrap = h('div.stage-wrap', { id: this.opts.embed ? 'sbStage' : 'stageWrap' });
      this.stage = new S.Stage(this.stageWrap, { label: t.title, minText: () => (innerWidth < 600 ? 10 : 11) });
      this.stage.onPick = (key) => this.pick(key);
      this.stage.enableZoom();
      const zb = (id, ic, title, fn) => { const b = h('button.icon-btn.zbtn', { type: 'button', id, 'aria-label': title, title }, icon(ic)); b.addEventListener('click', fn); return b; };
      const zIn = zb('btnZoomIn', 'zoomIn', 'Zoom in (+)', () => this.stage.setZoom(this.stage.zoom * 1.4, true));
      const zOut = zb('btnZoomOut', 'zoomOut', 'Zoom out (−)', () => this.stage.setZoom(this.stage.zoom / 1.4, true));
      const zFit = zb('btnZoomFit', 'fit', 'Fit to the stage (F)', () => this.stage.fit());
      this.stage.onZoom = (z) => { zOut.disabled = z <= 1; zFit.disabled = z <= 1; this.stageWrap.classList.toggle('zoomed', z > 1); };
      this.stage.onZoom(1);
      const zFull = zb('btnFull', 'max', 'The stage alone, on the whole screen (Shift+F)', () => this.fullscreen());
      this.zFull = zFull;
      this.stageWrap.appendChild(h('div.zoom', zIn, zOut, zFit, zFull));
      this.sayEl = h('div.say', { id: this.opts.embed ? 'sbSay' : 'say', 'aria-live': 'polite' });
      this.playBtn = h('button.icon-btn.play', { type: 'button', id: 'btnPlay', 'aria-label': 'Play', title: 'Play (Space)' }, icon('run'));
      this.playBtn.addEventListener('click', () => this.toggle());
      const ib = (id, ic, title, fn) => { const b = h('button.icon-btn', { type: 'button', id, 'aria-label': title, title }, icon(ic)); b.addEventListener('click', fn); return b; };
      this.backBtn = ib('btnBack', 'stepBack', 'Step back (←)', () => this.step(-1));
      this.fwdBtn = ib('btnFwd', 'stepOver', 'Next step (→)', () => this.step(1));
      const first = ib('btnFirst', 'restart', 'From the start (Home)', () => { this.pause(); this.go(0); });
      this.range = h('input', { type: 'range', min: '0', max: '0', value: '0', id: 'timeline', 'aria-label': 'Timeline' });
      this.range.addEventListener('input', () => { this.pause(); this.go(+this.range.value, true); });
      this.marks = h('div.marks');
      this.speedEl = h('input', { type: 'range', min: '0', max: String(SPEEDS.length - 1), value: String(this.app.settings.speed), id: 'speed', 'aria-label': 'Speed' });
      this.speedEl.addEventListener('input', () => { this.app.settings.speed = +this.speedEl.value; this.app.saveSettings(); });
      this.posEl = h('span.pos', { id: 'pos' });
      const big = ib('btnBig', 'full', 'A bigger stage (B)', () => this.bigger());
      // on a phone the definition and steps live in a drawer that this opens
      const drawerBtn = this.opts.side === false ? null : h('button.btn.small.drawer-btn', { type: 'button', id: 'btnDrawer', 'aria-expanded': 'false', 'aria-controls': 'sidePanel', title: 'The definition and the steps (D)' }, icon('drawer'), 'Definition');
      if (drawerBtn) drawerBtn.addEventListener('click', () => this.drawer());
      this.drawerBtn = drawerBtn;
      const controls = h('div.controls', first, this.backBtn, this.playBtn, this.fwdBtn, h('div.timeline', this.range, this.marks), this.posEl, h('label.speed', h('span', 'Speed'), this.speedEl), big, drawerBtn);
      const stageCard = h('div.card.stage-card', this.stageWrap, this.sayEl, this.opts.bare ? null : controls);
      if (this.opts.counters) { this.countersEl = h('div.counters.inline', { id: 'counters' }); stageCard.appendChild(this.countersEl); }
      if (this.opts.side === false) { this.root.appendChild(stageCard); this.tabs = {}; return; }
      this.tabs = {};
      const tabBar = h('div.tabs', { role: 'tablist', 'aria-label': 'Panels' });
      this.tabBody = h('div.tab-body', { id: 'tabBody', role: 'tabpanel' });
      for (const [k, label] of [['def', 'Definition'], ['steps', 'Steps']]) {
        const b = h('button', { type: 'button', role: 'tab', id: 'tab-' + k, 'aria-selected': 'false' }, label);
        b.addEventListener('click', () => this.showTab(k));
        b.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); const n = k === 'def' ? 'steps' : 'def'; this.showTab(n); this.tabs[n].focus(); } });
        tabBar.appendChild(b);
        this.tabs[k] = b;
      }
      const close = h('button.icon-btn.drawer-close', { type: 'button', id: 'btnDrawerClose', 'aria-label': 'Close the panel', title: 'Close (Esc)' }, icon('x'));
      close.addEventListener('click', () => this.drawer(false));
      tabBar.appendChild(close);
      this.countersEl = h('div.counters', { id: 'counters' });
      this.sideCard = h('div.card.side-card', { id: 'sidePanel' }, tabBar, this.tabBody, this.countersEl);
      this.scrim = h('div.drawer-scrim', { 'aria-hidden': 'true' });
      this.scrim.addEventListener('click', () => this.drawer(false));
      this.root.appendChild(h('div.work', stageCard, this.sideCard, this.scrim));
      this.tab = store.get('tab', 'def');
    }
    bigger() { this.stageWrap.classList.toggle('big'); this.redraw(); }
    /** The stage card alone over the whole window (Esc or the button again to leave) */
    fullscreen(on) {
      const card = this.stageWrap.closest('.stage-card');
      on = on === undefined ? !card.classList.contains('fullscreen') : !!on;
      card.classList.toggle('fullscreen', on);
      document.body.classList.toggle('stage-full', on);
      this.zFull.innerHTML = ''; this.zFull.appendChild(icon(on ? 'min' : 'max'));
      this.zFull.setAttribute('aria-label', on ? 'Leave the full-screen stage' : 'The stage alone, on the whole screen');
      this.zFull.setAttribute('aria-pressed', String(on));
      this.redraw();
    }
    /** Open or close the phone drawer (toggle when open is not given) */
    drawer(open) {
      if (!this.sideCard) return;
      const on = open === undefined ? !this.root.classList.contains('drawer-open') : !!open;
      this.root.classList.toggle('drawer-open', on);
      if (this.drawerBtn) this.drawerBtn.setAttribute('aria-expanded', String(on));
      if (on) { S.UI.fitTables(this.tabBody); const f = this.tabs[this.tab]; if (f) setTimeout(() => f.focus(), 30); } else if (this.drawerBtn && this.drawerBtn.offsetParent) this.drawerBtn.focus();
    }

    // ---- inputs ----------------------------------------------------------------------------------------
    buildInputs() {
      const t = this.t, el = this.inputsEl;
      el.innerHTML = '';
      this.fields = {};
      for (const inp of t.inputs || []) {
        if (inp.kind === 'hidden') continue;
        const v = this.input[inp.id];
        let field;
        const id = 'in-' + inp.id;
        if (inp.kind === 'choice') field = h('select', { id, 'aria-label': inp.label }, ...(inp.options || []).map((o) => h('option', { value: o.value, selected: o.value === v }, o.label)));
        else if (inp.kind === 'select' || inp.kind === 'toggle') {
          // select: option values keep their type (numbers too); toggle: a switch, {on, off} the values (true, false)
          const on = inp.on !== undefined ? inp.on : true, off = inp.off !== undefined ? inp.off : false;
          const sel = inp.kind === 'select';
          field = sel ? h('select', { id, 'aria-label': inp.label }, ...(inp.options || []).map((o, k) => h('option', { value: String(k), selected: o.value === v }, o.label)))
            : h('input', { type: 'checkbox', id, role: 'switch', 'aria-label': inp.label });
          if (!sel) field.checked = v === on;
          const read = () => (sel ? (inp.options[+field.value] || {}).value : field.checked ? on : off);
          field.addEventListener('change', () => this.apply(true));
          this.fields[inp.id] = { inp, field, read };
          el.appendChild(sel ? h('label', inp.label, field) : h('label.knob-toggle.t-toggle', field, h('span.lab-switch', { 'aria-hidden': 'true' }), h('span', inp.label)));
          continue;
        }
        else if (inp.kind === 'number') field = h('input', { type: 'number', value: String(v), id, 'aria-label': inp.label, style: { width: '96px' }, min: inp.min, max: inp.max, step: inp.integer === false ? 'any' : null });
        else if (inp.kind === 'slider') {
          // a slider runs the topic again as it moves; log sliders move the exponent
          const toPos = (x) => (inp.log ? Math.log10(x) : x), toVal = (q) => (inp.log ? +Math.pow(10, q).toPrecision(3) : q);
          const fmt = inp.fmt || ((x) => String(+(+x).toPrecision(3)));
          const out = h('output.mono', fmt(v));
          const r = h('input', { type: 'range', id: id + '-r', 'aria-label': inp.label, min: toPos(inp.min), max: toPos(inp.max), step: inp.step || (inp.log ? 0.05 : 1), value: toPos(v) });
          field = h('input', { type: 'hidden', id, value: String(v) });
          const go = S.UI.debounce(() => this.apply(true), 120);
          r.addEventListener('input', () => { const x = toVal(+r.value); field.value = String(x); out.textContent = fmt(x); go(); });
          this.fields[inp.id] = { inp, field };
          el.appendChild(h('label.slider', inp.label, r, out, field));
          continue;
        }
        else if (inp.kind === 'program') {
          // several lines of text (a program, a list of rows): Ctrl+Enter runs
          field = h('textarea.mono.prog-text', { id, 'aria-label': inp.label, spellcheck: 'false', rows: String(Math.min(17, Math.max(3, String(v || '').split('\n').length + 1))) });
          field.value = String(v || '');
        } else {
          field = h('input', { type: 'text', value: S.showInput(inp, v), id, 'aria-label': inp.label, spellcheck: 'false', placeholder: inp.kind === 'expr' ? "A'B + C" : inp.kind === 'list' ? '0, 1, 3' : '', style: inp.kind === 'expr' ? { minWidth: '200px' } : null });
          if (inp.kind === 'string' || inp.kind === 'expr' || inp.kind === 'list') field.classList.add('mono');
        }
        field.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (field.tagName !== 'TEXTAREA' || e.ctrlKey || e.metaKey)) { e.preventDefault(); this.apply(); } });
        this.fields[inp.id] = { inp, field };
        el.appendChild(h('label' + (inp.kind === 'program' ? '.wide' : ''), inp.label, field));
        if (inp.kind === 'program') S.UI.autosize(field, 380);
      }
      const go = h('button.btn.primary', { type: 'button', id: 'btnRun' }, icon('run'), 'Run');
      go.addEventListener('click', () => this.apply());
      if ((t.inputs || []).length) el.appendChild(go);
      if (t.presets && t.presets.length) {
        const ps = h('div.presets', { role: 'group', 'aria-label': 'Examples' });
        for (const p of t.presets) {
          const on = Object.entries(p.values || {}).every(([k, val]) => JSON.stringify(this.input[k]) === JSON.stringify(val));
          const c = h('button.chip' + (on ? '.on' : ''), { type: 'button', 'aria-pressed': String(on) }, p.label);
          c.addEventListener('click', () => { this.input = S.inputOf(t, Object.assign({}, S.inputOf(t), p.values)); this.buildInputs(); this.run(); });
          ps.appendChild(c);
        }
        el.appendChild(ps);
        S.UI.scrollRow(ps);
      }
      this.errEl = h('div.err', { id: 'inputErr', role: 'alert' });
      el.appendChild(this.errEl);
      if (!(t.inputs || []).length && !(t.presets || []).length) el.style.display = 'none';
    }
    /** Read the fields, check them and run again */
    apply(keepFrame) {
      const next = Object.assign({}, this.input);
      for (const [id, { inp, field, read }] of Object.entries(this.fields || {})) next[id] = read ? read() : S.parseInput(inp, field.value);
      const e = S.checkInput(this.t, next);
      this.errEl.textContent = e || '';
      if (e) return false;
      this.input = next;
      if (!this.opts.embed) store.set('in:' + this.t.id, next);
      this.run(keepFrame);
      if (this.inputsEl) for (const c of this.inputsEl.querySelectorAll('.presets .chip')) c.classList.remove('on');
      return true;
    }

    // ---- running ---------------------------------------------------------------------------------------
    /** run the topic with the current input; keepFrame stays on the same step (a slider moved) */
    run(keepFrame) {
      const at = keepFrame ? this.i : 0;
      this.pause();
      const res = S.run(this.t, this.input);
      this.res = res;
      this.frames = res.frames.length ? res.frames : [{ items: [], say: 'Nothing happens with this input.' }];
      this.answered = new Set();
      this.stage.clear();
      this.range.max = String(this.frames.length - 1);
      this.marks.innerHTML = '';
      this.frames.forEach((f, i) => {
        if (f.predict || f.mark) {
          const m = h('i' + (f.predict ? '.q' : ''), { title: f.mark || 'Predict' });
          m.style.left = (this.frames.length > 1 ? (i / (this.frames.length - 1)) * 100 : 0) + '%';
          this.marks.appendChild(m);
        }
      });
      this.i = Math.min(at, this.frames.length - 1);
      this.go(this.i, true);
      if (this.tabBody) this.showTab(this.tab);
    }
    showTab(k) {
      if (!this.tabBody) return;
      this.tab = k;
      store.set('tab', k);
      for (const [key, b] of Object.entries(this.tabs)) { b.classList.toggle('on', key === k); b.setAttribute('aria-selected', String(key === k)); b.tabIndex = key === k ? 0 : -1; }
      this.tabBody.setAttribute('aria-labelledby', (this.opts.idp || '') + 'tab-' + k);
      this.tabBody.innerHTML = '';
      if (k === 'def') this.tabBody.appendChild(this.defView());
      else this.tabBody.appendChild(this.stepsView());
      S.UI.fitTables(this.tabBody);
    }
    /** The definition, tables and equations of what is running, with this step's part lit */
    defView() {
      const box = h('div.defn', { id: 'defView' });
      const d = this.res && this.res.def;
      if (!d || !(d.sections || []).length) { box.appendChild(S.UI.empty('book', 'No definition here', 'This picture explains itself step by step: follow the narration under the stage, or open Steps for the whole story.')); return box; }
      const fr = this.frames[this.i] || {};
      const hl = fr.hl || {};
      for (const s of d.sections || []) {
        if (s.title) box.appendChild(h('h4', s.title));
        const lit = [].concat(hl[s.id] || []).map(String);
        if (s.kind === 'table') box.appendChild(S.Kit.table.html(Object.assign({}, s, { hl: lit })));
        else if (s.kind === 'math') box.appendChild(h('div.math', ...String(s.text).split('\n').map((l, i) => h('div' + (lit.includes(String(i)) ? '.hlline' : ''), l))));
        else box.appendChild(h('p', ...S.UI.withLinks(s.text || '')));
      }
      // keep the lit row in view
      requestAnimationFrame(() => { const el = box.querySelector('tr.hl, td.hl'); if (el && this.tabBody && this.tabBody.offsetParent) { const r = el.getBoundingClientRect(), b = this.tabBody.getBoundingClientRect(); if (r.top < b.top || r.bottom > b.bottom) el.scrollIntoView({ block: 'nearest' }); } });
      return box;
    }
    stepsView() {
      const box = h('ol.steps', { id: 'stepsView' });
      this.frames.forEach((f, i) => {
        const li = h('li' + (i === this.i ? '.on' : ''), h('button', { type: 'button', 'aria-current': i === this.i ? 'step' : null }, S.UI.sayPlain(f.say || '(no narration)')));
        li.firstChild.addEventListener('click', () => { this.pause(); this.go(i); });
        box.appendChild(li);
      });
      requestAnimationFrame(() => { const on = box.querySelector('li.on'); if (on && this.tabBody && this.tabBody.offsetParent) { const r = on.getBoundingClientRect(), b = this.tabBody.getBoundingClientRect(); if (r.top < b.top || r.bottom > b.bottom) on.scrollIntoView({ block: 'nearest' }); } });
      return box;
    }

    // ---- moving through the frames -----------------------------------------------------------------------
    go(i, instant) {
      i = Math.max(0, Math.min(this.frames.length - 1, i));
      const back = i < this.i;
      this.i = i;
      const fr = this.frames[i];
      const dur = instant ? 0 : Math.min(SPEEDS[this.app.settings.speed] * 0.72, 700) * (back ? 0.7 : 1);
      this.stage.show(fr, { duration: dur });
      this.range.value = String(i);
      this.posEl.textContent = (i + 1) + ' / ' + this.frames.length;
      this.sayEl.innerHTML = '';
      this.sayEl.appendChild(h('span.step', i === 0 ? 'Start' : i === this.frames.length - 1 ? 'Finished' : 'Step ' + i));
      this.sayEl.append(...S.UI.sayNodes(fr.say || ''));
      this.renderCounters(fr);
      if (this.tabBody) this.showTab(this.tab);
      this.backBtn.disabled = i === 0;
      this.fwdBtn.disabled = i === this.frames.length - 1;
      this.clearPredict();
      if (i === this.frames.length - 1 && this.res && this.res.ok && !this.opts.embed) this.app.markDone(this.t);
      if (this.opts.onFrame) this.opts.onFrame(i, fr);
    }
    renderCounters(fr) {
      if (!this.countersEl) return;
      const c = fr.counters || {};
      const prev = this.i > 0 ? this.frames[this.i - 1].counters || {} : {};
      const list = (this.res && this.res.counters && this.res.counters.length ? this.res.counters : Object.keys(c).map((k) => ({ id: k, label: k }))).map((x) => (typeof x === 'string' ? { id: x, label: x } : x));
      this.countersEl.innerHTML = '';
      for (const k of list) this.countersEl.appendChild(h('div.counter' + (c[k.id] !== prev[k.id] && this.i > 0 ? '.bump' : ''), { dataset: { counter: k.id } }, h('b', String(c[k.id] === undefined ? 0 : c[k.id])), h('span', k.label)));
    }
    step(d) {
      this.pause();
      if (d > 0 && this.pendingPredict()) return;
      this.go(this.i + d);
    }
    toggle() { if (this.playing) this.pause(); else this.play(); }
    play() {
      if (this.i >= this.frames.length - 1) this.go(0, true);
      this.playing = true;
      this.playBtn.innerHTML = ''; this.playBtn.appendChild(icon('pause')); this.playBtn.setAttribute('aria-label', 'Pause');
      this.tick();
    }
    pause() {
      this.playing = false;
      clearTimeout(this.timer);
      if (this.playBtn) { this.playBtn.innerHTML = ''; this.playBtn.appendChild(icon('run')); this.playBtn.setAttribute('aria-label', 'Play'); }
    }
    tick() {
      clearTimeout(this.timer);
      if (!this.playing || this.disposed) return;
      if (this.i >= this.frames.length - 1) { this.pause(); return; }
      if (this.pendingPredict()) { this.pause(); return; }
      this.timer = setTimeout(() => { if (!this.playing) return; this.go(this.i + 1); this.tick(); }, SPEEDS[this.app.settings.speed] * (this.frames[this.i].slow ? 1.6 : 1));
    }
    redraw() { this.stage.view = null; this.go(this.i, true); }
    fit() { this.stage.fit(); }

    // ---- predictions -----------------------------------------------------------------------------------
    pendingPredict() {
      const fr = this.frames[this.i];
      if (!fr.predict || !this.app.settings.predict || this.answered.has(this.i)) return false;
      this.showPredict(fr.predict);
      return true;
    }
    showPredict(p) {
      this.clearPredict();
      const box = h('div.predict', { id: 'predict', role: 'dialog', 'aria-label': 'Predict' });
      box.append(h('h4', 'Predict'), h('p', p.ask));
      const skip = h('button.btn.skip', { type: 'button', id: 'predictSkip' }, 'Show me');
      skip.addEventListener('click', () => this.reveal(null));
      if (p.pick === 'option' && p.options) {
        const opts = h('div.opts');
        for (const o of p.options) { const b = h('button.chip', { type: 'button' }, String(o)); b.addEventListener('click', () => this.reveal(String(o))); opts.appendChild(b); }
        opts.appendChild(skip);
        box.appendChild(opts);
      } else {
        this.stageWrap.classList.add('picking');
        box.appendChild(h('div.opts', h('span.muted', 'Click it on the picture.'), skip));
      }
      this.predictBox = box;
      this.predictQ = p;
      this.sayEl.after(box);
      const f = box.querySelector('button');
      if (f && document.activeElement && this.root.contains(document.activeElement)) f.focus();
    }
    pick(key) {
      if (this.predictQ && this.predictQ.pick !== 'option') { this.reveal(key); return; }
      // an item that carries more to show when clicked: a confusion cell and its examples, a node and its rows
      const f = this.frames[this.i], it = f && f.items.find((x) => x.key === key);
      const info = (f && f.picks && f.picks[key]) || (it && it.info);
      if (info) this.showInfo(info, key);
    }
    /** info: {title, text, lines: [..], cols: [names], rows: [[cells]..], images: [{px: [0..15], w, h, label}]} */
    showInfo(info, key) {
      if (!this.infoEl) { this.infoEl = h('div.pick-info', { 'aria-live': 'polite' }); this.sayEl.after(this.infoEl); }
      const el = this.infoEl;
      el.innerHTML = '';
      el.dataset.key = key || '';
      const close = h('button.icon-btn.pick-x', { type: 'button', 'aria-label': 'Close', title: 'Close' }, icon('x'));
      close.addEventListener('click', () => { el.innerHTML = ''; el.classList.remove('on'); });
      el.append(close, h('b', info.title || ''));
      if (info.text) el.appendChild(h('p', S.UI.inline ? S.UI.inline(info.text) : info.text));
      if (info.lines) el.appendChild(h('ul', info.lines.map((l) => h('li', l))));
      if (info.rows) el.appendChild(h('div.fit-table', h('table.ls-table', info.cols ? h('thead', h('tr', info.cols.map((c) => h('th', c)))) : null, h('tbody', info.rows.map((r) => h('tr', r.map((c) => h('td.mono', String(c)))))))));
      if (info.images) {
        const g = h('div.pick-imgs');
        for (const im of info.images) {
          const c = document.createElement('canvas'); c.width = im.w; c.height = im.h;
          const cx = c.getContext('2d'), d = cx.createImageData(im.w, im.h);
          im.px.forEach((v, k) => { const q = 255 - Math.round((v / 15) * 255); d.data.set([q, q, q, 255], k * 4); });
          cx.putImageData(d, 0, 0);
          g.appendChild(h('figure', c, im.label ? h('figcaption', im.label) : null));
        }
        el.appendChild(g);
      }
      el.classList.add('on');
    }
    reveal(given) {
      const p = this.predictQ;
      if (!p) return;
      this.answered.add(this.i);
      this.stageWrap.classList.remove('picking');
      const answers = [].concat(p.answer).map(String);
      const right = given !== null && answers.includes(String(given));
      const box = this.predictBox;
      box.querySelectorAll('.opts').forEach((o) => o.remove());
      box.appendChild(h('div.res' + (given === null ? '' : right ? '.good' : '.bad'), given === null ? '' : right ? 'Right.' : 'Not quite.'));
      if (p.explain) box.appendChild(h('p', { style: { marginTop: '4px' } }, p.explain));
      const go = h('button.btn.primary', { type: 'button', id: 'predictGo' }, 'See it happen');
      go.addEventListener('click', () => { this.clearPredict(); this.go(this.i + 1); });
      box.appendChild(go);
      this.predictQ = null;
      go.focus();
    }
    clearPredict() { if (this.predictBox) { this.predictBox.remove(); this.predictBox = null; } this.predictQ = null; if (this.stageWrap) this.stageWrap.classList.remove('picking'); }

    // ---- quiz and sharing --------------------------------------------------------------------------------
    quiz() {
      const t = this.t;
      if (!(t.quiz && t.quiz.length)) return;
      const box = h('div');
      let score = 0, answered = 0;
      const sc = h('p.muted', { id: 'quizScore' });
      for (const q of t.quiz || []) {
        const qb = h('div.quiz-q', h('h4', q.q));
        const why = h('div.quiz-why');
        q.options.forEach((o, k) => {
          const b = h('button.quiz-opt', { type: 'button' }, o);
          b.addEventListener('click', () => {
            if (qb.dataset.done) return;
            qb.dataset.done = '1';
            answered++;
            if (k === q.answer) { score++; b.classList.add('right'); } else { b.classList.add('wrong'); qb.querySelectorAll('.quiz-opt')[q.answer].classList.add('right'); }
            why.textContent = q.why || '';
            sc.textContent = score + ' of ' + answered + ' right so far';
          });
          qb.appendChild(b);
        });
        qb.appendChild(why);
        box.appendChild(qb);
      }
      box.appendChild(sc);
      S.UI.modal({ title: 'Quiz: ' + t.title, body: box, wide: true, buttons: [{ label: 'Close', value: true, primary: true }] });
    }
    share() {
      const q = Object.entries(this.input).map(([k, v]) => k + '=' + encodeURIComponent(JSON.stringify(v))).join('&');
      const url = location.href.replace(/#.*$/, '') + '#topic=' + this.t.id + (q ? '?' + q : '');
      S.Share.copy(url, 'A link to this topic with this input is copied.');
    }
  }

  S.TopicPlayer = TopicPlayer;

  // ---- the reader's place in the course: speed, predictions, topics seen to the end ------------------------
  /**
   * What players, lessons and courses need of an app: settings.speed and settings.predict (kept apart from the
   * app's own settings), the topics done, and markDone. S.Learner is that object.
   */
  const learner = S.Learner = {
    settings: Object.assign({ speed: 2, predict: true }, store.get('learner', {})),
    done: new Set(store.get('done', [])),
    saveSettings() { store.set('learner', this.settings); },
    markDone(t) { if (this.done.has(t.id)) return; this.done.add(t.id); store.set('done', [...this.done]); },
    setPredict(on) { this.settings.predict = on; this.saveSettings(); S.UI.toast(on ? 'Predictions on: the player stops to ask what comes next.' : 'Predictions off: the player runs straight through.', 'ok', 2500); },
  };

  /** The keys a player answers to; true when the key was used */
  S.playerKey = function (p, e, typing) {
    if (!p || typing || e.metaKey || e.ctrlKey || e.altKey) return false;
    const tag = (e.target && e.target.tagName) || '';
    if ((tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') && (e.key === ' ' || e.key === 'Enter')) return false;
    const k = e.key;
    if (k === 'Escape') {
      if (p.root && p.root.classList.contains('drawer-open')) { e.preventDefault(); p.drawer(false); return true; }
      if (p.stageWrap && p.stageWrap.closest('.fullscreen')) { e.preventDefault(); p.fullscreen(false); return true; }
      return false;
    }
    const act = () => { e.preventDefault(); return true; };
    if (k === ' ' || k === 'k') { p.toggle(); return act(); }
    if (k === 'ArrowRight' || k === 'l') { p.step(1); return act(); }
    if (k === 'ArrowLeft' || k === 'j') { p.step(-1); return act(); }
    if (k === 'Home') { p.pause(); p.go(0); return act(); }
    if (k === 'End') { p.pause(); p.go(p.frames.length - 1); return act(); }
    if (k === 'r' || k === 'R') { p.pause(); p.go(0, true); p.play(); return act(); }
    if (k === 'F' && e.shiftKey) { p.fullscreen(); return act(); }
    if (k === 'f' || k === '0') { p.fit(); return act(); }
    if (k === '+' || k === '=') { p.stage.setZoom(p.stage.zoom * 1.4, true); return act(); }
    if (k === '-') { p.stage.setZoom(p.stage.zoom / 1.4, true); return act(); }
    if (k === 'b' || k === 'B') { p.bigger(); return act(); }
    if (k === 'p') { learner.setPredict(!learner.settings.predict); return act(); }
    if ((k === 'd' || k === 'D') && p.sideCard) { if (p.drawerBtn && getComputedStyle(p.drawerBtn).display !== 'none') p.drawer(); else p.showTab(p.tab === 'def' ? 'steps' : 'def'); return act(); }
    if ((k === 'q' || k === 'Q') && p.quiz && !p.opts.embed) { p.quiz(); return act(); }
    if (k === ']' || k === '[') { learner.settings.speed = Math.max(0, Math.min(SPEEDS.length - 1, learner.settings.speed + (k === ']' ? 1 : -1))); learner.saveSettings(); if (p.speedEl) p.speedEl.value = String(learner.settings.speed); return act(); }
    return false;
  };
  S.PLAYER_KEYS = [
    ['Playing', [['Space', 'Play or pause'], ['→  ←', 'Next step, step back'], ['Home  End', 'First or last step'], ['R', 'Play again from the start'], ['[  ]', 'Slower, faster']]],
    ['Looking', [['F', 'Fit the picture to the stage'], ['Shift  F', 'The stage on the whole screen'], ['+  −', 'Zoom in, out'], ['B', 'A bigger stage'], ['D', 'Definition or steps (on a phone, the drawer)']]],
    ['Learning', [['P', 'Predictions on or off'], ['Q', 'The quiz of this topic']]],
  ];

  // ---- the Topics page ----------------------------------------------------------------------------------------
  function catalogue(main, focus, notice) {
    document.title = 'Topics · Proses';
    const box = h('div.home.topics', { id: 'topicsView' });
    if (notice) box.appendChild(h('div.notice', icon('info'), h('span', notice)));
    box.append(h('h1.page-title', 'Topics'), h('p.lead', 'The course, part by part. Each topic is a picture that runs: a process tree, a schedule, a page walk or a disk image changing step by step, with the actual values in the narration, a question to answer before each key moment, and a quiz at the end.'));
    for (const part of S.parts || []) {
      const fams = (S.families || []).filter((f) => f.part === part.id && (S.topics || []).some((t) => t.family === f.id));
      const sec = h('section.part', { id: 'part-' + part.id, dataset: { part: part.id } });
      sec.appendChild(h('div.part-head', h('span.num', String(part.n)), h('h2', part.title)));
      sec.appendChild(h('p.part-blurb', part.blurb));
      if (fams.length) {
        const grid = h('div.fam-grid');
        for (const f of fams) {
          const ts = S.topics.filter((t) => t.family === f.id);
          const done = ts.filter((t) => learner.done.has(t.id)).length;
          const card = h('div.card.fam-card.plain', { dataset: { fam: f.id } }, h('div.fc-body', h('h3', f.title), h('p', f.blurb || ''),
            h('ul.fam-topics', ...ts.map((t) => h('li', h('a', { href: '#topic=' + t.id, dataset: { topic: t.id } }, t.title), learner.done.has(t.id) ? h('span.done', { title: 'Seen to the end' }, ' ✓') : null))),
            h('span.n', ts.length + ' topic' + (ts.length === 1 ? '' : 's') + (done ? ' · ' + done + ' done' : '')),
            done ? h('span.fc-bar', h('i', { style: { width: Math.round((100 * done) / ts.length) + '%' } })) : null));
          grid.appendChild(card);
        }
        sec.appendChild(grid);
      } else sec.appendChild(h('div.part-soon', icon('layers'), h('span', 'The topics of this part are on their way. Meanwhile ', h('a', { href: '#demo' }, 'the sample scenes'), ' show the pictures they are built from.')));
      box.appendChild(sec);
    }
    main.appendChild(box);
    if (focus) requestAnimationFrame(() => { const el = document.getElementById('part-' + focus); if (el) el.scrollIntoView({ block: 'start' }); });
  }
  function openTopic(main, t, query) {
    const given = {};
    if (query) for (const part of query.split('&')) { const i = part.indexOf('='); if (i < 0) continue; try { given[part.slice(0, i)] = JSON.parse(decodeURIComponent(part.slice(i + 1))); } catch (e) { /* ignore */ } }
    const saved = store.get('in:' + t.id, null);
    let input = S.inputOf(t, Object.keys(given).length ? given : saved);
    if (S.checkInput(t, input)) input = S.inputOf(t);
    const p = new TopicPlayer(learner, main, { topic: t, input });
    const f = S.familyOf(t);
    document.title = t.title + (f ? ' · ' + f.title : '') + ' · Proses';
    return p;
  }
  S.openTopic = openTopic;
  S.Pages.register('topics', {
    nav: 'topics',
    open(app, main, rest) {
      rest = rest || '';
      let player = null;
      if (rest.startsWith('topic=') || rest.startsWith('topic/')) {
        const [id, q] = rest.slice(6).split('?');
        const t = S.byId && S.byId(id);
        if (t) player = openTopic(main, t, q);
        else catalogue(main, null, 'There is no topic called "' + id + '". It may have been renamed: pick one from the list.');
      } else if (rest.startsWith('part=') || rest.startsWith('part/')) {
        const k = rest.slice(5), part = (S.parts || []).find((x) => x.id === k || String(x.n) === k);
        catalogue(main, part ? part.id : null, part ? null : 'There is no part called "' + k + '".');
      } else catalogue(main, null);
      return {
        player, keys: player ? S.PLAYER_KEYS : null,
        onKey: (e, typing) => S.playerKey(player, e, typing),
        redraw() { if (player) { player.redraw(); if (player.tabBody) S.UI.fitTables(player.tabBody); } },
        dispose() { if (player) player.dispose(); },
      };
    },
  });
})(globalThis.Proses = globalThis.Proses || {});
