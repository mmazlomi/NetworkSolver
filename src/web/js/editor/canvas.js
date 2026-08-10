// Hand-written SVG schematic editor. See docs/research.md section 2.5 for
// why this is hand-rolled instead of a dataflow-graph library: the domain
// here is a vertex/edge physical network (like a P&ID), not a node-port
// dataflow graph, so a focused native-SVG implementation is a better fit
// and keeps the app dependency-free.
const SVG_NS = 'http://www.w3.org/2000/svg';

const NODE_RADIUS = 14;

const ELEMENT_COLORS = {
  pipe: '#5b8def',
  valve: '#e08a2c',
  pump: '#2ca97f',
  heatExchanger: '#c2477a',
};

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function htmlEl(tag, attrs = {}) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v);
  }
  return el;
}

const ZOOM_STEP = 1.2;
const ZOOM_MIN = 0.25; // 25% of the base viewBox extent
const ZOOM_MAX = 4; // 400% of the base viewBox extent
const PAN_CLICK_THRESHOLD = 4; // px; below this, a pointerdown+up on empty canvas is a click (deselect), not a pan

function clientToSvgPoint(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: clientX, y: clientY };
  const transformed = pt.matrixTransform(ctm.inverse());
  return { x: transformed.x, y: transformed.y };
}

/** Finds the node whose center is within `radius` of an SVG-space point, closest first. */
function findNodeAt(network, x, y, radius) {
  let best = null;
  let bestDist = radius;
  for (const node of network.nodes) {
    const d = Math.hypot(node.x - x, node.y - y);
    if (d <= bestDist) {
      best = node;
      bestDist = d;
    }
  }
  return best;
}

export function initEditor(svg, store) {
  let dragNodeId = null;
  let dragOffset = { x: 0, y: 0 };
  let dragSnapshotPushed = false; // only snapshot undo history once the node actually moves, not on a plain click
  let reconnecting = null; // { elementId, end: 'source'|'target', otherNodeId } | null
  let previewLine = null;
  let panState = null; // { startClientX, startClientY, startView, rect, moved } | null, while dragging empty canvas

  // ---- zoom / pan --------------------------------------------------------
  // View state lives entirely here (not in the Store): it's a UI concern of
  // this canvas, not part of the network's data model -- it must not be
  // saved/loaded with the network, nor go through undo/redo. The initial
  // viewBox on the <svg> element (index.html) is the single source of truth
  // for the "100%"/reset extent.
  const [baseX, baseY, baseWidth, baseHeight] = svg.getAttribute('viewBox').split(/\s+/).map(Number);
  const BASE_VIEW = { x: baseX, y: baseY, width: baseWidth, height: baseHeight };
  const MIN_WIDTH = BASE_VIEW.width / ZOOM_MAX;
  const MAX_WIDTH = BASE_VIEW.width / ZOOM_MIN;
  const view = { ...BASE_VIEW };

  const zoomLabel = htmlEl('span', { class: 'ns-zoom-percent', text: '100%' });

  function applyViewBox() {
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`);
    zoomLabel.textContent = `${Math.round((BASE_VIEW.width / view.width) * 100)}%`;
  }

  /** Zooms by `factor` (>1 = in, <1 = out), keeping the SVG point under `clientX/clientY` fixed on screen. */
  function zoomAt(factor, clientX, clientY) {
    const anchor = clientToSvgPoint(svg, clientX, clientY);
    const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, view.width / factor));
    const actualFactor = newWidth / view.width;
    if (actualFactor === 1) return; // already at a zoom limit
    view.width = newWidth;
    view.height *= actualFactor;
    view.x = anchor.x - (anchor.x - view.x) * actualFactor;
    view.y = anchor.y - (anchor.y - view.y) * actualFactor;
    applyViewBox();
  }

  function canvasCenterClientPoint() {
    const rect = svg.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function zoomIn() {
    const c = canvasCenterClientPoint();
    zoomAt(ZOOM_STEP, c.x, c.y);
  }
  function zoomOut() {
    const c = canvasCenterClientPoint();
    zoomAt(1 / ZOOM_STEP, c.x, c.y);
  }
  function resetZoom() {
    Object.assign(view, BASE_VIEW);
    applyViewBox();
  }
  /** Frames every node with some padding, preserving the base aspect ratio (no distortion). */
  function fitToContent() {
    const nodes = store.state.network.nodes;
    if (!nodes.length) {
      resetZoom();
      return;
    }
    const PAD = 120;
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    }
    minX -= PAD; maxX += PAD; minY -= PAD; maxY += PAD;
    const aspect = BASE_VIEW.width / BASE_VIEW.height;
    let width = Math.max(maxX - minX, 1);
    let height = Math.max(maxY - minY, 1);
    if (width / height > aspect) height = width / aspect;
    else width = height * aspect;
    width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
    height = width / aspect;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    view.x = cx - width / 2;
    view.y = cy - height / 2;
    view.width = width;
    view.height = height;
    applyViewBox();
  }

  svg.addEventListener('wheel', (evt) => {
    evt.preventDefault();
    zoomAt(evt.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, evt.clientX, evt.clientY);
  }, { passive: false });

  const zoomControls = htmlEl('div', { class: 'ns-zoom-controls' });
  const zoomOutBtn = htmlEl('button', { type: 'button', title: 'Zoom out (Ctrl -)', text: '−' });
  const zoomInBtn = htmlEl('button', { type: 'button', title: 'Zoom in (Ctrl +)', text: '+' });
  const fitBtn = htmlEl('button', { type: 'button', title: 'Fit to content', text: 'Fit' });
  const resetBtn = htmlEl('button', { type: 'button', title: 'Reset zoom to 100% (Ctrl 0)', text: '100%' });
  zoomOutBtn.addEventListener('click', zoomOut);
  zoomInBtn.addEventListener('click', zoomIn);
  fitBtn.addEventListener('click', fitToContent);
  resetBtn.addEventListener('click', resetZoom);
  zoomControls.append(zoomOutBtn, zoomLabel, zoomInBtn, fitBtn, resetBtn);
  svg.parentElement.appendChild(zoomControls);

  function startReconnect(evt, handle) {
    const elementId = handle.dataset.elementId;
    const end = handle.dataset.reconnectEnd;
    const element = store.state.network.elements.find((e) => e.id === elementId);
    if (!element) return;
    const nodeById = new Map(store.state.network.nodes.map((n) => [n.id, n]));
    const otherNodeId = end === 'source' ? element.targetNodeId : element.sourceNodeId;
    const otherNode = nodeById.get(otherNodeId);
    if (!otherNode) return;

    reconnecting = { elementId, end, otherNodeId };
    previewLine = svgEl('line', {
      x1: otherNode.x, y1: otherNode.y, x2: otherNode.x, y2: otherNode.y,
      class: 'ns-reconnect-preview',
    });
    svg.appendChild(previewLine);
    svg.setPointerCapture(evt.pointerId);
  }

  function updateReconnectPreview(point) {
    if (!previewLine) return;
    previewLine.setAttribute('x2', point.x);
    previewLine.setAttribute('y2', point.y);
  }

  function endReconnect(point) {
    if (previewLine) {
      previewLine.remove();
      previewLine = null;
    }
    if (!reconnecting) return;
    const { elementId, end, otherNodeId } = reconnecting;
    reconnecting = null;
    if (!point) return; // cancelled (pointercancel), don't commit
    const dropNode = findNodeAt(store.state.network, point.x, point.y, NODE_RADIUS + 8);
    if (!dropNode || dropNode.id === otherNodeId) return; // no target, or would create a self-loop
    store.updateElement(elementId, end === 'source' ? { sourceNodeId: dropNode.id } : { targetNodeId: dropNode.id });
  }

  svg.addEventListener('pointerdown', (evt) => {
    const { mode } = store.state;
    const point = clientToSvgPoint(svg, evt.clientX, evt.clientY);

    const reconnectHandle = mode === 'select' ? evt.target.closest('[data-reconnect-end]') : null;
    if (reconnectHandle) {
      startReconnect(evt, reconnectHandle);
      return;
    }

    const target = evt.target.closest('[data-node-id], [data-element-id]');

    if (target && target.dataset.nodeId) {
      const nodeId = target.dataset.nodeId;
      if (mode === 'addElement') {
        handleAddElementClick(store, nodeId);
        return;
      }
      store.setSelection('node', nodeId);
      dragNodeId = nodeId;
      dragSnapshotPushed = false;
      const node = store.state.network.nodes.find((n) => n.id === nodeId);
      dragOffset = { x: point.x - node.x, y: point.y - node.y };
      svg.setPointerCapture(evt.pointerId);
      return;
    }

    if (target && target.dataset.elementId) {
      if (mode === 'select') store.setSelection('element', target.dataset.elementId);
      return;
    }

    // clicked empty canvas
    if (mode === 'addNode') {
      store.addNodeAt(Math.round(point.x), Math.round(point.y), store.state.pendingType || 'junction');
      store.setMode('select');
    } else if (mode === 'select') {
      // Defer deselect-vs-pan until pointerup: a plain click (no meaningful
      // movement) deselects, as before; dragging pans the canvas instead.
      panState = {
        startClientX: evt.clientX, startClientY: evt.clientY, startView: { ...view }, rect: svg.getBoundingClientRect(), moved: false,
      };
      svg.setPointerCapture(evt.pointerId);
    }
  });

  svg.addEventListener('pointermove', (evt) => {
    const point = clientToSvgPoint(svg, evt.clientX, evt.clientY);
    if (reconnecting) {
      updateReconnectPreview(point);
      return;
    }
    if (panState) {
      const dxClient = evt.clientX - panState.startClientX;
      const dyClient = evt.clientY - panState.startClientY;
      if (!panState.moved && Math.hypot(dxClient, dyClient) > PAN_CLICK_THRESHOLD) panState.moved = true;
      if (panState.moved) {
        const scale = view.width / panState.rect.width; // svg units per screen px (uniform: preserveAspectRatio="meet")
        view.x = panState.startView.x - dxClient * scale;
        view.y = panState.startView.y - dyClient * scale;
        applyViewBox();
      }
      return;
    }
    if (!dragNodeId) return;
    if (!dragSnapshotPushed) {
      store.beginNodeDrag();
      dragSnapshotPushed = true;
    }
    store.moveNode(dragNodeId, Math.round(point.x - dragOffset.x), Math.round(point.y - dragOffset.y));
  });

  svg.addEventListener('pointerup', (evt) => {
    dragNodeId = null;
    if (reconnecting) endReconnect(clientToSvgPoint(svg, evt.clientX, evt.clientY));
    if (panState) {
      if (!panState.moved) store.setSelection(null, null);
      panState = null;
    }
  });
  svg.addEventListener('pointercancel', () => {
    dragNodeId = null;
    endReconnect(null);
    panState = null;
  });

  window.addEventListener('keydown', (evt) => {
    const isTyping = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    if (isTyping) return;
    if ((evt.key === 'Delete' || evt.key === 'Backspace') && store.state.selection.id) {
      evt.preventDefault();
      store.deleteSelection();
    }
    if (evt.key === 'Escape') {
      store.setMode('select');
      store.setSelection(null, null);
    }
    if ((evt.ctrlKey || evt.metaKey) && (evt.key === '=' || evt.key === '+')) {
      evt.preventDefault();
      zoomIn();
    } else if ((evt.ctrlKey || evt.metaKey) && evt.key === '-') {
      evt.preventDefault();
      zoomOut();
    } else if ((evt.ctrlKey || evt.metaKey) && evt.key === '0') {
      evt.preventDefault();
      resetZoom();
    }
    if ((evt.ctrlKey || evt.metaKey) && (evt.key === 'z' || evt.key === 'Z')) {
      evt.preventDefault();
      if (evt.shiftKey) store.redo();
      else store.undo();
    } else if ((evt.ctrlKey || evt.metaKey) && (evt.key === 'y' || evt.key === 'Y')) {
      evt.preventDefault();
      store.redo();
    } else if ((evt.ctrlKey || evt.metaKey) && (evt.key === 'c' || evt.key === 'C') && store.state.selection.id) {
      evt.preventDefault();
      store.copySelection();
    } else if ((evt.ctrlKey || evt.metaKey) && (evt.key === 'v' || evt.key === 'V')) {
      evt.preventDefault();
      store.pasteClipboard();
    }
  });

  store.subscribe((state) => render(svg, state));
  render(svg, store.state);
}

function handleAddElementClick(store, nodeId) {
  const { pendingSourceNodeId, pendingType } = store.state;
  if (!pendingSourceNodeId) {
    store.setPendingSourceNode(nodeId);
    return;
  }
  if (pendingSourceNodeId === nodeId) return; // ignore self-loop click
  store.addElement(pendingType, pendingSourceNodeId, nodeId);
  store.setMode('select');
}

function nodeClass(node, state) {
  const classes = ['ns-node', `ns-node-type-${node.nodeType}`];
  if (node.boundary.pressure.fixed) classes.push('ns-node-boundary-pressure');
  if (node.boundary.temperature.fixed) classes.push('ns-node-boundary-temperature');
  if (state.selection.type === 'node' && state.selection.id === node.id) classes.push('ns-selected');
  if (state.pendingSourceNodeId === node.id) classes.push('ns-pending-source');
  const hasError = state.diagnostics.errors.some((e) => e.ref === node.id);
  const hasWarning = state.diagnostics.warnings.some((w) => w.ref === node.id);
  if (hasError) classes.push('ns-has-error');
  else if (hasWarning) classes.push('ns-has-warning');
  return classes.join(' ');
}

function elementClass(el, state) {
  const classes = ['ns-element', `ns-element-${el.type}`];
  if (!el.enabled) classes.push('ns-disabled');
  if (state.selection.type === 'element' && state.selection.id === el.id) classes.push('ns-selected');
  const solved = el.computed.flow !== null && el.computed.flow !== undefined;
  classes.push(solved ? 'ns-solved' : 'ns-unsolved');
  const hasError = state.diagnostics.errors.some((e) => e.ref === el.id);
  const hasWarning = state.diagnostics.warnings.some((w) => w.ref === el.id) || el.computed.valid === false;
  if (hasError) classes.push('ns-has-error');
  else if (hasWarning) classes.push('ns-has-warning');
  return classes.join(' ');
}

/** Reservoirs and tanks get a distinct shape from plain junctions (a circle),
 * loosely echoing conventional P&ID/EPANET symbols, so their fixed-head
 * role is visible on the canvas without opening the inspector. */
function nodeShape(node) {
  if (node.nodeType === 'reservoir') {
    const g = svgEl('g', {});
    g.appendChild(svgEl('rect', { x: -16, y: -9, width: 32, height: 18, 'data-node-id': node.id, class: 'ns-node-shape' }));
    for (let i = -12; i <= 12; i += 8) {
      g.appendChild(svgEl('line', { x1: i, y1: 9, x2: i - 5, y2: 16, class: 'ns-reservoir-hatch' }));
    }
    return g;
  }
  if (node.nodeType === 'tank') {
    return svgEl('rect', { x: -11, y: -16, width: 22, height: 32, rx: 4, 'data-node-id': node.id, class: 'ns-node-shape' });
  }
  return svgEl('circle', { r: NODE_RADIUS, 'data-node-id': node.id, class: 'ns-node-shape' });
}

function midpointMarker(type, x, y, color) {
  const g = svgEl('g', { transform: `translate(${x},${y})`, class: 'ns-marker' });
  if (type === 'valve') {
    g.appendChild(svgEl('path', { d: 'M -9,-7 L 9,7 M -9,7 L 9,-7', stroke: color, 'stroke-width': 3, fill: 'none' }));
    g.appendChild(svgEl('circle', { r: 11, fill: 'white', stroke: color, 'stroke-width': 2, opacity: 0.001 }));
  } else if (type === 'pump') {
    g.appendChild(svgEl('circle', { r: 10, fill: 'white', stroke: color, 'stroke-width': 2.5 }));
    g.appendChild(svgEl('path', { d: 'M -4,-5 L 6,0 L -4,5 Z', fill: color }));
  } else if (type === 'heatExchanger') {
    g.appendChild(svgEl('rect', { x: -11, y: -8, width: 22, height: 16, rx: 3, fill: 'white', stroke: color, 'stroke-width': 2.5 }));
    g.appendChild(svgEl('path', { d: 'M -6,0 q 3,-6 6,0 t 6,0', stroke: color, 'stroke-width': 1.6, fill: 'none' }));
  }
  return g;
}

/** `mx,my` is where the arrow is drawn (the element's, possibly offset, midpoint); the
 * angle still comes from the straight source->target chord, which is an
 * accurate-enough approximation even when the line is fanned out. */
function flowArrow(x1, y1, x2, y2, mx, my, flow, color) {
  const forward = flow >= 0;
  const angle = Math.atan2(y2 - y1, x2 - x1) + (forward ? 0 : Math.PI);
  const g = svgEl('g', { transform: `translate(${mx},${my}) rotate(${(angle * 180) / Math.PI})`, class: 'ns-flow-arrow' });
  g.appendChild(svgEl('path', { d: 'M -18,-5 L -6,0 L -18,5 Z', fill: color }));
  return g;
}

/** Draggable endpoint handle for reconnecting a selected element's source/target node. */
function reconnectHandle(node, elementId, end, color) {
  const g = svgEl('g', {
    transform: `translate(${node.x},${node.y}) rotate(45)`,
    class: 'ns-reconnect-handle', 'data-element-id': elementId, 'data-reconnect-end': end,
  });
  g.appendChild(svgEl('rect', {
    x: -8, y: -8, width: 16, height: 16, rx: 2, fill: 'white', stroke: color, 'stroke-width': 2.5,
    'data-element-id': elementId, 'data-reconnect-end': end,
  }));
  return g;
}

const PARALLEL_SPACING = 18;

/**
 * Groups element ids by their unordered {source, target} node pair, so
 * multiple elements between the same two nodes (e.g. a pasted parallel
 * duplicate) can be fanned out instead of rendering exactly on top of one
 * another.
 */
function groupByNodePair(elements) {
  const groups = new Map();
  for (const el of elements) {
    const key = [el.sourceNodeId, el.targetNodeId].slice().sort().join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(el.id);
  }
  return groups;
}

function render(svg, state) {
  svg.textContent = '';
  const { network } = state;
  const nodeById = new Map(network.nodes.map((n) => [n.id, n]));
  const pairGroups = groupByNodePair(network.elements);

  const elementsLayer = svgEl('g', { class: 'ns-elements-layer' });
  const nodesLayer = svgEl('g', { class: 'ns-nodes-layer' });

  for (const el of network.elements) {
    const source = nodeById.get(el.sourceNodeId);
    const target = nodeById.get(el.targetNodeId);
    if (!source || !target) continue;
    const color = ELEMENT_COLORS[el.type];

    // Fan out parallel elements sharing both endpoints around the straight
    // midpoint; a lone element between its two nodes gets offset 0, which
    // collapses back to the plain straight-line case.
    const group = pairGroups.get([el.sourceNodeId, el.targetNodeId].slice().sort().join('|'));
    let mx = (source.x + target.x) / 2;
    let my = (source.y + target.y) / 2;
    if (group.length > 1) {
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const len = Math.hypot(dx, dy) || 1;
      const offset = (group.indexOf(el.id) - (group.length - 1) / 2) * PARALLEL_SPACING;
      mx += (-dy / len) * offset;
      my += (dx / len) * offset;
    }

    const g = svgEl('g', { 'data-element-id': el.id, class: elementClass(el, state) });
    g.appendChild(svgEl('polyline', {
      points: `${source.x},${source.y} ${mx},${my} ${target.x},${target.y}`,
      fill: 'none', stroke: color, 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      'data-element-id': el.id,
    }));
    if (Number.isFinite(el.computed.flow) && Math.abs(el.computed.flow) > 1e-9) {
      g.appendChild(flowArrow(source.x, source.y, target.x, target.y, mx, my, el.computed.flow, color));
    }
    g.appendChild(midpointMarker(el.type, mx, my, color));
    g.appendChild(svgEl('text', { x: mx, y: my - 16, class: 'ns-element-label', 'text-anchor': 'middle' })).textContent = el.name;
    elementsLayer.appendChild(g);
  }

  for (const node of network.nodes) {
    const g = svgEl('g', { 'data-node-id': node.id, class: nodeClass(node, state), transform: `translate(${node.x},${node.y})` });
    g.appendChild(nodeShape(node));
    if (node.nodeType === 'junction' && node.boundary.pressure.fixed) {
      g.appendChild(svgEl('circle', { r: NODE_RADIUS + 4, class: 'ns-boundary-ring', fill: 'none' }));
    }
    const label = svgEl('text', { y: -NODE_RADIUS - 8, class: 'ns-node-label', 'text-anchor': 'middle' });
    label.textContent = node.name;
    g.appendChild(label);
    if (Number.isFinite(node.computed.pressure)) {
      const p = svgEl('text', { y: NODE_RADIUS + 16, class: 'ns-node-sub', 'text-anchor': 'middle' });
      p.textContent = `${(node.computed.pressure / 1000).toFixed(0)} kPa`;
      g.appendChild(p);
    }
    nodesLayer.appendChild(g);
  }

  if (state.pendingSourceNodeId) {
    const src = nodeById.get(state.pendingSourceNodeId);
    if (src) {
      const hint = svgEl('circle', { cx: src.x, cy: src.y, r: NODE_RADIUS + 8, class: 'ns-pending-hint', fill: 'none' });
      nodesLayer.appendChild(hint);
    }
  }

  svg.appendChild(elementsLayer);
  svg.appendChild(nodesLayer);

  // Drag-to-reconnect handles: only for the selected element, in select mode,
  // rendered last so they sit above everything else and take pointer priority.
  if (state.mode === 'select' && state.selection.type === 'element') {
    const selected = network.elements.find((e) => e.id === state.selection.id);
    const source = selected && nodeById.get(selected.sourceNodeId);
    const target = selected && nodeById.get(selected.targetNodeId);
    if (selected && source && target) {
      const color = ELEMENT_COLORS[selected.type];
      const reconnectLayer = svgEl('g', { class: 'ns-reconnect-layer' });
      reconnectLayer.appendChild(reconnectHandle(source, selected.id, 'source', color));
      reconnectLayer.appendChild(reconnectHandle(target, selected.id, 'target', color));
      svg.appendChild(reconnectLayer);
    }
  }
}
