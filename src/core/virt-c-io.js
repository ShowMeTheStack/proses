// Virtual machines, part 3: I/O virtualisation as path models, and a virtual machine against a container counted
// in crossings.
//   S.Virt.ioPath(mode, {requests: 8, regs: 4, batch: 8, posted: true})
//       mode 'emulated': the guest's ordinary driver touches a device that does not exist; each of its `regs`
//         register accesses per request exits to the VMM's device model, which does the real I/O through the
//         host, and a virtual interrupt is injected when it is done.
//       mode 'paravirtual': the guest knows it is virtual; its driver puts requests in a ring shared with the
//         host and notifies the host once per `batch` (one exit), and the host interrupts once per batch.
//       mode 'passthrough': the device is given to the guest; the IOMMU translates its DMA to the guest's memory,
//         so the guest drives it directly; with posted interrupts even completions need no exit.
//       -> {hops: [{from, to, how}], steps, exits, injections, copies, perRequest, mode}
//   S.Virt.compareIO(o) -> [{mode, exits, injections, copies, perRequest}] for the three modes
//   S.Virt.crossings({op: 'read', io: 'paravirtual', requests: 1})
//       -> {rows: [{setup, modeSwitches, exits, kernels, say}], steps}: one file read from a native process, a
//          container (the host's own kernel, behind namespaces) and a virtual machine (its own kernel on top).
(function (S) {
  'use strict';
  const V = (S.Virt = S.Virt || {});
  const pl = (n, w, ws) => n + ' ' + (n === 1 ? w : ws || w + 's');

  V.ioPath = function (mode, o) {
    o = o || {};
    const n = Math.max(1, o.requests || 8), regs = Math.max(1, o.regs || 4), batch = Math.max(1, o.batch || 8), posted = o.posted !== false;
    const steps = [], hops = [];
    let exits = 0, injections = 0, copies = 0;
    const hop = (from, to, how) => hops.push({ from, to, how });
    if (mode === 'emulated') {
      hop('guest app', 'guest kernel', 'system call'); hop('guest kernel', 'guest driver', 'call'); hop('guest driver', 'VMM device model', 'VM exit per register access');
      hop('VMM device model', 'host kernel', 'system call'); hop('host kernel', 'real device', 'host driver'); hop('VMM device model', 'guest kernel', 'virtual interrupt');
      exits = n * regs + n; injections = n; copies = 2 * n;
      steps.push({ kind: 'driver', say: 'The guest\'s unchanged driver programs a device that is only imitated: each request touches ' + regs + ' device registers.' });
      steps.push({ kind: 'exit', say: 'Every register access exits to the VMM, whose device model works out what a real device would do: ' + pl(regs, 'exit') + ' per request.' });
      steps.push({ kind: 'host', say: 'The device model does the real I/O through the host kernel and copies the data into guest memory.' });
      steps.push({ kind: 'inject', say: 'It injects a virtual interrupt; the guest\'s handler acknowledges it with one more register access, one more exit.' });
    } else if (mode === 'paravirtual') {
      hop('guest app', 'guest kernel', 'system call'); hop('guest kernel', 'paravirtual driver', 'call'); hop('paravirtual driver', 'shared ring', 'memory write');
      hop('paravirtual driver', 'host back end', 'one notify exit per batch'); hop('host back end', 'real device', 'host driver'); hop('host back end', 'guest kernel', 'one interrupt per batch');
      const batches = Math.ceil(n / batch);
      exits = batches; injections = batches; copies = n;
      steps.push({ kind: 'ring', say: 'The guest\'s paravirtual driver knows it is in a virtual machine: it writes request descriptors into a ring shared with the host, an ordinary memory write.' });
      steps.push({ kind: 'notify', say: 'After every ' + (batch === 1 ? 'request' : batch + ' requests') + ' it notifies the host once (one exit): ' + pl(batches, 'notification') + ' for ' + pl(n, 'request') + '.' });
      steps.push({ kind: 'host', say: 'The host back end takes the requests off the ring and does them; the data goes straight into the guest buffers the descriptors name.' });
      steps.push({ kind: 'inject', say: 'One interrupt per batch tells the guest the ring has completions.' });
    } else if (mode === 'passthrough') {
      hop('guest app', 'guest kernel', 'system call'); hop('guest kernel', 'real driver', 'call'); hop('real driver', 'real device', 'direct register access'); hop('real device', 'guest memory', 'DMA through the IOMMU');
      hop('real device', 'guest kernel', posted ? 'posted interrupt' : 'interrupt through the VMM');
      exits = posted ? 0 : n; injections = posted ? 0 : n; copies = 0;
      steps.push({ kind: 'assign', say: 'The device belongs to this guest alone; its registers are mapped straight into the guest.' });
      steps.push({ kind: 'dma', say: 'The device writes into guest memory by DMA; the IOMMU translates its guest-physical addresses to host ones and stops it reaching any other memory.' });
      steps.push({ kind: 'irq', say: posted ? 'Completions arrive as posted interrupts, delivered into the guest with no exit.' : 'Completions arrive at the host, which injects them into the guest: one exit each.' });
      steps.push({ kind: 'cost', say: 'The price: the device cannot be shared or easily moved with the guest to another machine.' });
    } else throw new Error('unknown I/O mode ' + mode);
    const perRequest = Math.round((exits / n) * 100) / 100;
    steps.push({ kind: 'total', say: mode[0].toUpperCase() + mode.slice(1) + ' I/O, ' + pl(n, 'request') + ': ' + pl(exits, 'VM exit') + ' (' + perRequest + ' per request), ' + pl(injections, 'injected interrupt') + ', ' + pl(copies, 'data copy', 'data copies') + '.' });
    return { hops, steps, exits, injections, copies, perRequest, mode };
  };
  V.compareIO = (o) => ['emulated', 'paravirtual', 'passthrough'].map((m) => { const r = V.ioPath(m, o); return { mode: m, exits: r.exits, injections: r.injections, copies: r.copies, perRequest: r.perRequest }; });

  V.crossings = function (o) {
    o = o || {};
    const op = o.op || 'read', io = o.io || 'paravirtual', n = Math.max(1, o.requests || 1);
    const vio = V.ioPath(io, { requests: n, batch: o.batch || 1, regs: o.regs || 4 });
    const rows = [
      { setup: 'native process', modeSwitches: 2 * n, exits: 0, kernels: 1, say: 'A native process: ' + op + '() traps into the kernel and returns, 2 mode switches.' },
      { setup: 'container', modeSwitches: 2 * n, exits: 0, kernels: 1, say: 'A container: the same host kernel, the same 2 mode switches; the namespaces only change which files, processes and network the process sees.' },
      { setup: 'virtual machine (' + io + ' I/O)', modeSwitches: 2 * n, exits: vio.exits, kernels: 2, say: 'A virtual machine: ' + op + '() traps into the guest kernel (2 mode switches inside the guest), whose driver then reaches the host with ' + pl(vio.exits, 'VM exit') + ' (' + io + '): two kernels on the path.' },
    ];
    const steps = rows.map((r) => ({ kind: 'row', say: r.say, row: r }));
    steps.push({ kind: 'result', say: 'Containers cost no more than native processes per call but share one kernel, so a kernel bug reaches them all; a virtual machine has its own kernel, stronger isolation, and pays for it in exits.' });
    return { rows, steps };
  };
})(globalThis.Proses = globalThis.Proses || {});
