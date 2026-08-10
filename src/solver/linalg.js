// Small dependency-free dense linear algebra used by the Newton-Raphson
// hydraulic solve, the thermal energy-balance solve and the admittance
// optimizer. See docs/research.md section 2.4 for why this is hand-written
// instead of an external matrix library.

/**
 * Solve A x = b for x using Gaussian elimination with partial pivoting.
 * @param {number[][]} A square matrix (n x n), not mutated.
 * @param {number[]} b right-hand side (length n), not mutated.
 * @returns {{ x: number[]|null, singular: boolean }}
 */
export function solveLinearSystem(A, b) {
  const n = b.length;
  if (n === 0) return { x: [], singular: false };
  const M = A.map((row) => row.slice());
  const rhs = b.slice();

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let pivotVal = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r][col]);
      if (v > pivotVal) {
        pivotVal = v;
        pivotRow = r;
      }
    }
    if (pivotVal < 1e-14) {
      return { x: null, singular: true };
    }
    if (pivotRow !== col) {
      [M[col], M[pivotRow]] = [M[pivotRow], M[col]];
      [rhs[col], rhs[pivotRow]] = [rhs[pivotRow], rhs[col]];
    }
    const pivot = M[col][col];
    for (let r = col + 1; r < n; r++) {
      const factor = M[r][col] / pivot;
      if (factor === 0) continue;
      for (let c = col; c < n; c++) {
        M[r][c] -= factor * M[col][c];
      }
      rhs[r] -= factor * rhs[col];
    }
  }

  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = rhs[i];
    for (let j = i + 1; j < n; j++) sum -= M[i][j] * x[j];
    x[i] = sum / M[i][i];
  }
  return { x, singular: false };
}

/** Euclidean norm of a vector. */
export function norm2(v) {
  let s = 0;
  for (const value of v) s += value * value;
  return Math.sqrt(s);
}

/** Max absolute value of a vector (0 for empty vectors). */
export function normInf(v) {
  let m = 0;
  for (const value of v) m = Math.max(m, Math.abs(value));
  return m;
}

/**
 * Smoothed signed square-root, the core admittance-flow primitive:
 * Q = A * signedSqrt(deltaPressure). Smooth and differentiable everywhere,
 * including deltaPressure = 0, which keeps the Newton Jacobian finite.
 * Asymptotically equals sign(x) * sqrt(|x|) once |x| >> delta. Equivalent
 * to signedPow(x, 0.5, delta) -- kept as its own function since it's the
 * default/most common case (valves, heat exchangers, Darcy-Weisbach pipes).
 */
export function signedSqrt(x, delta = 1e-3) {
  const denom = Math.sqrt(Math.sqrt(x * x + delta * delta));
  return x / denom;
}

/**
 * Smoothed signed power: sign(x)*|x|^n away from zero, smooth and finite
 * at x=0 (same trick as signedSqrt, generalized to an arbitrary exponent).
 * signedPow(x, 0.5, delta) is mathematically equal to signedSqrt(x, delta)
 * (differs only by floating-point rounding, since the two take different
 * computational paths to the same value). Used by
 * pipe.js to support both Darcy-Weisbach (n=0.5) and Hazen-Williams
 * (n=1/1.852) headloss models under one admittance-flow primitive.
 */
export function signedPow(x, n, delta = 1e-3) {
  return x * (x * x + delta * delta) ** ((n - 1) / 2);
}
