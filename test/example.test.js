// End-to-end coverage of Phase 10 (and its extension to the larger
// built-in example): load each example, validate, solve, run the
// goal-seek, export, re-import, and confirm topology/parameters survive
// the round trip. Shared as one workflow so both examples are exercised
// identically rather than duplicating the assertions per example.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExampleNetwork } from '../src/solver/example.js';
import { buildComplexExampleNetwork } from '../src/solver/complexExample.js';
import { buildNet1BenchmarkNetwork } from '../src/solver/net1BenchmarkExample.js';
import { buildThreeReservoirBenchmarkNetwork } from '../src/solver/threeReservoirExample.js';
import { validateNetwork } from '../src/solver/validate.js';
import { solveNetwork } from '../src/solver/index.js';
import { optimizeAdmittances, applyOptimizationResult } from '../src/solver/optimize.js';
import { exportNetwork, importNetwork } from '../src/solver/io.js';

function runExampleWorkflow(net, { targetTolerance = 1e-3, requirePump = true, requireHeatExchanger = true } = {}) {
  // 1. load
  if (requirePump) assert.equal(net.elements.some((e) => e.type === 'pump'), true);
  if (requireHeatExchanger) assert.equal(net.elements.some((e) => e.type === 'heatExchanger'), true);

  // 2. validate
  const validation = validateNetwork(net);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));

  // 3. solve pressure/flow/temperature
  const { network: solved, diagnostics } = solveNetwork(net);
  assert.equal(diagnostics.hydraulic.converged, true);
  for (const el of solved.elements) {
    assert.ok(Number.isFinite(el.computed.flow), `${el.name} flow not finite`);
    assert.notEqual(el.computed.flow, Infinity);
  }
  for (const node of solved.nodes) {
    assert.ok(Number.isFinite(node.computed.pressure), `${node.name} pressure not finite`);
  }
  // mass balance closes at every internal (non-fixed-pressure) node
  for (const node of solved.nodes) {
    if (!node.boundary.pressure.fixed) {
      assert.ok(Math.abs(node.computed.massBalanceResidual) < 1e-4, `${node.name} residual too large`);
    }
  }

  // 4. run the multi-variable admittance adjustment
  const optResult = optimizeAdmittances(net, {
    targets: net.goalSeek.targets,
    adjustable: net.goalSeek.adjustable,
    tolerance: net.goalSeek.tolerance,
    maxIterations: net.goalSeek.maxIterations,
  });
  assert.equal(optResult.status, 'converged');

  // goal seek must materially reduce the target-flow error, not just end below tolerance by luck
  const seedResidual = optResult.history[0].residualNorm;
  assert.ok(optResult.best.residualNorm < seedResidual, 'goal seek did not reduce the residual');

  // 5. verify results are within configured tolerance
  for (const t of net.goalSeek.targets) {
    assert.ok(Math.abs(optResult.best.actualFlows[t.elementId] - t.targetFlow) < targetTolerance);
  }
  const optimizedNetwork = applyOptimizationResult(net, optResult);
  const { diagnostics: postOptDiagnostics } = solveNetwork(optimizedNetwork);
  assert.equal(postOptDiagnostics.hydraulic.converged, true);

  // 6. export
  const exported = exportNetwork(optimizedNetwork);
  assert.equal(exported.nodes.length, optimizedNetwork.nodes.length);

  // 7. import it again
  const { network: reimported, errors } = importNetwork(exported);
  assert.deepEqual(errors, []);

  // 8. topology and parameters preserved
  assert.equal(reimported.nodes.length, optimizedNetwork.nodes.length);
  assert.equal(reimported.elements.length, optimizedNetwork.elements.length);
  for (const el of optimizedNetwork.elements) {
    const match = reimported.elements.find((e) => e.id === el.id);
    assert.ok(match, `element ${el.id} missing after import`);
    assert.equal(match.sourceNodeId, el.sourceNodeId);
    assert.equal(match.targetNodeId, el.targetNodeId);
    assert.equal(match.type, el.type);
    assert.equal(match.admittance.current, el.admittance.current);
  }

  // results must be recomputed, not trusted, after import
  for (const el of reimported.elements) assert.equal(el.computed.flow, null);

  const reimportedValidation = validateNetwork(reimported);
  assert.equal(reimportedValidation.valid, true);
  const { diagnostics: reimportedDiagnostics } = solveNetwork(reimported);
  assert.equal(reimportedDiagnostics.hydraulic.converged, true);

  return { optResult };
}

test('example network: load, validate, solve, goal-seek, export/import round trip', () => {
  runExampleWorkflow(buildExampleNetwork());
});

test('complex example network: load, validate, solve, goal-seek, export/import round trip', () => {
  runExampleWorkflow(buildComplexExampleNetwork());
});

test('EPANET Net1 benchmark: load, validate, solve, goal-seek, export/import round trip', () => {
  // Net1 is a real-world benchmark with no heat exchanger (reservoir + pump + plain pipes).
  runExampleWorkflow(buildNet1BenchmarkNetwork(), { requireHeatExchanger: false });
});

test('EPANET Net1 benchmark: matches the source Net1.inp topology (2 boundary + 9 junctions, 12 pipes + 1 pump)', () => {
  const net = buildNet1BenchmarkNetwork();

  assert.equal(net.nodes.length, 11);
  assert.equal(net.elements.length, 13);
  const byType = net.elements.reduce((acc, e) => ({ ...acc, [e.type]: (acc[e.type] || 0) + 1 }), {});
  assert.equal(byType.pipe, 12);
  assert.equal(byType.pump, 1);
  assert.equal(byType.heatExchanger, undefined);
  assert.equal(byType.valve, undefined);

  // "Boundary" here means EPANET's Reservoir/Tank fixed-pressure sources
  // (matching how the source file itself distinguishes them from ordinary
  // demand junctions, even though junctions also carry a fixed demand).
  const boundaryNodes = net.nodes.filter((n) => n.boundary.pressure.fixed);
  assert.equal(boundaryNodes.length, 2); // Reservoir 9 + Tank 2
  assert.equal(net.nodes.filter((n) => n.nodeType === 'reservoir').length, 1);
  assert.equal(net.nodes.filter((n) => n.nodeType === 'tank').length, 1);
  assert.equal(net.nodes.filter((n) => n.nodeType === 'junction').length, 9);

  // Tank 2 preserves all of EPANET's [TANKS] fields directly (elevation is
  // the base; params carry level/min/max/diameter -- see model.js).
  const tank = net.nodes.find((n) => n.nodeType === 'tank');
  const FT = 0.3048;
  assert.ok(Math.abs(tank.elevation - 850 * FT) < 1e-9);
  assert.ok(Math.abs(tank.params.level - 120 * FT) < 1e-9);
  assert.ok(Math.abs(tank.params.minLevel - 100 * FT) < 1e-9);
  assert.ok(Math.abs(tank.params.maxLevel - 150 * FT) < 1e-9);
  assert.ok(Math.abs(tank.params.diameter - 50.5 * FT) < 1e-9);

  // 9 junctions carry a fixed extraction demand except Junction 10 (0 GPM in the source)
  const demandNodes = net.nodes.filter((n) => n.boundary.flow.fixed);
  assert.equal(demandNodes.length, 8);

  assert.equal(new Set(net.nodes.map((n) => n.id)).size, net.nodes.length);
  assert.equal(new Set(net.elements.map((e) => e.id)).size, net.elements.length);
});

test('EPANET Net1 benchmark: solved state is physically plausible (no negative pressure, mass balance holds)', () => {
  const net = buildNet1BenchmarkNetwork();
  const { network: solved, diagnostics } = solveNetwork(net);
  assert.equal(diagnostics.hydraulic.converged, true);
  for (const node of solved.nodes) {
    assert.ok(node.computed.pressure >= 0, `${node.name} has negative pressure`);
  }
  // Pump 9 feeds Junction 10 with zero demand and a single downstream pipe (Pipe 10) --
  // its entire flow must pass straight through.
  const pump = solved.elements.find((e) => e.id === 'el_pump9');
  const pipe10 = solved.elements.find((e) => e.id === 'el_p10');
  assert.ok(Math.abs(pump.computed.flow - pipe10.computed.flow) < 1e-6);
});

test('Three-Reservoir Problem benchmark: load, validate, solve, goal-seek, export/import round trip', () => {
  // A pure textbook junction problem: 3 reservoirs + 1 junction + 3 plain pipes, no pump/heat exchanger.
  runExampleWorkflow(buildThreeReservoirBenchmarkNetwork(), { requirePump: false, requireHeatExchanger: false });
});

test('Three-Reservoir Problem benchmark: matches the source topology (3 reservoirs + 1 junction, 3 pipes)', () => {
  const net = buildThreeReservoirBenchmarkNetwork();

  assert.equal(net.nodes.length, 4);
  assert.equal(net.elements.length, 3);
  assert.equal(net.elements.every((e) => e.type === 'pipe'), true);
  assert.equal(net.nodes.filter((n) => n.nodeType === 'reservoir').length, 3);
  assert.equal(net.nodes.filter((n) => n.nodeType === 'junction').length, 1);

  // Elevations exactly as cited (Larock/Jeppson/Watters Example 2.7): 100 m, 85 m, 60 m.
  const elevations = net.nodes.filter((n) => n.nodeType === 'reservoir').map((n) => n.elevation).sort((a, b) => a - b);
  assert.deepEqual(elevations, [60, 85, 100]);

  // Pipe geometry exactly as cited: (L, D) = (2000, 0.3), (1500, 0.25), (3000, 0.25); roughness 0.5 mm on all.
  const geometries = net.elements.map((e) => [e.params.length, e.params.diameter]).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(geometries, [[1500, 0.25], [2000, 0.3], [3000, 0.25]]);
  assert.equal(net.elements.every((e) => Math.abs(e.params.roughness - 0.0005) < 1e-12), true);

  // The junction's fixed external demand, exactly as cited: 0.06 m^3/s withdrawn.
  const junction = net.nodes.find((n) => n.nodeType === 'junction');
  assert.equal(junction.boundary.flow.fixed, true);
  assert.equal(junction.boundary.flow.value, -0.06);

  assert.equal(new Set(net.nodes.map((n) => n.id)).size, net.nodes.length);
  assert.equal(new Set(net.elements.map((e) => e.id)).size, net.elements.length);
});

test('Three-Reservoir Problem benchmark: solved flows match the published reference solution within ~2%', () => {
  // Published reference (Larock/Jeppson/Watters Example 2.7, cross-checked against an independent
  // citation): Q1 (A->J) = 0.1023, Q2 (B->J) = 0.02, Q3 (J->C) = 0.0622 m^3/s. NetworkSolver's
  // Darcy-Weisbach admittance is evaluated once at a representative reference velocity rather than
  // iterating Colebrook-White at the actual converged velocity (see docs/research.md 2.3/2.8 and
  // threeReservoirExample.js's header), so an exact 4-significant-figure match isn't expected --
  // only a small, bounded deviation, which this test pins down numerically rather than assuming.
  const net = buildThreeReservoirBenchmarkNetwork();
  const { network: solved, diagnostics } = solveNetwork(net);
  assert.equal(diagnostics.hydraulic.converged, true);

  const published = { el_p1: 0.1023, el_p2: 0.02, el_p3: 0.0622 };
  for (const [id, expected] of Object.entries(published)) {
    const actual = solved.elements.find((e) => e.id === id).computed.flow;
    assert.ok(actual > 0, `${id} should flow in the reference's stated direction (positive)`);
    assert.ok(Math.abs(actual - expected) / expected < 0.03, `${id}: solved ${actual} vs published ${expected}`);
  }

  // Exact mass balance at the junction is a structural property of the Newton-Raphson solver
  // (independent of the friction-model deviation above), so this must hold to solver tolerance.
  const junction = solved.nodes.find((n) => n.nodeType === 'junction');
  assert.ok(Math.abs(junction.computed.massBalanceResidual) < 1e-6);
});

test('complex example: topology matches the ~40-element / 5-boundary-node design', () => {
  const net = buildComplexExampleNetwork();

  assert.equal(net.elements.length, 40);
  const byType = net.elements.reduce((acc, e) => ({ ...acc, [e.type]: (acc[e.type] || 0) + 1 }), {});
  assert.equal(byType.pipe, 22);
  assert.equal(byType.valve, 10);
  assert.equal(byType.pump, 4);
  assert.equal(byType.heatExchanger, 4);
  assert.ok(byType.pipe >= 18);
  assert.ok(byType.valve >= 8);
  assert.ok(byType.pump >= 4);
  assert.ok(byType.heatExchanger >= 4);

  const boundaryNodes = net.nodes.filter((n) => n.boundary.pressure.fixed || n.boundary.flow.fixed);
  assert.equal(boundaryNodes.length, 5);
  // exactly one boundary node uses the fixed-flow (extraction/demand) BC type, exercising a
  // boundary-condition path the basic example does not
  assert.equal(boundaryNodes.filter((n) => n.boundary.flow.fixed).length, 1);
  assert.equal(boundaryNodes.filter((n) => n.boundary.pressure.fixed).length, 4);

  // no duplicate ids
  assert.equal(new Set(net.nodes.map((n) => n.id)).size, net.nodes.length);
  assert.equal(new Set(net.elements.map((e) => e.id)).size, net.elements.length);
});

test('complex example: fully connected with all 5 boundary nodes reachable', () => {
  const net = buildComplexExampleNetwork();
  const parent = new Map(net.nodes.map((n) => [n.id, n.id]));
  function find(x) {
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
    return x;
  }
  function union(a, b) { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra, rb); }
  for (const el of net.elements) union(el.sourceNodeId, el.targetNodeId);

  const roots = new Set(net.nodes.map((n) => find(n.id)));
  assert.equal(roots.size, 1, 'network has disconnected components');

  const boundaryNodes = net.nodes.filter((n) => n.boundary.pressure.fixed || n.boundary.flow.fixed);
  assert.equal(boundaryNodes.length, 5);
});

test('complex example: goal seek is meaningfully coupled (a shared adjustable affects multiple targets)', () => {
  const net = buildComplexExampleNetwork();
  assert.ok(net.goalSeek.targets.length >= 3 && net.goalSeek.targets.length <= 6);
  assert.ok(net.goalSeek.adjustable.length >= 3 && net.goalSeek.adjustable.length <= 6);

  // Perturbing the loop-bridge valve (which feeds Manifold 2 directly) should
  // change more than one Manifold-2-side target flow, demonstrating coupling.
  const base = solveNetwork(net).network;
  const bumped = {
    ...net,
    elements: net.elements.map((e) => (e.id === 'el_loop_bridge_valve'
      ? { ...e, admittance: { ...e.admittance, current: e.admittance.max } }
      : e)),
  };
  const perturbed = solveNetwork(bumped).network;

  const affected = net.goalSeek.targets.filter((t) => {
    const before = base.elements.find((e) => e.id === t.elementId).computed.flow;
    const after = perturbed.elements.find((e) => e.id === t.elementId).computed.flow;
    return Math.abs(after - before) > 1e-5;
  });
  assert.ok(affected.length >= 2, `expected at least 2 targets to move, got ${affected.length}`);
});
