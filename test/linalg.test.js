import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveLinearSystem, signedSqrt, signedPow, norm2, normInf } from '../src/solver/linalg.js';

test('solveLinearSystem solves a simple 2x2 system', () => {
  const { x, singular } = solveLinearSystem([[2, 1], [1, 3]], [5, 10]);
  assert.equal(singular, false);
  assert.ok(Math.abs(x[0] - 1) < 1e-9);
  assert.ok(Math.abs(x[1] - 3) < 1e-9);
});

test('solveLinearSystem detects a singular matrix', () => {
  const { singular, x } = solveLinearSystem([[1, 2], [2, 4]], [1, 2]);
  assert.equal(singular, true);
  assert.equal(x, null);
});

test('signedSqrt matches sign(x)*sqrt(|x|) away from zero', () => {
  assert.ok(Math.abs(signedSqrt(100) - 10) < 1e-3);
  assert.ok(Math.abs(signedSqrt(-100) + 10) < 1e-3);
});

test('signedSqrt stays finite and smooth at zero', () => {
  const v = signedSqrt(0);
  assert.equal(Number.isFinite(v), true);
  assert.equal(v, 0);
});

test('signedPow(x, 0.5) matches signedSqrt(x) for any x (same formula, different floating-point path)', () => {
  for (const x of [100, -100, 0, 37.5, -0.002]) {
    assert.ok(Math.abs(signedPow(x, 0.5) - signedSqrt(x)) < 1e-12);
  }
});

test('signedPow matches sign(x)*|x|^n away from zero, for a non-0.5 exponent', () => {
  const n = 1 / 1.852; // Hazen-Williams flow exponent
  assert.ok(Math.abs(signedPow(1000, n) - 1000 ** n) < 1e-6);
  assert.ok(Math.abs(signedPow(-1000, n) + 1000 ** n) < 1e-6);
});

test('signedPow stays finite at zero for any exponent', () => {
  assert.equal(Number.isFinite(signedPow(0, 1 / 1.852)), true);
  assert.equal(signedPow(0, 1 / 1.852), 0);
});

test('norm2 and normInf', () => {
  assert.equal(norm2([3, 4]), 5);
  assert.equal(normInf([3, -7, 2]), 7);
});
