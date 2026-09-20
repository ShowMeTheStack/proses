// Part 17, sandboxing and isolation (prot-d-memsafe.js): a policy that lists the calls and paths a program may use,
// with every path resolved before it is judged, and what two processes share or do not.
(function (S) {
  'use strict';
  const H = S.P09, Pr = () => S.Prot;
  const POL = {
    viewer: { label: 'An image viewer: read its inputs, write thumbnails', policy: { calls: ['read', 'write', 'open', 'close', 'exit'], paths: ['/sandbox/'], write: ['/sandbox/out/'], net: false },
      requests: [{ call: 'open', path: '/sandbox/in/photo.png' }, { call: 'open', path: '/sandbox/out/thumb.png', write: true }, { call: 'open', path: '/etc/passwd' }, { call: 'open', path: '/sandbox/in/../../etc/passwd' }, { call: 'open', path: '/sandbox/in/photo.png', write: true }, { call: 'connect', host: 'images.example' }, { call: 'fork' }, { call: 'exit' }] },
    fetcher: { label: 'A downloader: network allowed, one folder only', policy: { calls: ['read', 'write', 'open', 'close', 'exit', 'connect'], paths: ['/sandbox/'], write: ['/sandbox/'], net: true },
      requests: [{ call: 'connect', host: 'files.example' }, { call: 'open', path: '/sandbox/data.bin', write: true }, { call: 'open', path: '/home/ana/notes.txt' }, { call: 'open', path: '/sandbox/./data.bin' }, { call: 'exec' }, { call: 'exit' }] },
    strict: { label: 'A calculator: no files at all', policy: { calls: ['read', 'write', 'exit'], paths: [], write: [], net: false },
      requests: [{ call: 'read' }, { call: 'write' }, { call: 'open', path: '/sandbox/in/x' }, { call: 'connect', host: 'anywhere.example' }, { call: 'exit' }] },
  };
  const reqText = (q) => q.call + '(' + (q.path ? q.path + (q.write ? ', write' : '') : q.host || '') + ')';

  S.topic({
    id: 'prot-sandbox', family: 'p17-sandbox', order: 10, title: 'A sandbox policy',
    blurb: 'A sandbox runs a program with far fewer rights than its user has: only the system calls on a list, only the files under a few folders, writing only where it must, and the network only if it needs it. The kernel checks every request against the policy before doing it, so a bug in the program, or a malicious file it opens, cannot reach anything outside the box. Paths are resolved first (. and .. removed), so a path cannot leave the box by its spelling.',
    inputs: [{ id: 'pol', kind: 'choice', label: 'Program and policy', def: 'viewer', options: Object.entries(POL).map(([value, p]) => ({ value, label: p.label })) }],
    presets: Object.entries(POL).map(([k, p]) => ({ label: p.label, values: { pol: k } })),
    counters: [{ id: 'allowed', label: 'allowed' }, { id: 'refused', label: 'refused' }],
    run(inp) {
      const P = POL[inp.pol], R = Pr().sandbox({ policy: P.policy, requests: P.requests }), F = new S.Frames(['allowed', 'refused']);
      const pol = P.policy;
      const panel = () => [H.title('pt', 0, 6, 'the policy'), H.text('p1', 0, 32, 'calls: ' + pol.calls.join(', '), 'mono', 14), H.text('p2', 0, 56, 'read under: ' + (pol.paths.join(', ') || 'nothing'), 'mono', 14), H.text('p3', 0, 80, 'write under: ' + (pol.write.join(', ') || 'nothing'), 'mono', 14), H.text('p4', 0, 104, 'network: ' + (pol.net ? 'allowed' : 'none'), 'mono', 14)];
      const list = (upto, cur) => [H.title('rt', 0, 146, 'the program\'s requests')].concat(P.requests.map((q, k) => {
        const r = R.results[k], y = 160 + k * 30;
        return [{ key: 'rq' + k, kind: 'cell', x: 0, y, w: 400, h: 26, rx: 4, text: reqText(q), size: 14, align: 'left', cls: 'implrow mono' + (k === cur ? ' act' : '') }, k < upto ? { key: 'rv' + k, kind: 'cell', x: 410, y: y + 1, w: 90, h: 24, rx: 10, text: r.ok ? 'allowed' : 'EPERM', size: 13, cls: 'tag ' + (r.ok ? 'good' : 'hot') } : null];
      }).flat().filter(Boolean));
      const box = (cur) => {
        const items = [{ key: 'bx', kind: 'region', x: 540, y: 20, w: 240, h: 300, rx: 12, cls: 'act' }, H.title('bxt', 556, 44, 'inside the box')];
        items.push({ key: 'prog', kind: 'state', x: 660, y: 110, r: 30, text: 'prog', cls: 's-running' });
        const q = cur >= 0 ? P.requests[cur] : null, r = cur >= 0 ? R.results[cur] : null;
        if (q) {
          const norm = q.path ? Pr().normalise(q.path) : null, inside = norm && P.policy.paths.some((p) => norm.startsWith(p));
          const target = q.call === 'connect' ? { x: 660, y: 420, t: q.host } : norm ? (inside ? { x: 660, y: 250, t: norm } : { x: 660, y: 420, t: norm }) : { x: 660, y: 250, t: q.call + '()' };
          items.push({ key: 'tg', kind: 'cell', x: target.x - 115, y: target.y - 18, w: 230, h: 36, rx: 6, text: target.t, size: 13, cls: 'rec ' + (r.ok ? 'tagok idbox' : 'taghot idbox') });
          items.push({ key: 'te', kind: 'edge', from: 'prog', to: 'tg', cls: r.ok ? 'good' : 'hot' });
        }
        items.push(H.text('out', 545, 466, 'outside the box: the rest of the system', '', 13));
        return items;
      };
      F.add({ items: [...panel(), ...list(0, -1), ...box(-1)], say: `The program runs in a box: ${H.plural(pol.calls.length, 'system call')} allowed, ${pol.paths.length ? 'files under ' + pol.paths.join(', ') : 'no files'}, ${pol.net ? 'and the network' : 'and no network'}. Everything it asks for is checked first.`, meta: { phase: 'start', calls: pol.calls.length } });
      R.steps.forEach((st, k) => {
        if (st.kind === 'result') return;
        F.count(R.results[k].ok ? 'allowed' : 'refused');
        F.add({ items: [...panel(), ...list(k + 1, k), ...box(k)], say: st.say, meta: { phase: 'req', k, ok: R.results[k].ok }, title: reqText(P.requests[k]) });
      });
      const last = R.steps[R.steps.length - 1];
      F.add({ items: [...panel(), ...list(P.requests.length, -1), ...box(-1)], say: last.say, meta: { phase: 'end', refused: R.results.filter((x) => !x.ok).length, n: R.results.length }, title: 'summary', hold: 2500 });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'A sandbox', text: ['allow-list of system calls (deny the rest)', 'files: only under the allowed folders', 'paths resolved (. and .. removed) first', 'write only where the work needs it', 'network only if needed', 'checked by the kernel at every call'].join('\n') }] } };
    },
    predict: [{ at: (f, i, fr) => fr[i + 1] && fr[i + 1].meta.phase === 'req' && fr[i + 1].meta.k === 3, pick: 'option', ask: 'Will the next request be allowed?', options: ['allowed', 'refused'], answer: (fr, i) => (fr[i + 1].meta.ok ? 'allowed' : 'refused'), explain: (fr, i) => fr[i + 1].say }],
    quiz: [
      { q: 'A sandbox limits…', options: ['what a program may ask the kernel for', 'how fast it runs', 'its memory use only', 'which user started it'], answer: 0, why: 'Calls, files and network outside the policy are refused.' },
      { q: 'Why must paths be resolved before they are judged?', options: ['so that a path with dot-dot parts cannot name a file outside the allowed folder', 'to make them shorter', 'for speed', 'they need not be'], answer: 0, why: '/box/in/../../etc names /etc, whatever its spelling.' },
      { q: 'An allow-list (deny everything not listed) is safer than a deny-list because…', options: ['anything forgotten is refused rather than permitted', 'it is shorter', 'it runs faster', 'it needs no kernel'], answer: 0, why: 'Fail-safe defaults again.' },
      { q: 'A document viewer is a good candidate for a sandbox because…', options: ['it reads files from strangers and needs few rights', 'it is small', 'it never has bugs', 'it needs the network'], answer: 0, why: 'Untrusted input and a narrow job.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  const PAIRS = {
    users: { label: 'Two users\' processes on one machine', a: { name: 'ana\'s editor', uid: 1001, files: ['/home/ana/notes.txt', '/tmp/shared.log'], net: 'host', pidns: 'root' }, b: { name: 'ben\'s player', uid: 1002, files: ['/home/ben/music', '/tmp/shared.log'], net: 'host', pidns: 'root' } },
    same: { label: 'Two programs of one user', a: { name: 'browser', uid: 1001, files: ['/home/ana/downloads', '/home/ana/notes.txt'], net: 'host', pidns: 'root' }, b: { name: 'mail', uid: 1001, files: ['/home/ana/mail', '/home/ana/notes.txt'], net: 'host', pidns: 'root' } },
    boxed: { label: 'Two boxed services', a: { name: 'web box', uid: 2001, files: ['/srv/web'], net: 'web-net', pidns: 'web' }, b: { name: 'db box', uid: 2002, files: ['/srv/db'], net: 'db-net', pidns: 'db' } },
  };
  S.topic({
    id: 'prot-isolation', family: 'p17-sandbox', order: 20, title: 'What two processes share',
    blurb: 'Isolation is a list of things not shared. Two processes are not isolated just because they are different programs: if they run as the same user they can read each other\'s files and signal each other; if they see one file they can pass data through it; on one network or one process-id space they can reach each other. Each shared thing is a path from one to the other. Separate users, folders, network and process namespaces cut those paths one by one.',
    inputs: [{ id: 'pair', kind: 'choice', label: 'Processes', def: 'users', options: Object.entries(PAIRS).map(([value, p]) => ({ value, label: p.label })) }],
    presets: Object.entries(PAIRS).map(([k, p]) => ({ label: p.label, values: { pair: k } })),
    counters: [{ id: 'shared', label: 'shared' }],
    run(inp) {
      const P = PAIRS[inp.pair], R = Pr().isolation(P.a, P.b), F = new S.Frames(['shared']);
      const rows = [['user id', (x) => 'uid ' + x.uid, 'uid'], ['files', (x) => x.files.join('\n'), 'file'], ['network', (x) => x.net, 'net'], ['process ids', (x) => x.pidns + ' namespace', 'pids']];
      const col = (x, p, k0, lit) => [{ key: k0 + 'h', kind: 'cell', x, y: 20, w: 260, h: 34, rx: 8, text: p.name, size: 15, cls: 'idbox' }].concat(rows.map(([nm, f, kind], i) => {
        const sh = R.shared.some((s) => s.kind === kind), lines = f(p).split('\n');
        return { key: k0 + i, kind: 'cell', x, y: 74 + i * 70, w: 260, h: 56, rx: 6, lines, size: 13, cls: 'rec mono ' + (lit !== undefined && lit >= i ? (sh ? 'same' : 'tagok idbox') : '') };
      }));
      const mid = (lit) => rows.map(([nm, , kind], i) => { const sh = R.shared.some((s) => s.kind === kind); return [H.text('rn' + i, 390, 74 + i * 70 + 33, nm, lit !== undefined && lit >= i ? (sh ? 'hot' : 'good') : 'strong', 14, 'middle'), lit !== undefined && lit >= i && sh ? { key: 'ln' + i, kind: 'line', x1: 262, y1: 74 + i * 70 + 46, x2: 518, y2: 74 + i * 70 + 46, cls: 'hot' } : null]; }).flat().filter(Boolean);
      const pic = (lit, extra) => [...col(0, P.a, 'a', lit), ...col(520, P.b, 'b', lit), ...mid(lit), ...(extra || [])];
      F.add({ items: pic(undefined), say: `${P.a.name} and ${P.b.name}: what can one reach of the other?`, meta: { phase: 'start' } });
      rows.forEach(([nm, , kind], i) => {
        const s = R.shared.find((x) => x.kind === kind);
        if (s) F.count('shared');
        F.add({ items: pic(i), say: s ? `Both reach ${s.what}: a path between them.` : `Their ${nm} differ: no path through ${nm === 'files' ? 'a file' : 'it'}.`, meta: { phase: 'row', i, shared: !!s, uid: [P.a.uid, P.b.uid] }, title: nm });
      });
      const last = R.steps[R.steps.length - 1];
      F.add({ items: pic(3, [H.text('vd', 0, 74 + 4 * 70 + 20, H.plain(last.say), 'verdict2 ' + (R.shared.length ? 'hot' : 'good'), 16)]), say: H.plain(last.say) + (R.shared.length ? ' Each shared thing is a way for a fault in one to reach the other.' : ' A fault in one cannot reach the other through any of these.'), meta: { phase: 'end', n: R.shared.length }, title: 'verdict', hold: 2500 });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Paths between processes', text: ['same user: files and signals', 'a shared file: data both ways', 'one network: connections', 'one process-id space: signals, tracing', 'cut each with users, folders, namespaces'].join('\n') }] } };
    },
    predict: [{ at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'Are these two processes isolated from each other?', options: ['yes', 'no'], answer: (fr) => (fr[fr.length - 1].meta.n ? 'no' : 'yes'), explain: (fr) => fr[fr.length - 1].say }],
    quiz: [
      { q: 'Two programs run as the same user. Are they isolated?', options: ['no: each can read the other\'s files and signal it', 'yes: they are different programs', 'only if they use different CPUs', 'yes, if one is idle'], answer: 0, why: 'Protection in UNIX is per user; the same user means the same rights.' },
      { q: 'A file both processes can write is…', options: ['a channel between them', 'harmless', 'a capability', 'a namespace'], answer: 0, why: 'Whatever one writes, the other can read.' },
      { q: 'A process-id namespace isolates by…', options: ['letting a process see and signal only the processes in its own namespace', 'encrypting memory', 'slowing processes down', 'giving each its own CPU'], answer: 0, why: 'Processes outside cannot even be named.' },
      { q: 'Which gives the strongest isolation of the four rows shown?', options: ['different users, files, network and process namespaces together', 'different file names only', 'different program names', 'a different priority'], answer: 0, why: 'Each row cut removes one path.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
