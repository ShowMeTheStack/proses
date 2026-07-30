// Small UI toolkit: element builder, icons, dialogs, toasts, menus, splitters, downloads, storage, and the
// registries of pages (S.Pages) and of the scenes the diagram checker looks at (S.Checks).
(function () {
  'use strict';
  const S = (globalThis.Proses = globalThis.Proses || {});
  const UI = S.UI = {};

  /** h('div.cls#id', {attr}, ...children) */
  UI.h = function (sel, attrs, ...kids) {
    const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(sel) || [];
    const el = document.createElement(m[1] || 'div');
    (m[2] || '').replace(/([.#])([\w-]+)/g, (_, k, v) => { if (k === '.') el.classList.add(v); else el.id = v; });
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    const add = (k) => {
      if (k === null || k === undefined || k === false) return;
      if (Array.isArray(k)) { k.forEach(add); return; }
      el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    };
    kids.forEach(add);
    return el;
  };
  const h = UI.h;

  // ---- icons (simple stroke SVGs) -----------------------------------------------------------
  const P = {
    run: '<path d="M5 3l11 7-11 7z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="4" y="3" width="4" height="14" fill="currentColor" stroke="none"/><rect x="12" y="3" width="4" height="14" fill="currentColor" stroke="none"/>',
    stop: '<rect x="4" y="4" width="12" height="12" fill="currentColor" stroke="none"/>',
    restart: '<path d="M4 10a6 6 0 1 0 2-4.5"/><path d="M3 3v4h4"/>',
    stepInto: '<path d="M10 3v9"/><path d="M6 8l4 4 4-4"/><circle cx="10" cy="16" r="1.6" fill="currentColor"/>',
    stepOver: '<path d="M3 11a7 7 0 0 1 13-3"/><path d="M17 4v4h-4"/><circle cx="10" cy="16" r="1.6" fill="currentColor"/>',
    stepOut: '<path d="M10 14V4"/><path d="M6 8l4-4 4 4"/><circle cx="10" cy="17" r="1.6" fill="currentColor"/>',
    bp: '<circle cx="10" cy="10" r="5" fill="currentColor" stroke="none"/>',
    file: '<path d="M5 2h7l4 4v12H5z"/><path d="M12 2v4h4"/>',
    folder: '<path d="M2 5h6l2 2h8v10H2z"/>',
    folderOpen: '<path d="M2 5h6l2 2h8v2H5l-3 8z"/><path d="M5 9h14l-3 8H2z"/>',
    newFile: '<path d="M5 2h7l4 4v12H5z"/><path d="M10 9v6M7 12h6"/>',
    newFolder: '<path d="M2 5h6l2 2h8v10H2z"/><path d="M10 10v5M7.5 12.5h5"/>',
    upload: '<path d="M10 14V3"/><path d="M6 7l4-4 4 4"/><path d="M3 14v3h14v-3"/>',
    download: '<path d="M10 3v11"/><path d="M6 10l4 4 4-4"/><path d="M3 14v3h14v-3"/>',
    share: '<circle cx="15" cy="4" r="2"/><circle cx="5" cy="10" r="2"/><circle cx="15" cy="16" r="2"/><path d="M7 9l6-4M7 11l6 4"/>',
    save: '<path d="M3 3h11l3 3v11H3z"/><path d="M6 3v5h7V3M6 17v-6h8v6"/>',
    trash: '<path d="M4 6h12M8 6V3h4v3M6 6l1 11h6l1-11"/>',
    refresh: '<path d="M16 10a6 6 0 1 1-2-4.5"/><path d="M17 3v4h-4"/>',
    max: '<path d="M3 8V3h5M12 3h5v5M17 12v5h-5M8 17H3v-5"/>',
    min: '<path d="M8 3v5H3M17 8h-5V3M12 17v-5h5M3 12h5v5"/>',
    help: '<circle cx="10" cy="10" r="8"/><path d="M7.5 7.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7v.5"/><circle cx="10" cy="15" r=".8" fill="currentColor"/>',
    drive: '<rect x="2" y="6" width="16" height="8" rx="1"/><circle cx="14" cy="10" r="1" fill="currentColor"/>',
    link: '<path d="M8 12l4-4"/><path d="M9 5l2-2a3 3 0 0 1 4 4l-2 2"/><path d="M11 15l-2 2a3 3 0 0 1-4-4l2-2"/>',
    plus: '<path d="M10 4v12M4 10h12"/>',
    x: '<path d="M5 5l10 10M15 5L5 15"/>',
    edit: '<path d="M4 16l1-4 8-8 3 3-8 8z"/>',
    star: '<path d="M10 2l2.4 5 5.6.6-4.2 3.8 1.2 5.6L10 14.3 5 17l1.2-5.6L2 7.6 7.6 7z"/>',
    tour: '<path d="M10 2a6 6 0 0 1 6 6c0 4-6 10-6 10S4 12 4 8a6 6 0 0 1 6-6z"/><circle cx="10" cy="8" r="2"/>',
    book: '<path d="M3 4h5a2 2 0 0 1 2 2v11a2 2 0 0 0-2-2H3zM17 4h-5a2 2 0 0 0-2 2v11a2 2 0 0 1 2-2h5z"/>',
    cog: '<circle cx="10" cy="10" r="3"/><path d="M10 1v3M10 16v3M1 10h3M16 10h3M3.6 3.6l2.1 2.1M14.3 14.3l2.1 2.1M3.6 16.4l2.1-2.1M14.3 5.7l2.1-2.1"/>',
    screen: '<rect x="2" y="3" width="16" height="11" rx="1"/><path d="M7 17h6M10 14v3"/>',
    gw: '<rect x="2" y="3" width="16" height="14"/><path d="M5 8l3 2-3 2M10 13h4"/>',
    cursor: '<path d="M5 3v14l4-4 3 6 2-1-3-6h6z"/>',
    eye: '<path d="M1 10s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><circle cx="10" cy="10" r="2.5"/>',
    turtle: '<ellipse cx="10" cy="11" rx="5" ry="6"/><circle cx="10" cy="3.6" r="1.8"/><path d="M5.4 7.5L3.5 6M14.6 7.5l1.9-1.5M5.6 15l-2 1.6M14.4 15l2 1.6M5 11h10"/>',
    terminal: '<rect x="2" y="3" width="16" height="14" rx="3"/><path d="M5.5 8l3 2.2-3 2.2M10.5 13h4"/>',
    grid: '<rect x="3" y="3" width="14" height="14" rx="2"/><path d="M3 8h14M3 12.5h14M8 3v14M12.5 3v14"/>',
    procs: '<path d="M4 4h12M4 8h8M4 12h12M4 16h6"/>',
    bug: '<ellipse cx="10" cy="11.5" rx="4.5" ry="5.5"/><path d="M10 6V3.5M7.5 6.5L6 4.5M12.5 6.5L14 4.5M5.5 10H2.5M17.5 10h-3M5.5 14l-2.5 1.5M14.5 14l2.5 1.5M10 9v8"/>',
    menu: '<path d="M3.5 6h13M3.5 10h13M3.5 14h13"/>',
    speed: '<path d="M3 14a7 7 0 1 1 14 0"/><path d="M10 14l3.5-4.5"/><circle cx="10" cy="14" r="1" fill="currentColor"/>',
    clear: '<path d="M4 16h12"/><path d="M6.5 13.5l7-7-2.5-2.5-7 7 2.5 2.5z"/>',
    full: '<path d="M3 8V3h5M12 3h5v5M17 12v5h-5M8 17H3v-5"/>',
    camera: '<rect x="2" y="5.5" width="16" height="11" rx="2.5"/><circle cx="10" cy="11" r="3"/><path d="M7 5.5l1.2-2h3.6l1.2 2"/>',
    zoomIn: '<circle cx="9" cy="9" r="5.5"/><path d="M13 13l4.5 4.5M9 6.5v5M6.5 9h5"/>',
    zoomOut: '<circle cx="9" cy="9" r="5.5"/><path d="M13 13l4.5 4.5M6.5 9h5"/>',
    target: '<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="2"/><path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3"/>',
    palette: '<path d="M10 2.5a7.5 7.5 0 1 0 0 15c1.2 0 1.6-.9 1.2-1.8-.5-1.1.2-2.2 1.4-2.2h1.9a3 3 0 0 0 3-3A7.5 7.5 0 0 0 10 2.5z"/><circle cx="6.5" cy="9" r="1" fill="currentColor"/><circle cx="9" cy="6" r="1" fill="currentColor"/><circle cx="13" cy="6.5" r="1" fill="currentColor"/>',
    layers: '<path d="M10 3l7.5 4-7.5 4-7.5-4z"/><path d="M2.5 11l7.5 4 7.5-4"/>',
    learn: '<path d="M2 7.5L10 3.5l8 4-8 4z"/><path d="M5.5 9.5v4c1.2 1.3 2.7 2 4.5 2s3.3-.7 4.5-2v-4"/>',
    library: '<rect x="3" y="3" width="3.2" height="14" rx="1"/><rect x="7.6" y="3" width="3.2" height="14" rx="1"/><path d="M12.6 4.2l3-.8 2.6 13.2-3 .8z"/>',
    watch: '<path d="M1.5 10S4.5 4.5 10 4.5 18.5 10 18.5 10 15.5 15.5 10 15.5 1.5 10 1.5 10z"/><circle cx="10" cy="10" r="2.3"/>',
    stack: '<rect x="4" y="3" width="12" height="3.6" rx="1"/><rect x="4" y="8.2" width="12" height="3.6" rx="1"/><rect x="4" y="13.4" width="12" height="3.6" rx="1"/>',
    history: '<path d="M3.5 10a6.5 6.5 0 1 0 2-4.7"/><path d="M3 3.5v3.5h3.5M10 6.5V10l2.5 2"/>',
    sun: '<circle cx="10" cy="10" r="3.5"/><path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6L16 16M4 16l1.4-1.4M14.6 5.4L16 4"/>',
    more: '<circle cx="4.5" cy="10" r="1.3" fill="currentColor"/><circle cx="10" cy="10" r="1.3" fill="currentColor"/><circle cx="15.5" cy="10" r="1.3" fill="currentColor"/>',
    check: '<path d="M4 10.5l4 4 8-9"/>',
    build: '<path d="M11.5 3.5l5 5-2 2-5-5z"/><path d="M10 7l-7 7 2.5 2.5 7-7"/>',
    stepBack: '<path d="M16 15a6 6 0 1 0-10.3-4.2"/><path d="M3 8l2.7 2.8L8.5 8"/><circle cx="12" cy="17" r="1.2" fill="currentColor"/>',
    chip: '<rect x="5" y="5" width="10" height="10" rx="1"/><path d="M8 2.5v2.5M12 2.5v2.5M8 15v2.5M12 15v2.5M2.5 8H5M2.5 12H5M15 8h2.5M15 12h2.5"/>',
    moon: '<path d="M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8z"/>',
    cont: '<path d="M4 4v12M8 4l9 6-9 6z"/>',
    vars: '<path d="M4 4.5c-1.5 0-1.5 1-1.5 2.5S2 9.5 1.5 10c.5.5 1 1 1 3s0 2.5 1.5 2.5M16 4.5c1.5 0 1.5 1 1.5 2.5s.5 2.5 1 3c-.5.5-1 1-1 3s0 2.5-1.5 2.5M7 7.5l6 5M13 7.5l-6 5"/>',
    hexIcon: '<path d="M3 5h14M3 10h14M3 15h14"/><path d="M7 3v14M13 3v14"/>',
    sandbox: '<rect x="2.5" y="3" width="15" height="14" rx="2.5"/><circle cx="7" cy="10" r="2"/><circle cx="13.5" cy="10" r="2"/><path d="M9 10h2.5"/>',
    machine: '<circle cx="5.5" cy="12" r="3"/><circle cx="14.5" cy="12" r="3"/><circle cx="14.5" cy="12" r="1.3" fill="currentColor"/><path d="M8 10.5Q10 7 12 10.5"/>',
    grammar: '<path d="M3 5h5M3 10h9M3 15h6"/><path d="M12 5l3 3-3 3"/>',
    tape: '<rect x="1.5" y="7" width="17" height="6" rx="1"/><path d="M6 7v6M10 7v6M14 7v6"/><path d="M10 16.5l-2 2.5h4z" fill="currentColor"/>',
    regex: '<path d="M4 15l3-10M9 15l3-10"/><path d="M14 6l3 3M17 6l-3 3"/>',
    test: '<path d="M4 5h12M4 10h12M4 15h7"/><path d="M13 14.5l1.8 1.8L18 12.5"/>',
    undo: '<path d="M7 5L3.5 8.5 7 12"/><path d="M4 8.5h8a4.5 4.5 0 0 1 0 9H9"/>',
    redo: '<path d="M13 5l3.5 3.5L13 12"/><path d="M16 8.5H8a4.5 4.5 0 0 0 0 9h3"/>',
    layout: '<rect x="2.5" y="3" width="6" height="5" rx="1.5"/><rect x="11.5" y="3" width="6" height="5" rx="1.5"/><rect x="7" y="12" width="6" height="5" rx="1.5"/><path d="M5.5 8v2.5h9V8M10 10.5V12"/>',
    convert: '<path d="M3 7h11l-3-3M17 13H6l3 3"/>',
    fit: '<path d="M3 8V3h5M12 3h5v5M17 12v5h-5M8 17H3v-5"/><rect x="7" y="7" width="6" height="6" rx="1"/>',
    kit: '<rect x="3" y="3" width="6" height="6" rx="1.5"/><circle cx="14" cy="6" r="3"/><path d="M3 17l3-5 3 5z"/><rect x="11" y="11" width="6" height="6" rx="3"/>',
    flag: '<path d="M4 18V3"/><path d="M4 3.5h10l-2 3.5 2 3.5H4"/>',
    compare: '<rect x="2" y="4" width="7" height="12" rx="1.5"/><rect x="11" y="4" width="7" height="12" rx="1.5"/><path d="M10 2v16"/>',
    route: '<circle cx="4.5" cy="15.5" r="2"/><circle cx="15.5" cy="4.5" r="2"/><path d="M6.5 15.5h5a3 3 0 0 0 0-6h-3a3 3 0 0 1 0-6h5"/>',
    info: '<circle cx="10" cy="10" r="8"/><path d="M10 9v5"/><circle cx="10" cy="6.2" r=".9" fill="currentColor"/>',
    warn: '<path d="M10 2.5l8 14H2z"/><path d="M10 8v4"/><circle cx="10" cy="14.4" r=".9" fill="currentColor"/>',
    hint: '<path d="M7 14h6M8 17h4"/><path d="M10 2.5a5 5 0 0 0-3 9c.6.5 1 1.2 1 2h4c0-.8.4-1.5 1-2a5 5 0 0 0-3-9z"/>',
    search: '<circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4.5 4.5"/>',
    drawer: '<rect x="2.5" y="3" width="15" height="14" rx="2.5"/><path d="M2.5 11h15"/><path d="M8 14h4"/>',
    wave: '<path d="M1.5 13h3V6h4v8h4V6h4v7h2"/>',
    gate: '<path d="M4 4h5a6 6 0 0 1 0 12H4z"/><path d="M15 10h3M1 7h3M1 13h3"/>',
    bench: '<rect x="2" y="4" width="16" height="12" rx="2"/><path d="M2 8h16M2 12h16"/><circle cx="6" cy="10" r=".6" fill="currentColor"/><circle cx="10" cy="10" r=".6" fill="currentColor"/><circle cx="14" cy="10" r=".6" fill="currentColor"/>',
    code: '<path d="M7 5l-5 5 5 5M13 5l5 5-5 5"/>',
    fn: '<path d="M12 3.5c-2 0-3 1-3.4 3L7 16c-.4 2-1.4 2.5-3 2.5"/><path d="M5.5 9h7"/>',
    fsm: '<circle cx="5" cy="10" r="3"/><circle cx="15" cy="10" r="3"/><path d="M8 8.6Q10 6.5 12 8.6M12 11.4Q10 13.5 8 11.4"/>',
    probe: '<path d="M3 17l5-5"/><path d="M7 11l6-6 2 2-6 6z"/><path d="M13 5l2-2"/>',
    rotate: '<path d="M15 10a5 5 0 1 1-1.5-3.6"/><path d="M14 2.5v4h-4"/>',
    mirror: '<path d="M10 2v16"/><path d="M7 5L3 10l4 5zM13 5l4 5-4 5z"/>',
    copy: '<rect x="6" y="6" width="11" height="11" rx="2"/><path d="M3 13V4a1 1 0 0 1 1-1h9"/>',
    paste: '<rect x="4" y="4" width="12" height="14" rx="2"/><path d="M7 4V2.5h6V4"/>',
    block: '<rect x="4" y="3" width="12" height="14" rx="2"/><path d="M1 7h3M1 13h3M16 10h3"/>',
    tidy: '<path d="M3 5h6M3 10h10M3 15h14"/><circle cx="12" cy="5" r="1.5"/><circle cx="16" cy="10" r="1.5"/>',
    note: '<path d="M4 3h12v10l-4 4H4z"/><path d="M12 17v-4h4"/>',
    label: '<path d="M3 4h8l6 6-6 6H3z"/><circle cx="7" cy="10" r="1.2"/>',
    align: '<path d="M3 3v14"/><rect x="5" y="5" width="10" height="3" rx="1"/><rect x="5" y="12" width="6" height="3" rx="1"/>',
    image: '<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><circle cx="7" cy="8" r="1.5"/><path d="M3 15l4.5-4.5 3 3 2.5-2.5 4 4"/>',
    clock: '<circle cx="10" cy="10" r="7.5"/><path d="M10 5.5V10l3 2"/>',
    rewind: '<path d="M9 5l-6 5 6 5zM17 5l-6 5 6 5z"/>',
    edge: '<path d="M2 15h6V5h10"/><path d="M8 11l0-6"/><path d="M5.5 8L8 5l2.5 3"/>',
    play: '<path d="M6 3.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
    next: '<path d="M4.5 4v12l8-6z" fill="currentColor" stroke="none"/><path d="M15.5 4v12"/>',
    prev: '<path d="M15.5 4v12l-8-6z" fill="currentColor" stroke="none"/><path d="M4.5 4v12"/>',
    first: '<path d="M4.5 4v12"/><path d="M16 4v12l-8.5-6z" fill="currentColor" stroke="none"/>',
    lock: '<rect x="4" y="9" width="12" height="9" rx="2"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/><circle cx="10" cy="13.5" r="1.2" fill="currentColor"/>',
    unlock: '<rect x="4" y="9" width="12" height="9" rx="2"/><path d="M7 9V6.5a3 3 0 0 1 5.8-1"/>',
    key: '<circle cx="6.5" cy="10" r="3.5"/><path d="M10 10h8M15 10v3M17.5 10v2.2"/>',
    hash: '<path d="M7.5 3L6 17M14 3l-1.5 14M3.5 7.5h14M2.5 12.5h14"/>',
    curve: '<path d="M2.5 15c3-1 4.5-4 5.5-7s2.5-5 4-5c2.5 0 2.5 4 0 6.5S8.5 13 10 15.5c1 1.7 4 1.5 7.5 0"/><circle cx="7.6" cy="9.3" r="1.2" fill="currentColor"/>',
    numbers: '<path d="M4 4.5h3v11M3 15.5h5.5"/><path d="M11.5 6.5a2.5 2.5 0 0 1 5 0c0 2.5-5 5-5 9h5"/>',
    proto: '<path d="M4 2.5v15M16 2.5v15"/><path d="M4 6h10M12 4l2 2-2 2M16 11H6M8 9l-2 2 2 2"/>',
    rotor: '<circle cx="10" cy="10" r="7.5"/><circle cx="10" cy="10" r="2.2"/><path d="M10 2.5v3M10 14.5v3M2.5 10h3M14.5 10h3M4.7 4.7l2.1 2.1M13.2 13.2l2.1 2.1M4.7 15.3l2.1-2.1M13.2 6.8l2.1-2.1"/>',
    cipher: '<rect x="2.5" y="5" width="15" height="10" rx="2"/><path d="M6 8.5v3M9 8.5v3M12 8.5h2.5M12 11.5h2.5"/>',
    trophy: '<path d="M6 3h8v4a4 4 0 0 1-8 0z"/><path d="M6 4.5H3.5a2.5 2.5 0 0 0 2.6 3.4M14 4.5h2.5a2.5 2.5 0 0 1-2.6 3.4"/><path d="M10 11v3.5M6.5 17h7M8 14.5h4v2.5H8z"/>',
    sound: '<path d="M3 8h3l4-3.5v11L6 12H3z"/><path d="M13 7.5a3.5 3.5 0 0 1 0 5M15.5 5a7 7 0 0 1 0 10"/>',
    mute: '<path d="M3 8h3l4-3.5v11L6 12H3z"/><path d="M13 8l4 4M17 8l-4 4"/>',
    shuffle: '<path d="M2.5 6h3.5l7 8h4.5M2.5 14h3.5l2-2.3M11 8.3L13 6h4.5"/><path d="M15.5 4l2 2-2 2M15.5 12l2 2-2 2"/>',
    sheet: '<rect x="3.5" y="2.5" width="13" height="15" rx="1.5"/><path d="M3.5 6.5h13M7.5 2.5v15M3.5 10h13M3.5 13.5h13"/>',
    cable: '<circle cx="4.5" cy="15" r="2"/><circle cx="15.5" cy="5" r="2"/><path d="M6 13.5c6 0 2-7 8-7"/>',
    upload2: '<path d="M10 13V3"/><path d="M6 7l4-4 4 4"/><path d="M3 13v4h14v-4"/>',
    keyboard: '<rect x="1.5" y="5" width="17" height="10" rx="2"/><path d="M5 8.5h.01M8 8.5h.01M11 8.5h.01M14 8.5h.01M6 12h8"/>',
  };
  /** more icons, from a page's own file: UI.addIcons({name: '<path …/>'}) (drawn on a 20×20 grid) */
  UI.addIcons = (o) => Object.assign(P, o);
  UI.icon = function (name) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 20 20');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.6');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = P[name] || '';
    return s;
  };

  // ---- toasts ---------------------------------------------------------------------------------
  let toastBox = null;
  UI.toast = function (msg, kind, ms) {
    if (!toastBox) { toastBox = h('div.toasts', { role: 'status', 'aria-live': 'polite' }); document.body.appendChild(toastBox); }
    const t = h('div.toast' + (kind ? '.' + kind : ''), msg);
    toastBox.appendChild(t);
    setTimeout(() => t.remove(), ms || 3500);
    return t;
  };

  // ---- modal dialogs ----------------------------------------------------------------------------
  const openModals = [];
  UI.modal = function (opts) {
    return new Promise((resolve) => {
      const prevFocus = document.activeElement;
      const back = h('div.modal-back', { role: 'presentation' });
      const box = h('div.modal' + (opts.wide ? '.wide' : '') + (opts.cls ? '.' + opts.cls : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || 'Dialog' });
      const head = h('div.modal-head', opts.title || '');
      const body = h('div.modal-body');
      if (typeof opts.body === 'string') body.innerHTML = opts.body;
      else if (opts.body) body.appendChild(opts.body);
      const foot = h('div.modal-foot');
      let done = false;
      const close = (v) => {
        if (done) return;
        done = true;
        back.remove();
        openModals.splice(openModals.indexOf(close), 1);
        document.removeEventListener('keydown', onKey, true);
        if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* ignore */ }
        resolve(v);
      };
      for (const b of opts.buttons || [{ label: 'OK', value: true, primary: true }]) {
        const btn = h('button.btn' + (b.primary ? '.primary' : ''), { type: 'button' }, b.label);
        btn.addEventListener('click', () => {
          const v = typeof b.value === 'function' ? b.value() : b.value;
          if (v === undefined && b.keepOpen) return;
          close(v);
        });
        foot.appendChild(btn);
      }
      box.append(head, body, foot);
      back.appendChild(box);
      back.addEventListener('mousedown', (e) => { if (e.target === back && opts.dismissable !== false) close(opts.cancelValue); });
      const onKey = (e) => {
        if (openModals[openModals.length - 1] !== close) return;
        if (e.key === 'Tab') {
          // keep keyboard focus inside the dialog (aria-modal)
          const f = [...box.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
          if (f.length) {
            const i = f.indexOf(document.activeElement);
            const n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i < 0 || i === f.length - 1 ? 0 : i + 1);
            e.preventDefault(); e.stopPropagation();
            f[n].focus();
            return;
          }
        }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(opts.cancelValue); return; }
        if (e.key === 'Enter' && opts.enterValue !== undefined && !(e.target instanceof HTMLTextAreaElement)) {
          e.preventDefault(); e.stopPropagation();
          const v = typeof opts.enterValue === 'function' ? opts.enterValue() : opts.enterValue;
          if (v !== undefined) close(v);
          return;
        }
        // Other keys reach the focused control inside the dialog, but never the page behind it
        if (!box.contains(e.target)) { e.stopPropagation(); }
      };
      document.addEventListener('keydown', onKey, true);
      openModals.push(close);
      (document.getElementById('overlay-root') || document.body).appendChild(back);
      const f = box.querySelector('input,textarea,select') || foot.querySelector('.primary') || foot.querySelector('button');
      if (f) setTimeout(() => { f.focus(); if (f.select && opts.selectInput !== false) f.select(); }, 20);
      if (opts.onOpen) opts.onOpen(box, close);
    });
  };
  UI.anyModalOpen = () => openModals.length > 0;
  /** Close every open dialog as if Escape was pressed (newest first) */
  UI.closeAllModals = () => { while (openModals.length) openModals[openModals.length - 1](undefined); };
  UI.alert = (title, msg) => UI.modal({ title, body: msg instanceof Node ? msg : h('div', { html: msg }), buttons: [{ label: 'OK', value: true, primary: true }], enterValue: true });
  UI.confirm = (title, msg, okLabel, cancelLabel) => UI.modal({
    title, body: msg instanceof Node ? msg : h('div', { html: msg }),
    buttons: [{ label: cancelLabel || 'Cancel', value: false }, { label: okLabel || 'OK', value: true, primary: true }],
    enterValue: true, cancelValue: false,
  });
  UI.prompt = function (title, label, value, opts) {
    const input = h('input', { type: 'text', value: value || '', spellcheck: 'false', 'aria-label': label });
    const body = h('div', h('label', label), input, opts && opts.hint ? h('p.muted', { style: { marginTop: '6px' } }, opts.hint) : null);
    return UI.modal({
      title, body,
      buttons: [{ label: 'Cancel', value: null }, { label: (opts && opts.ok) || 'OK', value: () => input.value, primary: true }],
      enterValue: () => input.value, cancelValue: null,
    });
  };

  // ---- dropdown menus ----------------------------------------------------------------------------
  let openMenu = null;
  UI.closeMenus = function () { if (openMenu) { openMenu.close(); openMenu = null; } };
  /**
   * items: [{label, sc, action, checked, disabled, sep, items(submenu)}]
   */
  UI.showMenu = function (items, x, y, opts) {
    UI.closeMenus();
    const pop = h('div.menu-pop', { role: 'menu' });
    let subOpen = null;
    let sub = null; // keyboard state of the open submenu: {els, idx}
    const els = [];
    const closeSub = () => { if (subOpen) { subOpen.remove(); subOpen = null; } sub = null; };
    // a tap also sends mouseover; opening a submenu then would put it under the finger and the
    // same tap would pick one of its items, so taps open submenus on the click instead
    let lastTouch = 0;
    pop.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') lastTouch = Date.now(); }, true);
    for (const it of items) {
      if (!it) continue;
      if (it.sep) { pop.appendChild(h('div.menu-sep')); continue; }
      if (it.header) { pop.appendChild(h('div.menu-head', it.label)); continue; }
      const el = h('div.menu-item' + (it.disabled ? '.disabled' : '') + (it.checked ? '.checked' : ''), { role: 'menuitem', tabindex: '-1', 'aria-haspopup': it.items ? 'true' : null },
        h('span', it.label), it.items ? h('span.sub-arrow', '▸') : (it.sc ? h('span.sc', it.sc) : null));
      const openSub = (keyboard) => {
        closeSub();
        const r = el.getBoundingClientRect();
        const sp = h('div.menu-pop', { role: 'menu' });
        const subEls = [];
        for (const s2 of it.items) {
          if (!s2) continue;
          if (s2.sep) { sp.appendChild(h('div.menu-sep')); continue; }
          const se = h('div.menu-item' + (s2.disabled ? '.disabled' : '') + (s2.checked ? '.checked' : ''), { role: 'menuitem' }, h('span', s2.label), s2.sc ? h('span.sc', s2.sc) : null);
          se.addEventListener('click', (e) => { e.stopPropagation(); UI.closeMenus(); if (s2.action) setTimeout(() => s2.action(), 0); });
          sp.appendChild(se);
          if (!s2.disabled) subEls.push(se);
        }
        document.body.appendChild(sp);
        const sw = sp.offsetWidth;
        sp.style.left = Math.min(r.right - 2, window.innerWidth - sw - 4) + 'px';
        sp.style.top = Math.min(r.top - 4, window.innerHeight - sp.offsetHeight - 4) + 'px';
        subOpen = sp;
        sub = { els: subEls, idx: -1 };
        if (keyboard) focusSub(0);
      };
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (it.disabled) return;
        if (it.items) { openSub(false); return; }
        UI.closeMenus();
        if (it.action) setTimeout(() => it.action(), 0);
      });
      el.addEventListener('mouseenter', () => { if (Date.now() - lastTouch < 1000) return; if (it.items) openSub(false); else closeSub(); });
      els.push({ el, it, openSub });
      pop.appendChild(el);
    }
    document.body.appendChild(pop);
    const w = pop.offsetWidth, hh = pop.offsetHeight;
    pop.style.left = Math.max(2, Math.min(x, window.innerWidth - w - 4)) + 'px';
    pop.style.top = Math.max(2, Math.min(y, window.innerHeight - hh - 4)) + 'px';
    let idx = -1;
    const focusIdx = (i) => {
      const live = els.filter((e) => !e.it.disabled);
      if (!live.length) return;
      idx = (i + live.length) % live.length;
      els.forEach((e) => e.el.classList.remove('active'));
      live[idx].el.classList.add('active');
      live[idx].el.scrollIntoView({ block: 'nearest' });
    };
    function focusSub(i) {
      if (!sub || !sub.els.length) return;
      sub.idx = (i + sub.els.length) % sub.els.length;
      sub.els.forEach((e) => e.classList.remove('active'));
      sub.els[sub.idx].classList.add('active');
    }
    const onKey = (e) => {
      const live = els.filter((x) => !x.it.disabled);
      if (sub && sub.idx >= 0) {
        // keyboard is inside a submenu
        if (e.key === 'ArrowDown') { e.preventDefault(); focusSub(sub.idx + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); focusSub(sub.idx - 1); }
        else if (e.key === 'Enter') { e.preventDefault(); sub.els[sub.idx].click(); }
        else if (e.key === 'ArrowLeft' || e.key === 'Escape') { e.preventDefault(); closeSub(); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); if (opts && opts.onArrow) opts.onArrow(1); }
        else return;
        e.stopPropagation();
        return;
      }
      const cur = idx >= 0 ? live[idx] : null;
      if (e.key === 'Escape') { e.preventDefault(); UI.closeMenus(); if (opts && opts.onEscape) opts.onEscape(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); closeSub(); focusIdx(idx < 0 ? 0 : idx + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); closeSub(); focusIdx(idx < 0 ? live.length - 1 : idx - 1); }
      else if (e.key === 'Enter' && cur) { e.preventDefault(); if (cur.it.items) cur.openSub(true); else cur.el.click(); }
      else if (e.key === 'ArrowRight' && cur && cur.it.items) { e.preventDefault(); cur.openSub(true); }
      else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && opts && opts.onArrow) { e.preventDefault(); opts.onArrow(e.key === 'ArrowRight' ? 1 : -1); }
      else return;
      e.stopPropagation();
    };
    const onDown = (e) => { if (!pop.contains(e.target) && !(subOpen && subOpen.contains(e.target)) && !(opts && opts.anchor && opts.anchor.contains(e.target))) UI.closeMenus(); };
    document.addEventListener('keydown', onKey, true);
    setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
    if (opts && opts.keyboard) focusIdx(0);
    openMenu = {
      close() {
        pop.remove(); if (subOpen) subOpen.remove();
        document.removeEventListener('keydown', onKey, true);
        document.removeEventListener('mousedown', onDown, true);
        if (opts && opts.onClose) opts.onClose();
      },
    };
    return openMenu;
  };

  // ---- splitters ------------------------------------------------------------------------------------
  UI.splitter = function (el, onMove, onEnd) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      document.body.classList.add('resizing');
      const move = (ev) => onMove(ev);
      const up = () => {
        el.classList.remove('dragging');
        document.body.classList.remove('resizing');
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        if (onEnd) onEnd();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
  };

  // ---- downloads / file picking ---------------------------------------------------------------------
  UI.download = function (name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  UI.pickFiles = function (accept, multiple) {
    return new Promise((resolve) => {
      const inp = h('input', { type: 'file', accept: accept || '', multiple: !!multiple, style: { display: 'none' } });
      inp.addEventListener('change', () => { resolve(Array.from(inp.files || [])); inp.remove(); });
      document.body.appendChild(inp);
      inp.click();
    });
  };


  // ---- tables in narrow panels ----------------------------------------------------------------------
  /**
   * Make every table under root fit its box: first a smaller type and tighter cells, then text that wraps
   * inside its cell, and only when even that is too wide, sideways scrolling with a visible sign of it (a
   * note above and a fade at the edge that is hidden once the end is reached). Never clips silently.
   * Tables are .dtable-wrap > table (the table helpers) or any table inside a .fit-table box.
   */
  // a table is fitted again when its box changes width (a window resized, a panel opened), so the note about
  // scrolling sideways shows only while the table really is wider than its box
  let fitObs = null;
  const refit = (wrap) => { const b = wrap.parentElement && wrap.parentElement.classList.contains('dtable-box') ? wrap.parentElement : wrap; UI.fitTables(b.parentElement || b); };
  const watch = (wrap) => {
    if (typeof ResizeObserver === 'undefined' || wrap.dataset.fitWatch) return;
    if (!fitObs) fitObs = new ResizeObserver((es) => { for (const e of es) { const w = Math.round(e.contentRect.width), t = e.target; if (+t.dataset.fitW === w) continue; t.dataset.fitW = String(w); if (t._fitWrap && t._fitWrap.isConnected) refit(t._fitWrap); } });
    const host = wrap.parentElement && wrap.parentElement.classList.contains('dtable-box') ? wrap.parentElement.parentElement : wrap.parentElement;
    if (!host || host._fitWrap) return;
    wrap.dataset.fitWatch = '1';
    host._fitWrap = wrap;
    host.dataset.fitW = String(Math.round(host.getBoundingClientRect().width));
    fitObs.observe(host);
  };
  UI.fitTables = function (root) {
    if (!root) return;
    for (const wrap of root.querySelectorAll('.dtable-wrap, .fit-table')) {
      watch(wrap);
      if (!wrap.isConnected || !wrap.offsetParent) continue;
      wrap.classList.remove('compact', 'wrapping', 'scroll-x');
      delete wrap.dataset.scrollAffordance;
      const box = wrap.parentElement && wrap.parentElement.classList.contains('dtable-box') ? wrap.parentElement : null;
      if (box) { box.classList.remove('scrolls', 'at-end'); const n = box.querySelector(':scope > .scroll-note'); if (n) n.remove(); }
      const over = () => wrap.scrollWidth > wrap.clientWidth + 1;
      if (!over()) continue;
      wrap.classList.add('compact');
      if (!over()) continue;
      wrap.classList.add('wrapping');
      if (!over()) continue;
      wrap.classList.add('scroll-x');
      wrap.dataset.scrollAffordance = 'sideways';
      let b = box;
      if (!b) { b = h('div.dtable-box'); wrap.before(b); b.appendChild(wrap); }
      b.classList.add('scrolls');
      b.insertBefore(h('div.scroll-note', { 'aria-hidden': 'true' }, 'Wider than the panel: scroll sideways ', h('span.arrow', '→')), wrap);
      const edge = () => b.classList.toggle('at-end', wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 2);
      if (!wrap.dataset.fitBound) { wrap.dataset.fitBound = '1'; wrap.addEventListener('scroll', edge, { passive: true }); }
      edge();
    }
  };

  /**
   * A row that scrolls sideways when it does not fit (presets, chips): a fade on the side with more, and
   * data-scroll-affordance for the diagram checker. Call again after the row changes; it updates on scroll.
   */
  UI.scrollRow = function (el) {
    const upd = () => {
      const over = el.scrollWidth > el.clientWidth + 1;
      el.classList.toggle('scrolls', over);
      el.classList.toggle('more-right', over && el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
      el.classList.toggle('more-left', over && el.scrollLeft > 2);
      if (over) el.dataset.scrollAffordance = 'sideways'; else delete el.dataset.scrollAffordance;
    };
    if (!el.dataset.rowBound) { el.dataset.rowBound = '1'; el.addEventListener('scroll', upd, { passive: true }); window.addEventListener('resize', UI.debounce(upd, 100)); }
    requestAnimationFrame(upd);
    upd();
    return upd;
  };

  // ---- empty states -------------------------------------------------------------------------------------
  /** A friendly box for "nothing here": an icon, a title, a sentence and optional buttons [{label, icon, action, primary}] */
  UI.empty = function (ic, title, text, actions) {
    return h('div.empty-state', h('div.es-icon', UI.icon(ic || 'book')), h('div.es-title', title), text ? h('p', text) : null,
      actions && actions.length ? h('div.es-acts', ...actions.map((a) => { const b = h('button.btn' + (a.primary ? '.primary' : '') + '.small', { type: 'button', id: a.id }, a.icon ? UI.icon(a.icon) : null, a.label); b.addEventListener('click', a.action); return b; })) : null);
  };

  // ---- inline text: `code`, **bold**, *italic*, [link](#hash or url) -----------------------------------------
  UI.inline = function (text) {
    const out = [];
    // \* and \_ are literal; `code` is literal too (it is matched first, so no markup applies inside it)
    const re = /(`[^`]+`|\*\*(?:\\\*|[^*])+\*\*|(?<![\w)\]\\])\*(?![\s*])(?:\\\*|[^*])*?[^\s\\]\*(?![\w(])|\[[^\]]+\]\([^)]+\))/g;
    const unesc = (x) => x.replace(/\\([*_\\`])/g, '$1');
    let last = 0, m;
    text = String(text === undefined || text === null ? '' : text);
    while ((m = re.exec(text))) {
      // an escaped star is not markup: skip a match that starts right after a backslash
      if (m.index > 0 && text[m.index - 1] === '\\' && m[0][0] === '*') { re.lastIndex = m.index + 1; continue; }
      if (m.index > last) out.push(unesc(text.slice(last, m.index)));
      const t = m[0];
      if (t[0] === '`') out.push(h('code', t.slice(1, -1)));
      else if (t.startsWith('**')) out.push(h('b', unesc(t.slice(2, -2))));
      else if (t[0] === '*') out.push(h('i', unesc(t.slice(1, -1))));
      else { const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t); out.push(mm[2][0] === '#' ? h('a', { href: mm[2] }, mm[1]) : h('a', { href: mm[2], target: '_blank', rel: 'noopener' }, mm[1])); }
      last = m.index + t.length;
    }
    if (last < text.length) out.push(unesc(text.slice(last)));
    return out;
  };
  /** text with its topic links ([[topic-id]] or [[topic-id|words]], see S.topicLinks) as links to those topics */
  UI.withLinks = function (text) {
    const T = globalThis.Proses;
    if (!T || !T.topicLinks) return [String(text === undefined || text === null ? '' : text)];
    return T.topicLinks(text).map((x) => (typeof x === 'string' ? x : x.missing ? x.text : h('a.topic-link', { href: '#topic=' + x.id }, x.text)));
  };
  /** narration: `text in backticks` is a value, set in the monospace face (span.v); the rest keeps its topic links */
  UI.sayNodes = function (text) {
    return String(text === undefined || text === null ? '' : text).split('`').flatMap((part, i) => (i % 2 ? [UI.h('span.v', part)] : UI.withLinks(part)));
  };
  /** the same text plain: backticks dropped, topic links as words */
  UI.sayPlain = function (text) {
    const T = globalThis.Proses, t = String(text === undefined || text === null ? '' : text).replace(/`/g, '');
    return T && T.plainLinks ? T.plainLinks(t) : t;
  };
  /** Grow a text box to its text, up to max px; past that it scrolls (with a visible scrollbar), as a long editor should */
  UI.autosize = function (ta, max) {
    const fit = () => {
      if (!ta.isConnected || !ta.offsetParent) return;
      ta.style.height = 'auto';
      const want = ta.scrollHeight + 2;
      ta.style.height = Math.min(want, max || 420) + 'px';
      if (want > (max || 420)) { ta.dataset.scrollOk = 'long'; ta.style.overflowY = 'scroll'; } else { delete ta.dataset.scrollOk; ta.style.overflowY = 'hidden'; }
    };
    if (!ta.dataset.autosize) { ta.dataset.autosize = '1'; ta.addEventListener('input', fit); }
    requestAnimationFrame(fit);
    fit();
    return fit;
  };
  UI.debounce = (fn, ms) => { let t = null; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  UI.reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

  UI.storage = {
    get(k, d) { try { const v = localStorage.getItem('proses.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('proses.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  // ---- pages and their checks ----------------------------------------------------------------------------
  /**
   * Every page of the app registers here: S.Pages.register(id, { title, nav, open(app, main, rest) }).
   * open returns the page object ({ dispose(), onKey(e), redraw() }, all optional). nav names the top-bar
   * button lit while the page is open. The routes are #id and #id/rest.
   */
  const pages = new Map();
  S.Pages = {
    register(id, def) { pages.set(id, Object.assign({ id }, def)); },
    get: (id) => pages.get(id),
    list: () => [...pages.values()],
  };
  /**
   * Scenes for tools/check-diagrams.mjs, registered by the pages that draw them:
   * S.Checks.push({ group, name, hash, ready: 'a JS expression true once drawn', setup: 'async JS run first', sel })
   */
  S.Checks = S.Checks || [];
  /**
   * The benches register here, from files that load before the Bench page itself (bench.js):
   * S.Bench.tab(id, {title, icon, blurb, order, open(host, state, ctx)}); S.Bench.preset(id, state) fills a bench
   * before it opens.
   */
  const benchTabs = new Map(), benchPending = {};
  S.Bench = {
    _tabs: benchTabs, _pending: benchPending,
    tab(id, def) { benchTabs.set(id, Object.assign({ id, order: 50 }, def)); },
    tabs: () => [...benchTabs.values()].sort((a, b) => a.order - b.order),
    get: (id) => benchTabs.get(id),
    preset(id, state) { benchPending[id] = state; },
  };
})();
