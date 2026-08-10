// Save/load glue over the solver's io.js, using browser File APIs
// (Blob + object URL for export, FileReader for import).
export function downloadNetwork(store) {
  const data = store.exportNetworkObject();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = (store.state.network.meta.name || 'network').replace(/[^a-z0-9-_]+/gi, '_').toLowerCase();
  a.href = url;
  a.download = `${safeName}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function openFilePicker(store, onError) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const { errors, warnings } = store.importNetworkFromText(String(reader.result), file.name);
      if (errors.length) onError(errors, warnings);
      else if (warnings.length) onError([], warnings);
    };
    reader.onerror = () => onError(['Failed to read the selected file'], []);
    reader.readAsText(file);
  });
  input.click();
}
