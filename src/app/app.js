// The Proses app: routing between the pages that register with S.Pages (ui.js), the theme and projector settings,
// share links and keyboard shortcuts. The top bar, the home page, the settings dialog and About are drawn by
// S.Shell (shell.js). Pages register themselves; this file only frames them.
(function (S) {
  'use strict';
  const { h, icon } = S.UI;
  const store = S.UI.storage;
  const TITLE = 'Proses: operating systems you can see inside';
  const frame = () => document.getElementById('app') || document.body;

  class App {
    constructor() {
      S.app = this;
      this.settings = Object.assign({ theme: 'auto', projector: false, animate: true, autosave: true }, store.get('settings', {}));
      this.applyTheme();
      try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (this.settings.theme === 'auto') { this.applyTheme(); this.redraw(); } }); } catch (e) { /* old browsers */ }
      this.players = [];
      this.byId = {};
      this.buildTop();
      window.addEventListener('hashchange', () => this.route());
      document.addEventListener('keydown', (e) => this.onKey(e));
      let lastW = innerWidth;
      window.addEventListener('resize', () => { if (innerWidth === lastW) return; lastW = innerWidth; for (const p of this.players) p.resized(); if (this.page && this.page.resized) this.page.resized(); });
      this.route();
    }
    saveSettings() { store.set('settings', this.settings); }
    get theme() { return document.documentElement.dataset.theme; }
    applyTheme() {
      let t = this.settings.theme;
      if (t === 'auto') { try { t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (e) { t = 'light'; } }
      document.documentElement.dataset.theme = t;
      document.documentElement.dataset.projector = this.settings.projector ? 'on' : 'off';
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', t === 'dark' ? '#1b1816' : '#ffffff');
      if (this.btnTheme) { this.btnTheme.innerHTML = ''; this.btnTheme.appendChild(icon(t === 'dark' ? 'sun' : 'moon')); }
      if (this.btnProj) { this.btnProj.classList.toggle('on', !!this.settings.projector); this.btnProj.setAttribute('aria-pressed', String(!!this.settings.projector)); }
    }
    setTheme(t) { this.settings.theme = t; this.saveSettings(); this.applyTheme(); this.redraw(); }
    toggleTheme() { this.setTheme(this.theme === 'dark' ? 'light' : 'dark'); }
    setProjector(on) { this.settings.projector = on; this.saveSettings(); this.applyTheme(); this.redraw(); }
    /** draw again after a theme change: rasters read their colours from the theme */
    redraw() {
      if (this.page && this.page.redraw) this.page.redraw();
      for (const p of this.players) p.redraw ? p.redraw() : p.resized();
    }

    buildTop() { S.Shell.buildTop(this); }
    aboutMenu(anchor) { S.Shell.aboutMenu(this, anchor); }
    settingsDialog() { S.Shell.settings(this); }
    about() { S.Shell.about(this); }
    share(kind, data) { return S.Shell.share(kind, data); }
    markDone(t) { if (S.Learner) S.Learner.markDone(t); }
    pageOf(hash) { return S.Shell.pageOf(hash); }
    route() {
      let hash = '';
      try { hash = decodeURIComponent(location.hash.replace(/^#\/?/, '')); } catch (e) { hash = location.hash.replace(/^#\/?/, ''); }
      window.__prosesReady = false;
      frame().classList.remove('menu-open');
      // a dialog belongs to the page it was opened over
      if (S.UI.anyModalOpen && S.UI.anyModalOpen() && S.UI.closeAllModals) S.UI.closeAllModals();
      if (this.page && this.page.dispose) try { this.page.dispose(); } catch (e) { /* gone */ }
      for (const p of this.players) p.stop();
      this.page = null; this.players = []; this.byId = {};
      const main = document.getElementById('main');
      main.innerHTML = '';
      main.className = 'main';
      document.title = TITLE;
      if (hash.startsWith('share=')) { S.Shell.openShared(this, hash.slice(6)); return; }
      const [id, rest] = this.pageOf(hash);
      const pg = id && S.Pages.get(id);
      if (pg) {
        this.setNav(pg.nav === undefined ? id : pg.nav);
        if (pg.wide) main.classList.add('wide');
        try { this.page = pg.open(this, main, rest) || {}; }
        catch (e) { main.innerHTML = ''; main.appendChild(S.UI.empty('warn', 'This page could not open', String(e.message || e))); if (typeof console !== 'undefined') console.error(e); }
        if (pg.title) document.title = pg.title + ' · Proses';
        if (!this.page || !this.page.async) requestAnimationFrame(() => { window.__prosesReady = true; });
        window.scrollTo(0, 0);
        return;
      }
      this.setNav('');
      this.renderHome(main, hash ? 'There is no page called "' + hash + '". Start from here.' : null);
      window.scrollTo(0, 0);
      requestAnimationFrame(() => { window.__prosesReady = true; });
    }
    setNav(navOf) {
      for (const b of document.querySelectorAll('#topNav button')) { const on = b.dataset.route === navOf; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
    }

    renderHome(main, notice) { S.Shell.renderHome(this, main, notice); }

    onKey(e) {
      if (S.UI.anyModalOpen()) return;
      if (e.key === 'Escape' && frame().classList.contains('menu-open')) { frame().classList.remove('menu-open'); return; }
      const tag = (e.target && e.target.tagName) || '';
      const typing = /INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable);
      if (this.page && this.page.onKey && this.page.onKey(e, typing)) return;
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((tag === 'BUTTON' || tag === 'A') && (e.key === ' ' || e.key === 'Enter')) return;
      const k = e.key;
      if (k === '?') { e.preventDefault(); this.shortcuts(); }
      else if (k === 'P' && e.shiftKey) { e.preventDefault(); this.setProjector(!this.settings.projector); }
      else if (k === 't' || k === 'T') { e.preventDefault(); this.toggleTheme(); }
    }
    shortcuts() {
      const groups = [['Everywhere', [['T', 'Light or dark'], ['Shift  P', 'Projector mode'], ['Esc', 'Close a dialog or the menu'], ['?', 'This list']]]];
      const pg = this.page && this.page.keys;
      if (pg) groups.unshift(...pg);
      const body = h('div.keys', ...groups.map(([title, rows]) => h('section', h('h4', title), h('table', ...rows.map(([k, v]) => h('tr', h('td', ...k.split('  ').map((x, i) => [i ? ' ' : '', h('kbd', x)])), h('td', v)))))));
      S.UI.modal({ title: 'Keyboard shortcuts', body, wide: true, cls: 'keys-modal', buttons: [{ label: 'OK', value: true, primary: true }], enterValue: true });
    }
  }

  S.App = App;
  if (typeof document !== 'undefined' && document.getElementById && document.getElementById('main')) {
    const start = () => { try { new App(); } catch (e) { document.body.innerHTML = '<pre style="padding:20px;white-space:pre-wrap">Proses could not start: ' + String(e.stack || e.message).replace(/</g, '&lt;') + '</pre>'; throw e; } };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  }
})(globalThis.Proses = globalThis.Proses || {});
