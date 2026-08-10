// Built-in "EPANET Net1 Benchmark" example: the classic tutorial network
// distributed with EPANET (US EPA, public domain) -- one of the most
// widely cited benchmark networks in water-distribution modeling
// literature. Converted from the official Net1.inp data (node elevations/
// demands, pipe diameters/lengths, pump curve, tank level) into SI units
// for NetworkSolver. Source: EPANET example-networks/Net1.inp
// (https://github.com/OpenWaterAnalytics/EPANET).
//
// Conversions and modeling notes (see also each element's `notes` field):
//   - Units: EPANET Net1 uses US customary units (feet, inches, GPM).
//     ft->m: x0.3048, in->m: x0.0254, GPM->m^3/s: x(3.785411784e-3/60).
//   - The Reservoir and Tank use NetworkSolver's dedicated 'reservoir'/
//     'tank' node types (model.js), which are always fixed-pressure=0 (a
//     free water surface) -- their entire hydraulic significance is
//     elevation (reservoir) or elevation+level (tank), matching EPANET's
//     own model, where elevation and (pressure) head are reported
//     separately, exactly like NetworkSolver's elevation + computed
//     pressure. All of EPANET's [TANKS] fields (elevation, init/min/max
//     level, diameter) are preserved directly on the tank node.
//   - NetworkSolver is steady-state only; EPANET's Tank (a dynamic storage
//     node) is represented at its *initial* water level -- a
//     single-instant snapshot, not a time-varying tank.
//   - All 12 pipes share Hazen-Williams C=100 in the source. NetworkSolver
//     now natively supports Hazen-Williams as a network-wide headloss model
//     (model.js HEADLOSS_MODELS / pipe.js), so this network sets
//     headlossModel: 'hazenWilliams' and each pipe's hazenWilliamsC: 100 --
//     an exact match to the source file's roughness model, rather than the
//     Darcy-Weisbach roughness approximation used before that feature existed.
//   - The pump's single-point curve (1500 GPM @ 250 ft) is extrapolated to
//     a shutoff head of 1.33x the design head, EPANET's own documented
//     convention for single-point curves, reproduced here as
//     NetworkSolver's quadratic curve-mode pump.
//   - EPANET's base network does not model temperature (only a generic
//     "quality" tracer); a uniform reference temperature (20 C) is assumed
//     at both boundary sources since NetworkSolver requires one.
import { createNetwork, createNode, createElement, createFluid } from './model.js';
import { getElementModule } from './elements/index.js';

const FT = 0.3048;
const IN = 0.0254;
const GPM = 3.785411784e-3 / 60; // m^3/s per US gallon-per-minute
const GRAVITY = 9.80665;
const HAZEN_WILLIAMS_C = 100; // EPANET Net1.inp's roughness coefficient, shared by all 12 pipes

function withNominalAdmittance(element, fluid, headlossModel) {
  const nominal = getElementModule(element.type).computeNominalAdmittance(element.params, fluid, headlossModel);
  if (nominal != null && nominal > 0) {
    element.admittance.initial = nominal;
    element.admittance.current = nominal;
    element.admittance.min = nominal * 0.05;
    element.admittance.max = nominal * 5;
  }
  return element;
}

export function buildNet1BenchmarkNetwork() {
  const fluid = createFluid(); // water

  // EPANET [COORDINATES], rescaled/offset to a comfortable canvas region.
  const coords = {
    10: [20, 70], 11: [30, 70], 12: [50, 70], 13: [70, 70],
    21: [30, 40], 22: [50, 40], 23: [70, 40],
    31: [30, 10], 32: [50, 10],
    9: [10, 70], 2: [50, 90],
  };
  const SCALE = 14;
  const pos = (id) => ({ x: Math.round(coords[id][0] * SCALE) + 100, y: Math.round((100 - coords[id][1]) * SCALE) + 100 });

  // [JUNCTIONS]: id -> [elevation(ft), demand(GPM)]
  const junctionData = [
    ['10', 710, 0], ['11', 710, 150], ['12', 700, 150], ['13', 695, 100],
    ['21', 700, 150], ['22', 695, 200], ['23', 690, 150],
    ['31', 700, 100], ['32', 710, 100],
  ];
  const nodeById = {};
  const nodes = [];
  for (const [id, elevFt, demandGpm] of junctionData) {
    const node = createNode({
      id: `n_${id}`, name: `Junction ${id}`, ...pos(id),
      elevation: elevFt * FT,
      boundary: demandGpm > 0 ? { flow: { fixed: true, value: -demandGpm * GPM } } : {},
    });
    nodeById[id] = node;
    nodes.push(node);
  }

  const reservoir = createNode({
    id: 'n_9', nodeType: 'reservoir', name: 'Reservoir 9', ...pos(9), elevation: 800 * FT,
    boundary: { temperature: { fixed: true, value: 20 } },
    notes: 'EPANET [RESERVOIRS]: Head=800 ft, modeled directly as this reservoir\'s fixed head (elevation).',
  });
  nodeById['9'] = reservoir;
  nodes.push(reservoir);

  const tank = createNode({
    id: 'n_2', nodeType: 'tank', name: 'Tank 2', ...pos(2), elevation: 850 * FT,
    params: { diameter: 50.5 * FT, minLevel: 100 * FT, maxLevel: 150 * FT, level: 120 * FT },
    boundary: { temperature: { fixed: true, value: 20 } },
    notes: 'EPANET [TANKS]: Elevation=850 ft, InitLevel=120 ft, MinLevel=100 ft, MaxLevel=150 ft, Diameter=50.5 ft -- '
      + 'all preserved directly as this tank\'s base elevation and level fields. NetworkSolver is steady-state '
      + 'only, so "level" is a fixed snapshot (EPANET\'s InitLevel), not a value that changes as the network runs.',
  });
  nodeById['2'] = tank;
  nodes.push(tank);

  // [PIPES]: id -> [fromId, toId, length(ft), diameter(in)] -- all MinorLoss=0.
  const pipeData = [
    ['10', '10', '11', 10530, 18],
    ['11', '11', '12', 5280, 14],
    ['12', '12', '13', 5280, 10],
    ['21', '21', '22', 5280, 10],
    ['22', '22', '23', 5280, 12],
    ['31', '31', '32', 5280, 6],
    ['110', '2', '12', 200, 18],
    ['111', '11', '21', 5280, 10],
    ['112', '12', '22', 5280, 12],
    ['113', '13', '23', 5280, 8],
    ['121', '21', '31', 5280, 8],
    ['122', '22', '32', 5280, 6],
  ];
  const elements = [];
  for (const [id, a, b, lenFt, diaIn] of pipeData) {
    const length = lenFt * FT;
    const diameter = diaIn * IN;
    elements.push(withNominalAdmittance(createElement('pipe', {
      id: `el_p${id}`, name: `Pipe ${id}`, sourceNodeId: nodeById[a].id, targetNodeId: nodeById[b].id,
      params: { length, diameter, hazenWilliamsC: HAZEN_WILLIAMS_C, localLossCoefficient: 0, ambientTemperature: 20, heatTransferCoefficient: 0 },
      notes: `EPANET Net1 Pipe ${id}: L=${lenFt} ft, D=${diaIn} in, Hazen-Williams C=100.`,
    }), fluid, 'hazenWilliams'));
  }

  // [PUMPS] + [CURVES]: single-point curve (1500 GPM @ 250 ft), EPANET's
  // standard extrapolation to shutoff head = 1.33x design head.
  const designFlow = 1500 * GPM;
  const designHeadPa = 250 * FT * fluid.density * GRAVITY;
  const shutoffHeadPa = 1.33 * 250 * FT * fluid.density * GRAVITY;
  const pump = createElement('pump', {
    id: 'el_pump9', name: 'Pump 9', sourceNodeId: reservoir.id, targetNodeId: nodeById['10'].id,
    params: {
      mode: 'curve', curveShutoffHead: shutoffHeadPa, nominalFlow: designFlow, nominalHead: designHeadPa,
      speedFactor: 1, efficiency: 0.75, direction: 'sourceToTarget', thermalContribution: false,
    },
    notes: 'EPANET Net1 Pump 9: single-point curve (1500 GPM @ 250 ft) from [CURVES], extrapolated to a '
      + 'shutoff head of 1.33x the design head (EPANET\'s standard single-point-curve convention). '
      + 'Efficiency 75% from [ENERGY] Global Efficiency.',
  });
  elements.push(pump);

  return createNetwork({
    meta: {
      name: 'EPANET Net1 Benchmark',
      description: 'The classic EPANET "Net1" tutorial network (US EPA, public domain) -- a reservoir and '
        + 'pump feeding a two-loop, 9-junction pipe network with an elevated tank. One of the most widely '
        + 'cited benchmark networks in water-distribution modeling. Converted from the official Net1.inp '
        + 'data into SI units, using the same Hazen-Williams headloss model (C=100) as the source file; '
        + 'see element notes for the original US-customary values and remaining modeling approximations '
        + '(tank -> fixed-pressure snapshot).',
    },
    fluid,
    headlossModel: 'hazenWilliams',
    nodes,
    elements,
    goalSeek: {
      targets: [
        { elementId: 'el_p12', targetFlow: 0.009 },
        { elementId: 'el_p113', targetFlow: 0.0025 },
        { elementId: 'el_p31', targetFlow: 0.0035 },
      ],
      // No explicit min/max here: optimize.js's resolveBounds() falls back
      // to each pipe's own admittance.min/max (set above by
      // withNominalAdmittance as 0.05x/5x of its Hazen-Williams nominal
      // admittance), so these bounds stay correct for whichever headloss
      // model this network uses instead of hardcoding values sized for one
      // specific model's admittance scale.
      adjustable: [
        { elementId: 'el_p12' },
        { elementId: 'el_p112' },
        { elementId: 'el_p121' },
      ],
      tolerance: 2e-4,
      maxIterations: 80,
      history: [],
    },
  });
}
