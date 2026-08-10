// Structured results tables (nodes + elements) and solver diagnostics.
import { getEffectiveElevation } from '../../solver/index.js';
import { downloadResultsCsv } from '../io/csvExport.js';

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) node.appendChild(child);
  return node;
}

function fmt(v, digits = 3) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const abs = Math.abs(v);
  return abs !== 0 && (abs < 0.001 || abs >= 100000) ? v.toExponential(digits) : v.toFixed(digits);
}

function table(headers, rows) {
  const t = el('table', { class: 'ns-table' });
  const thead = el('thead');
  thead.appendChild(el('tr', {}, headers.map((h) => el('th', { text: h }))));
  t.appendChild(thead);
  const tbody = el('tbody');
  for (const row of rows) tbody.appendChild(el('tr', {}, row.map((c) => el('td', { text: c }))));
  t.appendChild(tbody);
  return el('div', { class: 'ns-table-scroll' }, [t]);
}

/** Converts a volumetric flow (m³/s) to mass flow (kg/s) using the network's fluid density. */
function massFlow(density, volumetricFlow) {
  return Number.isFinite(volumetricFlow) && Number.isFinite(density) ? density * volumetricFlow : null;
}

const GRAVITY = 9.80665;

/**
 * Total hydraulic head (elevation + pressure head, in meters) -- the same
 * "elevation + p/ρg" quantity the solver itself uses to drive flow (see
 * docs/technical_specs.md §2.1). Node pressure alone can be misleadingly
 * small or zero for a boundary node whose driving potential is carried by
 * elevation instead (e.g. an open reservoir/tank, at 0 gauge pressure at
 * its free surface) -- showing both side by side makes that visible
 * instead of "pressure = 0" looking like a bug. Uses the node's *effective*
 * elevation (a tank's base elevation + its current level), matching what
 * the solver itself uses to drive flow -- not the raw elevation field.
 */
function totalHead(node, pressure, density) {
  return Number.isFinite(pressure) && Number.isFinite(density) ? getEffectiveElevation(node) + pressure / (density * GRAVITY) : null;
}

export function initResultsPanel(container, store) {
  store.subscribe((state) => render(state));
  render(store.state);

  function render(state) {
    container.textContent = '';
    const { network, diagnostics } = state;
    const density = network.fluid.density;

    const header = el('div', { class: 'ns-panel-header' }, [el('h3', { text: 'Solver status' })]);
    const exportBtn = el('button', { type: 'button', class: 'ns-btn-small', text: 'Export Results (CSV)' });
    exportBtn.addEventListener('click', () => downloadResultsCsv(store));
    header.appendChild(exportBtn);
    container.appendChild(header);

    const statusBox = el('div', { class: `ns-status ns-status-${diagnostics.status}` });
    statusBox.textContent = diagnostics.hydraulic
      ? `${diagnostics.hydraulic.status} — ${diagnostics.hydraulic.iterations} iteration(s), residual ${fmt(diagnostics.hydraulic.residualNorm, 2)} m³/s`
      : 'Not solved yet';
    container.appendChild(statusBox);

    if (diagnostics.errors.length || diagnostics.warnings.length) {
      const list = el('ul', { class: 'ns-diagnostics-list' });
      for (const e of diagnostics.errors) list.appendChild(el('li', { class: 'ns-error-item', text: `Error [${e.code}]: ${e.message}` }));
      for (const w of diagnostics.warnings) list.appendChild(el('li', { class: 'ns-warning-item', text: `Warning [${w.code}]: ${w.message}` }));
      container.appendChild(list);
    }

    container.appendChild(el('h3', { text: 'Nodes' }));
    container.appendChild(table(
      ['Node', 'Elevation (m)', 'Pressure (Pa)', 'Total head (m)', 'Temperature (°C)', 'Mass balance residual (m³/s)', 'Mass balance residual (kg/s)'],
      network.nodes.map((n) => [
        n.name, fmt(n.elevation, 2), fmt(n.computed.pressure, 0), fmt(totalHead(n, n.computed.pressure, density), 2),
        fmt(n.computed.temperature, 2), fmt(n.computed.massBalanceResidual, 6), fmt(massFlow(density, n.computed.massBalanceResidual), 6),
      ]),
    ));

    container.appendChild(el('h3', { text: 'Elements' }));
    container.appendChild(table(
      ['Element', 'Type', 'Flow (m³/s)', 'Mass flow (kg/s)', 'ΔP src−tgt (Pa)', 'Inlet T (°C)', 'Outlet T (°C)', 'Duty (W)'],
      network.elements.map((e) => [
        e.name, e.type, fmt(e.computed.flow, 6), fmt(massFlow(density, e.computed.flow), 6), fmt(e.computed.pressureDrop, 0),
        fmt(e.computed.inletTemperature, 2), fmt(e.computed.outletTemperature, 2), fmt(e.computed.heatDuty, 0),
      ]),
    ));
  }
}
