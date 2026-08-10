// Makes the palette (left) and side (right) panels resizable by dragging
// the thin bars between them and the canvas, or via arrow keys when a bar
// has focus (keyboard-accessible, since each is exposed as a
// role="separator" in index.html). Widths persist in localStorage so the
// layout survives a reload.
const MIN_PALETTE = 160;
const MAX_PALETTE = 480;
const DEFAULT_PALETTE = 220;
const MIN_SIDE = 260;
const MAX_SIDE = 640;
const DEFAULT_SIDE = 340;

const STORAGE_KEY_PALETTE = 'ns-palette-width';
const STORAGE_KEY_SIDE = 'ns-side-width';

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function readStoredWidth(key, fallback, min, max) {
  const stored = Number(localStorage.getItem(key));
  return Number.isFinite(stored) && stored > 0 ? clamp(stored, min, max) : fallback;
}

/**
 * @param {HTMLElement} handle the draggable divider element
 * @param {string} cssVar the CSS custom property that sets the panel's grid track width
 * @param {string} storageKey localStorage key to persist the resulting width under
 * @param {number} min
 * @param {number} max
 * @param {number} dragSign +1 if dragging the handle right grows the panel, -1 if it shrinks it
 */
function setupResizer(handle, cssVar, storageKey, min, max, dragSign) {
  if (!handle) return;
  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  function currentWidth() {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(cssVar)) || min;
  }

  function setWidth(px) {
    const clamped = clamp(px, min, max);
    document.documentElement.style.setProperty(cssVar, `${clamped}px`);
    return clamped;
  }

  function persist() {
    localStorage.setItem(storageKey, String(Math.round(currentWidth())));
  }

  handle.addEventListener('pointerdown', (evt) => {
    dragging = true;
    startX = evt.clientX;
    startWidth = currentWidth();
    handle.classList.add('ns-resizing');
    handle.setPointerCapture(evt.pointerId);
    evt.preventDefault();
  });

  handle.addEventListener('pointermove', (evt) => {
    if (!dragging) return;
    setWidth(startWidth + dragSign * (evt.clientX - startX));
  });

  function endDrag(evt) {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('ns-resizing');
    try { handle.releasePointerCapture(evt.pointerId); } catch { /* pointer already released */ }
    persist();
  }
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

  handle.addEventListener('keydown', (evt) => {
    const step = evt.shiftKey ? 40 : 10;
    if (evt.key === 'ArrowRight') setWidth(currentWidth() + step);
    else if (evt.key === 'ArrowLeft') setWidth(currentWidth() - step);
    else return;
    evt.preventDefault();
    persist();
  });
}

export function initResizers() {
  const root = document.documentElement;
  root.style.setProperty('--ns-palette-width', `${readStoredWidth(STORAGE_KEY_PALETTE, DEFAULT_PALETTE, MIN_PALETTE, MAX_PALETTE)}px`);
  root.style.setProperty('--ns-side-width', `${readStoredWidth(STORAGE_KEY_SIDE, DEFAULT_SIDE, MIN_SIDE, MAX_SIDE)}px`);

  setupResizer(document.getElementById('resizer-left'), '--ns-palette-width', STORAGE_KEY_PALETTE, MIN_PALETTE, MAX_PALETTE, 1);
  setupResizer(document.getElementById('resizer-right'), '--ns-side-width', STORAGE_KEY_SIDE, MIN_SIDE, MAX_SIDE, -1);
}
