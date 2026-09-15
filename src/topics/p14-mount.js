// Part 14, mounting and protection: a second file system mounted into the namespace (S.FS.Sys mount and umount),
// with what crosses the mount point and what cannot (EXDEV, EBUSY); and the permission bits checked on a path,
// directory by directory, for a process with its own user and group.
(function (S) {
  'use strict';
  const T = () => S.T12, U = () => S.T14;
  const R = Math.round;

  function stick() {
    const F = S.FS, img = U().image(), sys = new F.Sys(img);
    sys.op(1, 'create', '/readme'); sys.op(1, 'write', '/readme', 0, 'holiday photos');
    sys.op(1, 'mkdir', '/photos'); sys.op(1, 'create', '/photos/beach'); sys.op(1, 'write', '/photos/beach', 0, 'sand and sea');
    return img;
  }
  const SCEN = {
    tour: (at) => [['mount', at, 1], ['stat', 1, at + '/readme'], ['stat', 1, at + '/photos/beach'], ['umount', at], ['stat', 1, at + '/readme']],
    busy: (at) => [['mount', at, 1], ['open', 1, at + '/photos/beach', 'r'], ['umount', at], ['close', 1, 0], ['umount', at]],
    cross: (at) => [['mount', at, 1], ['op', 1, 'link', at + '/readme', '/notes/readme'], ['op', 1, 'symlink', at + '/readme', '/notes/readme'], ['op', 1, 'rename', at + '/readme', '/notes/moved'], ['op', 1, 'rename', at + '/readme', at + '/photos/readme']],
  };
  S.topic({
    id: 'fs-mount', family: 'p14-mount', order: 10, title: 'Mounting a second file system',
    blurb: 'One namespace can span several file systems. Mounting one on a directory makes a lookup that reaches that directory carry on at the root of the other file system, hiding whatever the directory held. Inode numbers mean something only inside one file system, so a hard link or a rename cannot cross; and a file system with open files cannot be unmounted.',
    inputs: [
      { id: 'scen', kind: 'choice', label: 'what happens', def: 'tour', options: [{ value: 'tour', label: 'mount, look round, unmount' }, { value: 'busy', label: 'unmount with a file open' }, { value: 'cross', label: 'links and renames across' }] },
      { id: 'at', kind: 'choice', label: 'mount point', def: '/mnt', options: [{ value: '/mnt', label: '/mnt (holds a file of its own)' }, { value: '/notes', label: '/notes' }] },
    ],
    presets: [
      { label: 'Mount, look round, unmount', values: { scen: 'tour', at: '/mnt' } },
      { label: 'Busy: a file is open', values: { scen: 'busy', at: '/mnt' } },
      { label: 'Crossing: EXDEV', values: { scen: 'cross', at: '/mnt' } },
      { label: 'Mounted over /notes', values: { scen: 'tour', at: '/notes' } },
    ],
    counters: [{ id: 'mounts', label: 'mounted' }, { id: 'open', label: 'open files' }],
    run(inp) {
      const t = T(), u = U(), F2 = S.FS, img2 = stick();
      // the mount point is made last, so it is the rightmost name under the root, nearest the stick
      const mk = { '/notes': (sys) => { sys.op(1, 'mkdir', '/notes'); sys.op(1, 'create', '/notes/todo'); }, '/mnt': (sys) => { sys.op(1, 'mkdir', '/mnt'); sys.op(1, 'create', '/mnt/old'); } };
      const setup = (sys) => { for (const d of Object.keys(mk).filter((x) => x !== inp.at).concat([inp.at])) mk[d](sys); };
      const capture = (sys, img) => ({ t0: u.tree(img, '/'), t1: u.tree(img2, '/'), on: sys.devs.some((d) => d.dev === 1 && d.at) });
      const calls = SCEN[inp.scen](inp.at), run = u.runCalls(calls, { setup, capture, mounts: [img2] });
      const F = new S.Frames(['mounts', 'open']);
      const callText = (c) => (c[0] === 'mount' ? `mount(device 1, "${c[1]}")` : c[0] === 'umount' ? `umount("${c[1]}")` : c[0] === 'stat' ? `stat("${c[2]}")` : u.callText(c));
      const draw = (i, st, act0, act1) => {
        const items = [];
        const at = inp.at, under = (n) => n.path === at || n.path.startsWith(at + '/');
        const d0 = u.drawTree(st.t0, { prefix: 'mt:a', x: 0, y: 40, w: 420, levelH: 84, boxW: 104, gapX: 20, act: act0, cls: (n) => (st.on && under(n) && n.path !== at ? 'hidden14' : n.path === at && st.on ? 'mnt14' : '') });
        items.push(t.title('mt:at', 0, 14, 'the root file system (device 0)'));
        items.push(...d0.items);
        const RX = 470;
        const d1 = u.drawTree(st.t1, { prefix: 'mt:b', x: RX, y: 40, w: 316, levelH: 84, boxW: 100, gapX: 16, act: act1 });
        items.push(t.panel('mt:dv', RX - 14, 0, 344, 40 + d1.h + 22, 'dev14'), t.title('mt:bt', RX, 22, 'device 1: a USB stick'));
        items.push(...d1.items);
        if (st.on) {
          const mp = d0.pos.get(u.flat(st.t0).find((n) => n.path === inp.at).ino), r1 = d1.pos.get(1);
          items.push({ key: 'mt:link', kind: 'edge', from: 'mt:a:n' + u.flat(st.t0).find((n) => n.path === inp.at).ino, to: 'mt:b:n1', cls: 'tedge mnt', label: 'mounted on ' + inp.at, lx: R((mp.x + r1.x) / 2 - 30), ly: R((mp.y + r1.y) / 2 - 22), size: 13 });
        }
        // the calls and the open files
        const cy = 360;
        items.push(t.title('mt:ct', 0, cy, 'the calls'));
        calls.forEach((c, k) => items.push(t.text('mt:c' + k, 0, cy + 26 + k * 21, callText(c), 'calc mono' + (k === i ? ' act' : k > i ? ' muted' : ''), 13)));
        items.push(t.title('mt:ot', RX, cy, 'open files'));
        const files = st.snap ? st.snap.files : [];
        if (!files.length) items.push(t.text('mt:o0', RX, cy + 26, 'none', 'tick', 13));
        files.forEach((f, k) => items.push(t.text('mt:o' + k, RX, cy + 26 + k * 21, `entry ${f.id} → device ${f.dev}, inode ${f.ino}`, 'mono', 13)));
        return items;
      };
      const st0 = Object.assign({}, run.before, { snap: null });
      F.add({ items: draw(-1, st0, null, null), title: 'start', say: `Two file systems, each with its own root, inode 1. Device 1 is not reachable yet: no path leads into it. ${inp.at} holds ${inp.at === '/mnt' ? 'a file called old' : 'a file called todo'}.`, meta: { phase: 'start' } });
      run.out.forEach((c, i) => {
        const st = Object.assign({}, c.extra, { snap: c.snap }), key = c.steps.find((s) => s.kind === c.call || s.kind === c.args[1]) || c.steps[c.steps.length - 1];
        let say, a0 = null, a1 = null;
        if (c.err) say = `${callText([c.call, ...c.args])} fails with ${c.err.code}: ${c.err.message}${c.err.code === 'EXDEV' ? '. An inode number names a file only within its own device' : c.err.code === 'EBUSY' ? '. Close the files first' : ''}.`;
        else if (c.call === 'stat') { const r = c.result; say = `stat ${c.args[1]}: device ${r.dev}, inode ${r.ino}, a ${r.type} of ${r.size} bytes. ${r.dev ? `The lookup reached ${inp.at} and carried on at device 1’s root.` : `With nothing mounted, ${inp.at} is just a directory of device 0.`}`; if (r.dev) a1 = r.ino; else a0 = r.ino; }
        else { say = key ? key.say : callText([c.call, ...c.args]) + ' is done.'; if (c.call === 'open' && key) a1 = key.ino; }
        F.set('mounts', st.on ? 1 : 0).set('open', c.snap.files.length);
        F.add({ items: draw(i, st, a0, a1), title: c.call, say, meta: { phase: c.call, i, err: c.err, step: key, result: c.result, on: st.on, before: i ? run.out[i - 1].snap.files : [] } });
      });
      return { frames: F.list, def: { sections: [{ id: 'm', kind: 'math', title: 'Mounting', text: ['mount dev on dir: lookups reaching dir go on at dev’s root', 'what dir held is hidden, not lost', 'inode numbers are per device', 'link, rename across devices: EXDEV', 'a symbolic link may cross (it holds a path)', 'umount with open files: EBUSY'].join('\n') }] } };
    },
    predict: [
      { at: (f, i, fr) => fr[i + 1] && (fr[i + 1].meta.phase === 'umount' || (fr[i + 1].meta.phase === 'op' && fr[i + 1].meta.err !== undefined)) && f.meta.phase !== 'start', once: true, pick: 'option', ask: 'Will the next call succeed?', options: ['yes', 'no'], answer: (fr, i) => (fr[i + 1].meta.err ? 'no' : 'yes'), explain: (fr, i) => fr[i + 1].say },
    ],
    quiz: [
      { q: 'A directory with files in it is used as a mount point. Its files…', options: ['are hidden until the unmount, then visible again', 'are deleted', 'are copied to the new file system', 'appear beside the new ones'], answer: 0, why: 'The lookup simply goes elsewhere; nothing on the old directory changes.' },
      { q: 'Why can a hard link not point from one file system into another?', options: ['a directory entry holds an inode number, which means something only in its own file system', 'it would be too slow', 'links need root', 'the names are too long'], answer: 0, why: 'Inode 5 on one device and inode 5 on another are different files.' },
      { q: 'umount fails with EBUSY. Why?', options: ['some process still has a file open on it (or is in a directory on it)', 'the disk is full', 'it was never mounted', 'it is read-only'], answer: 0, why: 'The kernel will not pull a file system out from under an open file.' },
      { q: 'Which can name a file on another mounted file system?', options: ['a symbolic link', 'a hard link', 'neither', 'only a rename'], answer: 0, why: 'It stores a path, looked up afresh each time.' },
    ],
  });

  // =================================================================================================================
  const WANTS = [{ value: 'r', label: 'read' }, { value: 'w', label: 'write' }, { value: 'rw', label: 'read and write' }];
  const octal = (v) => (/^[0-7]{3}$/.test(v) ? null : 'three octal digits, such as 640');
  S.topic({
    id: 'fs-permissions', family: 'p14-mount', order: 20, title: 'Permission bits: who may do what',
    blurb: 'Every inode has an owner, a group and nine bits: read, write and execute for the owner, for the group and for everyone else. The kernel picks exactly one of the three sets (the owner’s if the process’s user owns the file, else the group’s if it is in the group, else the others’) and checks the bits it needs. To reach the file at all, every directory on the path must grant search (x). The superuser, uid 0, passes every check.',
    inputs: [
      { id: 'mode', kind: 'string', label: 'file mode', def: '640', min: 3, max: 3, check: octal },
      { id: 'dmode', kind: 'string', label: 'directory /proj mode', def: '751', min: 3, max: 3, check: octal },
      { id: 'owner', kind: 'number', label: 'file owner uid', def: 10, min: 0, max: 99 },
      { id: 'group', kind: 'number', label: 'file group gid', def: 20, min: 0, max: 99 },
      { id: 'uid', kind: 'number', label: 'process uid', def: 11, min: 0, max: 99 },
      { id: 'gid', kind: 'number', label: 'process gid', def: 20, min: 0, max: 99 },
      { id: 'want', kind: 'choice', label: 'opens it to', def: 'r', options: WANTS },
    ],
    presets: [
      { label: 'A group member reads', values: { mode: '640', dmode: '751', owner: 10, group: 20, uid: 11, gid: 20, want: 'r' } },
      { label: 'A group member writes', values: { mode: '640', dmode: '751', owner: 10, group: 20, uid: 11, gid: 20, want: 'w' } },
      { label: 'The owner writes', values: { mode: '640', dmode: '751', owner: 10, group: 20, uid: 10, gid: 20, want: 'rw' } },
      { label: 'A stranger reads', values: { mode: '640', dmode: '751', owner: 10, group: 20, uid: 30, gid: 30, want: 'r' } },
      { label: 'The owner shut out by its own bits', values: { mode: '044', dmode: '755', owner: 10, group: 20, uid: 10, gid: 20, want: 'r' } },
      { label: 'No search on the directory', values: { mode: '644', dmode: '750', owner: 10, group: 20, uid: 30, gid: 30, want: 'r' } },
      { label: 'Root passes', values: { mode: '000', dmode: '700', owner: 10, group: 20, uid: 0, gid: 0, want: 'rw' } },
    ],
    counters: [{ id: 'checks', label: 'checks' }],
    run(inp) {
      const t = T(), u = U(), F2 = S.FS, mode = parseInt(inp.mode, 8), dmode = parseInt(inp.dmode, 8);
      const setup = (sys) => { sys.op(1, 'mkdir', '/proj'); sys.op(1, 'create', '/proj/plan'); sys.op(1, 'write', '/proj/plan', 0, 'secret plan'); sys.op(1, 'chown', '/proj/plan', inp.owner, inp.group); sys.op(1, 'chmod', '/proj/plan', mode); sys.op(1, 'chown', '/proj', inp.owner, inp.group); sys.op(1, 'chmod', '/proj', dmode); };
      const run = u.runCalls([['proc', 2, inp.uid, inp.gid], ['open', 2, '/proj/plan', inp.want]], { setup });
      const res = run.out[1], img = run.img, cred = { uid: inp.uid, gid: inp.gid };
      const dIno = F2.lookup(img, '/proj').ino, fIno = F2.lookup(img, '/proj/plan').ino;
      const tx = new F2.Tx(img), dn = tx.inode(dIno), fn = tx.inode(fIno);
      const cls = (n) => (inp.uid === 0 ? 'root' : inp.uid === n.uid ? 'owner' : inp.gid === n.gid ? 'group' : 'others');
      const canSearch = F2.can(dn, cred, 1), want = (inp.want.includes('r') ? 4 : 0) + (inp.want.includes('w') ? 2 : 0), canFile = F2.can(fn, cred, want);
      const F = new S.Frames(['checks']);
      const strip = (key, x, y, title, n, setIdx, bits) => {
        const items = [t.text(key + ':t', x, y - 10, title, 'strong', 14)];
        const groups = ['owner', 'group', 'others'];
        groups.forEach((g, gi) => {
          items.push(t.text(key + ':g' + gi, x + gi * 132 + 60, y + 58, g + (gi === 0 ? ' (uid ' + n.uid + ')' : gi === 1 ? ' (gid ' + n.gid + ')' : ''), 'tick', 13, 'middle'));
          'rwx'.split('').forEach((c, ci) => {
            const on = (n.mode >> (8 - (gi * 3 + ci))) & 1, chk = setIdx === gi && bits.includes(c);
            const verdict = chk ? (on ? ' on act' : ' deny') : on ? ' on' : ' off';
            items.push({ key: key + ':b' + gi + ci, kind: 'cell', x: x + gi * 132 + ci * 40, y, w: 36, h: 36, rx: 5, text: on ? c : '-', size: 16, cls: 'pb' + verdict + (setIdx !== gi && setIdx !== -1 ? ' faded' : '') });
          });
        });
        return items;
      };
      const card = [t.title('pm:pt', 470, 36, 'the process'), t.text('pm:pu', 470, 64, 'uid ' + inp.uid + ', gid ' + inp.gid + (inp.uid === 0 ? ' (root)' : ''), 'mono', 14), t.text('pm:pw', 470, 90, 'opens /proj/plan to ' + WANTS.find((w) => w.value === inp.want).label, 'calc mono', 14)];
      const gIdx = (n) => ({ owner: 0, group: 1, others: 2, root: -1 }[cls(n)]);
      const draw = (stage) => {
        const items = [...card];
        items.push(...strip('pm:d', 0, 40, 'directory /proj · mode ' + F2.modeString(dmode), dn, stage >= 1 ? gIdx(dn) : -1, stage >= 1 ? 'x' : ''));
        items.push(...strip('pm:f', 0, 160, 'file /proj/plan · mode ' + F2.modeString(mode), fn, stage >= 2 ? gIdx(fn) : -1, stage >= 2 ? inp.want : ''));
        if (stage >= 3) items.push(t.text('pm:res', 470, 150, res.err ? '✗ ' + res.err.code : '✓ opened: descriptor ' + res.result, res.err ? 'bad14' : 'good14', 16));
        return items;
      };
      F.add({ items: draw(0), title: 'the bits', say: `/proj/plan has mode ${F2.modeString(mode)} (${inp.mode}), owner uid ${inp.owner}, group gid ${inp.group}; /proj has mode ${F2.modeString(dmode)}. Process 2 runs as uid ${inp.uid}, gid ${inp.gid}.`, meta: { phase: 'start' } });
      F.set('checks', 1);
      const dc = cls(dn);
      F.add({ items: draw(1), title: 'search /proj', say: inp.uid === 0 ? 'To reach plan, the lookup must search /proj. Process 2 is root, uid 0: no bit is checked.' : `To reach plan, the lookup must search /proj: for uid ${inp.uid} the ${dc === 'others' ? 'others’' : dc === 'owner' ? 'owner’s' : 'group’s'} bits apply, ${F2.modeString(dmode).slice(...(dc === 'owner' ? [0, 3] : dc === 'group' ? [3, 6] : [6, 9]))}, and x is ${canSearch ? 'set: search allowed' : 'clear: the lookup stops here'}.`, meta: { phase: 'dir', ok: canSearch } });
      if (canSearch) {
        F.set('checks', 2);
        const fc = cls(fn), bits = F2.modeString(mode).slice(...(fc === 'owner' ? [0, 3] : fc === 'group' ? [3, 6] : [6, 9]));
        F.add({ items: draw(2), title: 'the file', say: inp.uid === 0 ? 'Root again: the file’s bits are not consulted.' : `On the file, ${fc === 'owner' ? `uid ${inp.uid} owns it, so only the owner’s bits count` : fc === 'group' ? `uid ${inp.uid} is not the owner but gid ${inp.gid} is the file’s group, so the group’s bits count` : 'the process is neither the owner nor in the group, so the others’ bits count'}: ${bits}. ${WANTS.find((w) => w.value === inp.want).label} needs ${inp.want.split('').join(' and ')}: ${canFile ? 'granted' : 'refused'}.`, meta: { phase: 'file', ok: canFile } });
      }
      F.add({ items: draw(3), title: res.err ? 'refused' : 'opened', say: res.err ? `open fails with ${res.err.code}: ${res.err.message}` : (res.steps.find((s) => s.kind === 'open') || {}).say, meta: { phase: 'end', err: res.err, step: res.steps.find((s) => s.kind === 'open') || null, result: res.result } });
      return { frames: F.list, def: { sections: [{ id: 'p', kind: 'math', title: 'The check', text: ['uid 0: allowed', 'uid = owner: the owner’s rwx', 'else gid = group: the group’s rwx', 'else: the others’ rwx', 'only one set is used, even if another would allow', 'every directory on the path needs x (search)', 'r on a directory: list its names; w: add and remove them'].join('\n') }] } };
    },
    predict: [
      { at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'Will process 2 be able to open the file?', options: ['yes', 'no'], answer: (fr) => (fr[fr.length - 1].meta.err ? 'no' : 'yes'), explain: (fr) => fr[fr.length - 1].say },
    ],
    quiz: [
      { q: 'Mode 640, owner alice, group staff. Bob is in staff. Can bob write?', options: ['no: the group bits are r--', 'yes', 'only if alice is logged in', 'yes, because the owner can'], answer: 0, why: '640 is rw- r-- ---; bob gets the group’s r--.' },
      { q: 'Mode 044 on a file the process owns. Can it read the file?', options: ['no: the owner’s set (---) is used, even though group and others may read', 'yes', 'only through the group', 'only as root'], answer: 0, why: 'The kernel picks one set and does not fall through to the others.' },
      { q: 'What does x on a directory allow?', options: ['passing through it in a path lookup (search)', 'running it', 'listing its names', 'deleting it'], answer: 0, why: 'Without x, no name inside can be reached, even one whose own bits allow it.' },
      { q: 'Which octal mode is rwxr-x---?', options: ['750', '755', '640', '570'], answer: 0, why: 'rwx = 7, r-x = 5, --- = 0.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
