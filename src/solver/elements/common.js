import { signedPow } from '../linalg.js';

export const GRAVITY = 9.80665; // m/s^2

/**
 * Effective driving pressure difference from source to target, folding in
 * hydrostatic elevation head: positive means flow is driven source->target.
 */
export function effectiveDeltaPressure({ pIn, pOut, zIn = 0, zOut = 0, density }) {
  return pIn + density * GRAVITY * zIn - (pOut + density * GRAVITY * zOut);
}

/**
 * Generic admittance-based flow relation shared by pipe/valve/heatExchanger:
 * Q = admittance * sign(deltaPressure) * |deltaPressure|^exponent. Valves
 * and heat exchangers always use the default (Cv/Kv-style square root,
 * exponent=0.5); pipes pass a different exponent under the Hazen-Williams
 * headloss model (1/1.852) -- see pipe.js.
 */
export function admittanceFlow(deltaPressure, admittance, exponent = 0.5) {
  if (!(admittance > 0)) return 0;
  return admittance * signedPow(deltaPressure, exponent);
}
