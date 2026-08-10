// Public API surface of the solver core. Framework/DOM independent --
// importable unmodified by Node (tests) and by the browser (no bundler).
export * from './model.js';
export { validateNetwork } from './validate.js';
export { solveHydraulics, applyHydraulicResult } from './hydraulics.js';
export { solveThermal, applyThermalResult } from './thermal.js';
export { buildDiagnostics } from './diagnostics.js';
export { optimizeAdmittances, applyOptimizationResult } from './optimize.js';
export { exportNetwork, importNetwork, serializeNetwork } from './io.js';
export { buildExampleNetwork } from './example.js';
export { buildComplexExampleNetwork } from './complexExample.js';
export { buildNet1BenchmarkNetwork } from './net1BenchmarkExample.js';
export { buildThreeReservoirBenchmarkNetwork } from './threeReservoirExample.js';
export { getElementModule } from './elements/index.js';

import { validateNetwork } from './validate.js';
import { solveHydraulics, applyHydraulicResult } from './hydraulics.js';
import { solveThermal, applyThermalResult } from './thermal.js';
import { buildDiagnostics } from './diagnostics.js';

/**
 * Runs the full validate -> hydraulic -> thermal pipeline and returns both
 * an updated (non-mutated-input) network with computed.* fields populated
 * and a normalized diagnostics object for the UI.
 */
export function solveNetwork(network, options = {}) {
  const validation = validateNetwork(network);
  if (!validation.valid) {
    return { network, diagnostics: buildDiagnostics({ validation, hydraulic: null, thermal: null }) };
  }

  const hydraulic = solveHydraulics(network, options.hydraulic);
  let updated = applyHydraulicResult(network, hydraulic);

  let thermal = null;
  if (hydraulic.status !== 'invalidNetwork' && hydraulic.status !== 'singularJacobian') {
    thermal = solveThermal(updated, hydraulic);
    updated = applyThermalResult(updated, thermal);
  }

  return { network: updated, diagnostics: buildDiagnostics({ validation, hydraulic, thermal }) };
}
