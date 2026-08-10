import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNetwork, createNode, createElement } from '../src/solver/model.js';
import { optimizeAdmittances } from '../src/solver/optimize.js';
import { buildExampleNetwork } from '../src/solver/example.js';

function singlePipeNetwork() {
  const n1 = createNode({ id: 'n1', boundary: { pressure: { fixed: true, value: 300000 } } });
  const n2 = createNode({ id: 'n2', boundary: { pressure: { fixed: true, value: 100000 } } });
  const pipe = createElement('pipe', {
    id: 'p1', sourceNodeId: 'n1', targetNodeId: 'n2',
    admittance: { current: 1e-4, min: 1e-7, max: 1e-2 },
  });
  return createNetwork({ nodes: [n1, n2], elements: [pipe] });
}

test('one target, one adjustable element converges to the exact algebraic solution', () => {
  const net = singlePipeNetwork();
  const targetFlow = 0.005;
  const result = optimizeAdmittances(net, {
    targets: [{ elementId: 'p1', targetFlow }],
    adjustable: [{ elementId: 'p1', min: 1e-7, max: 1e-2 }],
    tolerance: 1e-6,
    maxIterations: 30,
  });
  assert.equal(result.status, 'converged');
  const expectedA = targetFlow / Math.sqrt(200000);
  assert.ok(Math.abs(result.best.admittances.p1 - expectedA) / expectedA < 1e-3);
  assert.ok(Math.abs(result.best.actualFlows.p1 - targetFlow) < 1e-6);
});

test('admittance bounds are always respected, even under an aggressive target', () => {
  const net = singlePipeNetwork();
  const result = optimizeAdmittances(net, {
    targets: [{ elementId: 'p1', targetFlow: 5 }], // unreasonably large
    adjustable: [{ elementId: 'p1', min: 1e-6, max: 1e-4 }],
    tolerance: 1e-6,
    maxIterations: 25,
  });
  for (const entry of result.history) {
    const v = entry.admittances.p1;
    assert.ok(v >= 1e-6 - 1e-12 && v <= 1e-4 + 1e-12, `admittance ${v} out of bounds`);
  }
  assert.notEqual(result.status, 'converged');
});

test('unreachable target is reported distinctly once bounds are pinned', () => {
  const net = singlePipeNetwork();
  const result = optimizeAdmittances(net, {
    targets: [{ elementId: 'p1', targetFlow: 10 }],
    adjustable: [{ elementId: 'p1', min: 1e-6, max: 2e-6 }],
    tolerance: 1e-6,
    maxIterations: 15,
  });
  assert.equal(result.status, 'unreachableTarget');
});

test('multiple targets and multiple adjustable elements on coupled parallel branches converge', () => {
  const net = buildExampleNetwork();
  const result = optimizeAdmittances(net, {
    targets: net.goalSeek.targets,
    adjustable: net.goalSeek.adjustable,
    tolerance: net.goalSeek.tolerance,
    maxIterations: net.goalSeek.maxIterations,
  });
  assert.equal(result.status, 'converged');
  for (const t of net.goalSeek.targets) {
    const err = Math.abs(result.best.actualFlows[t.elementId] - t.targetFlow);
    assert.ok(err < 1e-3, `target ${t.elementId} error ${err} too large`);
  }
  // the original network object must remain untouched until the caller applies the result
  for (const adj of net.goalSeek.adjustable) {
    const original = net.elements.find((e) => e.id === adj.elementId);
    assert.notEqual(original.admittance.current, result.best.admittances[adj.elementId]);
  }
});

test('degrades gracefully when the hydraulic solve cannot converge for any candidate', () => {
  // Needs an actual unknown (internal) node so the Newton loop is required;
  // a purely two-fixed-pressure-node network solves in zero iterations.
  const n1 = createNode({ id: 'n1', boundary: { pressure: { fixed: true, value: 300000 } } });
  const n2 = createNode({ id: 'n2', boundary: { flow: { fixed: true, value: -0.005 } } });
  const n3 = createNode({ id: 'n3', boundary: { pressure: { fixed: true, value: 100000 } } });
  const pipeAdj = createElement('pipe', {
    id: 'p1', sourceNodeId: 'n1', targetNodeId: 'n2', admittance: { current: 1e-4, min: 1e-6, max: 1e-2 },
  });
  const pipeFixed = createElement('pipe', {
    id: 'p2', sourceNodeId: 'n2', targetNodeId: 'n3', admittance: { current: 1e-4 },
  });
  const net = createNetwork({ nodes: [n1, n2, n3], elements: [pipeAdj, pipeFixed] });

  const result = optimizeAdmittances(net, {
    targets: [{ elementId: 'p1', targetFlow: 0.01 }],
    adjustable: [{ elementId: 'p1', min: 1e-6, max: 1e-2 }],
    tolerance: 1e-8,
    maxIterations: 5,
    hydraulicOptions: { maxIterations: 0 }, // force every hydraulic evaluation to fail to converge
  });
  assert.notEqual(result.status, 'converged');
  assert.equal(result.best.hydraulicConverged, false);
  assert.ok(Number.isFinite(result.best.residualNorm));
});

test('rejects a configuration with no targets or no adjustable elements', () => {
  const net = singlePipeNetwork();
  const noTargets = optimizeAdmittances(net, { targets: [], adjustable: [{ elementId: 'p1' }] });
  assert.equal(noTargets.status, 'invalidConfiguration');
  const noAdjustable = optimizeAdmittances(net, { targets: [{ elementId: 'p1', targetFlow: 0.01 }], adjustable: [] });
  assert.equal(noAdjustable.status, 'invalidConfiguration');
});

test('rejects an adjustable element that is not a pipe, valve, or heat exchanger', () => {
  const n1 = createNode({ id: 'n1', boundary: { pressure: { fixed: true, value: 300000 } } });
  const n2 = createNode({ id: 'n2', boundary: { pressure: { fixed: true, value: 100000 } } });
  const pump = createElement('pump', { id: 'pump1', sourceNodeId: 'n1', targetNodeId: 'n2' });
  const net = createNetwork({ nodes: [n1, n2], elements: [pump] });
  const result = optimizeAdmittances(net, {
    targets: [{ elementId: 'pump1', targetFlow: 0.01 }],
    adjustable: [{ elementId: 'pump1' }],
  });
  assert.equal(result.status, 'invalidConfiguration');
});
