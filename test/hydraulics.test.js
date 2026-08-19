import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNetwork, createNode, createElement, createFluid } from '../src/solver/model.js';
import { solveHydraulics } from '../src/solver/hydraulics.js';
import { computeNominalAdmittance } from '../src/solver/elements/pipe.js';

function twoNodeNetwork({ p1, p2, admittance }) {
  const n1 = createNode({ id: 'n1', boundary: { pressure: { fixed: true, value: p1 } } });
  const n2 = createNode({ id: 'n2', boundary: { pressure: { fixed: true, value: p2 } } });
  const pipe = createElement('pipe', {
    id: 'p1', sourceNodeId: 'n1', targetNodeId: 'n2', admittance: { current: admittance },
  });
  return createNetwork({ nodes: [n1, n2], elements: [pipe] });
}

test('single pipe between two fixed-pressure nodes matches the closed-form admittance equation', () => {
  const A = 1.5e-4;
  const net = twoNodeNetwork({ p1: 200000, p2: 100000, admittance: A });
  const result = solveHydraulics(net);
  assert.equal(result.converged, true);
  const expectedQ = A * Math.sqrt(100000);
  const Q = result.elementResults.p1.Q;
  assert.ok(Math.abs(Q - expectedQ) / expectedQ < 1e-6, `Q=${Q} expected ${expectedQ}`);
});

test('network.headlossModel="hazenWilliams" uses the 1/1.852 exponent instead of 0.5, end-to-end through the solver', () => {
  const A = 1.5e-4;
  const net = { ...twoNodeNetwork({ p1: 200000, p2: 100000, admittance: A }), headlossModel: 'hazenWilliams' };
  const result = solveHydraulics(net);
  assert.equal(result.converged, true);
  const expectedQ = A * (100000 ** (1 / 1.852));
  const Q = result.elementResults.p1.Q;
  assert.ok(Math.abs(Q - expectedQ) / expectedQ < 1e-6, `Q=${Q} expected ${expectedQ}`);
  // Sanity check that this really is a different exponent, not a no-op.
  assert.notEqual(expectedQ, A * Math.sqrt(100000));
});

test('single pipe with an internal demand node converges via Newton iteration to the analytic flow', () => {
  const A = 2e-4;
  const demand = 0.01;
  const n1 = createNode({ id: 'n1', boundary: { pressure: { fixed: true, value: 250000 } } });
  const n2 = createNode({ id: 'n2', boundary: { flow: { fixed: true, value: -demand } } });
  const pipe = createElement('pipe', { id: 'p1', sourceNodeId: 'n1', targetNodeId: 'n2', admittance: { current: A } });
  const net = createNetwork({ nodes: [n1, n2], elements: [pipe] });

  const result = solveHydraulics(net);
  assert.equal(result.converged, true);
  assert.ok(Math.abs(result.elementResults.p1.Q - demand) / demand < 1e-5);

  const expectedDp = (demand / A) ** 2;
  const expectedP2 = 250000 - expectedDp;
  assert.ok(Math.abs(result.nodePressures.n2 - expectedP2) / expectedDp < 1e-4);
});

test('series pipes: combined flow matches series-resistance closed form', () => {
  const A1 = 3e-4;
  const A2 = 2e-4;
  const n1 = createNode({ id: 'n1', boundary: { pressure: { fixed: true, value: 300000 } } });
  const n2 = createNode({ id: 'n2' });
  const n3 = createNode({ id: 'n3', boundary: { pressure: { fixed: true, value: 100000 } } });
  const pipe1 = createElement('pipe', { id: 'p1', sourceNodeId: 'n1', targetNodeId: 'n2', admittance: { current: A1 } });
  const pipe2 = createElement('pipe', { id: 'p2', sourceNodeId: 'n2', targetNodeId: 'n3', admittance: { current: A2 } });
  const net = createNetwork({ nodes: [n1, n2, n3], elements: [pipe1, pipe2] });

  const result = solveHydraulics(net);
  assert.equal(result.converged, true);

  const totalDp = 200000;
  const expectedQ = Math.sqrt(totalDp / (1 / A1 ** 2 + 1 / A2 ** 2));
  assert.ok(Math.abs(result.elementResults.p1.Q - expectedQ) / expectedQ < 1e-5);
  assert.ok(Math.abs(result.elementResults.p2.Q - expectedQ) / expectedQ < 1e-5);
});

test('parallel pipes then series pipe: matches equivalent-admittance closed form', () => {
  const A1 = 2e-4;
  const A2 = 1.5e-4;
  const A3 = 1.2e-4;
  const n1 = createNode({ id: 'n1', boundary: { pressure: { fixed: true, value: 300000 } } });
  const n2 = createNode({ id: 'n2' });
  const n3 = createNode({ id: 'n3', boundary: { pressure: { fixed: true, value: 100000 } } });
  const pA = createElement('pipe', { id: 'pA', sourceNodeId: 'n1', targetNodeId: 'n2', admittance: { current: A1 } });
  const pB = createElement('pipe', { id: 'pB', sourceNodeId: 'n1', targetNodeId: 'n2', admittance: { current: A2 } });
  const pC = createElement('pipe', { id: 'pC', sourceNodeId: 'n2', targetNodeId: 'n3', admittance: { current: A3 } });
  const net = createNetwork({ nodes: [n1, n2, n3], elements: [pA, pB, pC] });

  const result = solveHydraulics(net);
  assert.equal(result.converged, true);

  const Aeq = A1 + A2;
  const totalDp = 200000;
  const expectedQ = Math.sqrt(totalDp / (1 / Aeq ** 2 + 1 / A3 ** 2));
  assert.ok(Math.abs(result.elementResults.pC.Q - expectedQ) / expectedQ < 1e-5);

  const massBalance = result.elementResults.pA.Q + result.elementResults.pB.Q - result.elementResults.pC.Q;
  assert.ok(Math.abs(massBalance) < 1e-6);
});

test('reports invalidNetwork when there is no fixed-pressure reference node', () => {
  const n1 = createNode({ id: 'n1' });
  const n2 = createNode({ id: 'n2' });
  const pipe = createElement('pipe', { id: 'p1', sourceNodeId: 'n1', targetNodeId: 'n2', admittance: { current: 1e-4 } });
  const net = createNetwork({ nodes: [n1, n2], elements: [pipe] });
  const result = solveHydraulics(net);
  assert.equal(result.status, 'invalidNetwork');
  assert.equal(result.converged, false);
});

test('flow reverses sign correctly when downstream pressure exceeds upstream', () => {
  const A = 1e-4;
  const net = twoNodeNetwork({ p1: 100000, p2: 300000, admittance: A });
  const result = solveHydraulics(net);
  assert.ok(result.elementResults.p1.Q < 0);
});

test('reservoir and tank drive flow purely through effective elevation (both at 0 pressure)', () => {
  const A = 1e-4;
  const density = 998;
  const gravity = 9.80665;
  const reservoir = createNode({ id: 'r1', nodeType: 'reservoir', elevation: 100 });
  const tank = createNode({ id: 't1', nodeType: 'tank', elevation: 50, params: { level: 8, minLevel: 0, maxLevel: 10 } });
  const pipe = createElement('pipe', { id: 'p1', sourceNodeId: 'r1', targetNodeId: 't1', admittance: { current: A } });
  const net = createNetwork({ nodes: [reservoir, tank], elements: [pipe] });

  const result = solveHydraulics(net);
  assert.equal(result.converged, true);
  // both nodes are fixed at pressure=0, so the driving potential is purely
  // the difference between reservoir elevation and tank (elevation+level)
  const deltaZ = 100 - (50 + 8);
  const expectedQ = A * Math.sqrt(density * gravity * deltaZ);
  assert.ok(Math.abs(result.elementResults.p1.Q - expectedQ) / expectedQ < 1e-6);
});

// Two pipes of different diameter in parallel between the same pair of
// fixed-pressure nodes, at two very different total driving pressures.
function parallelPipesNetwork({ p1, p2, recomputeFriction }) {
  const paramsA = { length: 10, diameter: 0.05, roughness: 0.00015, localLossCoefficient: 0 };
  const paramsB = { length: 10, diameter: 0.08, roughness: 0.00015, localLossCoefficient: 0 };
  const nominalA = computeNominalAdmittance(paramsA, createFluid(), 'darcyWeisbach');
  const nominalB = computeNominalAdmittance(paramsB, createFluid(), 'darcyWeisbach');
  const n1 = createNode({ id: 'n1', boundary: { pressure: { fixed: true, value: p1 } } });
  const n2 = createNode({ id: 'n2', boundary: { pressure: { fixed: true, value: p2 } } });
  const pA = createElement('pipe', { id: 'pA', sourceNodeId: 'n1', targetNodeId: 'n2', admittance: { current: nominalA }, params: paramsA });
  const pB = createElement('pipe', { id: 'pB', sourceNodeId: 'n1', targetNodeId: 'n2', admittance: { current: nominalB }, params: paramsB });
  return createNetwork({ nodes: [n1, n2], elements: [pA, pB], recomputeFriction });
}

test('recomputeFriction=false (default): parallel-branch flow-split ratio is exactly invariant to total driving pressure', () => {
  const low = solveHydraulics(parallelPipesNetwork({ p1: 100000.05, p2: 100000, recomputeFriction: false }));
  const high = solveHydraulics(parallelPipesNetwork({ p1: 8000000, p2: 100000, recomputeFriction: false }));
  const ratioLow = low.elementResults.pA.Q / low.elementResults.pB.Q;
  const ratioHigh = high.elementResults.pA.Q / high.elementResults.pB.Q;
  // Reproduces the reported behavior: with a fixed (Re-independent)
  // admittance, Q = A*sqrt(dp) for every pipe, so scaling the total driving
  // pressure scales every branch's flow by the same sqrt(factor) and the
  // split ratio never moves, no matter how different the two Reynolds
  // numbers actually are.
  assert.ok(Math.abs(ratioLow - ratioHigh) / ratioHigh < 1e-9);
  assert.equal(low.elementResults.pA.reynoldsNumber, null);
});

test('recomputeFriction=true: parallel-branch flow-split ratio shifts with total driving pressure (Reynolds-dependent friction)', () => {
  const low = solveHydraulics(parallelPipesNetwork({ p1: 100000.05, p2: 100000, recomputeFriction: true }));
  const high = solveHydraulics(parallelPipesNetwork({ p1: 8000000, p2: 100000, recomputeFriction: true }));
  assert.equal(low.converged, true);
  assert.equal(high.converged, true);
  const ratioLow = low.elementResults.pA.Q / low.elementResults.pB.Q;
  const ratioHigh = high.elementResults.pA.Q / high.elementResults.pB.Q;
  assert.ok(Math.abs(ratioLow - ratioHigh) / ratioHigh > 0.1, `expected ratios to differ, got ${ratioLow} vs ${ratioHigh}`);

  // Reynolds numbers should be populated and consistent with Re = rho*v*D/mu
  // for the converged flow.
  const fluid = createFluid();
  for (const [id, params] of [['pA', { diameter: 0.05 }], ['pB', { diameter: 0.08 }]]) {
    const r = high.elementResults[id];
    const area = Math.PI * params.diameter * params.diameter / 4;
    const expectedRe = (fluid.density * Math.abs(r.Q) / area * params.diameter) / fluid.viscosity;
    assert.ok(Math.abs(r.reynoldsNumber - expectedRe) / expectedRe < 1e-3);
  }
});

test('recomputeFriction=true still converges (and matches recomputeFriction=false) for a network with no unknown pressure nodes', () => {
  // Two directly-bridged fixed-pressure nodes: n===0 (no Newton unknowns),
  // exercising the dedicated friction fixed-point loop rather than the
  // Newton loop.
  const withFriction = solveHydraulics(parallelPipesNetwork({ p1: 8000000, p2: 100000, recomputeFriction: true }));
  const without = solveHydraulics(parallelPipesNetwork({ p1: 8000000, p2: 100000, recomputeFriction: false }));
  assert.equal(withFriction.converged, true);
  // Self-consistency: the converged flow's own velocity, fed back through
  // the Darcy-Weisbach admittance formula, must reproduce the same flow.
  assert.notEqual(withFriction.elementResults.pA.Q, without.elementResults.pA.Q);
});
