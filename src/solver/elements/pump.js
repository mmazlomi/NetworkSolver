import { effectiveDeltaPressure } from './common.js';
import { signedSqrt } from '../linalg.js';

export const type = 'pump';

/**
 * Derives the quadratic head-flow curve H(Q) = H0 - k*Q^2 (Pa) from the
 * element parameters. "fixedHead" mode is modeled as a curve with a very
 * steep (near-vertical) k, which keeps the pump inside the same
 * Q = f(deltaPressure) formulation every other element uses (required for
 * the generic Newton-Raphson residual/Jacobian assembly) while behaving
 * as an approximately-constant head source across the flow range of
 * interest -- see docs/research.md / docs/technical_specs.md.
 */
function curveParams(params) {
  const speed = params.speedFactor || 1;
  if (params.mode === 'fixedHead') {
    const refFlow = Math.max(params.nominalFlow || 1e-3, 1e-4);
    const H0 = params.fixedHead;
    const k = (H0 * 1e-6) / (refFlow * refFlow); // steep/near-vertical curve
    return { H0: H0 * speed * speed, k: k / (speed * speed || 1) };
  }
  const H0 = params.curveShutoffHead;
  const Qn = Math.max(params.nominalFlow || 1e-4, 1e-6);
  const Hn = params.nominalHead;
  const kRaw = H0 > Hn ? (H0 - Hn) / (Qn * Qn) : (H0 * 1e-6) / (Qn * Qn);
  return { H0: H0 * speed * speed, k: kRaw / (speed * speed || 1) };
}

/**
 * dpSourceToTarget = (sourceHead - targetHead), i.e. the same sign
 * convention every other element uses for effectiveDeltaPressure. The pump
 * curve is evaluated in whichever direction it is installed to pump
 * ("forward"), and the resulting flow is expressed back in the
 * source->target convention.
 */
export function flow({ pIn, pOut, zIn, zOut, fluid, enabled, params }) {
  if (!enabled) return { Q: 0, deltaPressure: 0, valid: true, messages: [] };
  const { H0, k } = curveParams(params);
  const kSafe = Math.max(k, 1e-9);
  const dpSourceToTarget = effectiveDeltaPressure({ pIn, pOut, zIn, zOut, density: fluid.density });
  const forward = params.direction !== 'targetToSource';
  // Head the pump must supply in its own forward (inlet->outlet) direction.
  const deltaRiseForward = forward ? -dpSourceToTarget : dpSourceToTarget;
  const Qforward = signedSqrt(H0 - deltaRiseForward) / Math.sqrt(kSafe);
  const Q = forward ? Qforward : -Qforward;
  return { Q, deltaPressure: dpSourceToTarget, valid: true, messages: [] };
}

/** Optional simplistic thermal contribution from pump inefficiency. */
export function thermalTransfer({ Q, params, fluid }) {
  if (!params.thermalContribution || !(Math.abs(Q) > 1e-9)) return { a: 1, b: 0 };
  const { H0, k } = curveParams(params);
  const headRise = Math.max(H0 - k * Q * Q, 0);
  const hydraulicPower = headRise * Math.abs(Q); // W (deltaP[Pa] * Q[m3/s])
  const eff = Math.min(Math.max(params.efficiency ?? 0.7, 0.01), 1);
  const wasteHeat = hydraulicPower * (1 - eff);
  const massFlow = fluid.density * Math.abs(Q);
  const dT = wasteHeat / (massFlow * fluid.specificHeat);
  return { a: 1, b: dT };
}

export function computeNominalAdmittance() {
  return null; // pumps are driven by their head curve, not an admittance
}

export function validateParams(params) {
  const errors = [];
  if (params.mode === 'fixedHead' && !(params.fixedHead >= 0)) {
    errors.push('fixedHead must be >= 0');
  }
  if (params.mode === 'curve') {
    if (!(params.curveShutoffHead >= 0)) errors.push('curveShutoffHead must be >= 0');
    if (!(params.nominalFlow > 0)) errors.push('nominalFlow must be > 0');
  }
  if (params.efficiency != null && (params.efficiency <= 0 || params.efficiency > 1)) {
    errors.push('efficiency must be within (0, 1]');
  }
  return errors;
}
