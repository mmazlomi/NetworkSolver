// Single in-memory application state + a tiny pub/sub, used instead of a
// framework (per the vanilla-JS constraint) to keep the editor, inspector,
// results and goal-seek panels in sync.
import {
  createNetwork, createNode, createElement, findNode, findElement, getElementModule, pruneGoalSeekReferences,
  validateNetwork, solveNetwork, buildExampleNetwork, buildComplexExampleNetwork, buildNet1BenchmarkNetwork,
  buildThreeReservoirBenchmarkNetwork,
  optimizeAdmittances, applyOptimizationResult,
  exportNetwork, importNetwork,
} from '../solver/index.js';

// Built-in example registry, used by the "Load Example" toolbar control
// (see src/web/js/app.js). The first entry is the default (used by
// loadExample() when called with no id, and preselected in the toolbar's
// example dropdown). Adding another built-in example only requires one
// more entry here plus a builder module under src/solver/.
export const EXAMPLES = [
  {
    id: 'complex-network',
    label: 'Complex Network Example',
    build: buildComplexExampleNetwork,
    fileName: 'example-complex-network.json',
  },
  {
    id: 'series-parallel',
    label: 'Series/Parallel Loop',
    build: buildExampleNetwork,
    fileName: 'example-series-parallel-loop.json',
  },
  {
    id: 'net1-benchmark',
    label: 'EPANET Net1 Benchmark',
    build: buildNet1BenchmarkNetwork,
    fileName: 'example-epanet-net1-benchmark.json',
  },
  {
    id: 'three-reservoir-benchmark',
    label: 'Three-Reservoir Problem (Handbook Benchmark)',
    build: buildThreeReservoirBenchmarkNetwork,
    fileName: 'example-three-reservoir-benchmark.json',
  },
];

function nextLabel(network, prefix) {
  let i = 1;
  const used = new Set([...network.nodes, ...network.elements].map((o) => o.name));
  while (used.has(`${prefix} ${i}`)) i += 1;
  return `${prefix} ${i}`;
}

/** "Name copy", then "Name copy 2", "Name copy 3", ... */
function copyLabel(network, originalName) {
  const used = new Set([...network.nodes, ...network.elements].map((o) => o.name));
  const base = `${originalName} copy`;
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base} ${i}`)) i += 1;
  return `${base} ${i}`;
}

const PASTE_OFFSET_STEP = 30;

// Undo/redo tracks the *network* (topology, positions, parameters, boundary
// conditions, applied admittances) -- i.e. user edits to the scheme. Solver
// output (computed.* fields, the goal-seek run log) is derived and is
// deliberately excluded: solve() and runGoalSeek() never push a snapshot.
const MAX_HISTORY = 100;
const BLANK_DIAGNOSTICS = { status: 'ok', errors: [], warnings: [], hydraulic: null };

class Store {
  constructor() {
    this.state = {
      network: createNetwork({ meta: { name: 'New Network' } }),
      diagnostics: { status: 'ok', errors: [], warnings: [], hydraulic: null },
      selection: { type: null, id: null },
      mode: 'select', // 'select' | 'addNode' | 'addElement'
      pendingType: null, // element type (addElement mode) or node type (addNode mode)
      pendingSourceNodeId: null,
      optimization: null,
      fileName: null,
      lastAction: null,
      canUndo: false,
      canRedo: false,
      canPaste: false,
    };
    this.listeners = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.clipboard = null; // { type: 'node'|'element', data } | null
    this.pasteCount = 0;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setState(patch) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  // ---- undo / redo ------------------------------------------------------
  /**
   * Snapshots the current network onto the undo stack before a change is
   * applied. Called once per discrete edit; for continuous gestures (e.g.
   * dragging a node) the caller snapshots once at the start of the gesture
   * rather than on every intermediate update -- see canvas.js.
   */
  pushUndoSnapshot() {
    this.undoStack.push(this.state.network);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.setState({ canUndo: true, canRedo: false });
  }

  undo() {
    if (this.undoStack.length === 0) return;
    const previous = this.undoStack.pop();
    this.redoStack.push(this.state.network);
    if (this.redoStack.length > MAX_HISTORY) this.redoStack.shift();
    const { network, diagnostics } = solveNetwork(previous);
    this.setState({
      network, diagnostics, selection: { type: null, id: null }, optimization: null,
      canUndo: this.undoStack.length > 0, canRedo: true,
    });
  }

  redo() {
    if (this.redoStack.length === 0) return;
    const next = this.redoStack.pop();
    this.undoStack.push(this.state.network);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    const { network, diagnostics } = solveNetwork(next);
    this.setState({
      network, diagnostics, selection: { type: null, id: null }, optimization: null,
      canUndo: true, canRedo: this.redoStack.length > 0,
    });
  }

  // ---- network editing -------------------------------------------------
  addNodeAt(x, y, nodeType = 'junction') {
    this.pushUndoSnapshot();
    const prefix = nodeType === 'junction' ? 'Node' : nodeType.charAt(0).toUpperCase() + nodeType.slice(1);
    const node = createNode({ name: nextLabel(this.state.network, prefix), x, y, nodeType });
    const network = { ...this.state.network, nodes: [...this.state.network.nodes, node] };
    this.setState({ network, selection: { type: 'node', id: node.id } });
    return node;
  }

  addElement(type, sourceNodeId, targetNodeId) {
    this.pushUndoSnapshot();
    const el = createElement(type, {
      name: nextLabel(this.state.network, type.charAt(0).toUpperCase() + type.slice(1)),
      sourceNodeId,
      targetNodeId,
    });
    const network = { ...this.state.network, elements: [...this.state.network.elements, el] };
    this.setState({ network, selection: { type: 'element', id: el.id } });
    return el;
  }

  /** Continuous position update during a node drag -- does not itself snapshot; see beginNodeDrag(). */
  moveNode(nodeId, x, y) {
    const network = {
      ...this.state.network,
      nodes: this.state.network.nodes.map((n) => (n.id === nodeId ? { ...n, x, y } : n)),
    };
    this.setState({ network });
  }

  /** Call once at the start of a node-drag gesture so the whole drag is a single undo step. */
  beginNodeDrag() {
    this.pushUndoSnapshot();
  }

  updateNode(nodeId, patch) {
    this.pushUndoSnapshot();
    const network = {
      ...this.state.network,
      nodes: this.state.network.nodes.map((n) => (n.id === nodeId ? deepMerge(n, patch) : n)),
    };
    this.setState({ network });
  }

  updateElement(elementId, patch) {
    this.pushUndoSnapshot();
    const network = {
      ...this.state.network,
      elements: this.state.network.elements.map((e) => (e.id === elementId ? deepMerge(e, patch) : e)),
    };
    this.setState({ network });
  }

  deleteSelection() {
    const { selection, network } = this.state;
    if (!selection.id) return;
    this.pushUndoSnapshot();
    if (selection.type === 'node') {
      const nodes = network.nodes.filter((n) => n.id !== selection.id);
      const elements = network.elements.filter((e) => e.sourceNodeId !== selection.id && e.targetNodeId !== selection.id);
      const goalSeek = pruneGoalSeekReferences(network.goalSeek, elements);
      this.setState({ network: { ...network, nodes, elements, goalSeek }, selection: { type: null, id: null } });
    } else if (selection.type === 'element') {
      const elements = network.elements.filter((e) => e.id !== selection.id);
      const goalSeek = pruneGoalSeekReferences(network.goalSeek, elements);
      this.setState({ network: { ...network, elements, goalSeek }, selection: { type: null, id: null } });
    }
  }

  // ---- network-wide settings -------------------------------------------
  /**
   * Switches the network's pipe headloss model (Darcy-Weisbach vs.
   * Hazen-Williams). This is a network-wide setting (matching EPANET's
   * own [OPTIONS] Headloss being network-wide, not per-pipe), so every
   * pipe's admittance.current is recomputed from its geometry under the
   * *new* model -- otherwise a pipe would keep an admittance value sized
   * for the old model but have the new model's exponent applied to it in
   * flow(), silently producing wrong physics (the same class of bug as
   * editing geometry without recomputing admittance -- see inspector.js).
   */
  setHeadlossModel(model) {
    if (model === this.state.network.headlossModel) return;
    this.pushUndoSnapshot();
    const fluid = this.state.network.fluid;
    const elements = this.state.network.elements.map((e) => {
      if (e.type !== 'pipe') return e;
      const admittance = getElementModule('pipe').computeNominalAdmittance(e.params, fluid, model);
      if (admittance == null || !(admittance > 0)) return e;
      return { ...e, admittance: { ...e.admittance, current: admittance } };
    });
    const network = { ...this.state.network, headlossModel: model, elements };
    this.setState({ network });
  }

  // ---- copy / paste ---------------------------------------------------
  copySelection() {
    const { selection, network } = this.state;
    if (!selection.id) return;
    if (selection.type === 'node') {
      const node = findNode(network, selection.id);
      if (!node) return;
      this.clipboard = { type: 'node', data: structuredClone(node) };
    } else if (selection.type === 'element') {
      const el = findElement(network, selection.id);
      if (!el) return;
      this.clipboard = { type: 'element', data: structuredClone(el) };
    }
    this.pasteCount = 0;
    this.setState({ canPaste: true });
  }

  /**
   * Pastes a copied node as a new, independent node offset from the
   * original's position. Pastes a copied element as a new element of the
   * same type/parameters connecting the *same* source and target nodes as
   * the original (a parallel duplicate) -- if either node was since
   * deleted, the paste is a no-op. Repeated pastes of the same clipboard
   * item step the offset further out so copies don't stack exactly on top
   * of each other.
   */
  pasteClipboard() {
    if (!this.clipboard) return null;
    this.pasteCount += 1;
    const offset = this.pasteCount * PASTE_OFFSET_STEP;

    if (this.clipboard.type === 'node') {
      this.pushUndoSnapshot();
      // id/computed are intentionally dropped, not copied
      const { id: _id, computed: _computed, x, y, ...rest } = structuredClone(this.clipboard.data);
      const node = createNode({
        ...rest,
        name: copyLabel(this.state.network, this.clipboard.data.name),
        x: x + offset,
        y: y + offset,
      });
      const network = { ...this.state.network, nodes: [...this.state.network.nodes, node] };
      this.setState({ network, selection: { type: 'node', id: node.id } });
      return node;
    }

    if (this.clipboard.type === 'element') {
      const original = this.clipboard.data;
      if (!findNode(this.state.network, original.sourceNodeId) || !findNode(this.state.network, original.targetNodeId)) {
        return null; // endpoints no longer exist
      }
      this.pushUndoSnapshot();
      // id/computed/type are intentionally dropped, not copied (type is passed positionally below)
      const { id: _id, computed: _computed, type: _type, ...rest } = structuredClone(original);
      const el = createElement(original.type, {
        ...rest,
        name: copyLabel(this.state.network, original.name),
      });
      const network = { ...this.state.network, elements: [...this.state.network.elements, el] };
      this.setState({ network, selection: { type: 'element', id: el.id } });
      return el;
    }
    return null;
  }

  setSelection(type, id) {
    this.setState({ selection: { type, id } });
  }

  setMode(mode, pendingType = null) {
    this.setState({ mode, pendingType, pendingSourceNodeId: null });
  }

  setPendingSourceNode(nodeId) {
    this.setState({ pendingSourceNodeId: nodeId });
  }

  // ---- solving ------------------------------------------------------
  solve() {
    const { network, diagnostics } = solveNetwork(this.state.network);
    this.setState({ network, diagnostics, lastAction: 'solve' });
    return diagnostics;
  }

  validateOnly() {
    const validation = validateNetwork(this.state.network);
    this.setState({ diagnostics: { status: validation.valid ? (validation.warnings.length ? 'warning' : 'ok') : 'error', errors: validation.errors, warnings: validation.warnings, hydraulic: null } });
    return validation;
  }

  // ---- goal seek ------------------------------------------------------
  setGoalSeekConfig(patch) {
    this.pushUndoSnapshot();
    const network = { ...this.state.network, goalSeek: { ...this.state.network.goalSeek, ...patch } };
    this.setState({ network });
  }

  runGoalSeek(config) {
    const result = optimizeAdmittances(this.state.network, config);
    const network = {
      ...this.state.network,
      goalSeek: { ...this.state.network.goalSeek, ...config, history: result.history },
    };
    this.setState({ network, optimization: result, lastAction: 'goalSeek' });
    return result;
  }

  applyGoalSeek() {
    if (!this.state.optimization) return;
    this.pushUndoSnapshot();
    const network = applyOptimizationResult(this.state.network, this.state.optimization);
    this.setState({ network });
  }

  revertGoalSeek() {
    this.setState({ optimization: null });
  }

  // ---- example / file io -----------------------------------------------
  loadExample(exampleId = EXAMPLES[0].id) {
    this.pushUndoSnapshot();
    const example = EXAMPLES.find((e) => e.id === exampleId) || EXAMPLES[0];
    const network = example.build();
    this.setState({ network, diagnostics: BLANK_DIAGNOSTICS, selection: { type: null, id: null }, optimization: null, fileName: example.fileName });
  }

  newNetwork() {
    this.pushUndoSnapshot();
    this.setState({
      network: createNetwork({ meta: { name: 'New Network' } }),
      diagnostics: BLANK_DIAGNOSTICS,
      selection: { type: null, id: null },
      optimization: null,
      fileName: null,
    });
  }

  exportNetworkObject() {
    return exportNetwork(this.state.network);
  }

  importNetworkFromText(text, fileName) {
    const { network, errors, warnings } = importNetwork(text);
    if (!network) return { errors, warnings };
    this.pushUndoSnapshot();
    const { network: solved, diagnostics } = solveNetwork(network);
    this.setState({ network: solved, diagnostics, selection: { type: null, id: null }, optimization: null, fileName: fileName || null });
    return { errors: [], warnings };
  }
}

function deepMerge(target, patch) {
  const out = { ...target };
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof target[key] === 'object' && target[key] !== null) {
      out[key] = deepMerge(target[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export const store = new Store();
export { findElement };
