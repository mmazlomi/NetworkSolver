// Steady-state thermal solver. Once flow directions/magnitudes are known
// from the hydraulic solve, node energy balance (perfect mixing) is linear
// in temperature, so this is a single direct linear solve -- no iteration
// needed. See docs/technical_specs.md for the full derivation.
import { getElementModule } from './elements/index.js';
import { solveLinearSystem } from './linalg.js';

const FLOW_EPSILON = 1e-9;

function endpoints(el, Q) {
  return Q >= 0
    ? { upstreamId: el.sourceNodeId, downstreamId: el.targetNodeId }
    : { upstreamId: el.targetNodeId, downstreamId: el.sourceNodeId };
}

/**
 * @param {object} network
 * @param {object} hydraulicResult result of solveHydraulics()
 * @returns {object} { nodeTemperatures, elementResults, warnings, errors }
 */
export function solveThermal(network, hydraulicResult) {
  const warnings = [];
  const errors = [];
  const nodeById = new Map(network.nodes.map((n) => [n.id, n]));

  const flows = new Map();
  for (const el of network.elements) {
    const r = hydraulicResult.elementResults[el.id];
    flows.set(el.id, r ? r.Q : 0);
  }

  const inboundElements = new Map(network.nodes.map((n) => [n.id, []]));
  for (const el of network.elements) {
    const Q = flows.get(el.id);
    if (!el.enabled || Math.abs(Q) <= FLOW_EPSILON) continue;
    const { upstreamId, downstreamId } = endpoints(el, Q);
    inboundElements.get(downstreamId).push({ el, upstreamId, Q });
  }

  const fixedIds = new Set(network.nodes.filter((n) => n.boundary.temperature.fixed).map((n) => n.id));
  const candidateUnknown = network.nodes.filter((n) => !fixedIds.has(n.id) && inboundElements.get(n.id).length > 0);
  const unknownIndex = new Map(candidateUnknown.map((n, i) => [n.id, i]));
  const m = candidateUnknown.length;

  const M = Array.from({ length: m }, () => new Array(m).fill(0));
  const b = new Array(m).fill(0);
  const transferCache = new Map(); // elementId -> { a, b, effectiveness }

  for (const node of candidateUnknown) {
    const row = unknownIndex.get(node.id);
    let capacitySum = 0;
    for (const { el, upstreamId, Q } of inboundElements.get(node.id)) {
      const mod = getElementModule(el.type);
      const transfer = mod.thermalTransfer({ Q, params: el.params, fluid: network.fluid });
      transferCache.set(el.id, transfer);
      const massFlowCp = network.fluid.density * Math.abs(Q) * network.fluid.specificHeat;
      capacitySum += massFlowCp;

      if (fixedIds.has(upstreamId)) {
        const upstreamT = nodeById.get(upstreamId).boundary.temperature.value;
        b[row] += massFlowCp * (transfer.a * upstreamT + transfer.b);
      } else if (unknownIndex.has(upstreamId)) {
        M[row][unknownIndex.get(upstreamId)] += -massFlowCp * transfer.a;
        b[row] += massFlowCp * transfer.b;
      } else {
        warnings.push({
          severity: 'warning',
          code: 'INDETERMINATE_UPSTREAM_TEMPERATURE',
          message: `Node "${node.name}" receives flow from an element whose upstream temperature is indeterminate`,
          ref: node.id,
        });
        b[row] += massFlowCp * transfer.b;
      }
    }
    M[row][row] += capacitySum;
  }

  let solvedTemps = [];
  if (m > 0) {
    const { x, singular } = solveLinearSystem(M, b);
    if (singular) {
      errors.push({ severity: 'error', code: 'SINGULAR_THERMAL_SYSTEM', message: 'Thermal energy-balance system is singular' });
    } else {
      solvedTemps = x;
    }
  }

  const nodeTemperatures = {};
  for (const node of network.nodes) {
    if (fixedIds.has(node.id)) {
      nodeTemperatures[node.id] = node.boundary.temperature.value;
    } else if (unknownIndex.has(node.id) && solvedTemps.length) {
      nodeTemperatures[node.id] = solvedTemps[unknownIndex.get(node.id)];
    } else {
      nodeTemperatures[node.id] = null;
      warnings.push({
        severity: 'warning',
        code: 'TEMPERATURE_INDETERMINATE',
        message: `Node "${node.name}" temperature could not be determined (no flow reaches it and it has no fixed temperature)`,
        ref: node.id,
      });
    }
  }

  const elementResults = {};
  for (const el of network.elements) {
    const Q = flows.get(el.id);
    if (!el.enabled || Math.abs(Q) <= FLOW_EPSILON) {
      elementResults[el.id] = { inletTemperature: null, outletTemperature: null, heatDuty: 0 };
      continue;
    }
    const { upstreamId } = endpoints(el, Q);
    const tIn = nodeTemperatures[upstreamId];
    let transfer = transferCache.get(el.id);
    if (!transfer) {
      const mod = getElementModule(el.type);
      transfer = mod.thermalTransfer({ Q, params: el.params, fluid: network.fluid });
    }
    const tOut = Number.isFinite(tIn) ? transfer.a * tIn + transfer.b : null;
    const massFlowCp = network.fluid.density * Math.abs(Q) * network.fluid.specificHeat;
    const heatDuty = Number.isFinite(tIn) && Number.isFinite(tOut) ? massFlowCp * (tIn - tOut) : null;
    // inlet/outlet reported in the physical (upstream->downstream) sense,
    // but keyed for consumers by source/target via sourceIsUpstream flag.
    elementResults[el.id] = {
      inletTemperature: tIn,
      outletTemperature: tOut,
      heatDuty,
      sourceIsUpstream: upstreamId === el.sourceNodeId,
      effectiveness: transfer.effectiveness,
    };
  }

  return { nodeTemperatures, elementResults, warnings, errors };
}

/** Writes a solveThermal() result onto (a copy of) the network's computed.* fields. */
export function applyThermalResult(network, result) {
  const updated = { ...network, nodes: network.nodes.map((n) => ({ ...n, computed: { ...n.computed } })), elements: network.elements.map((e) => ({ ...e, computed: { ...e.computed } })) };
  for (const node of updated.nodes) {
    if (result.nodeTemperatures[node.id] !== undefined) node.computed.temperature = result.nodeTemperatures[node.id];
  }
  for (const el of updated.elements) {
    const r = result.elementResults[el.id];
    if (!r) continue;
    el.computed.inletTemperature = r.inletTemperature;
    el.computed.outletTemperature = r.outletTemperature;
    el.computed.heatDuty = r.heatDuty;
  }
  return updated;
}
