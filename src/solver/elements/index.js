// Element type registry. Adding a new element type only requires a new
// module in this directory implementing this same interface
// (flow, thermalTransfer, computeNominalAdmittance, validateParams) and one
// line here -- the hydraulic/thermal solvers never branch on element type.
import * as pipe from './pipe.js';
import * as valve from './valve.js';
import * as pump from './pump.js';
import * as heatExchanger from './heatExchanger.js';

export const ELEMENT_MODULES = {
  pipe,
  valve,
  pump,
  heatExchanger,
};

export function getElementModule(type) {
  const mod = ELEMENT_MODULES[type];
  if (!mod) throw new Error(`Unknown element type: ${type}`);
  return mod;
}
