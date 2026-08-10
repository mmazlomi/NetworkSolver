import { effectiveDeltaPressure, admittanceFlow } from './common.js';

export const type = 'heatExchanger';

export function flow({ pIn, pOut, zIn, zOut, admittance, fluid, enabled }) {
  if (!enabled) return { Q: 0, deltaPressure: 0, valid: true, messages: [] };
  const dp = effectiveDeltaPressure({ pIn, pOut, zIn, zOut, density: fluid.density });
  const Q = admittanceFlow(dp, admittance);
  return { Q, deltaPressure: dp, valid: true, messages: [] };
}

/**
 * Effectiveness-NTU model against a secondary-side reference temperature.
 * Returns { a, b } such that Tout = a*Tin + b, plus the computed duty for
 * reporting. secondaryCapacityRate may be a very large number to represent
 * an effectively isothermal secondary side (e.g. condensing/boiling fluid).
 */
export function thermalTransfer({ Q, params, fluid }) {
  const massFlow = fluid.density * Math.abs(Q);
  const c1 = massFlow * fluid.specificHeat;
  if (c1 <= 1e-9) return { a: 1, b: 0, duty: 0, effectiveness: 0 };

  let effectiveness;
  if (params.effectivenessMode === 'effectiveness') {
    effectiveness = Math.min(Math.max(params.effectivenessValue ?? 0, 0), 1);
  } else {
    const c2 = params.secondaryCapacityRate;
    const cMin = Math.min(c1, c2);
    const cMax = Math.max(c1, c2);
    const cr = cMax > 0 ? cMin / cMax : 0;
    const ntu = params.ua / cMin;
    if (cr >= 0.999) {
      effectiveness = ntu / (1 + ntu);
    } else {
      const expTerm = Math.exp(-ntu * (1 - cr));
      effectiveness = (1 - expTerm) / (1 - cr * expTerm);
    }
  }

  const cMinForDuty = Math.min(c1, params.secondaryCapacityRate);
  const a = 1 - (effectiveness * cMinForDuty) / c1;
  const b = (effectiveness * cMinForDuty * params.secondaryTemperature) / c1;
  return { a, b, effectiveness };
}

export function computeNominalAdmittance() {
  return null; // heat exchanger admittance is set directly, not derived
}

export function validateParams(params) {
  const errors = [];
  if (params.effectivenessMode === 'ua' && !(params.ua >= 0)) errors.push('ua must be >= 0');
  if (params.effectivenessMode === 'effectiveness' &&
    (params.effectivenessValue < 0 || params.effectivenessValue > 1)) {
    errors.push('effectivenessValue must be within [0, 1]');
  }
  if (!(params.secondaryCapacityRate > 0)) errors.push('secondaryCapacityRate must be > 0');
  return errors;
}
