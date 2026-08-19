// Built-in "Two-Reservoir Single-Pipe Problem" benchmark example: the most
// elementary pipe-flow benchmark there is -- one pipe, two reservoirs, an
// energy balance closed by friction (Darcy-Weisbach) plus entrance/exit
// minor losses. This exact problem shape (two open reservoirs at different
// elevations joined by one pipe with a sharp entrance and submerged exit)
// is the standard first worked example in the pipe-flow chapter of every
// mainstream fluid-mechanics text -- e.g. Irving H. Shames, "Mechanics of
// Fluids" -- and in Streeter/White/Munson's equivalents. The numbers below
// are NetworkSolver's own (chosen for a clean, realistic turbulent
// operating point), not a verbatim citation of one edition's example, so
// this is benchmarked against the Colebrook-White equation itself (the
// actual Moody-chart friction correlation) rather than against a specific
// textbook's printed answer.
//
// Problem: reservoir A (surface elevation 20 m) drains to reservoir B
// (surface elevation 0 m) through L=250 m, D=250 mm commercial-steel pipe
// (roughness 0.046 mm), with a sharp-edged entrance (K=0.5) and a
// submerged exit (K=1.0). Water at 20 C. Energy equation:
//   z_A = z_B + (f*L/D + K_entrance + K_exit) * V^2 / (2g)
//
// Reference solution (Colebrook-White, solved by fixed-point iteration
// independent of this codebase): f=0.014333, Re=1.242e6, V=4.9775 m/s,
// Q=0.24433 m^3/s (244.33 L/s).
//
// This network is stored with the default `recomputeFriction: false`, like
// the other built-in examples, so its own pipe's admittance stays a fixed,
// goal-seekable value (see goalSeek below, which adjusts this same pipe --
// turning recomputeFriction on here would make it silently overwrite
// whatever admittance goal-seek converges to every outer iteration, which
// validate.js already flags as a warning). At that default, this pipe runs
// far enough from the fixed 1 m/s reference velocity (actual ~5 m/s) that
// NetworkSolver's flow comes out ~6% below the Colebrook-White reference --
// a larger, but still documented and expected, instance of the same
// fixed-admittance tradeoff noted in docs/research.md 2.3/2.8 and in
// threeReservoirExample.js. Solving a `{ ...network, recomputeFriction:
// true }` copy (see test/example.test.js) instead iterates the pipe's
// Darcy-Weisbach friction factor (Swamee-Jain, NetworkSolver's own explicit
// approximation to Colebrook-White) at the actual converged velocity each
// outer iteration, and reproduces the Colebrook-White reference to within
// ~0.3% -- the well-known, bounded gap between the Swamee-Jain explicit
// formula and the implicit Colebrook-White equation it approximates.
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

export function buildTwoReservoirPipeBenchmarkNetwork() {
  const fluid = createFluid(); // water, rho=998 kg/m^3, mu=0.001 Pa*s (matches the 20 C reference calc)

  const reservoirA = createNode({
    id: 'n_a', nodeType: 'reservoir', name: 'Upper Reservoir A', x: 220, y: 200, elevation: 20,
    boundary: { temperature: { fixed: true, value: 20 } },
    notes: 'Upper reservoir, free-surface elevation 20 m.',
  });
  const reservoirB = createNode({
    id: 'n_b', nodeType: 'reservoir', name: 'Lower Reservoir B', x: 640, y: 200, elevation: 0,
    boundary: { temperature: { fixed: true, value: 20 } },
    notes: 'Lower reservoir, free-surface elevation 0 m.',
  });

  const pipe = withNominalAdmittance(createElement('pipe', {
    id: 'el_pipe', name: 'Connecting Pipe', sourceNodeId: reservoirA.id, targetNodeId: reservoirB.id,
    params: {
      length: 250, diameter: 0.25, roughness: 0.046e-3, localLossCoefficient: 1.5,
      ambientTemperature: 20, heatTransferCoefficient: 0,
    },
    notes: 'L=250 m, D=250 mm, commercial-steel roughness 0.046 mm. localLossCoefficient=1.5 combines '
      + 'a sharp-edged entrance (K=0.5) and a submerged exit (K=1.0). Colebrook-White reference: '
      + 'Q=0.24433 m^3/s at V=4.9775 m/s, Re=1.242e6, f=0.014333.',
  }), fluid);

  return createNetwork({
    meta: {
      name: 'Two-Reservoir Single-Pipe Problem',
      description: 'The classic first worked example of the pipe-flow chapter in standard fluid-mechanics '
        + 'texts (e.g. Shames, "Mechanics of Fluids") -- two open reservoirs at different elevations joined '
        + 'by a single pipe with entrance/exit losses, solved from the energy equation. Benchmarked here '
        + 'against the Colebrook-White friction correlation (Q=0.24433 m^3/s); with recomputeFriction '
        + 'enabled, NetworkSolver matches to within ~0.3% -- the known Swamee-Jain vs. Colebrook-White gap. '
        + 'Ships with recomputeFriction off (like the other built-in examples) so goal-seek can adjust this '
        + "pipe's admittance directly -- see this file's header comment.",
    },
    fluid,
    headlossModel: 'darcyWeisbach',
    nodes: [reservoirA, reservoirB],
    elements: [pipe],
    goalSeek: {
      targets: [{ elementId: 'el_pipe', targetFlow: 0.2 }],
      adjustable: [{ elementId: 'el_pipe' }],
      tolerance: 1e-4,
      maxIterations: 50,
      history: [],
    },
  });
}
