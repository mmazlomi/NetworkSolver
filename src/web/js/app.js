import { store, EXAMPLES } from './state.js';
import { initEditor } from './editor/canvas.js';
import { initPalette } from './ui/palette.js';
import { initInspector } from './ui/inspector.js';
import { initResultsPanel } from './ui/resultsPanel.js';
import { initGoalSeekPanel } from './ui/goalSeekPanel.js';
import { downloadNetwork, openFilePicker } from './io/fileIO.js';
import { initResizers } from './ui/resizer.js';

initResizers();
initPalette(document.getElementById('ns-palette'), store);
initEditor(document.getElementById('ns-canvas'), store);
initInspector(document.getElementById('panel-properties'), store);
initResultsPanel(document.getElementById('panel-results'), store, (errors) => showBanner(errors, 'error'));
initGoalSeekPanel(document.getElementById('panel-goalseek'), store);

// ---- tabs -----------------------------------------------------------
const tabs = document.getElementById('ns-tabs');
const panels = {
  properties: document.getElementById('panel-properties'),
  results: document.getElementById('panel-results'),
  goalseek: document.getElementById('panel-goalseek'),
};
tabs.addEventListener('click', (evt) => {
  const btn = evt.target.closest('.ns-tab');
  if (!btn) return;
  for (const el of tabs.querySelectorAll('.ns-tab')) el.classList.toggle('ns-active', el === btn);
  for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== btn.dataset.tab;
});

function showTab(name) {
  const btn = tabs.querySelector(`[data-tab="${name}"]`);
  if (btn) btn.click();
}

// ---- toolbar ----------------------------------------------------------
const banner = document.getElementById('ns-banner');

function showBanner(messages, kind) {
  if (!messages.length) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  banner.className = `ns-banner ns-banner-${kind}`;
  banner.innerHTML = messages.map((m) => `<div>${escapeHtml(m)}</div>`).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

document.getElementById('btn-new').addEventListener('click', () => {
  if (confirm('Start a new, empty network? Unsaved changes will be lost.')) {
    store.newNetwork();
    showBanner([], 'ok');
  }
});

const exampleSelect = document.getElementById('example-select');
for (const example of EXAMPLES) {
  const option = document.createElement('option');
  option.value = example.id;
  option.textContent = example.label;
  exampleSelect.appendChild(option);
}

document.getElementById('btn-load-example').addEventListener('click', () => {
  store.loadExample(exampleSelect.value);
  const diagnostics = store.solve();
  showBanner(diagnostics.errors.map((e) => e.message), diagnostics.errors.length ? 'error' : 'ok');
  showTab('results');
});

document.getElementById('btn-load-file').addEventListener('click', () => {
  openFilePicker(store, (errors, warnings) => {
    if (errors.length) showBanner(errors, 'error');
    else showBanner(warnings, 'warning');
  });
});

document.getElementById('btn-save-file').addEventListener('click', () => {
  downloadNetwork(store, (errors) => showBanner(errors, 'error'));
});

document.getElementById('btn-solve').addEventListener('click', () => {
  const diagnostics = store.solve();
  showBanner(
    [...diagnostics.errors.map((e) => e.message), ...diagnostics.warnings.map((w) => w.message)],
    diagnostics.status === 'error' ? 'error' : diagnostics.status === 'ok' ? 'ok' : 'warning',
  );
  showTab('results');
});

const undoBtn = document.getElementById('btn-undo');
const redoBtn = document.getElementById('btn-redo');
undoBtn.addEventListener('click', () => store.undo());
redoBtn.addEventListener('click', () => store.redo());

store.subscribe((state) => {
  document.title = `NetworkSolver — ${state.network.meta.name}`;
  undoBtn.disabled = !state.canUndo;
  redoBtn.disabled = !state.canRedo;
});
