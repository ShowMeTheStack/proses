// Lesson blocks beyond the basic ones (lessons.js lists them all): a scene of the demo page, and a card that opens
// a lab set up for the lesson. More block kinds register in S.LessonBlocks: S.LessonBlocks.name = (b, page, app,
// idp) -> element, for a block {name: ...}.
(function (S) {
  'use strict';
  const { h, icon } = S.UI;
  const LB = (S.LessonBlocks = S.LessonBlocks || {});
  const inline = (t) => S.UI.inline(t);
  const figure = (el, caption, cls) => h('figure.ls-fig' + (cls ? '.' + cls : ''), el, caption ? h('figcaption', inline(caption)) : null);
  const card = (href, ic, kind, title, meta) => h('a.ls-link', { href }, h('span.tc-icon', icon(ic)), h('span', h('span.kind', kind), h('b', title), meta ? h('span.meta', meta) : null), h('span.go', '→'));

  /** {scene: 'demo scene id'}: the scene with its own small player */
  LB.scene = function (b, page) {
    const sc = S.Demo && S.Demo.byId && S.Demo.byId(b.scene);
    if (!sc) return figure(S.UI.empty('watch', 'A figure is missing here', 'It shows the scene "' + b.scene + '", which is not in this build.'), b.caption);
    const p = new S.Player(sc);
    const box = h('div.ls-scene', p.el);
    box._redraw = () => p.resized();
    requestAnimationFrame(() => { try { p.build(); } catch (e) { /* drawn on the next resize */ } });
    if (page) (page.scenes = page.scenes || []).push(p);
    if (S.app) S.app.players.push(p);
    return figure(box, b.caption, 'scene');
  };
  /** {lab: 'lab id', setup: {..}, title, text}: a card that opens the lab, set up like this when the lab can load a setup */
  LB.lab = function (b) {
    const lab = S.Labs && S.Labs.get(b.lab);
    const a = card('#labs/' + b.lab, lab ? lab.icon || 'chip' : 'chip', lab ? lab.title : 'A lab', b.title || (lab ? lab.title : b.lab), b.text || '');
    a.addEventListener('click', () => { if (lab && lab.preset && b.setup) S.Labs.preset(b.lab, b.setup); });
    return a;
  };
})(globalThis.Proses = globalThis.Proses || {});
