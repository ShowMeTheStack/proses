// Part 18, virtualising I/O (virt-c-io.js): the path a request takes with an emulated device, a paravirtual ring and
// a device passed straight through, the three compared in exits and copies, and a virtual machine against a container
// counted in crossings.
(function (S) {
  'use strict';
  const H = S.P09, V = () => S.Virt;
  // where each box of a path sits: column 0 the guest, column 1 the host side
  const POS = { 'guest app': [0, 0], 'guest kernel': [0, 1], 'guest driver': [0, 2], 'paravirtual driver': [0, 2], 'real driver': [0, 2], 'shared ring': [0, 3], 'guest memory': [0, 4], 'VMM device model': [1, 2], 'host back end': [1, 2], 'host kernel': [1, 3], 'real device': [1, 4] };
  const POSP = { 'real device': [1, 2], 'guest memory': [0, 3] };
  const HOPS = { emulated: { driver: [1], exit: [2], host: [3, 4], inject: [5] }, paravirtual: { ring: [2], notify: [3], host: [4], inject: [5] }, passthrough: { assign: [2], dma: [3], irq: [4] } };
  const MODES = [{ value: 'emulated', label: 'an emulated device' }, { value: 'paravirtual', label: 'a paravirtual ring' }, { value: 'passthrough', label: 'a device passed through' }];

  S.topic({
    id: 'virt-io-paths', family: 'p18-io', order: 10, title: 'The path of an I/O request',
    blurb: 'An emulated device lets an unchanged guest driver run: it touches device registers that do not exist, and every touch exits to the monitor, whose model of the device does the real I/O through the host. A paravirtual driver knows it is in a virtual machine: it puts requests in a ring of memory shared with the host and notifies it once per batch. A device passed through belongs to the guest alone: the guest drives the real hardware, and an I/O memory-management unit keeps its transfers inside the guest\'s memory.',
    inputs: [
      { id: 'mode', kind: 'choice', label: 'Device', def: 'emulated', options: MODES },
      { id: 'n', kind: 'number', label: 'Requests', def: 8, min: 1, max: 64 },
      { id: 'regs', kind: 'number', label: 'Register touches per request', def: 4, min: 1, max: 8 },
      { id: 'batch', kind: 'number', label: 'Requests per notification', def: 8, min: 1, max: 32 },
      { id: 'posted', kind: 'choice', label: 'Posted interrupts', def: 'yes', options: [{ value: 'yes', label: 'yes' }, { value: 'no', label: 'no' }] },
    ],
    presets: [
      { label: 'Emulated, 8 requests', values: { mode: 'emulated', n: 8, regs: 4 } },
      { label: 'Paravirtual, batches of 8', values: { mode: 'paravirtual', n: 8, batch: 8 } },
      { label: 'Paravirtual, one at a time', values: { mode: 'paravirtual', n: 8, batch: 1 } },
      { label: 'Passed through', values: { mode: 'passthrough', n: 8, posted: 'yes' } },
      { label: 'Passed through, no posted interrupts', values: { mode: 'passthrough', n: 8, posted: 'no' } },
    ],
    counters: [{ id: 'exits', label: 'VM exits' }, { id: 'inj', label: 'injected interrupts' }, { id: 'copies', label: 'copies' }],
    run(inp) {
      const R = V().ioPath(inp.mode, { requests: inp.n, regs: inp.regs, batch: inp.batch, posted: inp.posted === 'yes' }), F = new S.Frames(['exits', 'inj', 'copies']);
      const names = [...new Set(R.hops.flatMap((h) => [h.from, h.to]))];
      const at = (nm) => { const p = (inp.mode === 'passthrough' && POSP[nm]) || POS[nm]; return { x: 120 + p[0] * 430, y: 50 + p[1] * 88 }; };
      const pic = (lit) => {
        const items = [H.title('gs', 20, 0, 'guest'), H.title('hs', 450, 0, 'host and hardware')];
        names.forEach((nm) => { const p = at(nm); items.push({ key: 'n:' + nm, kind: 'cell', x: p.x - 100, y: p.y, w: 200, h: 40, rx: 8, text: nm, size: 14, cls: 'layer ' + (POS[nm][0] ? (nm === 'real device' ? 'hw' : 'host') : 'guest') + (lit && R.hops.some((h, k) => lit.includes(k) && (h.from === nm || h.to === nm)) ? ' act' : '') }); });
        R.hops.forEach((h, k) => {
          const a = at(h.from), b = at(h.to), up = b.y < a.y, side = a.x !== b.x;
          const e = { key: 'h' + k, kind: 'edge', from: 'n:' + h.from, to: 'n:' + h.to, cls: 'hop' + (lit && lit.includes(k) ? ' act' : ''), label: h.how, size: 13 };
          const w = S.geom.textWidth(h.how, 13);
          if (!side) { e.lx = Math.round(a.x + (POS[h.from][0] ? 1 : -1) * (12 + w / 2)); e.ly = Math.round((a.y + b.y) / 2 + 24); }
          else { const my = (a.y + b.y) / 2 + 20; e.lx = Math.round((a.x + b.x) / 2 + 20); e.ly = Math.round(up ? my - 36 : b.y > a.y ? my + 32 : my - 12); }
          items.push(e);
        });
        return items;
      };
      const all = R.hops.map((_, k) => k), first = [0];
      F.add({ items: pic(first), say: `${inp.n === 1 ? 'A request' : inp.n + ' requests'} from a guest program through ${MODES.find((m) => m.value === inp.mode).label}. Each starts as a system call into the guest kernel.`, meta: { phase: 'start', n: inp.n } });
      R.steps.forEach((st, k) => {
        const last = st.kind === 'total';
        if (last) F.set('exits', R.exits).set('inj', R.injections).set('copies', R.copies);
        F.add({ items: pic(last ? all : HOPS[inp.mode][st.kind] || []), say: st.say, meta: { phase: st.kind, k, exits: R.exits, inj: R.injections, copies: R.copies, per: R.perRequest, regs: inp.regs, batch: inp.batch, batches: Math.ceil(inp.n / inp.batch), n: inp.n }, title: st.kind });
      });
      F.last().hold = 2500;
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Three designs', text: ['emulated: unchanged driver, an exit per register touch', 'paravirtual: a shared ring, one exit per batch', 'passthrough: the real device, no exit per request;', '  the IOMMU confines its DMA to the guest', '  but the device cannot be shared or moved easily'].join('\n') }] } };
    },
    predict: [{ at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'How many VM exits will these requests cost?', options: (fr) => [...new Set(['0', String(fr[fr.length - 1].meta.batches), String(fr[0].meta.n), String(fr[fr.length - 1].meta.exits), String(fr[0].meta.n * 5)])].sort((a, b) => a - b), answer: (fr) => String(fr[fr.length - 1].meta.exits), explain: (fr) => fr[fr.length - 1].say }],
    quiz: [
      { q: 'Why is an emulated device slow?', options: ['every register access by the guest driver is a VM exit', 'it copies the disk', 'it runs on another machine', 'it disables the TLB'], answer: 0, why: 'Device drivers touch registers many times per request.' },
      { q: 'A paravirtual driver differs from an ordinary one in that it…', options: ['knows it runs in a VM and talks to the host through a shared ring', 'drives the real hardware', 'never needs the host', 'runs in the monitor'], answer: 0, why: 'It trades portability for far fewer exits.' },
      { q: 'With a device passed through, what stops it writing into another guest\'s memory?', options: ['the IOMMU translates and checks its DMA', 'nothing', 'the guest driver', 'the TLB'], answer: 0, why: 'Device transfers are confined to the memory the IOMMU maps for that guest.' },
      { q: 'The price of passing a device through is…', options: ['the device serves one guest and is hard to move with it', 'more exits', 'more copies', 'a slower CPU'], answer: 0, why: 'It belongs to that guest alone.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'virt-io-compare', family: 'p18-io', order: 20, title: 'Emulated, paravirtual, passed through: the counts',
    blurb: 'The same requests through each of the three designs, counted: VM exits (each a trip into the monitor and back), interrupts injected into the guest, and copies of the data. Batching moves a paravirtual ring towards one exit for many requests; passing the device through removes the monitor from the path altogether.',
    inputs: [
      { id: 'n', kind: 'number', label: 'Requests', def: 16, min: 1, max: 64 },
      { id: 'batch', kind: 'number', label: 'Requests per notification', def: 8, min: 1, max: 32 },
      { id: 'regs', kind: 'number', label: 'Register touches per request', def: 4, min: 1, max: 8 },
    ],
    presets: [{ label: '16 requests, batches of 8', values: { n: 16, batch: 8, regs: 4 } }, { label: 'One request', values: { n: 1, batch: 1, regs: 4 } }, { label: '64 requests, batches of 32', values: { n: 64, batch: 32, regs: 6 } }],
    counters: [],
    run(inp) {
      const R = V().compareIO({ requests: inp.n, batch: inp.batch, regs: inp.regs }), F = new S.Frames([]);
      const metrics = [['exits', 'VM exits'], ['injections', 'injected interrupts'], ['copies', 'copies of the data']];
      const max = Math.max(1, ...R.flatMap((r) => metrics.map(([m]) => r[m])));
      const bars = (upto) => {
        const items = [H.title('tt', 0, 6, inp.n + ' requests')];
        metrics.forEach(([m, name], i) => {
          const y0 = 34 + i * 140;
          items.push(H.text('mn' + i, 0, y0 + 14, name, 'strong', 15));
          R.slice(0, upto).forEach((r, k) => {
            const w = Math.max(3, Math.round((r[m] / max) * 460)), y = y0 + 26 + k * 34;
            items.push(H.text('bl' + i + k, 0, y + 19, MODES[k].label, '', 14), { key: 'bb' + i + k, kind: 'cell', x: 200, y, w, h: 26, rx: 3, text: '', cls: 'bar ' + ['neg', 'c0', 'pos'][k] }, H.text('bv' + i + k, 200 + w + 8, y + 19, String(r[m]), 'mono', 14));
          });
        });
        return items;
      };
      F.add({ items: bars(0), say: `${H.plural(inp.n, 'request')}, each touching the device's registers ${H.plural(inp.regs, 'time')} when emulated, or sent ${inp.batch} to a notification when paravirtual.`, meta: { phase: 'start' } });
      R.forEach((r, k) => F.add({ items: bars(k + 1), say: `${H.cap(MODES[k].label)}: ${H.plural(r.exits, 'VM exit')} (${r.perRequest} per request), ${H.plural(r.injections, 'injected interrupt')}, ${H.plural(r.copies, 'copy', 'copies')}.`, meta: { phase: 'mode', k, mode: r.mode, exits: r.exits, inj: r.injections, copies: r.copies, per: r.perRequest }, title: r.mode }));
      F.add({ items: bars(3), say: `From ${R[0].exits} exits to ${R[1].exits} to ${R[2].exits}: each step removes the monitor from more of the path, and each gives something up: the unchanged driver, then the ability to share and move the device.`, meta: { phase: 'end', e: R.map((r) => r.exits) }, title: 'compare', hold: 2500 });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Counts for n requests', text: ['emulated: exits = n × (registers + 1)', 'paravirtual: exits = ⌈n / batch⌉', 'passthrough: exits = 0 with posted interrupts', 'copies: 2n, n, 0'].join('\n') }] } };
    },
    predict: [{ at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'How many exits will the paravirtual ring need?', options: (fr) => [...new Set([String(fr[2].meta.exits), String(fr[1].meta.exits), '1', '0'])], answer: (fr) => String(fr[2].meta.exits), explain: (fr) => fr[2].say }],
    quiz: [
      { q: 'Emulated: 10 requests, 4 register touches each, plus one acknowledgement each. Exits?', options: ['50', '10', '4', '14'], answer: 0, why: '10 × (4 + 1).' },
      { q: 'Paravirtual: 20 requests in batches of 8. Notifications?', options: ['3', '20', '8', '1'], answer: 0, why: '⌈20 / 8⌉ = 3.' },
      { q: 'Why does batching help?', options: ['one exit carries many requests', 'it makes each request smaller', 'it removes the ring', 'it disables interrupts'], answer: 0, why: 'The fixed cost of an exit is shared.' },
      { q: 'Which design needs the guest\'s driver to be changed?', options: ['paravirtual', 'emulated', 'passthrough', 'none'], answer: 0, why: 'It must know about the ring; the other two use ordinary drivers.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  S.topic({
    id: 'virt-vm-container', family: 'p18-io', order: 30, title: 'A virtual machine against a container',
    blurb: 'A container is not a machine: it is ordinary processes on the host\'s own kernel, shown a private view of files, processes and network. A system call from a container costs what it costs a native process. A virtual machine has a kernel of its own on top of the monitor: a call goes into the guest kernel, whose driver then reaches the host with exits. The container is cheaper; the virtual machine isolates more, since the containers all share one kernel and a flaw in it reaches them all.',
    inputs: [{ id: 'io', kind: 'choice', label: 'The VM\'s device', def: 'paravirtual', options: MODES }, { id: 'n', kind: 'number', label: 'Reads', def: 1, min: 1, max: 8 }],
    presets: [{ label: 'One read, paravirtual', values: { io: 'paravirtual', n: 1 } }, { label: 'Four reads, emulated', values: { io: 'emulated', n: 4 } }, { label: 'One read, passed through', values: { io: 'passthrough', n: 1 } }],
    counters: [],
    run(inp) {
      const R = V().crossings({ op: 'read', io: inp.io, requests: inp.n }), F = new S.Frames([]);
      const STACKS = [['app', 'host kernel', 'hardware'], ['app (in namespaces)', 'host kernel', 'hardware'], ['app', 'guest kernel', 'monitor', 'host kernel', 'hardware']];
      const CLS = { app: 'guest', 'app (in namespaces)': 'ns', 'guest kernel': 'guest', monitor: 'host', 'host kernel': 'host', hardware: 'hw' };
      const col = (k, lit) => {
        const x = k * 270, items = [H.title('st' + k, x, 6, R.rows[k].setup)];
        STACKS[k].forEach((nm, j) => items.push({ key: 's' + k + '_' + j, kind: 'cell', x, y: 24 + j * 62, w: 230, h: 40, rx: 8, text: nm, size: 14, cls: 'layer ' + CLS[nm] + (lit ? ' act' : '') }));
        for (let j = 0; j + 1 < STACKS[k].length - 1; j++) items.push({ key: 'e' + k + '_' + j, kind: 'edge', from: 's' + k + '_' + j, to: 's' + k + '_' + (j + 1), cls: lit ? 'act' : '' });
        const r = R.rows[k];
        if (lit !== undefined) items.push(H.text('c' + k + 'a', x, 24 + 5 * 62 + 10, H.plural(r.modeSwitches, 'mode switch', 'mode switches'), 'strong', 14), H.text('c' + k + 'b', x, 24 + 5 * 62 + 34, H.plural(r.exits, 'VM exit'), r.exits ? 'hot' : 'good', 14), H.text('c' + k + 'c', x, 24 + 5 * 62 + 58, r.kernels === 1 ? 'one kernel, shared' : r.kernels + ' kernels on the path', 'strong', 14));
        return items;
      };
      const pic = (upto, lit) => [0, 1, 2].flatMap((k) => col(k, k < upto ? (k === lit) : undefined));
      F.add({ items: pic(0, -1), say: `${H.plural(inp.n, 'file read')}, the same in each setting: a native process, a container, and a virtual machine with ${MODES.find((m) => m.value === inp.io).label}.`, meta: { phase: 'start', n: inp.n } });
      R.steps.forEach((st, k) => { if (st.kind === 'row') F.add({ items: pic(k + 1, k), say: st.say, meta: { phase: 'row', k, sw: st.row.modeSwitches, exits: st.row.exits, kernels: st.row.kernels, perCall: 2 }, title: st.row.setup }); });
      F.add({ items: pic(3, -1), say: H.plain(R.steps[R.steps.length - 1].say), meta: { phase: 'end' }, title: 'compare', hold: 2500 });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Two kinds of isolation', text: ['container: processes on the host kernel,', '  with namespaces and control groups', '  cheap; one kernel shared by all', 'virtual machine: a guest kernel on a monitor', '  dearer (exits); its own kernel'].join('\n') }] } };
    },
    predict: [{ at: (f) => f.meta.phase === 'start', pick: 'option', ask: 'Which setting will need VM exits?', options: ['only the virtual machine', 'the container and the virtual machine', 'all three', 'none'], answer: (fr) => (fr.some((f) => f.meta.phase === 'row' && f.meta.k === 2 && f.meta.exits > 0) ? 'only the virtual machine' : 'none'), explain: (fr) => fr[fr.length - 1].say }],
    quiz: [
      { q: 'A system call from inside a container goes to…', options: ['the host\'s own kernel', 'a guest kernel', 'the monitor', 'a separate machine'], answer: 0, why: 'A container is a set of host processes with a narrowed view.' },
      { q: 'Why is a flaw in the kernel more serious for containers than for virtual machines?', options: ['all containers share the one kernel', 'containers have no kernel', 'virtual machines share their kernel', 'it is not'], answer: 0, why: 'Each virtual machine has its own kernel behind the monitor.' },
      { q: 'Which starts faster?', options: ['a container: it is only processes', 'a virtual machine: it boots a kernel', 'they are the same', 'neither can start'], answer: 0, why: 'Nothing has to boot.' },
      { q: 'Can a container run a different operating-system kernel from its host?', options: ['no: it uses the host\'s kernel', 'yes, always', 'only with more memory', 'only on weekends'], answer: 0, why: 'For a different kernel you need a virtual machine.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
