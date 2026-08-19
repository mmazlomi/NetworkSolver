import { effectiveDeltaPressure, admittanceFlow } from './common.js';

export const type = 'valve';

const EQUAL_PERCENTAGE_RANGEABILITY = 50;

function openingFraction(params) {
  return Math.min(1, Math.max(0, (params.openingPercent ?? 100) / 100));
}

function effectiveKv(params) {
  const x = openingFraction(params);
  const kvRated = params.kvRated || 0;
  if (x <= 0) return 0;
  switch (params.characteristic) {
    case 'quickOpening':
      return kvRated * Math.sqrt(x);
    case 'equalPercentage':
      return kvRated * EQUAL_PERCENTAGE_RANGEABILITY ** (x - 1);
    case 'linear':
    default:
      return kvRated * x;
  }
}

/**
 * Converts a Kv rating (m^3/h at deltaP = 1 bar, per standard valve-sizing
 * convention) into an SI admittance A such that Q[m^3/s] = A * sqrt(dP[Pa]).
 */
export function computeNominalAdmittance(params, fluid) {
  const kvEff = effectiveKv(params);
  if (!(kvEff > 0)) return 0;
  const sg = fluid.density / 1000;
  return (kvEff / 3600) * Math.sqrt(1 / (1e5 * sg));
}

/** Valves have no geometric flow bore in this model (sized by Kv, not diameter) -- no FNCG-equivalent Y. */
export function computeFncgAdmittance() {
  return null;
}

/** No FNCG-equivalent Y (see computeFncgAdmittance above) -- so no FNCG-equivalent mass flow either. */
export function computeFncgMassFlow() {
  return null;
}

export function flow({ pIn, pOut, zIn, zOut, admittance, fluid, enabled, params }) {
  const dp = effectiveDeltaPressure({ pIn, pOut, zIn, zOut, density: fluid.density });
  if (!enabled || openingFraction(params) <= 0) {
    return { Q: 0, deltaPressure: dp, valid: true, messages: [] };
  }
  const Q = admittanceFlow(dp, admittance);
  const messages = [];
  let valid = true;
  if (params.maxDeltaP != null && Math.abs(dp) > params.maxDeltaP) {
    valid = false;
    messages.push(`Pressure drop ${Math.abs(dp).toFixed(0)} Pa exceeds maxDeltaP ${params.maxDeltaP} Pa`);
  }
  return { Q, deltaPressure: dp, valid, messages };
}

/** Valves are treated as adiabatic (no modeled temperature change). */
export function thermalTransfer() {
  return { a: 1, b: 0 };
}

export function validateParams(params) {
  const errors = [];
  if (!(params.kvRated >= 0)) errors.push('kvRated must be >= 0');
  if (params.openingPercent < 0 || params.openingPercent > 100) {
    errors.push('openingPercent must be within [0, 100]');
  }
  return errors;
}
