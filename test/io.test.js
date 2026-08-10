import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportNetwork, serializeNetwork, importNetwork } from '../src/solver/io.js';
import { buildExampleNetwork } from '../src/solver/example.js';
import { SCHEMA_VERSION } from '../src/solver/model.js';

test('export produces an object with a numeric schemaVersion and topology arrays', () => {
  const net = buildExampleNetwork();
  const exported = exportNetwork(net);
  assert.equal(exported.schemaVersion, SCHEMA_VERSION);
  assert.equal(Array.isArray(exported.nodes), true);
  assert.equal(Array.isArray(exported.elements), true);
  assert.equal(exported.resultsCache.stale, false);
});

test('round-trip export -> import preserves topology and parameters', () => {
  const net = buildExampleNetwork();
  const json = serializeNetwork(net);
  const { network, errors } = importNetwork(json);
  assert.deepEqual(errors, []);
  assert.equal(network.nodes.length, net.nodes.length);
  assert.equal(network.elements.length, net.elements.length);

  const originalPump = net.elements.find((e) => e.id === 'el_pump');
  const importedPump = network.elements.find((e) => e.id === 'el_pump');
  assert.equal(importedPump.sourceNodeId, originalPump.sourceNodeId);
  assert.equal(importedPump.targetNodeId, originalPump.targetNodeId);
  assert.equal(importedPump.params.nominalFlow, originalPump.params.nominalFlow);
  assert.equal(importedPump.params.mode, originalPump.params.mode);

  const originalValve = net.elements.find((e) => e.id === 'el_valve_a');
  const importedValve = network.elements.find((e) => e.id === 'el_valve_a');
  assert.equal(importedValve.params.kvRated, originalValve.params.kvRated);
  assert.equal(importedValve.admittance.current, originalValve.admittance.current);

  const originalNode = net.nodes.find((n) => n.id === 'n_supply');
  const importedNode = network.nodes.find((n) => n.id === 'n_supply');
  assert.equal(importedNode.boundary.pressure.value, originalNode.boundary.pressure.value);
  assert.equal(importedNode.boundary.temperature.value, originalNode.boundary.temperature.value);
});

test('a hand-edited file with a goal-seek target/adjustable referencing a missing element id has it dropped, with a warning', () => {
  const net = buildExampleNetwork();
  const exported = exportNetwork(net);
  // Simulate a file edited (or corrupted) after the fact: one target and
  // one adjustable now point at an element id that isn't in "elements".
  exported.goalSeek.targets.push({ elementId: 'does-not-exist', targetFlow: 0.01 });
  exported.goalSeek.adjustable.push({ elementId: 'also-does-not-exist', min: 1e-6, max: 1e-3 });
  const originalTargetCount = exported.goalSeek.targets.length;
  const originalAdjustableCount = exported.goalSeek.adjustable.length;

  const { network, errors, warnings } = importNetwork(exported);
  assert.deepEqual(errors, []);
  assert.equal(network.goalSeek.targets.length, originalTargetCount - 1);
  assert.equal(network.goalSeek.adjustable.length, originalAdjustableCount - 1);
  assert.equal(network.goalSeek.targets.some((t) => t.elementId === 'does-not-exist'), false);
  assert.equal(network.goalSeek.adjustable.some((a) => a.elementId === 'also-does-not-exist'), false);
  assert.ok(warnings.some((w) => w.includes('goal-seek')));
});

test('round-trip export -> import preserves a non-default headlossModel', () => {
  const net = { ...buildExampleNetwork(), headlossModel: 'hazenWilliams' };
  const json = serializeNetwork(net);
  const { network, errors } = importNetwork(json);
  assert.deepEqual(errors, []);
  assert.equal(network.headlossModel, 'hazenWilliams');
});

test('a file with no headlossModel field (older save) imports as the default darcyWeisbach', () => {
  const net = buildExampleNetwork();
  const exported = exportNetwork(net);
  delete exported.headlossModel;
  const { network, errors } = importNetwork(exported);
  assert.deepEqual(errors, []);
  assert.equal(network.headlossModel, 'darcyWeisbach');
});

test('imported networks always start with results marked for recompute', () => {
  const net = buildExampleNetwork();
  net.nodes[0].computed.pressure = 999999; // simulate stale cached results
  const { network, warnings } = importNetwork(exportNetwork(net));
  assert.equal(network.nodes[0].computed.pressure, null);
  assert.ok(warnings.some((w) => w.includes('recomputed')));
});

test('rejects malformed JSON with a clear message', () => {
  const { network, errors } = importNetwork('{not valid json');
  assert.equal(network, null);
  assert.ok(errors[0].includes('not valid JSON'));
});

test('rejects a file with a missing schemaVersion', () => {
  const { network, errors } = importNetwork({ nodes: [], elements: [] });
  assert.equal(network, null);
  assert.ok(errors[0].includes('schemaVersion'));
});

test('rejects a file from a newer, incompatible schema version', () => {
  const exported = exportNetwork(buildExampleNetwork());
  exported.schemaVersion = SCHEMA_VERSION + 1;
  const { network, errors } = importNetwork(exported);
  assert.equal(network, null);
  assert.ok(errors[0].includes('newer'));
});

test('rejects an element referencing a missing node id', () => {
  const exported = exportNetwork(buildExampleNetwork());
  exported.elements[0].sourceNodeId = 'nonexistent';
  const { network, errors } = importNetwork(exported);
  assert.equal(network, null);
  assert.ok(errors.length > 0);
});
