// Built-in example network: a pumped supply/return loop with one series
// main, two parallel branches (each pipe + valve), and a heat exchanger --
// used by the "Load Example" UI action and by the automated test suite
// (Phase 10 of the spec).
import { createNetwork, createNode, createFluid, createElement } from './model.js';
import { getElementModule } from './elements/index.js';

function withNominalAdmittance(element, fluid) {
  const mod = getElementModule(element.type);
  const nominal = mod.computeNominalAdmittance(element.params, fluid);
  if (nominal != null && nominal > 0) {
    element.admittance.initial = nominal;
    element.admittance.current = nominal;
  }
  return element;
}

export function buildExampleNetwork() {
  const fluid = createFluid();

  const n1 = createNode({
    id: 'n_supply', name: 'Supply Header', x: 60, y: 220, elevation: 0,
    boundary: {
      pressure: { fixed: true, value: 350000 },
      temperature: { fixed: true, value: 75 },
    },
  });
  const n2 = createNode({ id: 'n_pumpout', name: 'Pump Discharge', x: 220, y: 220 });
  const n3 = createNode({ id: 'n_branch', name: 'Branch Point', x: 380, y: 220 });
  const n3a = createNode({ id: 'n_branchA_mid', name: 'Branch A Mid', x: 480, y: 110 });
  const n3b = createNode({ id: 'n_branchB_mid', name: 'Branch B Mid', x: 480, y: 330 });
  const n4 = createNode({ id: 'n_merge', name: 'Merge Point', x: 600, y: 220 });
  const n5 = createNode({ id: 'n_hx_in', name: 'HX Inlet', x: 740, y: 220 });
  const n6 = createNode({ id: 'n_hx_out', name: 'HX Outlet', x: 880, y: 220 });
  const n7 = createNode({
    id: 'n_return', name: 'Return Header', x: 1020, y: 220, elevation: 0,
    boundary: {
      pressure: { fixed: true, value: 150000 },
    },
  });

  const nodes = [n1, n2, n3, n3a, n3b, n4, n5, n6, n7];

  const pump = createElement('pump', {
    id: 'el_pump', name: 'Circulation Pump', sourceNodeId: n1.id, targetNodeId: n2.id,
    params: {
      mode: 'curve', curveShutoffHead: 90000, nominalFlow: 0.018, nominalHead: 65000,
      speedFactor: 1, efficiency: 0.72, direction: 'sourceToTarget', thermalContribution: true,
    },
  });

  const pipeMain = withNominalAdmittance(createElement('pipe', {
    id: 'el_pipe_main', name: 'Main Supply Pipe', sourceNodeId: n2.id, targetNodeId: n3.id,
    params: { length: 20, diameter: 0.08, roughness: 0.00015, localLossCoefficient: 0.5, ambientTemperature: 18, heatTransferCoefficient: 3 },
    admittance: { min: 5e-5, max: 5e-3 },
  }), fluid);

  const valveA = withNominalAdmittance(createElement('valve', {
    id: 'el_valve_a', name: 'Branch A Valve', sourceNodeId: n3.id, targetNodeId: n3a.id,
    params: { openingPercent: 60, kvRated: 20, characteristic: 'linear' },
    admittance: { min: 1e-6, max: 1e-3 },
  }), fluid);

  const pipeA = withNominalAdmittance(createElement('pipe', {
    id: 'el_pipe_a', name: 'Branch A Pipe', sourceNodeId: n3a.id, targetNodeId: n4.id,
    params: { length: 15, diameter: 0.05, roughness: 0.00015, localLossCoefficient: 0.8, ambientTemperature: 18, heatTransferCoefficient: 2 },
    admittance: { min: 5e-6, max: 2e-3 },
  }), fluid);

  const pipeB = withNominalAdmittance(createElement('pipe', {
    id: 'el_pipe_b', name: 'Branch B Pipe', sourceNodeId: n3.id, targetNodeId: n3b.id,
    params: { length: 15, diameter: 0.05, roughness: 0.00015, localLossCoefficient: 0.8, ambientTemperature: 18, heatTransferCoefficient: 2 },
    admittance: { min: 5e-6, max: 2e-3 },
  }), fluid);

  const valveB = withNominalAdmittance(createElement('valve', {
    id: 'el_valve_b', name: 'Branch B Valve', sourceNodeId: n3b.id, targetNodeId: n4.id,
    params: { openingPercent: 60, kvRated: 20, characteristic: 'linear' },
    admittance: { min: 1e-6, max: 1e-3 },
  }), fluid);

  const pipeToHx = withNominalAdmittance(createElement('pipe', {
    id: 'el_pipe_hx_in', name: 'Pipe to Heat Exchanger', sourceNodeId: n4.id, targetNodeId: n5.id,
    params: { length: 10, diameter: 0.08, roughness: 0.00015, localLossCoefficient: 0.5, ambientTemperature: 18, heatTransferCoefficient: 3 },
    admittance: { min: 5e-5, max: 5e-3 },
  }), fluid);

  const heatExchanger = createElement('heatExchanger', {
    id: 'el_hx', name: 'Process Heat Exchanger', sourceNodeId: n5.id, targetNodeId: n6.id,
    params: {
      ua: 9000, effectivenessMode: 'ua', secondaryTemperature: 15, secondaryCapacityRate: 6000, localLossCoefficient: 2,
    },
    admittance: { initial: 2.2e-4, current: 2.2e-4, min: 5e-5, max: 1e-3 },
  });

  const pipeReturn = withNominalAdmittance(createElement('pipe', {
    id: 'el_pipe_return', name: 'Return Pipe', sourceNodeId: n6.id, targetNodeId: n7.id,
    params: { length: 20, diameter: 0.08, roughness: 0.00015, localLossCoefficient: 0.5, ambientTemperature: 18, heatTransferCoefficient: 3 },
    admittance: { min: 5e-5, max: 5e-3 },
  }), fluid);

  const elements = [pump, pipeMain, valveA, pipeA, pipeB, valveB, pipeToHx, heatExchanger, pipeReturn];

  return createNetwork({
    meta: {
      name: 'Series/Parallel Demonstration Loop',
      description: 'Pumped supply/return loop with a series main, two parallel branches (pipe+valve each), and a heat exchanger. Demonstrates series and parallel topology plus coupled multi-variable admittance goal-seek on the two branch valves.',
    },
    fluid,
    nodes,
    elements,
    goalSeek: {
      targets: [
        { elementId: 'el_pipe_a', targetFlow: 0.0075 },
        { elementId: 'el_pipe_b', targetFlow: 0.0035 },
      ],
      adjustable: [
        { elementId: 'el_valve_a', min: 1e-6, max: 1e-3 },
        { elementId: 'el_valve_b', min: 1e-6, max: 1e-3 },
      ],
      tolerance: 1e-5,
      maxIterations: 50,
      history: [],
    },
  });
}
