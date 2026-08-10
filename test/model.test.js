import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNode, getEffectiveElevation, pruneGoalSeekReferences } from '../src/solver/model.js';

test('createNode defaults to a plain junction with no fixed boundary conditions', () => {
  const n = createNode({ name: 'J' });
  assert.equal(n.nodeType, 'junction');
  assert.equal(n.boundary.pressure.fixed, false);
  assert.deepEqual(n.params, {});
});

test('createNode: a reservoir is automatically a fixed-pressure=0 source', () => {
  const n = createNode({ nodeType: 'reservoir', elevation: 800 });
  assert.equal(n.boundary.pressure.fixed, true);
  assert.equal(n.boundary.pressure.value, 0);
  assert.equal(n.elevation, 800);
});

test('createNode: a tank is automatically a fixed-pressure=0 source with default level params', () => {
  const n = createNode({ nodeType: 'tank', elevation: 850 });
  assert.equal(n.boundary.pressure.fixed, true);
  assert.equal(n.boundary.pressure.value, 0);
  assert.ok(n.params.diameter > 0);
  assert.ok(Number.isFinite(n.params.minLevel));
  assert.ok(Number.isFinite(n.params.maxLevel));
  assert.ok(Number.isFinite(n.params.level));
});

test('createNode: reservoir/tank auto-defaults can still be explicitly overridden', () => {
  const n = createNode({ nodeType: 'reservoir', boundary: { pressure: { fixed: false } } });
  assert.equal(n.boundary.pressure.fixed, false);
});

test('createNode: a fresh id is generated even when spreading a cloned node without one', () => {
  const original = createNode({ nodeType: 'tank', name: 'T1', params: { level: 5 } });
  const { id: _id, computed: _computed, ...rest } = original;
  const clone = createNode({ ...rest, name: 'T1 copy' });
  assert.notEqual(clone.id, original.id);
  assert.equal(clone.params.level, 5);
});

test('getEffectiveElevation: junction and reservoir use raw elevation; tank adds its level', () => {
  const junction = createNode({ nodeType: 'junction', elevation: 100 });
  const reservoir = createNode({ nodeType: 'reservoir', elevation: 200 });
  const tank = createNode({ nodeType: 'tank', elevation: 50, params: { level: 8 } });
  assert.equal(getEffectiveElevation(junction), 100);
  assert.equal(getEffectiveElevation(reservoir), 200);
  assert.equal(getEffectiveElevation(tank), 58);
});

test('pruneGoalSeekReferences: drops targets/adjustable entries whose elementId no longer exists', () => {
  const goalSeek = {
    targets: [{ elementId: 'p1', targetFlow: 0.01 }, { elementId: 'deleted', targetFlow: 0.02 }],
    adjustable: [{ elementId: 'p1', min: 1e-6, max: 1e-3 }, { elementId: 'deleted', min: 1e-6, max: 1e-3 }],
    tolerance: 1e-4,
    maxIterations: 50,
    history: [{ some: 'stale run log' }],
  };
  const elements = [{ id: 'p1' }];
  const pruned = pruneGoalSeekReferences(goalSeek, elements);
  assert.deepEqual(pruned.targets, [{ elementId: 'p1', targetFlow: 0.01 }]);
  assert.deepEqual(pruned.adjustable, [{ elementId: 'p1', min: 1e-6, max: 1e-3 }]);
  // Everything else (tolerance, maxIterations, history) passes through untouched.
  assert.equal(pruned.tolerance, 1e-4);
  assert.equal(pruned.maxIterations, 50);
  assert.deepEqual(pruned.history, goalSeek.history);
});

test('pruneGoalSeekReferences: returns the same object by reference when nothing needs pruning', () => {
  const goalSeek = { targets: [{ elementId: 'p1', targetFlow: 0.01 }], adjustable: [{ elementId: 'p1' }], tolerance: 1e-4, maxIterations: 50, history: [] };
  const elements = [{ id: 'p1' }, { id: 'p2' }];
  const pruned = pruneGoalSeekReferences(goalSeek, elements);
  assert.equal(pruned, goalSeek);
});
