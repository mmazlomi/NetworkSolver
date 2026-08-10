import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFluid } from '../src/solver/model.js';
import { computeNominalAdmittance, flow, validateParams } from '../src/solver/elements/pipe.js';

const fluid = createFluid();
const GRAVITY = 9.80665;

test('computeNominalAdmittance defaults to Darcy-Weisbach when no headlossModel is given', () => {
  const params = { length: 10, diameter: 0.05, roughness: 0.00015, localLossCoefficient: 0.5 };
  const a = computeNominalAdmittance(params, fluid);
  assert.equal(a, computeNominalAdmittance(params, fluid, 'darcyWeisbach'));
});

test('Hazen-Williams admittance matches the closed-form SI headloss equation', () => {
  const params = { length: 100, diameter: 0.1, hazenWilliamsC: 130 };
  const admittance = computeNominalAdmittance(params, fluid, 'hazenWilliams');
  assert.ok(admittance > 0);

  // Pick an arbitrary flow, compute the textbook headloss, convert to a
  // pressure drop, then check the pipe's own admittance-based flow()
  // reproduces the same flow from that pressure drop (round-trip check).
  const Q = 0.01; // m^3/s
  const hL = 10.67 * params.length * Q ** 1.852 / (params.hazenWilliamsC ** 1.852 * params.diameter ** 4.8704);
  const deltaPressure = hL * fluid.density * GRAVITY;
  const result = flow({
    pIn: deltaPressure, pOut: 0, zIn: 0, zOut: 0, admittance, fluid, enabled: true, headlossModel: 'hazenWilliams',
  });
  assert.ok(Math.abs(result.Q - Q) / Q < 1e-6);
});

test('Darcy-Weisbach and Hazen-Williams give different flows for the same pipe/pressure drop', () => {
  const params = { length: 100, diameter: 0.1, roughness: 0.00015, hazenWilliamsC: 130, localLossCoefficient: 0 };
  const dw = computeNominalAdmittance(params, fluid, 'darcyWeisbach');
  const hw = computeNominalAdmittance(params, fluid, 'hazenWilliams');
  const ctxBase = { pIn: 50000, pOut: 0, zIn: 0, zOut: 0, fluid, enabled: true };
  const flowDw = flow({ ...ctxBase, admittance: dw, headlossModel: 'darcyWeisbach' }).Q;
  const flowHw = flow({ ...ctxBase, admittance: hw, headlossModel: 'hazenWilliams' }).Q;
  assert.notEqual(flowDw, flowHw);
});

test('Hazen-Williams admittance is null for invalid geometry (matches Darcy-Weisbach behavior)', () => {
  assert.equal(computeNominalAdmittance({ length: 0, diameter: 0.1, hazenWilliamsC: 130 }, fluid, 'hazenWilliams'), null);
  assert.equal(computeNominalAdmittance({ length: 10, diameter: 0.1, hazenWilliamsC: 0 }, fluid, 'hazenWilliams'), null);
});

test('flow() with enabled=false returns zero regardless of headlossModel', () => {
  const result = flow({ pIn: 50000, pOut: 0, zIn: 0, zOut: 0, admittance: 1e-4, fluid, enabled: false, headlossModel: 'hazenWilliams' });
  assert.equal(result.Q, 0);
});

test('validateParams rejects a non-positive hazenWilliamsC even though the active model is Darcy-Weisbach', () => {
  const errors = validateParams({ length: 10, diameter: 0.05, roughness: 0.00015, hazenWilliamsC: 0 });
  assert.ok(errors.some((e) => e.includes('hazenWilliamsC')));
});
