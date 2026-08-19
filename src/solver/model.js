// Network data model: plain, JSON-serializable factory objects for nodes,
// elements and the network container. Deliberately not classes, so the
// model round-trips through save/load and postMessage without special
// handling.

export const SCHEMA_VERSION = 1;

export const ELEMENT_TYPES = Object.freeze(['pipe', 'valve', 'pump', 'heatExchanger']);
export const NODE_TYPES = Object.freeze(['junction', 'reservoir', 'tank']);

// Network-wide pipe headloss model (matches EPANET's own [OPTIONS]
// Headloss setting being network-wide, not per-pipe -- see
// docs/technical_specs.md §2.2). 'darcyWeisbach' is the default and
// preserves all pre-existing behavior/save files (its absence in an
// older file means Darcy-Weisbach, unchanged).
export const HEADLOSS_MODELS = Object.freeze(['darcyWeisbach', 'hazenWilliams']);

// When true, pipe admittance under Darcy-Weisbach is re-derived every outer
// Newton iteration from the previous iteration's converged flow (i.e. the
// friction factor is evaluated at the network's own Reynolds number, not a
// fixed 1 m/s reference velocity). Off by default: it preserves all
// pre-existing behavior/save files, matches how admittance is otherwise
// treated as a fixed Kv-style parameter (docs/research.md §2.3), and costs
// extra solver iterations users may not want for a quick what-if. Only
// affects Darcy-Weisbach; Hazen-Williams has no friction-factor/Re concept.

let idCounter = 0;
function nextId(prefix) {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

/** Reset the internal id counter (used by tests for deterministic ids). */
export function resetIdCounter() {
  idCounter = 0;
}

export function createFluid(overrides = {}) {
  return {
    name: 'Water',
    density: 998, // kg/m^3
    specificHeat: 4186, // J/(kg*K)
    viscosity: 0.001, // Pa*s
    ...overrides,
  };
}

function defaultNodeParamsFor(nodeType) {
  switch (nodeType) {
    case 'tank':
      return {
        diameter: 10, // m; cross-sectional area basis (informational -- steady-state does not simulate fill/drain)
        minLevel: 0, // m, above the tank's own elevation
        maxLevel: 10, // m, above the tank's own elevation
        level: 5, // m, current water level for this steady-state snapshot
      };
    default:
      return {};
  }
}

/**
 * Reservoirs and tanks are infinite/finite fixed-head sources: their
 * pressure is not a user toggle, it is always 0 (a free water surface at
 * atmospheric/reference pressure) -- all of their hydraulic significance
 * comes from elevation (reservoir) or elevation+level (tank), matching how
 * EPANET itself models them. See getEffectiveElevation() below and
 * docs/technical_specs.md §2.1.
 */
export function createNode(overrides = {}) {
  const id = overrides.id || nextId('node');
  const nodeType = overrides.nodeType || 'junction';
  const isFixedHeadSource = nodeType === 'reservoir' || nodeType === 'tank';
  const boundaryOverrides = overrides.boundary || {};
  return {
    id,
    name: overrides.name || id,
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    nodeType,
    elevation: overrides.elevation ?? 0,
    notes: overrides.notes || '',
    params: { ...defaultNodeParamsFor(nodeType), ...overrides.params },
    boundary: {
      pressure: {
        fixed: isFixedHeadSource,
        value: isFixedHeadSource ? 0 : null,
        ...boundaryOverrides.pressure,
      },
      flow: { fixed: false, value: 0, ...boundaryOverrides.flow },
      temperature: { fixed: false, value: null, ...boundaryOverrides.temperature },
    },
    computed: {
      pressure: null,
      temperature: null,
      massBalanceResidual: null,
      ...overrides.computed,
    },
  };
}

/**
 * The elevation actually used to drive flow: a tank's water surface sits
 * `level` meters above its own base elevation, so its effective elevation
 * is elevation+level; every other node type just uses its own elevation.
 */
export function getEffectiveElevation(node) {
  if (node.nodeType === 'tank') {
    return (node.elevation || 0) + (node.params?.level ?? 0);
  }
  return node.elevation || 0;
}

function defaultParamsFor(type) {
  switch (type) {
    case 'pipe':
      return {
        length: 10,
        diameter: 0.05,
        roughness: 0.00015, // m, absolute roughness; used when the network's headlossModel is 'darcyWeisbach'
        hazenWilliamsC: 130, // dimensionless C-factor; used when the network's headlossModel is 'hazenWilliams'
        localLossCoefficient: 0.5,
        ambientTemperature: 20,
        heatTransferCoefficient: 0, // W/(m^2*K); 0 = adiabatic (no heat loss)
        perimeterOverride: null, // m; null => derived from diameter
      };
    case 'valve':
      return {
        openingPercent: 100,
        kvRated: 10, // m^3/h at deltaP = 1 bar, fully open
        characteristic: 'linear', // 'linear' | 'equalPercentage' | 'quickOpening'
        maxDeltaP: null, // Pa, null = unlimited
        initialState: 'open',
      };
    case 'pump':
      return {
        mode: 'curve', // 'curve' | 'fixedHead'
        fixedHead: 50000, // Pa
        curveShutoffHead: 60000, // Pa, H0 at Q=0
        nominalFlow: 0.01, // m^3/s
        nominalHead: 40000, // Pa at nominal flow
        speedFactor: 1,
        efficiency: 0.7,
        direction: 'sourceToTarget', // 'sourceToTarget' | 'targetToSource'
        thermalContribution: false,
      };
    case 'heatExchanger':
      return {
        ua: 500, // W/K
        area: 1, // m^2
        effectivenessMode: 'ua', // 'ua' | 'effectiveness'
        effectivenessValue: 0.7,
        secondaryTemperature: 60, // deg C
        secondaryCapacityRate: 2000, // W/K, Infinity-like large value = isothermal secondary
        localLossCoefficient: 2,
      };
    default:
      return {};
  }
}

export function createElement(type, overrides = {}) {
  if (!ELEMENT_TYPES.includes(type)) {
    throw new Error(`Unknown element type: ${type}`);
  }
  const id = overrides.id || nextId(type);
  const admittanceDefault = type === 'pump' ? null : 1e-4;
  return {
    id,
    name: overrides.name || id,
    type,
    sourceNodeId: overrides.sourceNodeId || null,
    targetNodeId: overrides.targetNodeId || null,
    enabled: overrides.enabled !== undefined ? overrides.enabled : true,
    notes: overrides.notes || '',
    admittance: {
      initial: admittanceDefault,
      current: admittanceDefault,
      min: type === 'pump' ? null : 1e-7,
      max: type === 'pump' ? null : 1e-2,
      ...overrides.admittance,
    },
    params: { ...defaultParamsFor(type), ...overrides.params },
    computed: {
      flow: null,
      pressureDrop: null,
      inletTemperature: null,
      outletTemperature: null,
      heatDuty: null,
      reynoldsNumber: null, // only populated for pipes when network.recomputeFriction is enabled
      valid: null,
      messages: [],
      ...overrides.computed,
    },
  };
}

export function createNetwork(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      name: 'Untitled Network',
      description: '',
      createdAt: new Date().toISOString(),
      ...overrides.meta,
    },
    fluid: createFluid(overrides.fluid),
    headlossModel: overrides.headlossModel || 'darcyWeisbach',
    recomputeFriction: overrides.recomputeFriction ?? false,
    nodes: overrides.nodes || [],
    elements: overrides.elements || [],
    goalSeek: overrides.goalSeek || {
      targets: [], // { elementId, targetFlow }
      adjustable: [], // { elementId, min, max }
      tolerance: 1e-4,
      maxIterations: 50,
      history: [],
    },
  };
}

export function findNode(network, nodeId) {
  return network.nodes.find((n) => n.id === nodeId) || null;
}

export function findElement(network, elementId) {
  return network.elements.find((e) => e.id === elementId) || null;
}

/**
 * Drops any goalSeek.targets/adjustable entries referencing an elementId
 * that isn't in `elements` -- otherwise deleting an element (or a node,
 * which cascades to delete its attached elements) or importing a
 * hand-edited/corrupted save file can leave a dangling reference that
 * optimizeAdmittances() only discovers at run time, as an
 * "Adjustable element ... not found" / "Target element ... not found"
 * invalidConfiguration error instead of the config simply no longer
 * listing it. Returns the same goalSeek object (by reference) if nothing
 * needed pruning, so callers can cheaply check whether anything changed.
 */
export function pruneGoalSeekReferences(goalSeek, elements) {
  const ids = new Set(elements.map((e) => e.id));
  const targets = goalSeek.targets.filter((t) => ids.has(t.elementId));
  const adjustable = goalSeek.adjustable.filter((a) => ids.has(a.elementId));
  if (targets.length === goalSeek.targets.length && adjustable.length === goalSeek.adjustable.length) {
    return goalSeek;
  }
  return { ...goalSeek, targets, adjustable };
}
