// CSV export of the current results (nodes + elements + goal-seek
// comparison tables). CSV opens natively in Excel/Sheets/Numbers with no
// dependency and no format-correctness risk; a true binary .xlsx would
// require either a heavy third-party library or a from-scratch OOXML/ZIP
// writer this project has no way to verify against real Excel -- see
// docs/research.md for the full rationale (same "keep it dependency-free"
// reasoning as the rest of the app).
import { getEffectiveElevation } from '../../solver/index.js';

const GRAVITY = 9.80665;

function csvField(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(fields) {
  return fields.map(csvField).join(',');
}

function num(v) {
  return Number.isFinite(v) ? v : '';
}

function massFlow(density, q) {
  return Number.isFinite(q) && Number.isFinite(density) ? density * q : null;
}

function totalHead(node, pressure, density) {
  return Number.isFinite(pressure) && Number.isFinite(density) ? getEffectiveElevation(node) + pressure / (density * GRAVITY) : null;
}

function elementName(network, id) {
  const found = network.elements.find((e) => e.id === id);
  return found ? found.name : id;
}

/** Builds the CSV text for the current network's results. Exported separately from the download step so it's testable/reusable without a DOM. */
export function buildResultsCsv(state) {
  const { network, diagnostics, optimization } = state;
  const density = network.fluid.density;
  const lines = [];

  lines.push(csvRow(['NetworkSolver results export']));
  lines.push(csvRow(['Network', network.meta.name]));
  lines.push(csvRow(['Exported', new Date().toISOString()]));
  lines.push(csvRow(['Solver status', diagnostics.hydraulic ? diagnostics.hydraulic.status : 'not solved']));
  lines.push('');

  lines.push(csvRow(['Nodes']));
  lines.push(csvRow([
    'Node', 'Type', 'Elevation (m)', 'Pressure (Pa)', 'Total head (m)', 'Temperature (C)',
    'Mass balance residual (m3/s)', 'Mass balance residual (kg/s)',
  ]));
  for (const n of network.nodes) {
    lines.push(csvRow([
      n.name, n.nodeType, num(n.elevation), num(n.computed.pressure), num(totalHead(n, n.computed.pressure, density)),
      num(n.computed.temperature), num(n.computed.massBalanceResidual), num(massFlow(density, n.computed.massBalanceResidual)),
    ]));
  }
  lines.push('');

  // Admittance columns show "old" (Initial/Current, i.e. before any pending
  // goal-seek is applied) alongside the pending goal-seek result, when one
  // exists -- so a reviewer can see exactly what Apply would change.
  const hasOptimization = !!(optimization && optimization.best);
  lines.push(csvRow(['Elements']));
  const header = ['Element', 'Type', 'Enabled', 'Initial admittance', 'Current admittance (old)'];
  if (hasOptimization) header.push('Goal-seek admittance (proposed)');
  header.push(
    'Min admittance', 'Max admittance', 'Flow (m3/s)', 'Mass flow (kg/s)',
    'Pressure drop src-tgt (Pa)', 'Inlet T (C)', 'Outlet T (C)', 'Heat duty (W)',
  );
  lines.push(csvRow(header));
  for (const e of network.elements) {
    const row = [e.name, e.type, e.enabled ? 'yes' : 'no', num(e.admittance.initial), num(e.admittance.current)];
    if (hasOptimization) {
      const proposed = optimization.best.admittances[e.id];
      row.push(proposed !== undefined ? num(proposed) : '');
    }
    row.push(
      num(e.admittance.min), num(e.admittance.max), num(e.computed.flow), num(massFlow(density, e.computed.flow)),
      num(e.computed.pressureDrop), num(e.computed.inletTemperature), num(e.computed.outletTemperature), num(e.computed.heatDuty),
    );
    lines.push(csvRow(row));
  }

  if (hasOptimization) {
    lines.push('');
    lines.push(csvRow([`Goal seek (status: ${optimization.status})`]));
    // Goal Seek is presented in mass flow (kg/s) throughout the UI (see
    // goalSeekPanel.js) -- kept consistent here, even though the solver and
    // network.goalSeek.targets store these in m3/s internally.
    lines.push(csvRow(['Target element', 'Target flow (kg/s)', 'Achieved flow (kg/s)', 'Error (kg/s)']));
    for (const t of network.goalSeek.targets) {
      lines.push(csvRow([
        elementName(network, t.elementId), num(massFlow(density, t.targetFlow)),
        num(massFlow(density, optimization.best.actualFlows[t.elementId])), num(massFlow(density, optimization.best.targetErrors[t.elementId])),
      ]));
    }
  }

  return lines.join('\r\n');
}

export function downloadResultsCsv(store) {
  const csv = buildResultsCsv(store.state);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = (store.state.network.meta.name || 'network').replace(/[^a-z0-9-_]+/gi, '_').toLowerCase();
  a.href = url;
  a.download = `${safeName}-results.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
