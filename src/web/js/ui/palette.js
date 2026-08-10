// Element palette: tool buttons that set the editor's interaction mode.
// `type` is the pending element type (addElement mode) or node type
// (addNode mode) -- see state.js's `pendingType`.
const TOOLS = [
  { mode: 'select', label: 'Select / Move', icon: '⭯' },
  { mode: 'addNode', type: 'junction', label: 'Add Node', icon: '●' },
  { mode: 'addNode', type: 'reservoir', label: 'Add Reservoir', icon: '▤' },
  { mode: 'addNode', type: 'tank', label: 'Add Tank', icon: '⛁' },
  { mode: 'addElement', type: 'pipe', label: 'Add Pipe', icon: '—' },
  { mode: 'addElement', type: 'valve', label: 'Add Valve', icon: '✕' },
  { mode: 'addElement', type: 'pump', label: 'Add Pump', icon: '▶' },
  { mode: 'addElement', type: 'heatExchanger', label: 'Add Heat Exchanger', icon: '▦' },
];

export function initPalette(container, store) {
  const buttons = new Map();
  for (const tool of TOOLS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ns-palette-btn';
    btn.innerHTML = `<span class="ns-palette-icon">${tool.icon}</span><span>${tool.label}</span>`;
    btn.addEventListener('click', () => store.setMode(tool.mode, tool.type || null));
    container.appendChild(btn);
    buttons.set(tool, btn);
  }

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'ns-palette-btn';
  copyBtn.innerHTML = '<span class="ns-palette-icon">⧉</span><span>Copy selected</span>';
  copyBtn.addEventListener('click', () => store.copySelection());
  container.appendChild(copyBtn);

  const pasteBtn = document.createElement('button');
  pasteBtn.type = 'button';
  pasteBtn.className = 'ns-palette-btn';
  pasteBtn.innerHTML = '<span class="ns-palette-icon">📋</span><span>Paste</span>';
  pasteBtn.addEventListener('click', () => store.pasteClipboard());
  container.appendChild(pasteBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'ns-palette-btn ns-palette-danger';
  deleteBtn.innerHTML = '<span class="ns-palette-icon">🗑</span><span>Delete selected</span>';
  deleteBtn.addEventListener('click', () => store.deleteSelection());
  container.appendChild(deleteBtn);

  const hint = document.createElement('p');
  hint.className = 'ns-hint';
  container.appendChild(hint);

  store.subscribe((state) => {
    for (const [tool, btn] of buttons) {
      const active = state.mode === tool.mode && (tool.mode === 'select' || state.pendingType === tool.type);
      btn.classList.toggle('ns-active', active);
    }
    copyBtn.disabled = !state.selection.id;
    pasteBtn.disabled = !state.canPaste;
    deleteBtn.disabled = !state.selection.id;
    hint.textContent = hintFor(state);
  });
}

function hintFor(state) {
  switch (state.mode) {
    case 'addNode':
      return state.pendingType === 'reservoir'
        ? 'Click on the canvas to place a reservoir (an infinite fixed-head source).'
        : state.pendingType === 'tank'
          ? 'Click on the canvas to place a storage tank (a fixed-head boundary at its current water level).'
          : 'Click on the canvas to place a node.';
    case 'addElement':
      return state.pendingSourceNodeId
        ? 'Click the target node to complete the connection.'
        : 'Click the source node, then the target node.';
    default:
      return state.selection.type === 'element'
        ? 'Drag the small square handles at either end of the selected element onto a different node to reconnect it, or edit its Source/Target node in the Properties panel. Ctrl+C to copy, Ctrl+V to paste a parallel duplicate.'
        : 'Click a node or element to select it. Drag nodes to move them. Delete/Backspace removes the selection. Ctrl+C/Ctrl+V to copy/paste.';
  }
}
