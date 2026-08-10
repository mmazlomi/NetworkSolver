import { effectiveDeltaPressure, admittanceFlow, GRAVITY } from './common.js';

export const type = 'pipe';

// Hazen-Williams flow exponent: Q ∝ Δp^(1/1.852), vs. Darcy-Weisbach's
// Q ∝ Δp^0.5 -- see docs/research.md and docs/technical_specs.md §2.2 for
// why these two headloss models are not exactly interconvertible (this is
// the actual mathematical reason, not just a units/roughness difference).
const HAZEN_WILLIAMS_EXPONENT = 1 / 1.852;

/**
 * Darcy-Weisbach + minor-loss resistance, condensed into an admittance
 * coefficient A such that Q = A * sign(dP) * sqrt(|dP|). The friction
 * factor is evaluated once at a representative velocity (Swamee-Jain
 * approximation) rather than re-derived every Newton iteration -- see
 * docs/research.md 2.3 for why admittance is treated as a fixed network
 * parameter, matching how valve Kv ratings are used.
 */
function computeDarcyWeisbachAdmittance(params, fluid) {
  const { length, diameter, roughness, localLossCoefficient = 0 } = params;
  if (!(length > 0) || !(diameter > 0)) return null;
  const area = Math.PI * diameter * diameter / 4;
  const refVelocity = 1; // m/s, representative reference velocity
  const re = (fluid.density * refVelocity * diameter) / fluid.viscosity;
  let f;
  if (re < 2300) {
    f = 64 / Math.max(re, 1);
  } else {
    const term = roughness / (3.7 * diameter) + 5.74 / re ** 0.9;
    f = 0.25 / Math.log10(term) ** 2;
  }
  const resistance = (f * (length / diameter) + localLossCoefficient) * fluid.density / (2 * area * area);
  if (!(resistance > 0)) return null;
  return 1 / Math.sqrt(resistance);
}

/**
 * Hazen-Williams admittance, inverted from the standard SI headloss
 * equation h_L = 10.67 * L * Q^1.852 / (C^1.852 * D^4.8704) [h_L in m],
 * converted to a pressure basis via Δp = ρ·g·h_L:
 *   Q = [C^1.852 · D^4.8704 / (10.67 · L · ρ · g)]^(1/1.852) · Δp^(1/1.852)
 * Minor losses (localLossCoefficient) are not included in this mode --
 * Hazen-Williams is a friction-only empirical correlation; EPANET itself
 * adds minor losses as a separate Darcy-Weisbach-style (exponent-2) term,
 * which would make the pipe's Q(Δp) relation a non-invertible two-term
 * sum. Ignoring minor losses under Hazen-Williams is a documented
 * simplification that keeps every element's flow() closed-form/invertible.
 * Only valid for water (Hazen-Williams' own documented limitation).
 */
function computeHazenWilliamsAdmittance(params, fluid) {
  const { length, diameter, hazenWilliamsC } = params;
  if (!(length > 0) || !(diameter > 0) || !(hazenWilliamsC > 0)) return null;
  const numerator = hazenWilliamsC ** 1.852 * diameter ** 4.8704;
  const denominator = 10.67 * length * fluid.density * GRAVITY;
  if (!(denominator > 0)) return null;
  return (numerator / denominator) ** HAZEN_WILLIAMS_EXPONENT;
}

/**
 * @param {object} params
 * @param {object} fluid
 * @param {'darcyWeisbach'|'hazenWilliams'} [headlossModel] network-wide choice (model.js HEADLOSS_MODELS)
 */
export function computeNominalAdmittance(params, fluid, headlossModel = 'darcyWeisbach') {
  return headlossModel === 'hazenWilliams'
    ? computeHazenWilliamsAdmittance(params, fluid)
    : computeDarcyWeisbachAdmittance(params, fluid);
}

export function flow({ pIn, pOut, zIn, zOut, admittance, fluid, enabled, headlossModel = 'darcyWeisbach' }) {
  if (!enabled) return { Q: 0, deltaPressure: 0, valid: true, messages: [] };
  const dp = effectiveDeltaPressure({ pIn, pOut, zIn, zOut, density: fluid.density });
  const exponent = headlossModel === 'hazenWilliams' ? HAZEN_WILLIAMS_EXPONENT : 0.5;
  const Q = admittanceFlow(dp, admittance, exponent);
  return { Q, deltaPressure: dp, valid: true, messages: [] };
}

/** Returns { a, b } such that Tout = a*Tin + b, from exponential heat loss to ambient. */
export function thermalTransfer({ Q, params, fluid }) {
  const massFlow = fluid.density * Math.abs(Q);
  const h = params.heatTransferCoefficient || 0;
  if (massFlow <= 1e-9 || h <= 0) return { a: 1, b: 0 };
  const perimeter = params.perimeterOverride || Math.PI * params.diameter;
  const ua = h * perimeter * params.length;
  const a = Math.exp(-ua / (massFlow * fluid.specificHeat));
  const b = params.ambientTemperature * (1 - a);
  return { a, b };
}

export function validateParams(params) {
  const errors = [];
  if (!(params.length > 0)) errors.push('length must be > 0');
  if (!(params.diameter > 0)) errors.push('diameter must be > 0');
  if (params.roughness < 0) errors.push('roughness must be >= 0');
  if (!(params.hazenWilliamsC > 0)) errors.push('hazenWilliamsC must be > 0');
  return errors;
}
