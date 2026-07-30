// The picture on the home page: the first sample scene (the life of a process on its state diagram) playing on its
// own, step after step, with its narration under it. It draws whatever the scene draws, so the hero always matches
// the demo page and the diagram checker's view of it.
(function (S) {
  'use strict';
  const { h } = S.UI;
  const HERO = 'process-life';

  /** S.HomeHero(host, caption element) -> {stop(), resized(), redraw()} */
  S.HomeHero = function (host, cap) {
    const scene = S.Demo && S.Demo.byId && S.Demo.byId(HERO);
    if (!S.Stage || !scene) return null;
    const wrap = h('div.hero-stage');
    host.appendChild(wrap);
    const stage = new S.Stage(wrap, { label: scene.title });
    let i = 0, timer = null, narrow = null, frames = null;
    const build = () => { narrow = wrap.clientWidth < 480; frames = scene.frames({ narrow, knobs: {} }); };
    const show = (instant) => {
      if (!frames || (wrap.clientWidth < 480) !== narrow) build();
      const f = frames[i];
      stage.show(f, { instant, duration: 700 });
      if (cap) cap.textContent = String(f.say || '').replace(/`/g, '');
    };
    show(true);
    const reduced = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
    const tick = () => { i = (i + 1) % frames.length; show(false); timer = setTimeout(tick, i === frames.length - 1 ? 4200 : 2800); };
    if (!reduced && !(S.app && S.app.settings.animate === false)) timer = setTimeout(tick, 2800);
    return {
      stop() { clearTimeout(timer); timer = null; },
      resized() { if ((wrap.clientWidth < 480) !== narrow) show(true); else stage.applyView && stage.applyView(); },
      redraw() { show(true); },
    };
  };
})(globalThis.Proses = globalThis.Proses || {});
