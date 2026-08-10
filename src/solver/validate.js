// Network validation: structural integrity, boundary-condition consistency
// and physical sanity checks, independent of solving. Returns structured
// diagnostics (errors block solving, warnings do not) rather than throwing,
// so the UI can render them directly.
import { getElementModule } from './elements/index.js';

function error(code, message, ref) {
  return { severity: 'error', code, message, ref: ref || null };
}
function warning(code, message, ref) {
  return { severity: 'warning', code, message, ref: ref || null };
}

/**
 * @param {object} network
 * @returns {{ valid: boolean, errors: object[], warnings: object[] }}
 */
export function validateNetwork(network) {
  const errors = [];
  const warnings = [];

  const nodeIds = new Set();
  for (const node of network.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push(error('DUPLICATE_NODE_ID', `Duplicate node id "${node.id}"`, node.id));
    }
    nodeIds.add(node.id);
    if (node.boundary.pressure.fixed && node.boundary.flow.fixed) {
      errors.push(error(
        'OVER_CONSTRAINED_NODE',
        `Node "${node.name}" has both fixed pressure and fixed flow; a node may only fix one`,
        node.id,
      ));
    }
    if (node.boundary.pressure.fixed && !(Number.isFinite(node.boundary.pressure.value))) {
      errors.push(error('INVALID_PRESSURE_BC', `Node "${node.name}" fixed pressure value is not a finite number`, node.id));
    }
    if (node.boundary.flow.fixed && !(Number.isFinite(node.boundary.flow.value))) {
      errors.push(error('INVALID_FLOW_BC', `Node "${node.name}" fixed flow value is not a finite number`, node.id));
    }
    if (node.boundary.temperature.fixed && !(Number.isFinite(node.boundary.temperature.value))) {
      errors.push(error('INVALID_TEMPERATURE_BC', `Node "${node.name}" fixed temperature value is not a finite number`, node.id));
    }
    if (node.nodeType === 'tank') {
      const { diameter, minLevel, maxLevel, level } = node.params;
      if (!(diameter > 0)) {
        errors.push(error('INVALID_TANK_PARAMS', `Tank "${node.name}" diameter must be > 0`, node.id));
      }
      if (Number.isFinite(minLevel) && Number.isFinite(maxLevel) && minLevel > maxLevel) {
        errors.push(error('INVALID_TANK_PARAMS', `Tank "${node.name}" minLevel (${minLevel}) exceeds maxLevel (${maxLevel})`, node.id));
      } else if (Number.isFinite(level) && (level < minLevel - 1e-9 || level > maxLevel + 1e-9)) {
        warnings.push(warning('TANK_LEVEL_OUT_OF_RANGE', `Tank "${node.name}" current level (${level}) is outside its [${minLevel}, ${maxLevel}] range`, node.id));
      }
    }
  }

  const elementIds = new Set();
  for (const el of network.elements) {
    if (elementIds.has(el.id)) {
      errors.push(error('DUPLICATE_ELEMENT_ID', `Duplicate element id "${el.id}"`, el.id));
    }
    elementIds.add(el.id);

    if (!nodeIds.has(el.sourceNodeId)) {
      errors.push(error('MISSING_SOURCE_NODE', `Element "${el.name}" source node "${el.sourceNodeId}" does not exist`, el.id));
    }
    if (!nodeIds.has(el.targetNodeId)) {
      errors.push(error('MISSING_TARGET_NODE', `Element "${el.name}" target node "${el.targetNodeId}" does not exist`, el.id));
    }
    if (el.sourceNodeId && el.sourceNodeId === el.targetNodeId) {
      errors.push(error('SELF_LOOP', `Element "${el.name}" connects a node to itself`, el.id));
    }

    let mod;
    try {
      mod = getElementModule(el.type);
    } catch {
      errors.push(error('UNKNOWN_ELEMENT_TYPE', `Element "${el.name}" has unknown type "${el.type}"`, el.id));
      continue;
    }

    if (el.type !== 'pump') {
      const { min, max, current, initial } = el.admittance;
      for (const [label, val] of [['current', current], ['initial', initial]]) {
        if (val != null && !(val >= 0)) {
          errors.push(error('INVALID_ADMITTANCE_VALUE', `Element "${el.name}" ${label} admittance must be >= 0`, el.id));
        }
      }
      if (min != null && max != null && min > max) {
        errors.push(error('INVALID_ADMITTANCE_BOUNDS', `Element "${el.name}" admittance min (${min}) exceeds max (${max})`, el.id));
      }
      if (min != null && current != null && current < min - 1e-12) {
        warnings.push(warning('ADMITTANCE_BELOW_MIN', `Element "${el.name}" current admittance is below its configured minimum`, el.id));
      }
      if (max != null && current != null && current > max + 1e-12) {
        warnings.push(warning('ADMITTANCE_ABOVE_MAX', `Element "${el.name}" current admittance is above its configured maximum`, el.id));
      }
    }

    const paramErrors = mod.validateParams(el.params);
    for (const msg of paramErrors) {
      errors.push(error('INVALID_PARAMS', `Element "${el.name}": ${msg}`, el.id));
    }
  }

  if (errors.length === 0) {
    checkConnectivity(network, errors, warnings);
    checkTemperatureBoundaries(network, warnings);
  }

  return { valid: errors.length === 0, errors, warnings };
}

function checkConnectivity(network, errors, warnings) {
  const parent = new Map(network.nodes.map((n) => [n.id, n.id]));
  function find(x) {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  const touched = new Set();
  for (const el of network.elements) {
    if (!el.enabled) continue;
    union(el.sourceNodeId, el.targetNodeId);
    touched.add(el.sourceNodeId);
    touched.add(el.targetNodeId);
  }

  for (const node of network.nodes) {
    if (!touched.has(node.id)) {
      warnings.push(warning('ISOLATED_NODE', `Node "${node.name}" has no connected elements`, node.id));
    }
  }

  const pressureRefByRoot = new Map();
  for (const node of network.nodes) {
    if (node.boundary.pressure.fixed) {
      pressureRefByRoot.set(find(node.id), node.id);
    }
  }

  if (pressureRefByRoot.size === 0) {
    errors.push(error('NO_PRESSURE_REFERENCE', 'The network has no fixed-pressure (reference) node'));
    return;
  }

  const componentsSeen = new Set();
  for (const node of network.nodes) {
    if (!touched.has(node.id)) continue;
    const root = find(node.id);
    componentsSeen.add(root);
    if (!pressureRefByRoot.has(root)) {
      errors.push(error(
        'DISCONNECTED_REGION',
        `Node "${node.name}" belongs to a connected region with no fixed-pressure reference node`,
        node.id,
      ));
    }
  }
}

function checkTemperatureBoundaries(network, warnings) {
  for (const node of network.nodes) {
    const isPotentialSource = node.boundary.pressure.fixed || (node.boundary.flow.fixed && node.boundary.flow.value > 0);
    if (isPotentialSource && !node.boundary.temperature.fixed) {
      warnings.push(warning(
        'MISSING_INFLOW_TEMPERATURE',
        `Node "${node.name}" can supply flow to the network but has no fixed temperature; its temperature will be undetermined if it acts as a source`,
        node.id,
      ));
    }
  }
}
