// Built-in "Three-Reservoir Problem" benchmark example: a classic textbook
// pipe-network problem, not tied to any particular software (unlike the
// EPANET Net1 benchmark) -- one of the standard worked examples used across
// fluid-mechanics/hydraulics texts to illustrate junction-node analysis.
//
// Source: Larock, B.E., Jeppson, R.W. and Watters, G.Z., "Hydraulics of
// Pipeline Systems" (2000, CRC Press), Example 2.7, p.26. Three reservoirs
// at different fixed elevations feed (or drain into) a single junction J,
// which also has a fixed external demand; the task is to find the flow in
// each pipe. Cross-checked against a second independent citation of the
// same example (a commercial pipe-network solver's published results
// verification) before being encoded here, since a "benchmark" is only
// useful if its reference numbers are trustworthy.
//
// Reservoir elevations: A = 100 m, B = 85 m, C = 60 m (A highest, C lowest).
// Pipes (Darcy-Weisbach, roughness 0.5 mm / 0.0005 m for all three, no
// minor losses in the source problem):
//   Pipe 1 (A -> J): L = 2000 m, D = 300 mm
//   Pipe 2 (B -> J): L = 1500 m, D = 250 mm
//   Pipe 3 (J -> C): L = 3000 m, D = 250 mm
// External demand at J: 0.06 m^3/s withdrawn from the network.
//
// Published reference solution: Q1 (A into J) = 0.1023 m^3/s, Q2 (B into
// J) = 0.02 m^3/s, Q3 (J into C) = 0.0622 m^3/s (these three balance the
// junction's mass balance together with the 0.06 m^3/s demand, to within
// the source's own rounding).
//
// NetworkSolver reproduces this to within ~2% (see test/example.test.js),
// not to 4 significant figures: the reference solves the Colebrook-White
// friction factor iteratively at each pipe's actual (converged) velocity,
// while NetworkSolver fixes each pipe's Darcy-Weisbach admittance once,
// from a friction factor evaluated at a single representative 1 m/s
// reference velocity (see docs/research.md 2.3/2.8 and pipe.js) -- a
// deliberate, already-documented simplification that trades a small,
// bounded accuracy loss for every element having a simple, invertible,
// closed-form Q(deltaP) relation. The reference's exact mass balance is a
// structural property of the Newton-Raphson solver, not of the friction
// model, so it still holds exactly regardless of this difference.
import { createNetwork, createNode, createElement, createFluid } from './model.js';
import { getElementModule } from './elements/index.js';

function withNominalAdmittance(element, fluid) {
  const nominal = getElementModule('pipe').computeNominalAdmittance(element.params, fluid, 'darcyWeisbach');
  if (nominal != null && nominal > 0) {
    element.admittance.initial = nominal;
    element.admittance.current = nominal;
    element.admittance.min = nominal * 0.05;
    element.admittance.max = nominal * 5;
  }
  return element;
}

export function buildThreeReservoirBenchmarkNetwork() {
  const fluid = createFluid(); // water

  const reservoirA = createNode({
    id: 'n_a', nodeType: 'reservoir', name: 'Reservoir A (highest)', x: 260, y: 140, elevation: 100,
    boundary: { temperature: { fixed: true, value: 20 } },
    notes: 'Larock/Jeppson/Watters Example 2.7: highest reservoir, water-surface elevation 100 m.',
  });
  const reservoirB = createNode({
    id: 'n_b', nodeType: 'reservoir', name: 'Reservoir B (middle)', x: 780, y: 140, elevation: 85,
    boundary: { temperature: { fixed: true, value: 20 } },
    notes: 'Larock/Jeppson/Watters Example 2.7: middle reservoir, water-surface elevation 85 m.',
  });
  const reservoirC = createNode({
    id: 'n_c', nodeType: 'reservoir', name: 'Reservoir C (lowest)', x: 520, y: 560, elevation: 60,
    boundary: { temperature: { fixed: true, value: 20 } },
    notes: 'Larock/Jeppson/Watters Example 2.7: lowest reservoir, water-surface elevation 60 m.',
  });
  const junction = createNode({
    id: 'n_j', name: 'Junction J', x: 520, y: 340, elevation: 0,
    boundary: { flow: { fixed: true, value: -0.06 }, temperature: { fixed: true, value: 20 } },
    notes: 'Larock/Jeppson/Watters Example 2.7: the common junction, with a fixed external demand of 0.06 m^3/s withdrawn from the network here.',
  });

  const pipeParams = (length, diameter) => ({
    length, diameter, roughness: 0.0005, localLossCoefficient: 0, ambientTemperature: 20, heatTransferCoefficient: 0,
  });

  const pipe1 = withNominalAdmittance(createElement('pipe', {
    id: 'el_p1', name: 'Pipe 1 (A-J)', sourceNodeId: reservoirA.id, targetNodeId: junction.id,
    params: pipeParams(2000, 0.3),
    notes: 'Example 2.7 Pipe 1: L=2000 m, D=300 mm. Reference solution: 0.1023 m^3/s from A into J.',
  }), fluid);
  const pipe2 = withNominalAdmittance(createElement('pipe', {
    id: 'el_p2', name: 'Pipe 2 (B-J)', sourceNodeId: reservoirB.id, targetNodeId: junction.id,
    params: pipeParams(1500, 0.25),
    notes: 'Example 2.7 Pipe 2: L=1500 m, D=250 mm. Reference solution: 0.02 m^3/s from B into J.',
  }), fluid);
  const pipe3 = withNominalAdmittance(createElement('pipe', {
    id: 'el_p3', name: 'Pipe 3 (J-C)', sourceNodeId: junction.id, targetNodeId: reservoirC.id,
    params: pipeParams(3000, 0.25),
    notes: 'Example 2.7 Pipe 3: L=3000 m, D=250 mm. Reference solution: 0.0622 m^3/s from J into C.',
  }), fluid);

  return createNetwork({
    meta: {
      name: 'Three-Reservoir Problem (Fluid Mechanics Handbook Benchmark)',
      description: 'The classic three-reservoir junction problem from Larock, Jeppson & Watters, '
        + '"Hydraulics of Pipeline Systems" (2000, CRC Press), Example 2.7 -- three reservoirs at '
        + 'different fixed elevations (100 m, 85 m, 60 m) feeding a single junction with a 0.06 m^3/s '
        + 'external demand. A standard textbook benchmark for junction-node pipe network analysis, '
        + 'independent of any particular hydraulic-modeling software. NetworkSolver reproduces the '
        + "published flows to within ~2% -- see this file's header comment for why not closer.",
    },
    fluid,
    headlossModel: 'darcyWeisbach',
    nodes: [reservoirA, reservoirB, reservoirC, junction],
    elements: [pipe1, pipe2, pipe3],
    goalSeek: {
      targets: [{ elementId: 'el_p3', targetFlow: 0.05 }],
      adjustable: [{ elementId: 'el_p3' }],
      tolerance: 1e-4,
      maxIterations: 50,
      history: [],
    },
  });
}
