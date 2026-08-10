// Goal-seek (simultaneous admittance adjustment) configuration, run
// control, history table and apply/revert actions.
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) node.appendChild(child);
  return node;
}

function fmt(v, digits = 5) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const abs = Math.abs(v);
  return abs !== 0 && (abs < 0.001 || abs >= 100000) ? v.toExponential(digits) : v.toFixed(digits);
}

/**
 * Goal Seek is displayed/edited entirely in mass flow (kg/s) -- more
 * intuitive for thermal/process work than volumetric flow -- while the
 * solver core (optimize.js) stays in m³/s throughout, exactly like
 * resultsPanel.js/inspector.js/csvExport.js's existing volumetric<->mass
 * display conversion. Uniform network-wide fluid density (network.fluid.density)
 * makes this an exact, lossless conversion at the UI boundary, so nothing
 * in the solver, save format, or other examples needs to change.
 */
function massFlow(density, volumetricFlow) {
  return Number.isFinite(volumetricFlow) && Number.isFinite(density) ? density * volumetricFlow : null;
}
function volumetricFlow(density, mass) {
  return Number.isFinite(mass) && density > 0 ? mass / density : mass;
}

const ADJUSTABLE_TYPES = new Set(['pipe', 'valve', 'heatExchanger']);

export function initGoalSeekPanel(container, store) {
  store.subscribe((state) => render(state));
  render(store.state);

  function targetRow(network, target, index) {
    const select = el('select');
    for (const e of network.elements) {
      const o = el('option', { value: e.id, text: `${e.name} (${e.type})` });
      if (e.id === target.elementId) o.selected = true;
      select.appendChild(o);
    }
    select.addEventListener('change', () => updateTargets(index, { elementId: select.value }));

    const density = network.fluid.density;
    const flowInput = el('input', { type: 'number', step: 'any' });
    flowInput.value = massFlow(density, target.targetFlow ?? 0) ?? 0;
    flowInput.addEventListener('change', () => updateTargets(index, { targetFlow: volumetricFlow(density, Number(flowInput.value)) }));

    const removeBtn = el('button', { type: 'button', class: 'ns-btn-small', text: '✕' });
    removeBtn.addEventListener('click', () => {
      const targets = network.goalSeek.targets.filter((_, i) => i !== index);
      store.setGoalSeekConfig({ targets });
    });

    return el('div', { class: 'ns-row' }, [select, flowInput, removeBtn]);
  }

  function updateTargets(index, patch) {
    const targets = store.state.network.goalSeek.targets.map((t, i) => (i === index ? { ...t, ...patch } : t));
    store.setGoalSeekConfig({ targets });
  }

  function adjustableRow(network, adj, index) {
    const adjustableElements = network.elements.filter((e) => ADJUSTABLE_TYPES.has(e.type));
    const select = el('select');
    for (const e of adjustableElements) {
      const o = el('option', { value: e.id, text: `${e.name} (${e.type})` });
      if (e.id === adj.elementId) o.selected = true;
      select.appendChild(o);
    }
    select.addEventListener('change', () => updateAdjustable(index, { elementId: select.value }));

    const minInput = el('input', { type: 'number', step: 'any', placeholder: 'min' });
    minInput.value = adj.min ?? '';
    minInput.addEventListener('change', () => updateAdjustable(index, { min: minInput.value === '' ? null : Number(minInput.value) }));

    const maxInput = el('input', { type: 'number', step: 'any', placeholder: 'max' });
    maxInput.value = adj.max ?? '';
    maxInput.addEventListener('change', () => updateAdjustable(index, { max: maxInput.value === '' ? null : Number(maxInput.value) }));

    const removeBtn = el('button', { type: 'button', class: 'ns-btn-small', text: '✕' });
    removeBtn.addEventListener('click', () => {
      const adjustable = network.goalSeek.adjustable.filter((_, i) => i !== index);
      store.setGoalSeekConfig({ adjustable });
    });

    return el('div', { class: 'ns-row' }, [select, minInput, maxInput, removeBtn]);
  }

  function updateAdjustable(index, patch) {
    const adjustable = store.state.network.goalSeek.adjustable.map((a, i) => (i === index ? { ...a, ...patch } : a));
    store.setGoalSeekConfig({ adjustable });
  }

  function render(state) {
    container.textContent = '';
    const { network, optimization } = state;
    const density = network.fluid.density;
    const adjustableElements = network.elements.filter((e) => ADJUSTABLE_TYPES.has(e.type));

    container.appendChild(el('h3', { text: 'Target flows (kg/s)' }));
    if (network.goalSeek.targets.length === 0) {
      container.appendChild(el('p', { class: 'ns-hint', text: 'No targets configured.' }));
    }
    for (const [i, t] of network.goalSeek.targets.entries()) container.appendChild(targetRow(network, t, i));
    const addTargetBtn = el('button', { type: 'button', class: 'ns-btn-small', text: '+ Add target' });
    addTargetBtn.disabled = network.elements.length === 0;
    addTargetBtn.addEventListener('click', () => {
      const first = network.elements[0];
      if (!first) return;
      store.setGoalSeekConfig({ targets: [...network.goalSeek.targets, { elementId: first.id, targetFlow: 0 }] });
    });
    container.appendChild(addTargetBtn);

    container.appendChild(el('h3', { text: 'Adjustable elements (pipes / valves / heat exchangers)' }));
    if (network.goalSeek.adjustable.length === 0) {
      container.appendChild(el('p', { class: 'ns-hint', text: 'No adjustable elements configured.' }));
    }
    for (const [i, a] of network.goalSeek.adjustable.entries()) container.appendChild(adjustableRow(network, a, i));
    const addAdjBtn = el('button', { type: 'button', class: 'ns-btn-small', text: '+ Add adjustable element' });
    addAdjBtn.disabled = adjustableElements.length === 0;
    addAdjBtn.addEventListener('click', () => {
      const first = adjustableElements[0];
      if (!first) return;
      store.setGoalSeekConfig({ adjustable: [...network.goalSeek.adjustable, { elementId: first.id, min: first.admittance.min, max: first.admittance.max }] });
    });
    container.appendChild(addAdjBtn);

    container.appendChild(el('h3', { text: 'Solver settings' }));
    const tolInput = el('input', { type: 'number', step: 'any' });
    tolInput.value = massFlow(density, network.goalSeek.tolerance) ?? network.goalSeek.tolerance;
    tolInput.addEventListener('change', () => store.setGoalSeekConfig({ tolerance: volumetricFlow(density, Number(tolInput.value)) }));
    container.appendChild(el('label', { class: 'ns-field' }, [el('span', { text: 'Tolerance (kg/s)' }), tolInput]));

    const iterInput = el('input', { type: 'number', step: '1', min: '1' });
    iterInput.value = network.goalSeek.maxIterations;
    iterInput.addEventListener('change', () => store.setGoalSeekConfig({ maxIterations: Number(iterInput.value) }));
    container.appendChild(el('label', { class: 'ns-field' }, [el('span', { text: 'Max iterations' }), iterInput]));

    const runBtn = el('button', { type: 'button', class: 'ns-btn', text: 'Run goal seek' });
    runBtn.disabled = network.goalSeek.targets.length === 0 || network.goalSeek.adjustable.length === 0;
    runBtn.addEventListener('click', () => {
      store.runGoalSeek({
        targets: network.goalSeek.targets,
        adjustable: network.goalSeek.adjustable,
        tolerance: network.goalSeek.tolerance,
        maxIterations: network.goalSeek.maxIterations,
      });
    });
    container.appendChild(runBtn);

    if (optimization) {
      container.appendChild(el('h3', { text: 'Optimization result' }));
      container.appendChild(el('div', { class: `ns-status ns-status-${optimization.status === 'converged' ? 'ok' : 'warning'}`, text: `Status: ${optimization.status}` }));
      if (optimization.warnings.length) {
        for (const w of optimization.warnings) container.appendChild(el('div', { class: 'ns-warning-item', text: w }));
      }

      const applyBtn = el('button', { type: 'button', class: 'ns-btn', text: 'Apply result' });
      applyBtn.addEventListener('click', () => { store.applyGoalSeek(); store.solve(); });
      const revertBtn = el('button', { type: 'button', class: 'ns-btn ns-btn-secondary', text: 'Revert' });
      revertBtn.addEventListener('click', () => store.revertGoalSeek());
      container.appendChild(el('div', { class: 'ns-row' }, [applyBtn, revertBtn]));

      container.appendChild(el('h4', { text: 'Admittance: old vs. goal-seek result' }));
      const admTable = el('table', { class: 'ns-table' });
      admTable.appendChild(el('thead', {}, [el('tr', {}, ['Element', 'Old (current)', 'Goal-seek result', 'Change'].map((h) => el('th', { text: h })))]));
      const admTbody = el('tbody');
      for (const adj of network.goalSeek.adjustable) {
        const element = network.elements.find((e) => e.id === adj.elementId);
        const oldA = element ? element.admittance.current : null;
        const newA = optimization.best.admittances[adj.elementId];
        const changeText = Number.isFinite(oldA) && oldA !== 0 && Number.isFinite(newA)
          ? `${((newA - oldA) / oldA * 100) >= 0 ? '+' : ''}${(((newA - oldA) / oldA) * 100).toFixed(1)}%`
          : '—';
        admTbody.appendChild(el('tr', {}, [
          el('td', { text: elName(network, adj.elementId) }),
          el('td', { text: fmt(oldA) }),
          el('td', { text: fmt(newA) }),
          el('td', { text: changeText }),
        ]));
      }
      admTable.appendChild(admTbody);
      container.appendChild(admTable);

      container.appendChild(el('h4', { text: 'History' }));
      const table = el('table', { class: 'ns-table' });
      const head = ['#', 'Note', ...network.goalSeek.adjustable.map((a) => `A: ${elName(network, a.elementId)}`),
        ...network.goalSeek.targets.map((t) => `Q (kg/s): ${elName(network, t.elementId)}`), 'Residual norm (kg/s)', 'Hydraulic'];
      table.appendChild(el('thead', {}, [el('tr', {}, head.map((h) => el('th', { text: h })))]));
      const tbody = el('tbody');
      for (const entry of optimization.history) {
        const cells = [
          String(entry.iteration), entry.note,
          ...network.goalSeek.adjustable.map((a) => fmt(entry.admittances[a.elementId])),
          ...network.goalSeek.targets.map((t) => fmt(massFlow(density, entry.actualFlows[t.elementId]))),
          fmt(massFlow(density, entry.residualNorm)), entry.hydraulicStatus,
        ];
        tbody.appendChild(el('tr', {}, cells.map((c) => el('td', { text: c }))));
      }
      table.appendChild(tbody);
      container.appendChild(table);
    }
  }

  function elName(network, id) {
    const found = network.elements.find((e) => e.id === id);
    return found ? found.name : id;
  }
}
