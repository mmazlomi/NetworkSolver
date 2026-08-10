// Versioned JSON export/import. See docs/research.md section 2.7 for the
// schema-versioning approach adopted (integer schemaVersion, permissive
// import, explicit rejection of incompatible future versions).
import { SCHEMA_VERSION, createNode, createElement, createFluid, createNetwork, pruneGoalSeekReferences } from './model.js';

/**
 * Serializes a network to a plain JSON-ready object. Computed results are
 * included only as an explicitly-labeled, stale-on-load cache -- the
 * canonical source of truth after import is always a fresh solve.
 */
export function exportNetwork(network) {
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    meta: network.meta,
    fluid: network.fluid,
    headlossModel: network.headlossModel,
    nodes: network.nodes,
    elements: network.elements,
    goalSeek: {
      targets: network.goalSeek.targets,
      adjustable: network.goalSeek.adjustable,
      tolerance: network.goalSeek.tolerance,
      maxIterations: network.goalSeek.maxIterations,
      // optimization history is a run log, not part of the durable config
    },
    resultsCache: {
      stale: false,
      note: 'Cached results are recomputed on import and must not be trusted as-is.',
      nodes: Object.fromEntries(network.nodes.map((n) => [n.id, n.computed])),
      elements: Object.fromEntries(network.elements.map((e) => [e.id, e.computed])),
    },
  };
}

export function serializeNetwork(network) {
  return JSON.stringify(exportNetwork(network), null, 2);
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * @param {string|object} input JSON text or already-parsed object.
 * @returns {{ network: object|null, errors: string[], warnings: string[] }}
 */
export function importNetwork(input) {
  const errors = [];
  const warnings = [];
  let raw;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (e) {
      return { network: null, errors: [`File is not valid JSON: ${e.message}`], warnings };
    }
  } else {
    raw = input;
  }

  if (!isPlainObject(raw)) {
    return { network: null, errors: ['File does not contain a network configuration object'], warnings };
  }
  if (typeof raw.schemaVersion !== 'number') {
    return { network: null, errors: ['File is missing a numeric "schemaVersion" field'], warnings };
  }
  if (raw.schemaVersion > SCHEMA_VERSION) {
    return {
      network: null,
      errors: [`File schema version ${raw.schemaVersion} is newer than the version this application supports (${SCHEMA_VERSION}); please update the application`],
      warnings,
    };
  }
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.elements)) {
    return { network: null, errors: ['File is missing "nodes" or "elements" arrays'], warnings };
  }

  let nodes;
  try {
    nodes = raw.nodes.map((n) => {
      const node = createNode({ ...n, id: n.id });
      node.computed = { pressure: null, temperature: null, massBalanceResidual: null };
      return node;
    });
  } catch (e) {
    return { network: null, errors: [`Failed to parse nodes: ${e.message}`], warnings };
  }

  let elements;
  try {
    elements = raw.elements.map((e) => {
      const el = createElement(e.type, { ...e, id: e.id });
      el.computed = { flow: null, pressureDrop: null, inletTemperature: null, outletTemperature: null, heatDuty: null, valid: null, messages: [] };
      return el;
    });
  } catch (e) {
    return { network: null, errors: [`Failed to parse elements: ${e.message}`], warnings };
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const el of elements) {
    if (!nodeIds.has(el.sourceNodeId) || !nodeIds.has(el.targetNodeId)) {
      errors.push(`Element "${el.name}" references a node id that does not exist in this file`);
    }
  }
  if (errors.length > 0) return { network: null, errors, warnings };

  if (raw.resultsCache) {
    warnings.push('Cached results from the file were discarded; results were recomputed after loading.');
  }

  const rawGoalSeek = {
    targets: raw.goalSeek?.targets || [],
    adjustable: raw.goalSeek?.adjustable || [],
    tolerance: raw.goalSeek?.tolerance ?? 1e-4,
    maxIterations: raw.goalSeek?.maxIterations ?? 50,
    history: [],
  };
  // A hand-edited or corrupted file can list a goal-seek target/adjustable
  // element id that isn't (or no longer is) in "elements" -- silently
  // dropping it here means Goal Seek is immediately usable after import,
  // instead of only failing with an "... not found" error the first time
  // the user clicks "Run goal seek".
  const goalSeek = pruneGoalSeekReferences(rawGoalSeek, elements);
  if (goalSeek.targets.length < rawGoalSeek.targets.length || goalSeek.adjustable.length < rawGoalSeek.adjustable.length) {
    warnings.push('One or more goal-seek targets/adjustable elements referenced an element id not present in this file and were dropped.');
  }

  const network = createNetwork({
    meta: raw.meta,
    fluid: createFluid(raw.fluid),
    headlossModel: raw.headlossModel,
    nodes,
    elements,
    goalSeek,
  });

  return { network, errors, warnings };
}
