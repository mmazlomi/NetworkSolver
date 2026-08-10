// Simultaneous admittance goal-seek: a bounded Gauss-Newton / Levenberg-
// Marquardt-style multi-variable solver. Every candidate admittance vector
// triggers a full hydraulic re-solve (the network is never partially
// re-solved), matching the requirement that coupled branches be handled
// exactly rather than approximated. See docs/research.md 2.4/4 and
// docs/technical_specs.md for the algorithm derivation.
import { solveHydraulics } from './hydraulics.js';
import { solveLinearSystem, norm2 } from './linalg.js';
import { findElement } from './model.js';

const MIN_ADMITTANCE_FLOOR = 1e-9;

function resolveBounds(network, adjustable) {
  return adjustable.map((adj) => {
    const el = findElement(network, adj.elementId);
    const min = Math.max(adj.min ?? el.admittance.min ?? MIN_ADMITTANCE_FLOOR, MIN_ADMITTANCE_FLOOR);
    const max = Math.max(adj.max ?? el.admittance.max ?? min, min);
    return { elementId: adj.elementId, min, max };
  });
}

function clip(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function applyAdmittances(network, bounds, x) {
  const values = new Map(bounds.map((b, i) => [b.elementId, clip(x[i], b.min, b.max)]));
  return {
    ...network,
    elements: network.elements.map((el) => (values.has(el.id)
      ? { ...el, admittance: { ...el.admittance, current: values.get(el.id) } }
      : el)),
  };
}

function evaluate(network, bounds, targets, x, hydraulicOptions) {
  const trialNetwork = applyAdmittances(network, bounds, x);
  const hydraulic = solveHydraulics(trialNetwork, hydraulicOptions);
  const actualFlows = targets.map((t) => {
    const r = hydraulic.elementResults[t.elementId];
    return r ? r.Q : NaN;
  });
  const residuals = actualFlows.map((q, i) => (Number.isFinite(q) ? q - targets[i].targetFlow : 1e3));
  return { hydraulic, actualFlows, residuals, residualNorm: norm2(residuals) };
}

/**
 * @param {object} network base network (not mutated)
 * @param {object} config { targets: [{elementId, targetFlow}], adjustable: [{elementId, min, max}], tolerance, maxIterations, hydraulicOptions }
 * @returns {object} optimization result with history and the best feasible iterate
 */
export function optimizeAdmittances(network, config) {
  const { targets, adjustable, tolerance = 1e-4, maxIterations = 50, hydraulicOptions } = config;
  const warnings = [];

  if (targets.length === 0 || adjustable.length === 0) {
    return {
      status: 'invalidConfiguration',
      warnings: ['At least one target and one adjustable element are required'],
      history: [],
      best: null,
    };
  }
  for (const t of targets) {
    if (!findElement(network, t.elementId)) {
      return { status: 'invalidConfiguration', warnings: [`Target element "${t.elementId}" not found`], history: [], best: null };
    }
  }
  for (const a of adjustable) {
    const el = findElement(network, a.elementId);
    if (!el) return { status: 'invalidConfiguration', warnings: [`Adjustable element "${a.elementId}" not found`], history: [], best: null };
    if (el.type !== 'pipe' && el.type !== 'valve' && el.type !== 'heatExchanger') {
      return { status: 'invalidConfiguration', warnings: [`Adjustable element "${a.elementId}" must be a pipe, valve, or heat exchanger`], history: [], best: null };
    }
  }
  if (adjustable.length < targets.length) {
    warnings.push('Fewer adjustable elements than targets: the configuration may be overconstrained');
  }

  const bounds = resolveBounds(network, adjustable);
  let x = bounds.map((b) => {
    const el = findElement(network, b.elementId);
    return clip(el.admittance.current ?? (b.min + b.max) / 2, b.min, b.max);
  });

  const p = x.length;
  const history = [];
  let lambda = 1e-3;
  let current = evaluate(network, bounds, targets, x, hydraulicOptions);
  let best = snapshot(0, x, bounds, targets, current, 'seed');
  history.push(best);

  let status = 'maxIterationsReached';
  if (current.residualNorm < tolerance && current.hydraulic.converged) {
    status = 'converged';
  }

  let iteration = 0;
  while (status === 'maxIterationsReached' && iteration < maxIterations) {
    iteration += 1;

    const J = Array.from({ length: targets.length }, () => new Array(p).fill(0));
    for (let j = 0; j < p; j++) {
      const step = Math.max(Math.abs(x[j]) * 1e-3, (bounds[j].max - bounds[j].min) * 1e-4, 1e-9);
      const xPerturbed = x.slice();
      xPerturbed[j] = clip(x[j] + step, bounds[j].min, bounds[j].max);
      const actualStep = xPerturbed[j] - x[j];
      if (Math.abs(actualStep) < 1e-15) continue;
      const perturbed = evaluate(network, bounds, targets, xPerturbed, hydraulicOptions);
      for (let i = 0; i < targets.length; i++) {
        J[i][j] = (perturbed.residuals[i] - current.residuals[i]) / actualStep;
      }
    }

    // Levenberg-Marquardt normal equations: (J^T J + lambda*I) dx = -J^T r
    const JT_J = Array.from({ length: p }, () => new Array(p).fill(0));
    const JT_r = new Array(p).fill(0);
    for (let a = 0; a < p; a++) {
      for (let b = 0; b < p; b++) {
        let sum = 0;
        for (let i = 0; i < targets.length; i++) sum += J[i][a] * J[i][b];
        JT_J[a][b] = sum;
      }
      let sumR = 0;
      for (let i = 0; i < targets.length; i++) sumR += J[i][a] * current.residuals[i];
      JT_r[a] = sumR;
    }
    for (let a = 0; a < p; a++) JT_J[a][a] += lambda * Math.max(JT_J[a][a], 1e-12);

    const { x: dx, singular } = solveLinearSystem(JT_J, JT_r.map((v) => -v));
    if (singular) {
      status = 'stalled';
      break;
    }

    const xTrial = x.map((v, i) => clip(v + dx[i], bounds[i].min, bounds[i].max));
    const trial = evaluate(network, bounds, targets, xTrial, hydraulicOptions);

    const improved = trial.hydraulic.converged && trial.residualNorm < current.residualNorm;
    const entry = snapshot(iteration, xTrial, bounds, targets, trial, improved ? 'accepted' : 'rejected');
    history.push(entry);

    if (improved) {
      x = xTrial;
      current = trial;
      lambda = Math.max(lambda / 3, 1e-8);
      if (current.hydraulic.converged && current.residualNorm < best.residualNorm) best = entry;
      if (current.residualNorm < tolerance) {
        status = 'converged';
      }
    } else {
      lambda = Math.min(lambda * 4, 1e8);
      if (lambda >= 1e8) {
        status = 'stalled';
      }
    }
  }

  if (status === 'maxIterationsReached' || status === 'stalled') {
    const atBounds = bounds.every((b) => {
      const v = best.admittances[b.elementId];
      return v <= b.min + 1e-9 || v >= b.max - 1e-9;
    });
    if (atBounds && best.residualNorm > tolerance) status = 'unreachableTarget';
  }

  return { status, warnings, history, best, targets, adjustable: bounds };
}

function snapshot(iteration, x, bounds, targets, evalResult, note) {
  const admittances = {};
  const boundsReached = [];
  bounds.forEach((b, i) => {
    admittances[b.elementId] = x[i];
    if (x[i] <= b.min + 1e-9) boundsReached.push({ elementId: b.elementId, bound: 'min' });
    else if (x[i] >= b.max - 1e-9) boundsReached.push({ elementId: b.elementId, bound: 'max' });
  });
  const actualFlows = {};
  const targetErrors = {};
  targets.forEach((t, i) => {
    actualFlows[t.elementId] = evalResult.actualFlows[i];
    targetErrors[t.elementId] = evalResult.residuals[i];
  });
  return {
    iteration,
    note,
    admittances,
    actualFlows,
    targetErrors,
    residualNorm: evalResult.residualNorm,
    boundsReached,
    hydraulicStatus: evalResult.hydraulic.status,
    hydraulicConverged: evalResult.hydraulic.converged,
  };
}

/** Applies an optimization result's best admittances back onto (a copy of) the network. */
export function applyOptimizationResult(network, result) {
  if (!result || !result.best) return network;
  const admittances = result.best.admittances;
  return {
    ...network,
    elements: network.elements.map((el) => (admittances[el.id] !== undefined
      ? { ...el, admittance: { ...el.admittance, current: admittances[el.id] } }
      : el)),
  };
}
