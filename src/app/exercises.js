// Answer areas beyond the basic kinds (choice, string, number, set and table are drawn by lessons.js). Each answer
// area is S.ExerciseViews.kind = (x, host, draft, page) -> { get(), mark(result)?, after(result, box)? }; the kinds
// a later file adds (a Gantt chart to fill in, a page walk, a C program) register theirs the same way.
// S.ExWidgets holds the pieces other pages share: a code box and a console box.
(function (S) {
  'use strict';
  const { h } = S.UI;
  const W = (S.ExWidgets = S.ExWidgets || {});
  S.ExerciseViews = S.ExerciseViews || {};

  /** a text box for code: monospaced, keeps every space and line, Tab indents, Ctrl+Enter runs */
  W.codeArea = function (text, opts) {
    opts = opts || {};
    const ta = h('textarea.mono.code-area', { id: opts.id || 'ansCode', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', 'aria-label': opts.label || 'Your code', placeholder: opts.placeholder || '', rows: String(opts.rows || 12), wrap: 'soft' });
    ta.value = text || '';
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); if (!document.execCommand('insertText', false, '  ')) { const a = ta.selectionStart; ta.value = ta.value.slice(0, a) + '  ' + ta.value.slice(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = a + 2; } }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && opts.onRun) { e.preventDefault(); opts.onRun(); }
    });
    return ta;
  };
  /** what a run printed, folded open */
  W.logBox = (logs) => (logs && logs.length ? h('details.logs', { open: true }, h('summary', 'Output (' + logs.length + ' line' + (logs.length === 1 ? '' : 's') + ')'), h('pre.mono', logs.join('\n'))) : null);
  /** a challenge's or a task's card: what to do, the goal, and the limits as a list */
  W.taskCard = function (x) {
    const C = S.Challenges;
    const row = (k, v) => h('div.tc-row', h('span.tc-k', k), h('div', v));
    const limits = C ? C.limitSentences(x) : [];
    return h('div.task-card', x.task ? row('Task', S.UI.inline(x.task)) : null, C ? row('Goal', C.goal(x)) : null,
      limits.length ? row('Limits', h('ul.tc-limits', limits.map((l) => h('li', S.UI.inline(l))))) : null);
  };
})(globalThis.Proses = globalThis.Proses || {});
