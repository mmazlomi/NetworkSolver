import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNetwork, createNode, createElement } from '../src/solver/model.js';
import { validateNetwork } from '../src/solver/validate.js';

function baseValidNetwork() {
  const n1 = createNode({ id: 'n1', boundary: { pressure: { fixed: true, value: 200000 } } });
  const n2 = createNode({ id: 'n2', boundary: { pressure: { fixed: true, value: 100000 } } });
  const pipe = createElement('pipe', { id: 'p1', sourceNodeId: 'n1', targetNodeId: 'n2', admittance: { current: 1e-4 } });
  return createNetwork({ nodes: [n1, n2], elements: [pipe] });
}

test('a well-formed network validates cleanly', () => {
  const result = validateNetwork(baseValidNetwork());
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('rejects a network with no fixed-pressure reference node', () => {
  const net = baseValidNetwork();
  net.nodes[0].boundary.pressure.fixed = false;
  net.nodes[1].boundary.pressure.fixed = false;
  const result = validateNetwork(net);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === 'NO_PRESSURE_REFERENCE'));
});

test('detects a disconnected region lacking its own pressure reference', () => {
  const net = baseValidNetwork();
  const n3 = createNode({ id: 'n3' });
  const n4 = createNode({ id: 'n4' });
  net.nodes.push(n3, n4);
  net.elements.push(createElement('pipe', { id: 'p2', sourceNodeId: 'n3', targetNodeId: 'n4', admittance: { current: 1e-4 } }));
  const result = validateNetwork(net);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === 'DISCONNECTED_REGION'));
});

test('rejects a node with both fixed pressure and fixed flow', () => {
  const net = baseValidNetwork();
  net.nodes[1].boundary.flow.fixed = true;
  net.nodes[1].boundary.flow.value = 0.01;
  const result = validateNetwork(net);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === 'OVER_CONSTRAINED_NODE'));
});

test('rejects duplicate element ids', () => {
  const net = baseValidNetwork();
  net.elements.push(createElement('pipe', { id: 'p1', sourceNodeId: 'n1', targetNodeId: 'n2', admittance: { current: 1e-4 } }));
  const result = validateNetwork(net);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === 'DUPLICATE_ELEMENT_ID'));
});

test('rejects an element referencing a non-existent node', () => {
  const net = baseValidNetwork();
  net.elements[0].targetNodeId = 'does-not-exist';
  const result = validateNetwork(net);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === 'MISSING_TARGET_NODE'));
});

test('rejects invalid pipe geometry', () => {
  const net = baseValidNetwork();
  net.elements[0].params.diameter = -1;
  const result = validateNetwork(net);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === 'INVALID_PARAMS'));
});

test('rejects a non-positive hazenWilliamsC even when the network headlossModel is Darcy-Weisbach', () => {
  const net = baseValidNetwork();
  net.elements[0].params.hazenWilliamsC = 0;
  const result = validateNetwork(net);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === 'INVALID_PARAMS' && e.message.includes('hazenWilliamsC')));
});

test('rejects admittance min greater than max', () => {
  const net = baseValidNetwork();
  net.elements[0].admittance.min = 1e-3;
  net.elements[0].admittance.max = 1e-4;
  const result = validateNetwork(net);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === 'INVALID_ADMITTANCE_BOUNDS'));
});

test('warns about isolated nodes without blocking validation', () => {
  const net = baseValidNetwork();
  net.nodes.push(createNode({ id: 'n3' }));
  const result = validateNetwork(net);
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((w) => w.code === 'ISOLATED_NODE'));
});

function networkWithTank(tankParams) {
  const reservoir = createNode({ id: 'r1', nodeType: 'reservoir', elevation: 100 });
  const tank = createNode({ id: 't1', nodeType: 'tank', elevation: 50, params: tankParams });
  const pipe = createElement('pipe', { id: 'p1', sourceNodeId: 'r1', targetNodeId: 't1', admittance: { current: 1e-4 } });
  return createNetwork({ nodes: [reservoir, tank], elements: [pipe] });
}

test('a well-formed reservoir/tank network validates cleanly', () => {
  const result = validateNetwork(networkWithTank({ diameter: 10, minLevel: 0, maxLevel: 20, level: 8 }));
  assert.equal(result.valid, true);
});

test('rejects a tank with non-positive diameter', () => {
  const result = validateNetwork(networkWithTank({ diameter: -1, minLevel: 0, maxLevel: 20, level: 8 }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === 'INVALID_TANK_PARAMS'));
});

test('rejects a tank whose minLevel exceeds maxLevel', () => {
  const result = validateNetwork(networkWithTank({ diameter: 10, minLevel: 20, maxLevel: 5, level: 8 }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === 'INVALID_TANK_PARAMS'));
});

test('warns (without blocking) when a tank level is outside its min/max range', () => {
  const result = validateNetwork(networkWithTank({ diameter: 10, minLevel: 0, maxLevel: 20, level: 25 }));
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((w) => w.code === 'TANK_LEVEL_OUT_OF_RANGE'));
});
