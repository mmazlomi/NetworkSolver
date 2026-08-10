import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNetwork, createNode, createElement } from '../src/solver/model.js';
import { solveHydraulics } from '../src/solver/hydraulics.js';
import { solveThermal } from '../src/solver/thermal.js';
import * as heatExchanger from '../src/solver/elements/heatExchanger.js';

test('pipe heat loss matches the exponential ambient-decay closed form', () => {
  const n1 = createNode({
    id: 'n1', boundary: { pressure: { fixed: true, value: 200000 }, temperature: { fixed: true, value: 80 } },
  });
  const n2 = createNode({ id: 'n2', boundary: { pressure: { fixed: true, value: 100000 } } });
  const pipe = createElement('pipe', {
    id: 'p1', sourceNodeId: 'n1', targetNodeId: 'n2', admittance: { current: 2e-4 },
    params: { length: 50, diameter: 0.1, heatTransferCoefficient: 15, ambientTemperature: 10 },
  });
  const net = createNetwork({ nodes: [n1, n2], elements: [pipe] });

  const hydraulic = solveHydraulics(net);
  const thermal = solveThermal(net, hydraulic);

  const Q = hydraulic.elementResults.p1.Q;
  const massFlow = net.fluid.density * Q;
  const ua = 15 * Math.PI * 0.1 * 50;
  const expectedTout = 10 + (80 - 10) * Math.exp(-ua / (massFlow * net.fluid.specificHeat));

  assert.ok(Math.abs(thermal.elementResults.p1.outletTemperature - expectedTout) < 1e-6);
  assert.equal(thermal.nodeTemperatures.n2, thermal.elementResults.p1.outletTemperature);
});

test('node mixing: two inflows blend by flow-weighted average', () => {
  const n1 = createNode({ id: 'n1', boundary: { pressure: { fixed: true, value: 200000 }, temperature: { fixed: true, value: 80 } } });
  const n2 = createNode({ id: 'n2', boundary: { pressure: { fixed: true, value: 200000 }, temperature: { fixed: true, value: 20 } } });
  const n3 = createNode({ id: 'n3', boundary: { pressure: { fixed: true, value: 100000 } } });
  const pipeA = createElement('pipe', { id: 'pA', sourceNodeId: 'n1', targetNodeId: 'n3', admittance: { current: 2e-4 } });
  const pipeB = createElement('pipe', { id: 'pB', sourceNodeId: 'n2', targetNodeId: 'n3', admittance: { current: 2e-4 } });
  const net = createNetwork({ nodes: [n1, n2, n3], elements: [pipeA, pipeB] });

  const hydraulic = solveHydraulics(net);
  const thermal = solveThermal(net, hydraulic);

  const qA = hydraulic.elementResults.pA.Q;
  const qB = hydraulic.elementResults.pB.Q;
  const expectedT = (qA * 80 + qB * 20) / (qA + qB);
  assert.ok(Math.abs(thermal.nodeTemperatures.n3 - expectedT) < 1e-6);
});

test('heat exchanger effectiveness-NTU matches the counter-flow closed form', () => {
  const fluid = { density: 1000, specificHeat: 4180, viscosity: 0.001 };
  const Q = 0.01;
  const params = { ua: 5000, effectivenessMode: 'ua', secondaryTemperature: 20, secondaryCapacityRate: 3000 };
  const { a, b, effectiveness } = heatExchanger.thermalTransfer({ Q, params, fluid });

  const c1 = fluid.density * Q * fluid.specificHeat;
  const cMin = Math.min(c1, params.secondaryCapacityRate);
  const cMax = Math.max(c1, params.secondaryCapacityRate);
  const cr = cMin / cMax;
  const ntu = params.ua / cMin;
  const expTerm = Math.exp(-ntu * (1 - cr));
  const expectedEff = (1 - expTerm) / (1 - cr * expTerm);

  assert.ok(Math.abs(effectiveness - expectedEff) < 1e-9);

  const tIn = 90;
  const tOut = a * tIn + b;
  const expectedDuty = expectedEff * cMin * (tIn - params.secondaryTemperature);
  const expectedTout = tIn - expectedDuty / c1;
  assert.ok(Math.abs(tOut - expectedTout) < 1e-6);
});

test('a node with no inflow and no fixed temperature is reported as indeterminate with a warning', () => {
  const n1 = createNode({ id: 'n1', boundary: { pressure: { fixed: true, value: 100000 } } });
  const n2 = createNode({ id: 'n2', boundary: { pressure: { fixed: true, value: 100000 } } }); // zero deltaP -> zero flow
  const pipe = createElement('pipe', { id: 'p1', sourceNodeId: 'n1', targetNodeId: 'n2', admittance: { current: 1e-4 } });
  const net = createNetwork({ nodes: [n1, n2], elements: [pipe] });

  const hydraulic = solveHydraulics(net);
  const thermal = solveThermal(net, hydraulic);
  assert.equal(thermal.nodeTemperatures.n2, null);
  assert.ok(thermal.warnings.some((w) => w.code === 'TEMPERATURE_INDETERMINATE'));
});
