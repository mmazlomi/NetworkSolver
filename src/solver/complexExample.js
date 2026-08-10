// Built-in "Complex Network" example: a larger multi-manifold utility loop
// used to stress-test the solver and the goal-seek optimizer beyond the
// simple series/parallel demonstration in example.js. Exposed through the
// same "Load Example" mechanism (see src/web/js/state.js EXAMPLES
// registry) -- this module only builds the network; it adds no new
// solver/UI machinery.
//
// Topology summary (see docs/user_manual.md and docs/test_report.md for
// the full write-up):
//   - 5 boundary nodes: main supply, main return, auxiliary supply,
//     secondary sink, and a fixed-flow extraction/demand point.
//   - A main trunk from the main supply, through the main circulation
//     pump, splitting at a trunk junction into two independent paths that
//     both reach Manifold 2 -- one through Manifold 1's four parallel
//     branches + a booster pump, the other through a short loop-bridge
//     valve -- forming a genuine topological loop (a hydraulically
//     coupled region), plus a third independent inflow to Manifold 2 from
//     the auxiliary supply boundary.
//   - Manifold 2 fans out into four more branches: three rejoin at a
//     second merge point, the fourth exits directly to the secondary sink
//     boundary.
//   - From the second merge point, flow splits again toward the
//     fixed-flow extraction boundary and the main return (through a
//     second booster pump and a return-side heat exchanger).
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

function pipeParams(overrides = {}) {
  return {
    length: 12, diameter: 0.06, roughness: 0.00015, localLossCoefficient: 0.6,
    ambientTemperature: 18, heatTransferCoefficient: 2.5, ...overrides,
  };
}

export function buildComplexExampleNetwork() {
  const fluid = createFluid();
  const P = (overrides) => withNominalAdmittance(createElement('pipe', overrides), fluid);
  const V = (overrides) => withNominalAdmittance(createElement('valve', overrides), fluid);

  // ---- boundary nodes ---------------------------------------------------
  const bMainSupply = createNode({
    id: 'n_main_supply', name: 'Main Supply Header', x: 40, y: 300,
    boundary: { pressure: { fixed: true, value: 420000 }, temperature: { fixed: true, value: 82 } },
  });
  const bMainReturn = createNode({
    id: 'n_main_return', name: 'Main Return Header', x: 1650, y: 280,
    boundary: { pressure: { fixed: true, value: 140000 } },
  });
  const bAuxSupply = createNode({
    id: 'n_aux_supply', name: 'Auxiliary Supply Header', x: 40, y: 700,
    boundary: { pressure: { fixed: true, value: 320000 }, temperature: { fixed: true, value: 58 } },
  });
  const bSecondarySink = createNode({
    id: 'n_secondary_sink', name: 'Secondary Sink', x: 1600, y: 760,
    boundary: { pressure: { fixed: true, value: 130000 } },
  });
  const bExtraction = createNode({
    id: 'n_extraction', name: 'Process Extraction Point', x: 1420, y: 900,
    boundary: { flow: { fixed: true, value: -0.006 } },
  });

  // ---- internal nodes -----------------------------------------------
  const jPumpOut = createNode({ id: 'n_pump1_out', name: 'Main Pump Discharge', x: 160, y: 300 });
  const jTrunkPre = createNode({ id: 'n_trunk_pre', name: 'Trunk Pre-Junction', x: 260, y: 300 });
  const jTrunk = createNode({ id: 'n_trunk', name: 'Trunk Split', x: 360, y: 300 });
  const jLoopMid = createNode({ id: 'n_loop_mid', name: 'Loop Bridge Mid', x: 480, y: 650 });

  const nManifold1 = createNode({ id: 'n_manifold1', name: 'Manifold 1', x: 480, y: 260 });
  const jM1B1 = createNode({ id: 'n_m1_b1', name: 'M1 Branch 1 Mid', x: 620, y: 90 });
  const jM1B2 = createNode({ id: 'n_m1_b2', name: 'M1 Branch 2 Mid', x: 620, y: 190 });
  const jM1B3a = createNode({ id: 'n_m1_b3a', name: 'M1 Branch 3 Mid A', x: 620, y: 300 });
  const jM1B3b = createNode({ id: 'n_m1_b3b', name: 'M1 Branch 3 Mid B', x: 720, y: 320 });
  const jM1B3c = createNode({ id: 'n_m1_b3c', name: 'M1 Branch 3 Mid C', x: 820, y: 340 });
  const jM1B4 = createNode({ id: 'n_m1_b4', name: 'M1 Branch 4 Mid', x: 620, y: 430 });
  const jMerge1 = createNode({ id: 'n_merge1', name: 'Manifold 1 Merge', x: 900, y: 260 });
  const jBridgeOut = createNode({ id: 'n_bridge_out', name: 'Bridge Pump Discharge', x: 1030, y: 260 });

  const jAuxPre = createNode({ id: 'n_aux_pre', name: 'Auxiliary Header Junction', x: 160, y: 700 });
  const jAuxOut = createNode({ id: 'n_aux_pumpout', name: 'Auxiliary Pump Discharge', x: 280, y: 700 });

  const nManifold2 = createNode({ id: 'n_manifold2', name: 'Manifold 2', x: 1160, y: 460 });
  const jM2B1 = createNode({ id: 'n_m2_b1', name: 'M2 Branch 1 Mid', x: 1260, y: 320 });
  const jM2B2a = createNode({ id: 'n_m2_b2a', name: 'M2 Branch 2 Mid A', x: 1260, y: 400 });
  const jM2B2b = createNode({ id: 'n_m2_b2b', name: 'M2 Branch 2 Mid B', x: 1320, y: 400 });
  const jM2B3a = createNode({ id: 'n_m2_b3a', name: 'M2 Branch 3 Mid A', x: 1260, y: 520 });
  const jM2B3b = createNode({ id: 'n_m2_b3b', name: 'M2 Branch 3 Mid B', x: 1320, y: 540 });
  const jM2B4 = createNode({ id: 'n_m2_b4', name: 'M2 Branch 4 Mid', x: 1250, y: 650 });
  const jSinkPre = createNode({ id: 'n_sink_pre', name: 'Secondary Sink Feeder', x: 1380, y: 720 });
  const jMerge2 = createNode({ id: 'n_merge2', name: 'Manifold 2 Merge', x: 1400, y: 460 });

  const jExtractMid = createNode({ id: 'n_extract_mid', name: 'Extraction Feeder', x: 1380, y: 700 });

  const jRet1 = createNode({ id: 'n_ret1', name: 'Return Pre-Pump', x: 1470, y: 380 });
  const jRet2 = createNode({ id: 'n_ret2', name: 'Return Pump Discharge', x: 1540, y: 380 });
  const jRet3 = createNode({ id: 'n_ret3', name: 'Return Pre-HX', x: 1580, y: 340 });
  const jRet4 = createNode({ id: 'n_ret4', name: 'Return HX Outlet', x: 1610, y: 320 });
  const jRet5 = createNode({ id: 'n_ret5', name: 'Return Final Junction', x: 1630, y: 300 });

  const nodes = [
    bMainSupply, bMainReturn, bAuxSupply, bSecondarySink, bExtraction,
    jPumpOut, jTrunkPre, jTrunk, jLoopMid,
    nManifold1, jM1B1, jM1B2, jM1B3a, jM1B3b, jM1B3c, jM1B4, jMerge1, jBridgeOut,
    jAuxPre, jAuxOut,
    nManifold2, jM2B1, jM2B2a, jM2B2b, jM2B3a, jM2B3b, jM2B4, jSinkPre, jMerge2,
    jExtractMid,
    jRet1, jRet2, jRet3, jRet4, jRet5,
  ];

  // ---- elements -----------------------------------------------------
  const elements = [];

  // Main trunk (series): supply -> pump -> two pipes -> trunk split.
  elements.push(createElement('pump', {
    id: 'el_pump_main', name: 'Main Circulation Pump', sourceNodeId: bMainSupply.id, targetNodeId: jPumpOut.id,
    params: { mode: 'curve', curveShutoffHead: 130000, nominalFlow: 0.024, nominalHead: 95000, efficiency: 0.74, direction: 'sourceToTarget', thermalContribution: true },
  }));
  elements.push(P({
    id: 'el_trunk1a', name: 'Trunk Pipe 1a', sourceNodeId: jPumpOut.id, targetNodeId: jTrunkPre.id,
    params: pipeParams({ length: 15, diameter: 0.08 }), admittance: { min: 5e-5, max: 5e-3 },
  }));
  elements.push(P({
    id: 'el_trunk1b', name: 'Trunk Pipe 1b', sourceNodeId: jTrunkPre.id, targetNodeId: jTrunk.id,
    params: pipeParams({ length: 12, diameter: 0.08 }), admittance: { min: 5e-5, max: 5e-3 },
  }));

  // Loop bridge: trunk split -> pipe -> valve -> Manifold 2 (short path).
  elements.push(P({
    id: 'el_loop_bridge_pipe', name: 'Loop Bridge Pipe', sourceNodeId: jTrunk.id, targetNodeId: jLoopMid.id,
    params: pipeParams({ length: 30, diameter: 0.05 }), admittance: { min: 2e-5, max: 3e-3 },
  }));
  elements.push(V({
    id: 'el_loop_bridge_valve', name: 'Loop Bridge Valve', sourceNodeId: jLoopMid.id, targetNodeId: nManifold2.id,
    params: { openingPercent: 55, kvRated: 16, characteristic: 'equalPercentage' }, admittance: { min: 1e-6, max: 1e-3 },
  }));

  // Trunk split -> Manifold 1 (long path).
  elements.push(P({
    id: 'el_trunk2', name: 'Trunk Pipe 2 (to Manifold 1)', sourceNodeId: jTrunk.id, targetNodeId: nManifold1.id,
    params: pipeParams({ length: 14, diameter: 0.07 }), admittance: { min: 5e-5, max: 5e-3 },
  }));

  // Manifold 1: four parallel branches converging at Merge 1.
  elements.push(V({
    id: 'el_m1_b1_valve', name: 'M1 Branch1 Valve', sourceNodeId: nManifold1.id, targetNodeId: jM1B1.id,
    params: { openingPercent: 65, kvRated: 18, characteristic: 'linear' }, admittance: { min: 1e-6, max: 1e-3 },
  }));
  elements.push(createElement('heatExchanger', {
    id: 'el_m1_b1_hx', name: 'M1 Branch1 HX', sourceNodeId: jM1B1.id, targetNodeId: jMerge1.id,
    params: { ua: 6000, effectivenessMode: 'ua', secondaryTemperature: 22, secondaryCapacityRate: 4000, localLossCoefficient: 2 },
    admittance: { initial: 2.6e-4, current: 2.6e-4, min: 5e-5, max: 1e-3 },
  }));

  elements.push(P({
    id: 'el_m1_b2_pipe', name: 'M1 Branch2 Pipe', sourceNodeId: nManifold1.id, targetNodeId: jM1B2.id,
    params: pipeParams({ length: 16, diameter: 0.045 }), admittance: { min: 5e-6, max: 2e-3 },
  }));
  elements.push(V({
    id: 'el_m1_b2_valve', name: 'M1 Branch2 Valve', sourceNodeId: jM1B2.id, targetNodeId: jMerge1.id,
    params: { openingPercent: 60, kvRated: 15, characteristic: 'linear' }, admittance: { min: 1e-6, max: 1e-3 },
  }));

  elements.push(P({
    id: 'el_m1_b3_pipe_a', name: 'M1 Branch3 Pipe A', sourceNodeId: nManifold1.id, targetNodeId: jM1B3a.id,
    params: pipeParams({ length: 10, diameter: 0.05 }), admittance: { min: 5e-6, max: 2e-3 },
  }));
  elements.push(V({
    id: 'el_m1_b3_valve', name: 'M1 Branch3 Valve', sourceNodeId: jM1B3a.id, targetNodeId: jM1B3b.id,
    params: { openingPercent: 60, kvRated: 20, characteristic: 'linear' }, admittance: { min: 1e-6, max: 1e-3 },
  }));
  elements.push(P({
    id: 'el_m1_b3_pipe_b', name: 'M1 Branch3 Pipe B', sourceNodeId: jM1B3b.id, targetNodeId: jM1B3c.id,
    params: pipeParams({ length: 9, diameter: 0.05 }), admittance: { min: 5e-6, max: 2e-3 },
  }));
  elements.push(createElement('heatExchanger', {
    id: 'el_m1_b3_hx', name: 'M1 Branch3 HX', sourceNodeId: jM1B3c.id, targetNodeId: jMerge1.id,
    params: { ua: 5000, effectivenessMode: 'ua', secondaryTemperature: 20, secondaryCapacityRate: 3500, localLossCoefficient: 2 },
    admittance: { initial: 2.4e-4, current: 2.4e-4, min: 5e-5, max: 1e-3 },
  }));

  elements.push(V({
    id: 'el_m1_b4_valve', name: 'M1 Branch4 Valve', sourceNodeId: nManifold1.id, targetNodeId: jM1B4.id,
    params: { openingPercent: 55, kvRated: 14, characteristic: 'linear' }, admittance: { min: 1e-6, max: 1e-3 },
  }));
  elements.push(P({
    id: 'el_m1_b4_pipe', name: 'M1 Branch4 Pipe', sourceNodeId: jM1B4.id, targetNodeId: jMerge1.id,
    params: pipeParams({ length: 18, diameter: 0.045 }), admittance: { min: 5e-6, max: 2e-3 },
  }));

  // Merge 1 -> booster pump -> Manifold 2 (completes the loop with the bridge).
  elements.push(createElement('pump', {
    id: 'el_pump_bridge', name: 'Bridge Booster Pump', sourceNodeId: jMerge1.id, targetNodeId: jBridgeOut.id,
    params: { mode: 'curve', curveShutoffHead: 35000, nominalFlow: 0.012, nominalHead: 25000, efficiency: 0.68, direction: 'sourceToTarget', thermalContribution: false },
  }));
  elements.push(P({
    id: 'el_bridge_pipe', name: 'Bridge Pipe to Manifold 2', sourceNodeId: jBridgeOut.id, targetNodeId: nManifold2.id,
    params: pipeParams({ length: 20, diameter: 0.07 }), admittance: { min: 5e-5, max: 5e-3 },
  }));

  // Auxiliary supply -> pump -> Manifold 2 (third independent inflow).
  elements.push(P({
    id: 'el_aux_header_pipe', name: 'Auxiliary Header Pipe', sourceNodeId: bAuxSupply.id, targetNodeId: jAuxPre.id,
    params: pipeParams({ length: 8, diameter: 0.07 }), admittance: { min: 5e-5, max: 5e-3 },
  }));
  elements.push(createElement('pump', {
    id: 'el_pump_aux', name: 'Auxiliary Supply Pump', sourceNodeId: jAuxPre.id, targetNodeId: jAuxOut.id,
    params: { mode: 'curve', curveShutoffHead: 55000, nominalFlow: 0.01, nominalHead: 38000, efficiency: 0.7, direction: 'sourceToTarget', thermalContribution: false },
  }));
  elements.push(P({
    id: 'el_aux_pipe', name: 'Auxiliary Supply Pipe', sourceNodeId: jAuxOut.id, targetNodeId: nManifold2.id,
    params: pipeParams({ length: 55, diameter: 0.06 }), admittance: { min: 2e-5, max: 3e-3 },
  }));

  // Manifold 2: four branches -- three converge at Merge 2, one exits to the secondary sink.
  elements.push(V({
    id: 'el_m2_b1_valve', name: 'M2 Branch1 Valve', sourceNodeId: nManifold2.id, targetNodeId: jM2B1.id,
    params: { openingPercent: 60, kvRated: 18, characteristic: 'linear' }, admittance: { min: 1e-6, max: 1e-3 },
  }));
  elements.push(P({
    id: 'el_m2_b1_pipe', name: 'M2 Branch1 Pipe', sourceNodeId: jM2B1.id, targetNodeId: jMerge2.id,
    params: pipeParams({ length: 14, diameter: 0.05 }), admittance: { min: 5e-6, max: 2e-3 },
  }));

  elements.push(P({
    id: 'el_m2_b2_pipe', name: 'M2 Branch2 Pipe', sourceNodeId: nManifold2.id, targetNodeId: jM2B2a.id,
    params: pipeParams({ length: 12, diameter: 0.05 }), admittance: { min: 5e-6, max: 2e-3 },
  }));
  elements.push(createElement('heatExchanger', {
    id: 'el_m2_b2_hx', name: 'M2 Branch2 HX', sourceNodeId: jM2B2a.id, targetNodeId: jM2B2b.id,
    params: { ua: 5500, effectivenessMode: 'ua', secondaryTemperature: 25, secondaryCapacityRate: 3800, localLossCoefficient: 2 },
    admittance: { initial: 2.5e-4, current: 2.5e-4, min: 5e-5, max: 1e-3 },
  }));
  elements.push(V({
    id: 'el_m2_b2_valve', name: 'M2 Branch2 Valve', sourceNodeId: jM2B2b.id, targetNodeId: jMerge2.id,
    params: { openingPercent: 60, kvRated: 17, characteristic: 'linear' }, admittance: { min: 1e-6, max: 1e-3 },
  }));

  elements.push(V({
    id: 'el_m2_b3_valve', name: 'M2 Branch3 Valve', sourceNodeId: nManifold2.id, targetNodeId: jM2B3a.id,
    params: { openingPercent: 60, kvRated: 16, characteristic: 'linear' }, admittance: { min: 1e-6, max: 1e-3 },
  }));
  elements.push(P({
    id: 'el_m2_b3_pipe_a', name: 'M2 Branch3 Pipe A', sourceNodeId: jM2B3a.id, targetNodeId: jM2B3b.id,
    params: pipeParams({ length: 11, diameter: 0.05 }), admittance: { min: 5e-6, max: 2e-3 },
  }));
  elements.push(P({
    id: 'el_m2_b3_pipe_b', name: 'M2 Branch3 Pipe B', sourceNodeId: jM2B3b.id, targetNodeId: jMerge2.id,
    params: pipeParams({ length: 11, diameter: 0.05 }), admittance: { min: 5e-6, max: 2e-3 },
  }));

  elements.push(V({
    id: 'el_m2_b4_valve', name: 'M2 to Secondary Sink Valve', sourceNodeId: nManifold2.id, targetNodeId: jM2B4.id,
    params: { openingPercent: 45, kvRated: 12, characteristic: 'quickOpening' }, admittance: { min: 1e-6, max: 1e-3 },
  }));
  elements.push(P({
    id: 'el_sink_pipe_a', name: 'Pipe to Secondary Sink A', sourceNodeId: jM2B4.id, targetNodeId: jSinkPre.id,
    params: pipeParams({ length: 20, diameter: 0.05 }), admittance: { min: 5e-6, max: 2e-3 },
  }));
  elements.push(P({
    id: 'el_sink_pipe_b', name: 'Pipe to Secondary Sink B', sourceNodeId: jSinkPre.id, targetNodeId: bSecondarySink.id,
    params: pipeParams({ length: 18, diameter: 0.05 }), admittance: { min: 5e-6, max: 2e-3 },
  }));

  // Merge 2 -> extraction boundary (fixed-flow demand). This branch must
  // carry the full fixed extraction flow at a modest pressure drop, since
  // the extraction node's pressure is a free unknown (not itself
  // pressure-fixed) -- an overly restrictive path here would force that
  // node's solved pressure deeply negative for no physical reason.
  elements.push(P({
    id: 'el_extract_pipe', name: 'Extraction Feed Pipe', sourceNodeId: jMerge2.id, targetNodeId: jExtractMid.id,
    params: pipeParams({ length: 6, diameter: 0.09 }), admittance: { min: 5e-6, max: 2e-3 },
  }));
  elements.push(V({
    id: 'el_extract_valve', name: 'Extraction Valve', sourceNodeId: jExtractMid.id, targetNodeId: bExtraction.id,
    params: { openingPercent: 85, kvRated: 55, characteristic: 'linear' }, admittance: { min: 1e-6, max: 1e-3 },
  }));

  // Merge 2 -> return booster pump -> return HX -> main return.
  elements.push(P({
    id: 'el_return_pipe1', name: 'Return Pipe 1', sourceNodeId: jMerge2.id, targetNodeId: jRet1.id,
    params: pipeParams({ length: 12, diameter: 0.08 }), admittance: { min: 5e-5, max: 5e-3 },
  }));
  elements.push(createElement('pump', {
    id: 'el_pump_return', name: 'Return Booster Pump', sourceNodeId: jRet1.id, targetNodeId: jRet2.id,
    params: { mode: 'curve', curveShutoffHead: 22000, nominalFlow: 0.02, nominalHead: 15000, efficiency: 0.7, direction: 'sourceToTarget', thermalContribution: false },
  }));
  elements.push(P({
    id: 'el_return_pipe2', name: 'Return Pipe 2', sourceNodeId: jRet2.id, targetNodeId: jRet3.id,
    params: pipeParams({ length: 8, diameter: 0.08 }), admittance: { min: 5e-5, max: 5e-3 },
  }));
  elements.push(createElement('heatExchanger', {
    id: 'el_return_hx', name: 'Return Cooling HX', sourceNodeId: jRet3.id, targetNodeId: jRet4.id,
    params: { ua: 7000, effectivenessMode: 'ua', secondaryTemperature: 12, secondaryCapacityRate: 5000, localLossCoefficient: 2 },
    admittance: { initial: 3e-4, current: 3e-4, min: 5e-5, max: 1e-3 },
  }));
  elements.push(P({
    id: 'el_return_pipe3a', name: 'Return Pipe 3a', sourceNodeId: jRet4.id, targetNodeId: jRet5.id,
    params: pipeParams({ length: 6, diameter: 0.08 }), admittance: { min: 5e-5, max: 5e-3 },
  }));
  elements.push(P({
    id: 'el_return_pipe3b', name: 'Return Pipe 3b', sourceNodeId: jRet5.id, targetNodeId: bMainReturn.id,
    params: pipeParams({ length: 6, diameter: 0.08 }), admittance: { min: 5e-5, max: 5e-3 },
  }));

  return createNetwork({
    meta: {
      name: 'Complex Network Example',
      description: 'A larger multi-manifold supply/return network with a main trunk, an auxiliary injection source, two distribution manifolds, a genuine hydraulic loop (Manifold 1 branches + booster pump vs. a direct loop-bridge valve, both reaching Manifold 2), a secondary sink exit, and a fixed-flow extraction boundary. Built to stress-test the steady-state solver and the coupled multi-variable admittance goal-seek on a larger topology than the basic series/parallel example.',
    },
    fluid,
    nodes,
    elements,
    goalSeek: {
      targets: [
        { elementId: 'el_m2_b1_pipe', targetFlow: 0.0042 },
        { elementId: 'el_m2_b2_hx', targetFlow: 0.0028 },
        { elementId: 'el_m2_b3_pipe_b', targetFlow: 0.0022 },
        { elementId: 'el_m1_b3_hx', targetFlow: 0.0033 },
      ],
      adjustable: [
        { elementId: 'el_m2_b1_valve', min: 1e-6, max: 1e-3 },
        { elementId: 'el_m2_b2_valve', min: 1e-6, max: 1e-3 },
        { elementId: 'el_m2_b3_valve', min: 1e-6, max: 1e-3 },
        { elementId: 'el_loop_bridge_valve', min: 1e-6, max: 1e-3 },
        { elementId: 'el_m1_b3_valve', min: 1e-6, max: 1e-3 },
      ],
      tolerance: 1e-4,
      maxIterations: 80,
      history: [],
    },
  });
}
