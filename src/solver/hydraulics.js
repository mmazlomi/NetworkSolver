// Steady-state hydraulic solver: Newton-Raphson on node pressures (heads),
// with element flows given generically by each element module's flow()
// function. See docs/research.md section 6 / docs/technical_specs.md for
// the full derivation.
import { getElementModule } from './elements/index.js';
import { getEffectiveElevation } from './model.js';
import { solveLinearSystem, normInf } from './linalg.js';

const DEFAULT_OPTIONS = {
  maxIterations: 100,
  flowTolerance: 1e-6, // m^3/s
  headTolerance: 1e-2, // Pa
  finiteDiffStep: 1e-2, // Pa perturbation for the Jacobian
  initialGuess: 1e5, // Pa, used when no fixed-pressure node exists nearby
};

function evaluateElements(network, nodeById, pressureOf) {
  const results = new Map();
  for (const el of network.elements) {
    const source = nodeById.get(el.sourceNodeId);
    const target = nodeById.get(el.targetNodeId);
    const mod = getElementModule(el.type);
    const pIn = pressureOf.get(el.sourceNodeId);
    const pOut = pressureOf.get(el.targetNodeId);
    const out = mod.flow({
      pIn,
      pOut,
      zIn: getEffectiveElevation(source),
      zOut: getEffectiveElevation(target),
      admittance: el.admittance.current,
      fluid: network.fluid,
      enabled: el.enabled,
      params: el.params,
      headlossModel: network.headlossModel,
    });
    results.set(el.id, out);
  }
  return results;
}

/**
 * Runs the steady-state hydraulic Newton-Raphson solve.
 * Does not mutate the input network; call applyHydraulicResult() to write
 * results back onto a network object.
 * @returns {object} structured result with status/diagnostics.
 */
export function solveHydraulics(network, userOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  const warnings = [];
  const errors = [];

  const fixedNodes = network.nodes.filter((n) => n.boundary.pressure.fixed);
  const unknownNodes = network.nodes.filter((n) => !n.boundary.pressure.fixed);

  if (fixedNodes.length === 0) {
    return {
      status: 'invalidNetwork',
      converged: false,
      iterations: 0,
      errors: [{ severity: 'error', code: 'NO_PRESSURE_REFERENCE', message: 'No fixed-pressure node to solve against' }],
      warnings,
      history: [],
      nodePressures: {},
      elementResults: {},
    };
  }

  const nodeIndex = new Map(unknownNodes.map((n, i) => [n.id, i]));
  const nodeById = new Map(network.nodes.map((nd) => [nd.id, nd]));
  const n = unknownNodes.length;

  const seedGuess = fixedNodes.reduce((sum, node) => sum + node.boundary.pressure.value, 0) / fixedNodes.length;
  let x = unknownNodes.map((node) =>
    Number.isFinite(node.computed.pressure) ? node.computed.pressure : (seedGuess ?? options.initialGuess));

  function pressureAccessor(xVec) {
    const map = new Map();
    for (const node of fixedNodes) map.set(node.id, node.boundary.pressure.value);
    unknownNodes.forEach((node, i) => map.set(node.id, xVec[i]));
    return map;
  }

  function residualVector(xVec) {
    const pressureOf = pressureAccessor(xVec);
    const elementResults = evaluateElements(network, nodeById, pressureOf);
    const residual = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      residual[i] = -(unknownNodes[i].boundary.flow.value || 0);
    }
    for (const el of network.elements) {
      const { Q } = elementResults.get(el.id);
      const si = nodeIndex.get(el.sourceNodeId);
      const ti = nodeIndex.get(el.targetNodeId);
      if (si !== undefined) residual[si] += Q;
      if (ti !== undefined) residual[ti] -= Q;
    }
    return { residual, elementResults, pressureOf };
  }

  const history = [];
  let status = 'maxIterationsReached';
  let converged = false;
  let iterations = 0;
  let last = residualVector(x);

  if (n === 0) {
    converged = true;
    status = 'converged';
  }

  for (let iter = 0; iter < options.maxIterations && !converged; iter++) {
    iterations = iter + 1;
    const { residual: r0 } = last;
    const rNorm0 = normInf(r0);

    if (rNorm0 < options.flowTolerance) {
      converged = true;
      status = 'converged';
      break;
    }

    const J = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const h = options.finiteDiffStep;
      const xPerturbed = x.slice();
      xPerturbed[j] += h;
      const { residual: rP } = residualVector(xPerturbed);
      for (let i = 0; i < n; i++) J[i][j] = (rP[i] - r0[i]) / h;
    }

    const { x: dx, singular } = solveLinearSystem(J, r0.map((v) => -v));
    if (singular) {
      status = 'singularJacobian';
      errors.push({ severity: 'error', code: 'SINGULAR_JACOBIAN', message: `Hydraulic Jacobian is singular at iteration ${iterations}; network may be underdetermined` });
      break;
    }

    let factor = 1;
    let accepted = null;
    while (factor > 1e-4) {
      const xTrial = x.map((v, i) => v + factor * dx[i]);
      const trial = residualVector(xTrial);
      if (normInf(trial.residual) < rNorm0 || factor <= 2e-4) {
        accepted = { xTrial, trial };
        break;
      }
      factor /= 2;
    }
    if (!accepted) {
      status = 'stalled';
      break;
    }

    const maxDx = normInf(accepted.xTrial.map((v, i) => v - x[i]));
    x = accepted.xTrial;
    last = accepted.trial;
    history.push({ iteration: iterations, residualNorm: normInf(last.residual), maxDx, stepFactor: factor });

    if (normInf(last.residual) < options.flowTolerance && maxDx < options.headTolerance) {
      converged = true;
      status = 'converged';
    }
  }

  const { elementResults, pressureOf } = last;
  const nodePressures = {};
  for (const node of network.nodes) nodePressures[node.id] = pressureOf.get(node.id);

  const netFlowByNode = new Map(network.nodes.map((nd) => [nd.id, 0]));
  const elementOut = {};
  for (const el of network.elements) {
    const r = elementResults.get(el.id);
    elementOut[el.id] = r;
    netFlowByNode.set(el.sourceNodeId, netFlowByNode.get(el.sourceNodeId) + r.Q);
    netFlowByNode.set(el.targetNodeId, netFlowByNode.get(el.targetNodeId) - r.Q);
    if (!r.valid) {
      for (const msg of r.messages) {
        warnings.push({ severity: 'warning', code: 'ELEMENT_CONSTRAINT_VIOLATED', message: `${el.name}: ${msg}`, ref: el.id });
      }
    }
    if (!Number.isFinite(r.Q)) {
      errors.push({ severity: 'error', code: 'NON_FINITE_FLOW', message: `Element "${el.name}" produced a non-finite flow`, ref: el.id });
    }
  }

  const massBalanceResidual = {};
  for (const node of network.nodes) {
    const externalInjection = node.boundary.pressure.fixed ? null : (node.boundary.flow.value || 0);
    const net = netFlowByNode.get(node.id);
    massBalanceResidual[node.id] = externalInjection == null ? net : net - externalInjection;
  }

  if (!converged && status === 'maxIterationsReached') {
    warnings.push({ severity: 'warning', code: 'MAX_ITERATIONS_REACHED', message: `Hydraulic solve did not converge within ${options.maxIterations} iterations` });
  }

  return {
    status,
    converged,
    iterations,
    residualNorm: normInf(last.residual),
    history,
    errors,
    warnings,
    nodePressures,
    massBalanceResidual,
    elementResults: elementOut,
  };
}

/** Writes a solveHydraulics() result onto (a copy of) the network's computed.* fields. */
export function applyHydraulicResult(network, result) {
  const updated = { ...network, nodes: network.nodes.map((n) => ({ ...n, computed: { ...n.computed } })), elements: network.elements.map((e) => ({ ...e, computed: { ...e.computed } })) };
  for (const node of updated.nodes) {
    if (result.nodePressures[node.id] !== undefined) node.computed.pressure = result.nodePressures[node.id];
    if (result.massBalanceResidual[node.id] !== undefined) node.computed.massBalanceResidual = result.massBalanceResidual[node.id];
  }
  for (const el of updated.elements) {
    const r = result.elementResults[el.id];
    if (!r) continue;
    el.computed.flow = r.Q;
    el.computed.pressureDrop = r.deltaPressure;
    el.computed.valid = r.valid;
    el.computed.messages = r.messages;
  }
  return updated;
}
