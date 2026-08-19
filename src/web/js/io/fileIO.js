// Save/load glue over the solver's io.js, using browser File APIs
// (Blob + object URL for export, FileReader for import).

// Save via the File System Access API where available, so the user picks
// the destination path instead of always landing in the Downloads folder.
// Falls back to the anchor-download trick on browsers that don't support it
// (Firefox, Safari as of this writing).
export async function downloadNetwork(store, onError) {
  const data = store.exportNetworkObject();
  const json = JSON.stringify(data, null, 2);
  const safeName = (store.state.network.meta.name || 'network').replace(/[^a-z0-9-_]+/gi, '_').toLowerCase();
  const suggestedName = `${safeName}.json`;

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'NetworkSolver network', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
    } catch (err) {
      if (err.name !== 'AbortError') onError?.([`Failed to save the file: ${err.message}`]);
    }
    return;
  }

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
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
