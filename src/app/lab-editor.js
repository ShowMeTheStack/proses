// The code editor for the C subset: a text box over its highlighted copy, with line numbers, breakpoints, the line
// each process or thread is on (a coloured tag per process, as in the fork-tree scene), the compiler's error
// underlined at its line and column with the message and the hint, Tab and auto-indent, and named programs saved
// in this browser. No libraries.
//   const ed = S.LabEditor.create(host, opts)
//     opts: {value, id, label, minLines (8), maxHeight (px, 520), readOnly, onChange(text), onRun() (Ctrl+Enter),
//            onBreak(lines) (a breakpoint was set or cleared), files: 'namespace' (adds the bar of saved programs),
//            examples: [{name, src}] (listed in the bar), name (the program's name)}
//   ed.el  ed.get()  ed.set(text)  ed.focus()  ed.goto(line, col)  ed.dispose()
//   ed.setMarks([{line, tag: 'P1', cls: 'p0'..'p5', act: bool, title}])  the line each process or thread is on;
//       act lights its line with a band (the one that moves in this step)
//   ed.setError(err | null)   err: an S.CLang.CError or {line, col, msg, hint}: the token at line:col is
//       underlined, its line number turns red, and the message box under the code says where, what and the hint
//   ed.check()  compiles with S.CLang.compile (when there) and shows the first error; returns it (or null)
//   ed.breakpoints -> Set of lines   ed.setBreakpoints([lines])   ed.toggleBreakpoint(line)
//   S.LabEditor.programs(ns): {list() -> [names], load(name) -> text | null, save(name, text), remove(name)}
//   S.LabEditor.highlight(text) -> [html of each line]   (for read-only listings elsewhere)
(function (S) {
  'use strict';
  const LE = (S.LabEditor = S.LabEditor || {});
  const IND = '    ';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const TYPES = new Set('void char short int long unsigned signed float double size_t ssize_t pid_t off_t struct union enum typedef const static extern volatile register auto bool pthread_t pthread_mutex_t pthread_cond_t sem_t FILE sigset_t'.split(' '));
  const CTRL = new Set('if else while for do switch case default break continue return goto sizeof'.split(' '));
  const CONST = new Set('NULL EOF true false stdin stdout stderr SIGINT SIGTERM SIGKILL SIGCHLD SIGALRM SIGUSR1 SIGUSR2 SIGSTOP SIGCONT SIGPIPE SIG_IGN SIG_DFL WNOHANG O_RDONLY O_WRONLY O_RDWR O_CREAT O_TRUNC O_APPEND SEEK_SET SEEK_CUR SEEK_END STDIN_FILENO STDOUT_FILENO STDERR_FILENO'.split(' '));
  const SYS = /^(fork|exec[lv]p?e?|wait|waitpid|_?exit|atexit|getpid|getppid|sleep|kill|signal|sigaction|sigprocmask|sigemptyset|sigaddset|pause|alarm|raise|pipe|dup2?|open|close|read|write|lseek|unlink|pthread_\w+|sem_\w+)$/;

  /** highlight C: the html of every line (block comments may span lines) */
  LE.highlight = function (text) {
    const lines = String(text).split('\n'), out = [];
    let inCom = false;
    for (const line of lines) {
      let html = '', i = 0;
      const n = line.length;
      const span = (cls, s) => { html += '<span class="ck-' + cls + '">' + esc(s) + '</span>'; };
      if (inCom) {
        const e = line.indexOf('*/');
        if (e < 0) { span('com', line); out.push(html); continue; }
        span('com', line.slice(0, e + 2)); i = e + 2; inCom = false;
      }
      if (/^\s*#/.test(line.slice(i)) && i === 0) {
        const m = /^(\s*#\s*\w+)(.*)$/.exec(line);
        if (m) {
          span('pre', m[1]);
          const rest = m[2], c = rest.indexOf('//');
          const body = c >= 0 ? rest.slice(0, c) : rest;
          const inc = /^(\s*)(<[^>]*>|"[^"]*")(.*)$/.exec(body);
          if (inc) { html += esc(inc[1]); span('str', inc[2]); html += esc(inc[3]); } else html += esc(body);
          if (c >= 0) span('com', rest.slice(c));
          out.push(html); continue;
        }
      }
      while (i < n) {
        const c = line[i], two = line.slice(i, i + 2);
        if (two === '//') { span('com', line.slice(i)); i = n; break; }
        if (two === '/*') { const e = line.indexOf('*/', i + 2); if (e < 0) { span('com', line.slice(i)); inCom = true; i = n; break; } span('com', line.slice(i, e + 2)); i = e + 2; continue; }
        if (c === '"' || c === "'") {
          let j = i + 1;
          while (j < n && line[j] !== c) j += line[j] === '\\' ? 2 : 1;
          span(c === '"' ? 'str' : 'chr', line.slice(i, Math.min(n, j + 1))); i = j + 1; continue;
        }
        if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(line[i + 1] || ''))) {
          const m = /^(0[xX][0-9a-fA-F]+|[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)[uUlLfF]*/.exec(line.slice(i));
          span('num', m[0]); i += m[0].length; continue;
        }
        if (/[A-Za-z_]/.test(c)) {
          const w = /^[A-Za-z_]\w*/.exec(line.slice(i))[0];
          const call = /^\s*\(/.test(line.slice(i + w.length));
          if (TYPES.has(w)) span('type', w);
          else if (CTRL.has(w)) span('kw', w);
          else if (CONST.has(w)) span('const', w);
          else if (call && SYS.test(w)) span('sys', w);
          else if (call) span('fn', w);
          else html += esc(w);
          i += w.length; continue;
        }
        if (/[-+*/%=<>!&|^~?:]/.test(c)) { let j = i + 1; while (j < n && /[-+*/%=<>!&|^~]/.test(line[j]) && line.slice(j, j + 2) !== '//' && line.slice(j, j + 2) !== '/*') j++; span('op', line.slice(i, j)); i = j; continue; }
        html += esc(c); i++;
      }
      out.push(html);
    }
    return out;
  };

  /** named programs in this browser: storage may be off, so every call is guarded */
  LE.programs = function (ns) {
    const key = 'progs:' + (ns || 'c');
    const read = () => { try { const v = JSON.parse(localStorage.getItem('proses.' + key) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } };
    const write = (all) => { try { localStorage.setItem('proses.' + key, JSON.stringify(all)); return true; } catch (e) { return false; } };
    return {
      list: () => Object.keys(read()).sort((a, b) => a.localeCompare(b)),
      load: (name) => { const v = read()[name]; return v === undefined ? null : String(v.src !== undefined ? v.src : v); },
      save: (name, src) => { const all = read(); all[name] = { src: String(src), t: Date.now() }; return write(all); },
      remove: (name) => { const all = read(); delete all[name]; return write(all); },
    };
  };

  /** where a CError points: {line, col, len} (the token at the column, at least one character) */
  function spot(err, lines) {
    const line = Math.max(1, Math.min(lines.length, +err.line || 1)), text = lines[line - 1] || '';
    let col = Math.max(1, +err.col || 1);
    if (col > text.length + 1) col = text.length + 1;
    const m = /^[A-Za-z_]\w*|^\d\w*|^"(?:[^"\\]|\\.)*"?|^'(?:[^'\\]|\\.)*'?|^\S/.exec(text.slice(col - 1));
    let len = m ? m[0].length : 1;
    if (!m && !text.trim()) len = 0;
    return { line, col, len };
  }

  LE.create = function (host, opts) {
    opts = opts || {};
    const { h, icon } = S.UI;
    const LH = 21;
    let marks = [], err = null, bps = new Set(), lastText = null;
    const ta = h('textarea.le-ta', { id: opts.id || null, spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', wrap: 'off', 'aria-label': opts.label || 'C program', readOnly: !!opts.readOnly });
    ta.setAttribute('autocorrect', 'off');
    ta.value = String(opts.value || '');
    const hl = h('div.le-hl', { 'aria-hidden': 'true' });
    const gut = h('div.le-gut');
    const code = h('div.le-code', hl, ta);
    const scroll = h('div.le-scroll', { dataset: { scrollAffordance: 'both' } }, h('div.le-lines', gut, code));
    scroll.style.maxHeight = (opts.maxHeight || 520) + 'px';
    const msg = h('div.le-msg', { role: 'status', 'aria-live': 'polite' });
    const el = h('div.le' + (opts.readOnly ? '.ro' : ''), scroll, msg);
    const ed = { el, ta };

    // ---- the bar of saved programs -------------------------------------------------------------------------
    if (opts.files) {
      const P = LE.programs(opts.files);
      const pick = h('select.le-pick', { 'aria-label': 'Open a program' });
      const fill = () => {
        pick.innerHTML = '';
        pick.appendChild(h('option', { value: '' }, ed.name ? ed.name : 'Open a program…'));
        const ex = opts.examples || [], mine = P.list();
        if (ex.length) pick.appendChild(h('optgroup', { label: 'Examples' }, ...ex.map((x, i) => h('option', { value: 'x:' + i }, x.name))));
        if (mine.length) pick.appendChild(h('optgroup', { label: 'Saved in this browser' }, ...mine.map((n) => h('option', { value: 's:' + n }, n))));
        pick.value = '';
      };
      ed.name = opts.name || '';
      pick.addEventListener('change', () => {
        const v = pick.value;
        if (v.startsWith('x:')) { const x = (opts.examples || [])[+v.slice(2)]; if (x) { ed.name = x.name; ed.set(x.src, true); } }
        else if (v.startsWith('s:')) { const t = P.load(v.slice(2)); if (t !== null) { ed.name = v.slice(2); ed.set(t, true); } }
        fill();
      });
      const btn = (id, ic, label, fn, bare) => { const b = h('button.btn.small' + (bare ? '.le-icon' : ''), { type: 'button', id, title: label, 'aria-label': label }, icon(ic), bare ? null : h('span.lbl', label)); b.addEventListener('click', fn); return b; };
      const save = async (as) => {
        let name = ed.name;
        if (as || !name || (opts.examples || []).some((x) => x.name === name)) name = await S.UI.prompt('Save the program', 'Name', name ? name.replace(/\.c$/, '') + (as ? ' copy' : '') + '.c' : 'my-program.c', { ok: 'Save' });
        if (!name) return;
        name = String(name).trim().slice(0, 60);
        if (!name) return;
        if (P.save(name, ta.value)) { ed.name = name; fill(); S.UI.toast('Saved as ' + name + ' in this browser.', 'ok', 1800); }
        else S.UI.toast('This browser does not let the page save: storage is off.', 'err', 3500);
      };
      const del = async () => {
        if (!ed.name || !P.list().includes(ed.name)) { S.UI.toast('Pick a saved program first.', 'info', 1800); return; }
        if (!(await S.UI.confirm('Delete ' + ed.name + '?', 'It is removed from this browser.', 'Delete', 'Keep it'))) return;
        P.remove(ed.name); ed.name = ''; fill();
      };
      el.prepend(h('div.le-bar', icon('file'), pick, btn('leSave', 'save', 'Save', () => save(false)), btn('leSaveAs', 'copy', 'Save as', () => save(true)), btn('leDel', 'trash', 'Delete', del, true)));
      fill();
      ed.files = { programs: P, refresh: fill, save };
    }

    // ---- drawing ------------------------------------------------------------------------------------------
    function draw() {
      const text = ta.value, lines = text.split('\n');
      const html = LE.highlight(text);
      const byLine = new Map();
      for (const m of marks) { if (!byLine.has(m.line)) byLine.set(m.line, []); byLine.get(m.line).push(m); }
      const sp = err ? spot(err, lines) : null;
      let out = '';
      for (let i = 0; i < lines.length; i++) {
        const ln = i + 1, ms = byLine.get(ln) || [];
        let body = html[i];
        if (sp && sp.line === ln) {
          // underline the token at the column: rebuild the line from its plain text around the error
          const t = lines[i], a = sp.col - 1, b = a + sp.len;
          const tok = t.slice(a, b);
          body = LE.highlight(t.slice(0, a))[0] + '<span class="le-err' + (tok ? '' : ' eol') + '">' + (tok ? LE.highlight(tok)[0] : '&nbsp;&nbsp;') + '</span>' + LE.highlight(t.slice(b))[0];
        }
        const tags = ms.length ? '<span class="le-tags">' + ms.map((m) => '<span class="le-tag ' + esc(m.cls || 'p0') + (m.act ? ' act' : '') + '" title="' + esc(m.title || m.tag) + '">' + esc(m.tag) + '</span>').join('') + '</span>' : '';
        const cls = 'le-l' + (ms.some((m) => m.act) ? ' act ' + esc((ms.find((m) => m.act) || {}).cls || '') : ms.length ? ' here' : '') + (bps.has(ln) ? ' bp' : '') + (sp && sp.line === ln ? ' bad' : '');
        out += '<div class="' + cls + '">' + (body || '') + tags + '​</div>';
      }
      hl.innerHTML = out;
      let g = '';
      for (let i = 1; i <= lines.length; i++) {
        const ms = byLine.get(i);
        g += '<div class="le-ln' + (bps.has(i) ? ' bp' : '') + (sp && sp.line === i ? ' bad' : '') + (ms ? ' here' : '') + '" data-line="' + i + '"' + (bps.has(i) ? ' title="Breakpoint: click to clear"' : ' title="Click to set a breakpoint"') + '>' + i + '</div>';
      }
      gut.innerHTML = g;
      const minLines = opts.minLines || 8;
      const H = (Math.max(minLines, lines.length) * LH + 20) + 'px';
      code.style.minHeight = H; ta.style.height = H;
      code.style.minWidth = 'calc(' + lines.reduce((m, l) => Math.max(m, l.length), 0) + 'ch + 64px)';
      if (err) {
        msg.className = 'le-msg bad';
        msg.innerHTML = '';
        const where = h('button.le-where', { type: 'button', title: 'Go to the error' }, 'line ' + sp.line + (err.col ? ', column ' + err.col : ''));
        where.addEventListener('click', () => ed.goto(sp.line, sp.col));
        msg.append(icon('warn'), h('div', h('div', where, ' ', h('span.le-what', String(err.msg || err.message || err))), err.hint ? h('div.le-hint', h('b', 'Hint: '), err.hint) : null));
      } else { msg.className = 'le-msg'; msg.innerHTML = ''; }
    }
    const changed = () => {
      if (ta.value === lastText) return;
      lastText = ta.value;
      if (err) err = null; // an edit makes the old error stale
      draw();
      if (opts.onChange) opts.onChange(ta.value);
    };
    ta.addEventListener('input', changed);

    // ---- breakpoints -----------------------------------------------------------------------------------------
    gut.addEventListener('click', (e) => { const d = e.target.closest('.le-ln'); if (d) ed.toggleBreakpoint(+d.dataset.line); });

    // ---- keys: Tab indents, Shift+Tab outdents, Enter keeps the indent (one more after {), } outdents -------------
    const edit = (start, end, text, caret) => {
      ta.focus();
      ta.setSelectionRange(start, end);
      let ok = false;
      try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
      if (!ok) { ta.value = ta.value.slice(0, start) + text + ta.value.slice(end); }
      const at = caret === undefined ? start + text.length : caret;
      ta.setSelectionRange(at, at);
      changed();
    };
    ta.addEventListener('keydown', (e) => {
      if (opts.readOnly) return;
      const v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
      const lineStart = v.lastIndexOf('\n', a - 1) + 1;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { if (opts.onRun) { e.preventDefault(); opts.onRun(); } return; }
      if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const multi = v.slice(a, b).includes('\n');
        if (!multi && !e.shiftKey) { const col = a - lineStart; edit(a, b, ' '.repeat(IND.length - (col % IND.length))); return; }
        // indent or outdent every selected line
        const endLine = v.indexOf('\n', b - (b > a && v[b - 1] === '\n' ? 1 : 0));
        const to = endLine < 0 ? v.length : endLine;
        const block = v.slice(lineStart, to).split('\n');
        const next = block.map((l) => (e.shiftKey ? l.replace(/^( {1,4}|\t)/, '') : l.length ? IND + l : l)).join('\n');
        edit(lineStart, to, next, lineStart);
        ta.setSelectionRange(lineStart, lineStart + next.length);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const cur = v.slice(lineStart, a), lead = /^[ \t]*/.exec(cur)[0];
        const before = cur.trimEnd(), after = v.slice(b, (v.indexOf('\n', b) + 1 || v.length + 1) - 1);
        if (/\{$/.test(before) && /^\s*\}/.test(after)) { const ins = '\n' + lead + IND + '\n' + lead; edit(a, b, ins, a + 1 + lead.length + IND.length); return; }
        edit(a, b, '\n' + lead + (/[{(]$/.test(before) || /^\s*(case\b.*|default\s*):$/.test(before) ? IND : ''));
        return;
      }
      if (e.key === '}' && a === b) {
        const cur = v.slice(lineStart, a);
        if (/^[ \t]+$/.test(cur)) { e.preventDefault(); const lead = cur.replace(/( {1,4}|\t)$/, ''); edit(lineStart, a, lead + '}'); }
        return;
      }
      if (e.key === 'Backspace' && a === b && a > lineStart) {
        const cur = v.slice(lineStart, a);
        if (/^ +$/.test(cur) && cur.length % IND.length === 0) { e.preventDefault(); edit(a - IND.length, a, ''); }
      }
    });

    // ---- the API ------------------------------------------------------------------------------------------
    Object.assign(ed, {
      get: () => ta.value,
      set(text, user) { ta.value = String(text === undefined || text === null ? '' : text); lastText = null; err = null; marks = []; changed(); if (!user) lastText = ta.value; },
      focus() { ta.focus(); },
      /** the caret to a line and column (1-based), scrolled into view */
      goto(line, col) {
        const lines = ta.value.split('\n');
        line = Math.max(1, Math.min(lines.length, line || 1));
        let at = 0;
        for (let i = 0; i < line - 1; i++) at += lines[i].length + 1;
        at += Math.max(0, Math.min(lines[line - 1].length, (col || 1) - 1));
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(at, at);
        ed.reveal(line);
      },
      /** scroll so a line shows */
      reveal(line) {
        const y = (line - 1) * LH + 10, top = scroll.scrollTop, hgt = scroll.clientHeight;
        if (y < top + 4 || y + LH > top + hgt - 4) scroll.scrollTop = Math.max(0, y - hgt / 3);
      },
      setMarks(list) { marks = (list || []).filter((m) => m && m.line > 0); draw(); const act = marks.find((m) => m.act); if (act) ed.reveal(act.line); },
      setError(e) { err = e ? { line: e.line, col: e.col, msg: e.msg || e.message, hint: e.hint } : null; draw(); if (err) ed.reveal(err.line); },
      error: () => err,
      check() {
        const C = S.CLang;
        if (!C || !C.compile) return null;
        try { C.compile(ta.value); ed.setError(null); return null; } catch (e) { if (e && e.line !== undefined) { ed.setError(e); return e; } ed.setError({ line: 1, col: 0, msg: String(e.message || e) }); return e; }
      },
      setBreakpoints(lines) { bps = new Set((lines || []).map(Number).filter((n) => n > 0)); draw(); },
      toggleBreakpoint(line) { if (bps.has(line)) bps.delete(line); else bps.add(line); draw(); if (opts.onBreak) opts.onBreak([...bps].sort((x, y) => x - y)); },
      redraw: draw,
      dispose() { /* nothing global to release */ },
    });
    Object.defineProperty(ed, 'breakpoints', { get: () => new Set(bps), enumerable: true });
    lastText = ta.value;
    draw();
    host.appendChild(el);
    return ed;
  };
})(globalThis.Proses = globalThis.Proses || {});
