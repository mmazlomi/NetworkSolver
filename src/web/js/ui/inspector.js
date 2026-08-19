// Property inspector: renders an editable form for the current selection
// (a node or an element) and a read-only block of its computed results.
import { getElementModule, getEffectiveElevation } from '../../solver/index.js';

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) node.appendChild(child);
  return node;
}

function field(labelText, inputEl) {
  const wrap = el('label', { class: 'ns-field' });
  wrap.appendChild(el('span', { text: labelText }));
  wrap.appendChild(inputEl);
  return wrap;
}

function numberInput(value, onChange, opts = {}) {
  const input = el('input', { type: 'number', step: opts.step || 'any' });
  input.value = value ?? '';
  if (opts.min !== undefined) input.min = opts.min;
  input.addEventListener('change', () => onChange(input.value === '' ? null : Number(input.value)));
  return input;
}

function textInput(value, onChange) {
  const input = el('input', { type: 'text' });
  input.value = value ?? '';
  input.addEventListener('change', () => onChange(input.value));
  return input;
}

function checkbox(checked, onChange) {
  const input = el('input', { type: 'checkbox' });
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked));
  return input;
}

function selectInput(value, options, onChange) {
  const select = el('select');
  for (const opt of options) {
    const o = el('option', { value: opt.value, text: opt.label });
    if (opt.value === value) o.selected = true;
    select.appendChild(o);
  }
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

function section(title) {
  return el('h3', { text: title });
}

/** Converts a volumetric flow (m³/s) to mass flow (kg/s) using the network's fluid density. */
function massFlow(density, volumetricFlow) {
  return Number.isFinite(volumetricFlow) && Number.isFinite(density) ? density * volumetricFlow : null;
}

const GRAVITY = 9.80665;

/**
 * Total hydraulic head (m) -- see resultsPanel.js for why this matters.
 * Uses the node's effective elevation (a tank's base + current level).
 */
function totalHead(node, pressure, density) {
  return Number.isFinite(pressure) && Number.isFinite(density) ? getEffectiveElevation(node) + pressure / (density * GRAVITY) : null;
}

const NODE_TYPE_LABELS = { junction: 'Junction', reservoir: 'Reservoir', tank: 'Tank' };

function renderNetworkSettings(container, network, store) {
  container.appendChild(el('p', { class: 'ns-hint', text: 'Select a node or element to view and edit its properties. Network-wide settings:' }));
  container.appendChild(section('Network Settings'));
  container.appendChild(field('Pipe headloss model', selectInput(network.headlossModel, [
    { value: 'darcyWeisbach', label: 'Darcy-Weisbach' },
    { value: 'hazenWilliams', label: 'Hazen-Williams' },
  ], (v) => store.setHeadlossModel(v))));
  container.appendChild(el('p', { class: 'ns-hint', text: 'Applies to every pipe in the network (matching EPANET\'s own network-wide Headloss option). Switching models recomputes every pipe\'s Current admittance from its geometry under the new model -- Darcy-Weisbach uses each pipe\'s Roughness, Hazen-Williams uses each pipe\'s Hazen-Williams C. Valves, pumps, and heat exchangers are unaffected.' }));

  container.appendChild(field('Recompute friction factor from Reynolds number', checkbox(network.recomputeFriction, (v) => store.setRecomputeFriction(v))));
  container.appendChild(el('p', { class: 'ns-hint', text: 'By default every pipe\'s admittance is a fixed value computed once at an assumed 1 m/s reference velocity (like a valve\'s Kv rating), so flow splits between parallel paths stay the same no matter how much total flow is driven through the network. Enabling this re-derives each pipe\'s Darcy-Weisbach friction factor from its own actual Reynolds number every solver iteration, so flow splits can shift with total flow rate (e.g. near the laminar/turbulent transition). Darcy-Weisbach only -- Hazen-Williams has no friction-factor/Reynolds-number concept. Costs extra solver iterations.' }));
}

function renderNode(container, node, store, fluid) {
  container.appendChild(section(`${NODE_TYPE_LABELS[node.nodeType] || 'Node'}: ${node.name}`));
  container.appendChild(field('Name', textInput(node.name, (v) => store.updateNode(node.id, { name: v }))));

  if (node.nodeType === 'reservoir') {
    container.appendChild(field('Elevation / fixed head (m)', numberInput(node.elevation, (v) => store.updateNode(node.id, { elevation: v }))));
    container.appendChild(el('p', { class: 'ns-hint', text: 'A reservoir is an infinite fixed-head source: pressure is always 0 (a free surface) and elevation is its entire hydraulic head.' }));
  } else if (node.nodeType === 'tank') {
    container.appendChild(field('Base elevation (m)', numberInput(node.elevation, (v) => store.updateNode(node.id, { elevation: v }))));
    container.appendChild(section('Tank geometry / level'));
    container.appendChild(field('Diameter (m)', numberInput(node.params.diameter, (v) => store.updateNode(node.id, { params: { diameter: v } }))));
    container.appendChild(field('Min level (m)', numberInput(node.params.minLevel, (v) => store.updateNode(node.id, { params: { minLevel: v } }))));
    container.appendChild(field('Max level (m)', numberInput(node.params.maxLevel, (v) => store.updateNode(node.id, { params: { maxLevel: v } }))));
    container.appendChild(field('Current level (m)', numberInput(node.params.level, (v) => store.updateNode(node.id, { params: { level: v } }))));
    container.appendChild(el('p', { class: 'ns-hint', text: 'A tank is a finite fixed-head source/sink for this steady-state snapshot: pressure is always 0 (a free surface) and its effective elevation is base elevation + current level. NetworkSolver does not simulate fill/drain over time.' }));
  } else {
    container.appendChild(field('Elevation (m)', numberInput(node.elevation, (v) => store.updateNode(node.id, { elevation: v }))));
  }

  if (node.nodeType === 'junction') {
    container.appendChild(section('Boundary conditions'));
    const pf = checkbox(node.boundary.pressure.fixed, (v) => store.updateNode(node.id, { boundary: { pressure: { fixed: v } } }));
    container.appendChild(field('Fixed pressure', pf));
    container.appendChild(field('Pressure (Pa)', numberInput(node.boundary.pressure.value, (v) => store.updateNode(node.id, { boundary: { pressure: { value: v } } }))));

    const ff = checkbox(node.boundary.flow.fixed, (v) => store.updateNode(node.id, { boundary: { flow: { fixed: v } } }));
    container.appendChild(field('Fixed external flow', ff));
    container.appendChild(field('Flow (m³/s, + = injection)', numberInput(node.boundary.flow.value, (v) => store.updateNode(node.id, { boundary: { flow: { value: v } } }))));
  }

  const tf = checkbox(node.boundary.temperature.fixed, (v) => store.updateNode(node.id, { boundary: { temperature: { fixed: v } } }));
  container.appendChild(field('Fixed temperature', tf));
  container.appendChild(field('Temperature (°C)', numberInput(node.boundary.temperature.value, (v) => store.updateNode(node.id, { boundary: { temperature: { value: v } } }))));

  container.appendChild(field('Notes', textInput(node.notes, (v) => store.updateNode(node.id, { notes: v }))));

  container.appendChild(section('Computed results'));
  container.appendChild(readonlyRow('Pressure', formatNum(node.computed.pressure, 'Pa')));
  container.appendChild(readonlyRow('Total head (elevation + pressure head)', formatNum(totalHead(node, node.computed.pressure, fluid.density), 'm')));
  container.appendChild(readonlyRow('Temperature', formatNum(node.computed.temperature, '°C')));
  container.appendChild(readonlyRow('Mass balance residual', formatNum(node.computed.massBalanceResidual, 'm³/s')));
  container.appendChild(readonlyRow('Mass balance residual', formatNum(massFlow(fluid.density, node.computed.massBalanceResidual), 'kg/s')));
}

// Params that determine a pipe's/valve's hydraulic resistance -- editing
// one of these recomputes admittance.current from the new geometry so the
// change actually affects the next solve, instead of silently doing
// nothing (the solver only ever reads admittance.current, never geometry,
// during a solve -- see docs/technical_specs.md §2.2-2.3).
const ADMITTANCE_GEOMETRY_FIELDS = {
  pipe: ['length', 'diameter', 'roughness', 'hazenWilliamsC', 'localLossCoefficient'],
  valve: ['openingPercent', 'kvRated', 'characteristic'],
};

function isGoalSeekAdjustable(network, elementId) {
  return network.goalSeek.adjustable.some((a) => a.elementId === elementId);
}

/**
 * Updates one params field, and if it affects hydraulic resistance,
 * recomputes admittance.current to match (as a single combined edit/undo
 * step) -- except for elements currently configured as goal-seek
 * adjustable, whose "Current" admittance holds a tuned goal-seek result
 * rather than the geometry's nominal value; silently overwriting it on
 * every geometry edit would discard that tuning. Those elements keep their
 * admittance until the user re-runs goal-seek or edits "Current" directly.
 */
function updateElementParam(store, el_, network, key, value) {
  const newParams = { ...el_.params, [key]: value };
  const patch = { params: { [key]: value } };
  if ((ADMITTANCE_GEOMETRY_FIELDS[el_.type] || []).includes(key) && !isGoalSeekAdjustable(network, el_.id)) {
    const admittance = getElementModule(el_.type).computeNominalAdmittance(newParams, network.fluid, network.headlossModel);
    if (admittance != null && admittance > 0) patch.admittance = { current: admittance };
  }
  store.updateElement(el_.id, patch);
}

// pipe's 'roughness' (Darcy-Weisbach) / 'hazenWilliamsC' (Hazen-Williams)
// are mutually exclusive depending on the network's headloss model, so
// they're rendered separately (see renderElement) instead of through this
// static list.
const PARAM_FIELDS = {
  pipe: [
    ['length', 'Length (m)'], ['diameter', 'Diameter (m)'],
    ['localLossCoefficient', 'Local loss coeff.'], ['ambientTemperature', 'Ambient temp (°C)'],
    ['heatTransferCoefficient', 'Heat transfer coeff. (W/m²K)'],
  ],
  valve: [
    ['openingPercent', 'Opening (%)'], ['kvRated', 'Kv rated (m³/h @1bar)'], ['maxDeltaP', 'Max ΔP (Pa)'],
  ],
  pump: [
    ['fixedHead', 'Fixed head (Pa)'], ['curveShutoffHead', 'Shutoff head H0 (Pa)'],
    ['nominalFlow', 'Nominal flow (m³/s)'], ['nominalHead', 'Nominal head (Pa)'],
    ['speedFactor', 'Speed factor'], ['efficiency', 'Efficiency (0-1)'],
  ],
  heatExchanger: [
    ['ua', 'UA (W/K)'], ['effectivenessValue', 'Effectiveness (0-1)'],
    ['secondaryTemperature', 'Secondary temp (°C)'], ['secondaryCapacityRate', 'Secondary capacity rate (W/K)'],
  ],
};

function renderElement(container, el_, store, network) {
  const fluid = network.fluid;
  container.appendChild(section(`${el_.type[0].toUpperCase()}${el_.type.slice(1)}: ${el_.name}`));
  container.appendChild(field('Name', textInput(el_.name, (v) => store.updateElement(el_.id, { name: v }))));
  container.appendChild(field('Enabled', checkbox(el_.enabled, (v) => store.updateElement(el_.id, { enabled: v }))));

  container.appendChild(section('Connections'));
  const nodeOptions = network.nodes.map((n) => ({ value: n.id, label: n.name }));
  container.appendChild(field('Source node (inlet)', selectInput(el_.sourceNodeId, nodeOptions,
    (v) => store.updateElement(el_.id, { sourceNodeId: v }))));
  container.appendChild(field('Target node (outlet)', selectInput(el_.targetNodeId, nodeOptions,
    (v) => store.updateElement(el_.id, { targetNodeId: v }))));
  if (el_.sourceNodeId === el_.targetNodeId) {
    container.appendChild(el('div', { class: 'ns-message', text: 'Source and target are the same node — this will fail validation as a self-loop.' }));
  }

  if (el_.type !== 'pump') {
    container.appendChild(section('Admittance'));
    if (el_.type === 'pipe' || el_.type === 'valve') {
      container.appendChild(el('p', {
        class: 'ns-hint',
        text: isGoalSeekAdjustable(network, el_.id)
          ? 'This element is a goal-seek adjustable element, so "Current" holds a tuned goal-seek result -- editing the geometry/opening fields below will NOT overwrite it. Re-run goal seek or edit "Current" directly to change it.'
          : '"Current" updates automatically when you edit the geometry/opening fields below. Edit it directly here to override that (e.g. to match a goal-seek result).',
      }));
    }
    container.appendChild(field('Initial', numberInput(el_.admittance.initial, (v) => store.updateElement(el_.id, { admittance: { initial: v } }))));
    container.appendChild(field('Current', numberInput(el_.admittance.current, (v) => store.updateElement(el_.id, { admittance: { current: v } }))));
    container.appendChild(field('Min', numberInput(el_.admittance.min, (v) => store.updateElement(el_.id, { admittance: { min: v } }))));
    container.appendChild(field('Max', numberInput(el_.admittance.max, (v) => store.updateElement(el_.id, { admittance: { max: v } }))));
  }

  container.appendChild(section('Parameters'));
  if (el_.type === 'pipe') {
    container.appendChild(el('p', { class: 'ns-hint', text: `Network headloss model: ${network.headlossModel === 'hazenWilliams' ? 'Hazen-Williams' : 'Darcy-Weisbach'} (set in Network Settings, no selection).` }));
    if (network.headlossModel === 'hazenWilliams') {
      container.appendChild(field('Hazen-Williams C', numberInput(el_.params.hazenWilliamsC, (v) => updateElementParam(store, el_, network, 'hazenWilliamsC', v))));
    } else {
      container.appendChild(field('Roughness (m)', numberInput(el_.params.roughness, (v) => updateElementParam(store, el_, network, 'roughness', v))));
    }
  }
  if (el_.type === 'valve') {
    container.appendChild(field('Characteristic', selectInput(el_.params.characteristic, [
      { value: 'linear', label: 'Linear' }, { value: 'equalPercentage', label: 'Equal percentage' }, { value: 'quickOpening', label: 'Quick opening' },
    ], (v) => updateElementParam(store, el_, network, 'characteristic', v))));
  }
  if (el_.type === 'pump') {
    container.appendChild(field('Mode', selectInput(el_.params.mode, [
      { value: 'curve', label: 'Performance curve' }, { value: 'fixedHead', label: 'Fixed head' },
    ], (v) => store.updateElement(el_.id, { params: { mode: v } }))));
    container.appendChild(field('Direction', selectInput(el_.params.direction, [
      { value: 'sourceToTarget', label: 'Source → Target' }, { value: 'targetToSource', label: 'Target → Source' },
    ], (v) => store.updateElement(el_.id, { params: { direction: v } }))));
    container.appendChild(field('Thermal contribution', checkbox(el_.params.thermalContribution, (v) => store.updateElement(el_.id, { params: { thermalContribution: v } }))));
  }
  if (el_.type === 'heatExchanger') {
    container.appendChild(field('Effectiveness mode', selectInput(el_.params.effectivenessMode, [
      { value: 'ua', label: 'From UA (NTU method)' }, { value: 'effectiveness', label: 'Direct effectiveness' },
    ], (v) => store.updateElement(el_.id, { params: { effectivenessMode: v } }))));
  }
  for (const [key, label] of PARAM_FIELDS[el_.type]) {
    container.appendChild(field(label, numberInput(el_.params[key], (v) => updateElementParam(store, el_, network, key, v))));
  }

  container.appendChild(field('Notes', textInput(el_.notes, (v) => store.updateElement(el_.id, { notes: v }))));

  container.appendChild(section('Computed results'));
  container.appendChild(readonlyRow('Flow', formatNum(el_.computed.flow, 'm³/s')));
  container.appendChild(readonlyRow('Mass flow', formatNum(massFlow(fluid.density, el_.computed.flow), 'kg/s')));
  container.appendChild(readonlyRow('Pressure drop (src−tgt)', formatNum(el_.computed.pressureDrop, 'Pa')));
  container.appendChild(readonlyRow('Inlet temperature', formatNum(el_.computed.inletTemperature, '°C')));
  container.appendChild(readonlyRow('Outlet temperature', formatNum(el_.computed.outletTemperature, '°C')));
  container.appendChild(readonlyRow('Heat duty', formatNum(el_.computed.heatDuty, 'W')));
  if (el_.type === 'pipe' && network.recomputeFriction) {
    container.appendChild(readonlyRow('Reynolds number', formatNum(el_.computed.reynoldsNumber, '')));
  }
  if (el_.computed.messages && el_.computed.messages.length) {
    const msgs = el('div', { class: 'ns-messages' });
    for (const m of el_.computed.messages) msgs.appendChild(el('div', { class: 'ns-message', text: m }));
    container.appendChild(msgs);
  }
}

function readonlyRow(label, value) {
  return el('div', { class: 'ns-readonly-row' }, [el('span', { text: label }), el('span', { class: 'ns-value', text: value })]);
}

function formatNum(v, unit) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const abs = Math.abs(v);
  const formatted = abs !== 0 && (abs < 0.001 || abs >= 100000) ? v.toExponential(3) : v.toFixed(4);
  return unit ? `${formatted} ${unit}` : formatted;
}

export function initInspector(container, store) {
  store.subscribe((state) => render(state));
  render(store.state);

  function render(state) {
    container.textContent = '';
    const { selection, network } = state;
    if (!selection.id) {
      renderNetworkSettings(container, network, store);
      return;
    }
    if (selection.type === 'node') {
      const node = network.nodes.find((n) => n.id === selection.id);
      if (node) renderNode(container, node, store, network.fluid);
    } else if (selection.type === 'element') {
      const element = network.elements.find((e) => e.id === selection.id);
      if (element) renderElement(container, element, store, network);
    }
  }
}
