import { effectiveDeltaPressure, admittanceFlow, GRAVITY } from './common.js';

export const type = 'pipe';

// Hazen-Williams flow exponent: Q ∝ Δp^(1/1.852), vs. Darcy-Weisbach's
// Q ∝ Δp^0.5 -- see docs/research.md and docs/technical_specs.md §2.2 for
// why these two headloss models are not exactly interconvertible (this is
// the actual mathematical reason, not just a units/roughness difference).
const HAZEN_WILLIAMS_EXPONENT = 1 / 1.852;

/**
 * Combined dimensionless loss coefficient K = f*(L/D) + K_minor -- friction
 * (Swamee-Jain explicit approximation, evaluated at `velocity`) plus the
 * minor-loss coefficient, the same two terms Darcy-Weisbach admittance and
 * the FNCG-equivalent Y both derive from. Kept as one function so the
 * friction-factor evaluation only lives in one place.
 */
function totalLossCoefficient(params, fluid, velocity) {
  const { length, diameter, roughness, localLossCoefficient = 0 } = params;
  if (!(length > 0) || !(diameter > 0)) return null;
  const re = (fluid.density * velocity * diameter) / fluid.viscosity;
  let f;
  if (re < 2300) {
    f = 64 / Math.max(re, 1);
  } else {
    const term = roughness / (3.7 * diameter) + 5.74 / re ** 0.9;
    f = 0.25 / Math.log10(term) ** 2;
  }
  return f * (length / diameter) + localLossCoefficient;
}

/**
 * Darcy-Weisbach + minor-loss resistance, condensed into an admittance
 * coefficient A such that Q = A * sign(dP) * sqrt(|dP|), using the
 * Swamee-Jain explicit friction-factor approximation evaluated at
 * `velocity` (default: a fixed 1 m/s reference velocity). By default this
 * is called once, at that fixed reference velocity, and the resulting
 * admittance is then treated as a fixed network parameter for the whole
 * solve -- matching how valve Kv ratings are used (docs/research.md 2.3).
 * When `network.recomputeFriction` is enabled, the hydraulic solver instead
 * calls this every outer iteration with the previous iteration's actual
 * flow-derived velocity, so the friction factor tracks the network's own
 * Reynolds number instead of a fixed stand-in.
 */
function computeDarcyWeisbachAdmittance(params, fluid, velocity = 1) {
  const diameter = params.diameter;
  if (!(diameter > 0)) return null;
  const K = totalLossCoefficient(params, fluid, velocity);
  if (!(K > 0)) return null;
  const area = Math.PI * diameter * diameter / 4;
  const resistance = K * fluid.density / (2 * area * area);
  if (!(resistance > 0)) return null;
  return 1 / Math.sqrt(resistance);
}

/** Reynolds number for a pipe carrying volumetric flow Q (m^3/s). */
function reynoldsNumberFor(params, fluid, Q) {
  const diameter = params.diameter;
  if (!(diameter > 0)) return null;
  const area = Math.PI * diameter * diameter / 4;
  const velocity = Math.abs(Q) / area;
  return (fluid.density * velocity * diameter) / fluid.viscosity;
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
 * @param {number} [velocity] m/s used for the Reynolds number in the
 *   Darcy-Weisbach branch. Defaults to the fixed 1 m/s reference velocity
 *   (static/nominal admittance); the hydraulic solver passes the actual
 *   flow-derived velocity instead when network.recomputeFriction is on
 *   (see solver/hydraulics.js).
 */
export function computeNominalAdmittance(params, fluid, headlossModel = 'darcyWeisbach', velocity = 1) {
  return headlossModel === 'hazenWilliams'
    ? computeHazenWilliamsAdmittance(params, fluid)
    : computeDarcyWeisbachAdmittance(params, fluid, velocity);
}

export { reynoldsNumberFor };

/**
 * FNCG-equivalent line admittance Y (the dimensionless loss coefficient
 * FNCG's ysfcm4 subroutine calls `afpnt`), back-solved so that FNCG's own
 * mass-flow equation -- mdot = sf * sign(dP) * sqrt(2*Y*rho*|dP|), sf =
 * flow area, emp55 = 1, no pump coupling -- reproduces exactly the flow
 * NetworkSolver already solved for at this element. NetworkSolver is
 * treated as ground truth: Y is derived from its actual solved operating
 * point (flow, deltaPressure), not re-derived from pipe geometry, so it
 * doesn't matter whether admittance.current is the nominal Darcy-Weisbach
 * value, a goal-seek-tuned override, or an untouched schema default --
 * whatever produced this flow, Y captures it:
 *   mdot = rho*flow  =>  Y = rho * flow^2 / (2 * sf^2 * |dP|)
 *
 * Under Darcy-Weisbach this is an exact, dP-independent unit conversion of
 * admittance.current, not just a point match: NetworkSolver's own
 * Q = A*sign(dP)*sqrt(|dP|) has the same sqrt(dP) exponent as FNCG's
 * equation, so a whole-network FNCG solve using these Y values (same
 * topology, same boundary pressures) should reproduce NetworkSolver's
 * whole-network flow distribution, not just this one element's flow in
 * isolation.
 *
 * Under Hazen-Williams, NetworkSolver's Q ∝ dP^(1/1.852) has a different
 * exponent than FNCG's fixed sqrt(dP) form -- there is no Y that makes the
 * two equations agree for any dP other than the current one, so this only
 * matches exactly at today's operating point; if FNCG's own solve shifts
 * this pipe's dP even slightly, its flow will drift from NetworkSolver's.
 * That's an inherent limitation of representing an HW pipe in FNCG's
 * orifice-type formulation, not a bug in this conversion.
 *
 * Null (left blank in the export) when the operating point can't pin down
 * a unique Y: no flow bore (diameter), or zero pressure drop (disabled
 * element, or any other zero-dP degenerate case).
 */
export function computeFncgAdmittance(params, fluid, flow, deltaPressure) {
  const diameter = params.diameter;
  if (!(diameter > 0) || !Number.isFinite(flow) || !(Math.abs(deltaPressure) > 0)) return null;
  const area = Math.PI * diameter * diameter / 4;
  return fluid.density * flow * flow / (2 * area * area * Math.abs(deltaPressure));
}

/**
 * FNCG-equivalent mass flow through this line: mdot = sf * sign(dP) *
 * sqrt(2*Y*rho*|dP|), FNCG's own mass-flow form, evaluated in reverse (Y
 * and dP known, solve for mdot). Because Y is itself back-solved from
 * NetworkSolver's actual flow at this same dP (see computeFncgAdmittance),
 * this reproduces density * flow exactly -- it's a round-trip check that
 * the "FNCG admittance Y" export really does encode this element's
 * NetworkSolver-solved flow, not an independent estimate.
 * @param {number} admittanceY the Y from computeFncgAdmittance.
 * @param {number} deltaPressure Pa, signed (this element's solved pressure drop).
 */
export function computeFncgMassFlow(params, fluid, admittanceY, deltaPressure) {
  const diameter = params.diameter;
  if (!(diameter > 0) || !Number.isFinite(admittanceY) || admittanceY < 0 || !Number.isFinite(deltaPressure)) return null;
  const area = Math.PI * diameter * diameter / 4;
  const sign = deltaPressure < 0 ? -1 : 1;
  return sign * area * Math.sqrt(2 * admittanceY * fluid.density * Math.abs(deltaPressure));
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
