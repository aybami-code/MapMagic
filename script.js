/* script.js
   TileForge — Tilemap Painter & Export (Pro)
   Full front-end implementation (canvas-only)
*/

/* ========== GLOBAL STATE ========== */
const STATE = {
  mapW: 32,
  mapH: 32,
  tileSize: 32,
  layers: [], // {name, visible, data: Int32Array(mapW*mapH), collision: Uint8Array(mapW*mapH)}
  activeLayer: 0,
  tilesPerRow: 0,
  tilesetImage: null,
  tilesetCols: 0,
  tilesetRows: 0,
  selectedTileIndex: 0,
  tool: 'brush', // brush, bucket, erase, rect, picker
  brushSize: 1,
  autoTile: false,
  undoStack: [],
  redoStack: [],
  maxUndo: 120,
  zoom: 1,
  panX: 0,
  panY: 0,
  showGrid: true,
  snapGrid: true,
  showCollision: false,
  autosave: true,
  seed: Date.now(),
};

/* ========== DOM REFS ========== */
const mapCanvas = document.getElementById('mapCanvas');
const uiCanvas = document.getElementsByClassName('overlay')[0]; // The second canvas is overlay
const tilesetUpload = document.getElementById('tilesetUpload');
const importProject = document.getElementById('importProject');
const paletteDiv = document.getElementById('palette');
const tilesetPreview = document.getElementById('tilesetPreview');
const layersList = document.getElementById('layersList');
const miniPreview = document.getElementById('miniPreview');
const mapWInput = document.getElementById('mapW');
const mapHInput = document.getElementById('mapH');
const tileSizeInput = document.getElementById('tileSize');
const resizeMapBtn = document.getElementById('resizeMap');
const brushSizeInput = document.getElementById('brushSize');
const autoTileInput = document.getElementById('autoTile');
const addLayerBtn = document.getElementById('addLayer');
const removeLayerBtn = document.getElementById('removeLayer');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const saveProjectBtn = document.getElementById('saveProject');
const exportPNGBtn = document.getElementById('exportPNG');
const exportHighPNGBtn = document.getElementById('exportHighPNG');
const exportJSONBtn = document.getElementById('exportJSON');
const exportTMXBtn = document.getElementById('exportTMX');
const exportPaletteBtn = document.getElementById('exportPalette');
const clearPaletteBtn = document.getElementById('clearPalette');
const zoomRange = document.getElementById('zoomRange');
const fitBtn = document.getElementById('fitBtn');
const showGridInput = document.getElementById('showGrid');
const snapGridInput = document.getElementById('snapGrid');
const showCollisionInput = document.getElementById('showCollision');
const tilesetUploadBtn = document.getElementById('tilesetUpload');
const importProjectBtn = document.getElementById('importProject');
const statusBar = document.querySelector('.status');
const seedLabel = document.getElementById('seedLabel');
const modeLabel = document.getElementById('modeLabel');
const sizeLabel = document.getElementById('sizeLabel');

/* overlay canvas */
const overlayCanvas = uiCanvas;
const mapCtx = mapCanvas.getContext('2d');
const overlayCtx = overlayCanvas.getContext('2d');

/* ========== INIT CANVAS SIZE ========== */
function fitCanvases() {
  const vp = document.getElementById('viewport');
  mapCanvas.width = Math.max(800, vp.clientWidth - 24);
  mapCanvas.height = Math.max(480, vp.clientHeight - 24);
  overlayCanvas.width = mapCanvas.width;
  overlayCanvas.height = mapCanvas.height;
  render();
}
window.addEventListener('resize', fitCanvases);

/* ========== HELPERS ========== */
function idx(x, y) { return y * STATE.mapW + x; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function now() { return Date.now(); }
function logStatus(text) { statusBar.innerText = text; }

/* ========== LAYERS & MAP ========== */
function createLayer(name = 'Layer ' + (STATE.layers.length + 1)) {
  const size = STATE.mapW * STATE.mapH;
  return {
    name,
    visible: true,
    data: new Int32Array(size).fill(-1), // -1 means empty
    collision: new Uint8Array(size).fill(0),
    opacity: 1.0,
  };
}

function initMap(w, h, tileSize = 32) {
  STATE.mapW = w;
  STATE.mapH = h;
  STATE.tileSize = tileSize;
  STATE.layers = [];
  STATE.activeLayer = 0;
  STATE.undoStack = [];
  STATE.redoStack = [];
  STATE.layers.push(createLayer('Ground'));
  STATE.layers.push(createLayer('Objects'));
  STATE.layers.push(createLayer('Top'));
  updateUIMapSize();
  pushHistory(); // initial snapshot
}

/* ========== HISTORY (UNDO/REDO) ========== */
function pushHistory() {
  try {
    const snap = {
      mapW: STATE.mapW,
      mapH: STATE.mapH,
      tileSize: STATE.tileSize,
      layers: STATE.layers.map(l => ({name: l.name, visible: l.visible, data: Array.from(l.data), collision: Array.from(l.collision)})),
      selectedTileIndex: STATE.selectedTileIndex,
    };
    STATE.undoStack.push(JSON.stringify(snap));
    if (STATE.undoStack.length > STATE.maxUndo) STATE.undoStack.shift();
    STATE.redoStack = [];
    updateUndoRedoButtons();
    if (STATE.autosave) saveToLocal();
  } catch (e) {
    console.error('pushHistory error', e);
  }
}

function applySnapshotString(s) {
  const snap = JSON.parse(s);
  STATE.mapW = snap.mapW;
  STATE.mapH = snap.mapH;
  STATE.tileSize = snap.tileSize;
  STATE.layers = snap.layers.map(l => ({name: l.name, visible: l.visible, data: Int32Array.from(l.data), collision: Uint8Array.from(l.collision)}));
  STATE.selectedTileIndex = snap.selectedTileIndex;
  rebuildLayersUI();
  updateUIMapSize();
  render();
}

function undo() {
  if (STATE.undoStack.length <= 1) return;
  const top = STATE.undoStack.pop();
  STATE.redoStack.push(top);
  const last = STATE.undoStack[STATE.undoStack.length - 1];
  applySnapshotString(last);
  updateUndoRedoButtons();
  logStatus('Undid change');
}

function redo() {
  if (STATE.redoStack.length === 0) return;
  const s = STATE.redoStack.pop();
  STATE.undoStack.push(s);
  applySnapshotString(s);
  updateUndoRedoButtons();
  logStatus('Redid change');
}

function updateUndoRedoButtons() {
  undoBtn.disabled = STATE.undoStack.length <= 1;
  redoBtn.disabled = STATE.redoStack.length === 0;
}

/* ========== UI: MAP SIZE / LAYERS / PALETTE ========== */
function updateUIMapSize() {
  mapWInput.value = STATE.mapW;
  mapHInput.value = STATE.mapH;
  tileSizeInput.value = STATE.tileSize;
  sizeLabel.textContent = `${STATE.mapW} × ${STATE.mapH}`;
}

function rebuildLayersUI() {
  layersList.innerHTML = '';
  STATE.layers.forEach((layer, i) => {
    const item = document.createElement('div');
    item.className = 'layer-item';
    item.innerHTML = `
      <input type="checkbox" ${layer.visible ? 'checked' : ''} data-index="${i}">
      <input type="text" value="${layer.name}" data-index-name="${i}" style="flex:1;padding:6px;border-radius:6px;background:transparent;border:1px solid rgba(255,255,255,0.03);color:inherit">
      <button class="btn small" data-set-active="${i}">${STATE.activeLayer===i?'Active':'Set'}</button>
    `;
    layersList.appendChild(item);
  });
  // attach events
  layersList.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const i = Number(e.target.getAttribute('data-index'));
      STATE.layers[i].visible = e.target.checked;
      render();
    });
  });
  layersList.querySelectorAll('[data-index-name]').forEach(inp => {
    inp.addEventListener('change', (e) => {
      const i = Number(e.target.getAttribute('data-index-name'));
      STATE.layers[i].name = e.target.value;
    });
  });
  layersList.querySelectorAll('[data-set-active]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const i = Number(e.target.getAttribute('data-set-active'));
      STATE.activeLayer = i;
      rebuildLayersUI();
      render();
    });
  });
}

/* ========== TILES / TILESET IMPORT ========== */
function onTilesetLoaded(img) {
  STATE.tilesetImage = img;
  STATE.tilesetCols = Math.floor(img.width / STATE.tileSize);
  STATE.tilesetRows = Math.floor(img.height / STATE.tileSize);
  STATE.tilesPerRow = STATE.tilesetCols;
  buildPaletteFromTileset();
  logStatus(`Tileset loaded: ${STATE.tilesetCols}x${STATE.tilesetRows} tiles`);
  render();
}

tilesetUpload.addEventListener('change', (ev) => {
  const f = ev.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      onTilesetLoaded(img);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(f);
});

/* build palette UI grid from tileset */
function buildPaletteFromTileset() {
  paletteDiv.innerHTML = '';
  tilesetPreview.innerHTML = '';
  if (!STATE.tilesetImage) {
    tilesetPreview.textContent = 'No tileset loaded';
    return;
  }
  // show small preview
  const pv = document.createElement('canvas');
  pv.width = Math.min(STATE.tilesetImage.width, 400);
  pv.height = Math.round(pv.width * (STATE.tilesetImage.height / STATE.tilesetImage.width));
  const pctx = pv.getContext('2d');
  pctx.drawImage(STATE.tilesetImage, 0, 0, pv.width, pv.height);
  tilesetPreview.innerHTML = '';
  tilesetPreview.appendChild(pv);

  const total = STATE.tilesetCols * STATE.tilesetRows;
  for (let i = 0; i < total; i++) {
    const cell = document.createElement('div');
    cell.className = 'tile';
    const c = document.createElement('canvas');
    c.width = STATE.tileSize;
    c.height = STATE.tileSize;
    const ctx = c.getContext('2d');
    const tx = (i % STATE.tilesetCols) * STATE.tileSize;
    const ty = Math.floor(i / STATE.tilesetCols) * STATE.tileSize;
    ctx.drawImage(STATE.tilesetImage, tx, ty, STATE.tileSize, STATE.tileSize, 0, 0, STATE.tileSize, STATE.tileSize);
    cell.appendChild(c);
    paletteDiv.appendChild(cell);
    // click handler
    ((index) => {
      cell.addEventListener('click', () => {
        STATE.selectedTileIndex = index;
        highlightSelectedTile();
        modeLabel.textContent = `Selected Tile ${index}`;
      });
    })(i);
  }
  highlightSelectedTile();
}

function highlightSelectedTile() {
  const tiles = paletteDiv.querySelectorAll('.tile');
  tiles.forEach((t, i) => {
    t.style.outline = (i === STATE.selectedTileIndex) ? `2px solid ${getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#60a5fa'}` : 'none';
  });
}

/* ========== RENDERING ========== */
function clearCanvas(ctx) {
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,ctx.canvas.width, ctx.canvas.height);
}

/* render visible map area */
function render() {
  if (!mapCtx) return;
  clearCanvas(mapCtx);
  // apply pan/zoom
  mapCtx.save();
  mapCtx.translate(STATE.panX, STATE.panY);
  mapCtx.scale(STATE.zoom, STATE.zoom);

  const ts = STATE.tileSize;
  // background
  mapCtx.fillStyle = '#071521';
  mapCtx.fillRect(0, 0, STATE.mapW * ts, STATE.mapH * ts);

  // draw layers back to front
  for (let li = 0; li < STATE.layers.length; li++) {
    const layer = STATE.layers[li];
    if (!layer.visible) continue;
    for (let y = 0; y < STATE.mapH; y++) {
      for (let x = 0; x < STATE.mapW; x++) {
        const id = layer.data[idx(x,y)];
        if (id >= 0 && STATE.tilesetImage) {
          drawTileOnContext(mapCtx, id, x * ts, y * ts, ts, ts);
        }
        if (STATE.showCollision && layer.collision[idx(x,y)]) {
          mapCtx.fillStyle = 'rgba(255,0,0,0.18)';
          mapCtx.fillRect(x * ts, y * ts, ts, ts);
        }
      }
    }
  }

  // grid
  if (STATE.showGrid) {
    mapCtx.strokeStyle = 'rgba(255,255,255,0.04)';
    mapCtx.lineWidth = 1 / STATE.zoom;
    for (let x = 0; x <= STATE.mapW; x++) {
      mapCtx.beginPath();
      mapCtx.moveTo(x * ts, 0);
      mapCtx.lineTo(x * ts, STATE.mapH * ts);
      mapCtx.stroke();
    }
    for (let y = 0; y <= STATE.mapH; y++) {
      mapCtx.beginPath();
      mapCtx.moveTo(0, y * ts);
      mapCtx.lineTo(STATE.mapW * ts, y * ts);
      mapCtx.stroke();
    }
  }

  mapCtx.restore();
  drawOverlay();
  updateMiniPreview();
}

/* draw a single tile from tileset to target context */
function drawTileOnContext(ctx, tileIndex, dx, dy, dw, dh) {
  if (!STATE.tilesetImage) return;
  const cols = STATE.tilesetCols;
  const sx = (tileIndex % cols) * STATE.tileSize;
  const sy = Math.floor(tileIndex / cols) * STATE.tileSize;
  ctx.drawImage(STATE.tilesetImage, sx, sy, STATE.tileSize, STATE.tileSize, dx, dy, dw, dh);
}

/* ========== OVERLAY: cursor preview, brush box ========== */
let mouse = {sx: 0, sy: 0, x: 0, y: 0, down: false};
function drawOverlay() {
  clearCanvas(overlayCtx);
  // draw brush preview
  overlayCtx.save();
  overlayCtx.translate(STATE.panX, STATE.panY);
  overlayCtx.scale(STATE.zoom, STATE.zoom);
  const ts = STATE.tileSize;
  // compute tile under cursor (in map coordinates)
  const relX = (mouse.sx - STATE.panX) / STATE.zoom;
  const relY = (mouse.sy - STATE.panY) / STATE.zoom;
  const tileX = Math.floor(relX / ts);
  const tileY = Math.floor(relY / ts);
  // brush squares
  overlayCtx.lineWidth = 1 / STATE.zoom;
  overlayCtx.strokeStyle = 'rgba(255,255,255,0.9)';
  const half = Math.floor(STATE.brushSize / 2);
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const x = tileX + dx, y = tileY + dy;
      if (x < 0 || y < 0 || x >= STATE.mapW || y >= STATE.mapH) continue;
      overlayCtx.strokeRect(x * ts + 0.5, y * ts + 0.5, ts - 1, ts - 1);
    }
  }
  overlayCtx.restore();
}

/* ========== INTERACTION: MOUSE / PAN / ZOOM / TOOLS ========== */
mapCanvas.addEventListener('mousedown', (e) => {
  mapCanvas.focus?.();
  mouse.down = true;
  mouse.sx = e.clientX - mapCanvas.getBoundingClientRect().left;
  mouse.sy = e.clientY - mapCanvas.getBoundingClientRect().top;
  handlePointerDown(e);
});
mapCanvas.addEventListener('mousemove', (e) => {
  mouse.sx = e.clientX - mapCanvas.getBoundingClientRect().left;
  mouse.sy = e.clientY - mapCanvas.getBoundingClientRect().top;
  handlePointerMove(e);
});
window.addEventListener('mouseup', (e) => {
  if (mouse.down) {
    mouse.down = false;
    handlePointerUp(e);
  }
});
mapCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = -e.deltaY * 0.0015;
  const newZoom = clamp(STATE.zoom + delta, 0.25, 3);
  // zoom around cursor
  const rect = mapCanvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;
  const wx = (cx - STATE.panX) / STATE.zoom;
  const wy = (cy - STATE.panY) / STATE.zoom;
  STATE.zoom = newZoom;
  STATE.panX = cx - wx * STATE.zoom;
  STATE.panY = cy - wy * STATE.zoom;
  zoomRange.value = STATE.zoom;
  render();
}, {passive: false});

/* pointer helpers */
function screenToMapTile(sx, sy) {
  const relX = (sx - STATE.panX) / STATE.zoom;
  const relY = (sy - STATE.panY) / STATE.zoom;
  const tx = Math.floor(relX / STATE.tileSize);
  const ty = Math.floor(relY / STATE.tileSize);
  return {tx, ty};
}

/* tool implementations */
function handlePointerDown(e) {
  const tool = STATE.tool;
  const {tx, ty} = screenToMapTile(mouse.sx, mouse.sy);
  if (tool === 'brush') {
    pushHistory();
    paintTilesAt(tx, ty, STATE.selectedTileIndex);
  } else if (tool === 'erase') {
    pushHistory();
    paintTilesAt(tx, ty, -1);
  } else if (tool === 'bucket') {
    pushHistory();
    bucketFill(tx, ty, STATE.selectedTileIndex);
  } else if (tool === 'picker') {
    const id = getTileAt(tx, ty);
    if (id !== null) {
      STATE.selectedTileIndex = id;
      highlightSelectedTile();
      modeLabel.textContent = `Picked ${id}`;
    }
  } else if (tool === 'rect') {
    // start rectangle drag
    rectStart = {tx, ty};
    rectMode = true;
  }
  render();
}

function handlePointerMove(e) {
  if (mouse.down && STATE.tool === 'brush') {
    const {tx, ty} = screenToMapTile(mouse.sx, mouse.sy);
    paintTilesAt(tx, ty, STATE.selectedTileIndex);
    render();
  } else if (mouse.down && STATE.tool === 'erase') {
    const {tx, ty} = screenToMapTile(mouse.sx, mouse.sy);
    paintTilesAt(tx, ty, -1);
    render();
  } else {
    drawOverlay();
  }
}

function handlePointerUp(e) {
  if (rectMode) {
    const {tx, ty} = screenToMapTile(mouse.sx, mouse.sy);
    pushHistory();
    drawRectTiles(rectStart.tx, rectStart.ty, tx, ty, STATE.selectedTileIndex);
    rectMode = false;
    rectStart = null;
    render();
  }
}

/* paint multiple tiles based on brush size */
function paintTilesAt(tx, ty, tileIndex) {
  const half = Math.floor(STATE.brushSize / 2);
  const layer = STATE.layers[STATE.activeLayer];
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const x = tx + dx, y = ty + dy;
      if (x < 0 || y < 0 || x >= STATE.mapW || y >= STATE.mapH) continue;
      layer.data[idx(x,y)] = tileIndex;
    }
  }
  if (STATE.autoTile) {
    applyAutoTileAround(tx, ty);
  }
}

/* draw rectangle of tiles */
let rectMode = false;
let rectStart = null;
function drawRectTiles(x1, y1, x2, y2, tileIndex) {
  const lx = Math.min(x1, x2), hx = Math.max(x1, x2);
  const ly = Math.min(y1, y2), hy = Math.max(y1, y2);
  const layer = STATE.layers[STATE.activeLayer];
  for (let y = ly; y <= hy; y++) {
    for (let x = lx; x <= hx; x++) {
      if (x < 0 || y < 0 || x >= STATE.mapW || y >= STATE.mapH) continue;
      layer.data[idx(x,y)] = tileIndex;
    }
  }
  if (STATE.autoTile) {
    for (let y = ly; y <= hy; y++) for (let x = lx; x <= hx; x++) applyAutoTileAround(x, y);
  }
}

/* get tile at position searching top-down from top layer */
function getTileAt(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= STATE.mapW || ty >= STATE.mapH) return null;
  for (let li = STATE.layers.length - 1; li >= 0; li--) {
    const id = STATE.layers[li].data[idx(tx,ty)];
    if (id >= 0) return id;
  }
  return -1;
}

/* simple bucket fill (non-optimized) */
function bucketFill(sx, sy, tileIndex) {
  if (sx < 0 || sy < 0 || sx >= STATE.mapW || sy >= STATE.mapH) return;
  const layer = STATE.layers[STATE.activeLayer];
  const target = layer.data[idx(sx, sy)];
  if (target === tileIndex) return;
  const stack = [[sx, sy]];
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= STATE.mapW || y >= STATE.mapH) continue;
    const id = layer.data[idx(x,y)];
    if (id !== target) continue;
    layer.data[idx(x,y)] = tileIndex;
    stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
  }
}

/* ========== AUTO-TILING (edge-based) ========== */
/* Basic rule: for each cell check neighbors up/right/down/left and pick variant (tileIndex + offset)
   This is a minimal approach: if tileset uses autotile variants arranged in specific order,
   you'll need mapping. We'll implement a generic approach that sets edges by adding offsets
   if tileset arrangement supports it. For this demo we do a simple adjacency highlight:
   - No heavy tileset remapping is done automatically because tileset formats vary.
   - We provide a small "auto tile neighbor clean" that sets neighboring tile indices based on adjacency.
*/
function applyAutoTileAround(cx, cy) {
  // minimal: check 4 neighbors and if missing, set neighbor to same tile if empty
  const layer = STATE.layers[STATE.activeLayer];
  const base = layer.data[idx(cx, cy)];
  if (base < 0) return;
  const neigh = [[1,0],[-1,0],[0,1],[0,-1]];
  for (const [dx,dy] of neigh) {
    const x = cx + dx, y = cy + dy;
    if (x < 0 || y < 0 || x >= STATE.mapW || y >= STATE.mapH) continue;
    if (layer.data[idx(x,y)] === -1) layer.data[idx(x,y)] = base;
  }
}

/* ========== EXPORTS ========== */
/* export visible baked PNG */
function exportPNG(scale = 1, filename = `tileforge_map_${STATE.mapW}x${STATE.mapH}.png`) {
  const ts = STATE.tileSize;
  const w = STATE.mapW * ts * scale;
  const h = STATE.mapH * ts * scale;
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const octx = off.getContext('2d');
  octx.imageSmoothingEnabled = false;
  // background transparent
  octx.clearRect(0,0,w,h);
  // draw layers
  for (let li = 0; li < STATE.layers.length; li++) {
    const layer = STATE.layers[li];
    if (!layer.visible) continue;
    for (let y = 0; y < STATE.mapH; y++) {
      for (let x = 0; x < STATE.mapW; x++) {
        const id = layer.data[idx(x,y)];
        if (id >= 0 && STATE.tilesetImage) {
          const sx = (id % STATE.tilesetCols) * STATE.tileSize;
          const sy = Math.floor(id / STATE.tilesetCols) * STATE.tileSize;
          octx.drawImage(STATE.tilesetImage, sx, sy, STATE.tileSize, STATE.tileSize, x * ts * scale, y * ts * scale, ts * scale, ts * scale);
        }
      }
    }
  }
  off.toBlob((blob) => {
    saveAs(blob, filename);
    logStatus('Exported PNG: ' + filename);
  });
}

/* export project JSON (map data + layers + tileset meta) */
function exportProjectJSON() {
  const payload = {
    meta: {
      mapW: STATE.mapW,
      mapH: STATE.mapH,
      tileSize: STATE.tileSize,
      tilesetCols: STATE.tilesetCols,
      tilesetRows: STATE.tilesetRows,
      selectedTileIndex: STATE.selectedTileIndex,
      tilesetImageName: STATE.tilesetImage ? (STATE.tilesetImage.src.split('/').pop() || 'tileset.png') : null,
    },
    layers: STATE.layers.map(l => ({name: l.name, visible: l.visible, data: Array.from(l.data), collision: Array.from(l.collision)}))
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'});
  saveAs(blob, `tileforge_project_${STATE.mapW}x${STATE.mapH}.json`);
  logStatus('Exported JSON project');
}

/* export TMX (Tiled format) very basic (no tileset embedding) */
function exportTMX() {
  // TMX requires a tileset source reference - we'll provide a basic XML with CSV layer data
  const tilesetName = STATE.tilesetImage ? (STATE.tilesetImage.src.split('/').pop() || 'tileset.png') : 'tileset.png';
  const tileCount = STATE.tilesetCols * STATE.tilesetRows;
  const xmlParts = [];
  xmlParts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  xmlParts.push(`<map version="1.2" tiledversion="1.3.3" orientation="orthogonal" renderorder="right-down" width="${STATE.mapW}" height="${STATE.mapH}" tilewidth="${STATE.tileSize}" tileheight="${STATE.tileSize}">`);
  xmlParts.push(`<tileset firstgid="1" name="${tilesetName}" tilewidth="${STATE.tileSize}" tileheight="${STATE.tileSize}" tilecount="${tileCount}" columns="${STATE.tilesetCols}">`);
  xmlParts.push(`<image source="${tilesetName}" width="${STATE.tilesetCols * STATE.tileSize}" height="${STATE.tilesetRows * STATE.tileSize}"/>`);
  xmlParts.push(`</tileset>`);
  // layers (we'll export each layer in order with CSV)
  for (let li = 0; li < STATE.layers.length; li++) {
    const layer = STATE.layers[li];
    const layerId = li + 1;
    xmlParts.push(`<layer id="${layerId}" name="${layer.name}" width="${STATE.mapW}" height="${STATE.mapH}">`);
    xmlParts.push(`<data encoding="csv">`);
    // Tiled expects global tile ids starting at 1. Our -1 (empty) becomes 0
    const csv = [];
    for (let y = 0; y < STATE.mapH; y++) {
      const row = [];
      for (let x = 0; x < STATE.mapW; x++) {
        const id = layer.data[idx(x,y)];
        row.push(id >= 0 ? (id + 1) : 0);
      }
      csv.push(row.join(','));
    }
    xmlParts.push(csv.join(',\n'));
    xmlParts.push(`</data>`);
    xmlParts.push(`</layer>`);
  }
  xmlParts.push(`</map>`);
  const blob = new Blob([xmlParts.join('\n')], {type: 'application/xml'});
  saveAs(blob, `tileforge_map_${STATE.mapW}x${STATE.mapH}.tmx`);
  logStatus('Exported TMX');
}

/* ========== SAVE / LOAD PROJECT / AUTOSAVE ========== */
function saveProjectToFile() {
  const payload = {
    meta: {
      mapW: STATE.mapW,
      mapH: STATE.mapH,
      tileSize: STATE.tileSize,
      selectedTileIndex: STATE.selectedTileIndex,
      tilesetCols: STATE.tilesetCols,
      tilesetRows: STATE.tilesetRows,
      tilesetImageDataUrl: STATE.tilesetImage ? STATE.tilesetImage.src : null,
      seed: STATE.seed,
    },
    layers: STATE.layers.map(l => ({name: l.name, visible: l.visible, data: Array.from(l.data), collision: Array.from(l.collision)}))
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'});
  saveAs(blob, `tileforge_project_${Date.now()}.json`);
  logStatus('Project saved to file.');
}

importProject.addEventListener('change', (ev) => {
  const f = ev.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result);
      loadProjectFromObject(obj);
      logStatus('Imported project JSON');
    } catch (e) {
      console.error('Import error', e);
      logStatus('Import failed: invalid JSON');
    }
  };
  reader.readAsText(f);
});

function loadProjectFromObject(obj) {
  if (!obj || !obj.meta) return;
  STATE.mapW = obj.meta.mapW || STATE.mapW;
  STATE.mapH = obj.meta.mapH || STATE.mapH;
  STATE.tileSize = obj.meta.tileSize || STATE.tileSize;
  STATE.seed = obj.meta.seed || STATE.seed;
  // layers
  STATE.layers = obj.layers.map(l => ({name: l.name, visible: l.visible, data: Int32Array.from(l.data), collision: Uint8Array.from(l.collision)}));
  if (obj.meta.tilesetImageDataUrl) {
    const img = new Image();
    img.onload = () => {
      onTilesetLoaded(img);
      rebuildLayersUI();
      updateUIMapSize();
      render();
    };
    img.src = obj.meta.tilesetImageDataUrl;
  } else {
    rebuildLayersUI();
    updateUIMapSize();
    render();
  }
  pushHistory();
}

/* autosave to localStorage */
function saveToLocal() {
  try {
    const payload = {
      meta: {
        mapW: STATE.mapW,
        mapH: STATE.mapH,
        tileSize: STATE.tileSize,
        seed: STATE.seed,
      },
      layers: STATE.layers.map(l => ({name: l.name, visible: l.visible, data: Array.from(l.data), collision: Array.from(l.collision)})),
      tilesetImageDataUrl: STATE.tilesetImage ? STATE.tilesetImage.src : null,
    };
    localStorage.setItem('tileforge_autosave', JSON.stringify(payload));
    //logStatus('Auto-saved');
  } catch (e) {
    console.warn('autosave failed', e);
  }
}

function loadFromLocal() {
  try {
    const raw = localStorage.getItem('tileforge_autosave');
    if (!raw) return false;
    const obj = JSON.parse(raw);
    loadProjectFromObject(obj);
    logStatus('Loaded autosave');
    return true;
  } catch (e) {
    console.warn('loadFromLocal error', e);
    return false;
  }
}

/* ========== MINI PREVIEW ========== */
function updateMiniPreview() {
  const c = miniPreview;
  if (!c) return;
  c.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.width = STATE.mapW;
  canvas.height = STATE.mapH;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width, canvas.height);
  // small render: draw top-down tile indices as colors (if tileset exists sample tile color)
  for (let y=0; y<STATE.mapH; y++) {
    for (let x=0; x<STATE.mapW; x++) {
      const id = getTileAt(x,y);
      let col = '#123';
      if (id >= 0 && STATE.tilesetImage) {
        // sample tile color center
        const sx = (id % STATE.tilesetCols) * STATE.tileSize + Math.floor(STATE.tileSize / 2);
        const sy = Math.floor(id / STATE.tilesetCols) * STATE.tileSize + Math.floor(STATE.tileSize / 2);
        // draw full tiles to offscreen to sample is heavy; instead map id to pseudo color
        const r = (id * 37) % 255; const g = (id * 59) % 255; const b = (id * 83) % 255;
        col = `rgb(${r},${g},${b})`;
      }
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // scale up to preview size
  const out = document.createElement('canvas');
  out.width = c.clientWidth || 160;
  out.height = c.clientHeight || 120;
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = false;
  octx.drawImage(canvas, 0, 0, out.width, out.height);
  c.appendChild(out);
}

/* ========== UI HOOKUPS ========== */
document.querySelectorAll('.tool').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.tool').forEach(x => x.classList.remove('selected'));
    e.target.classList.add('selected');
    STATE.tool = e.target.getAttribute('data-tool');
    modeLabel.textContent = STATE.tool;
  });
});

brushSizeInput.addEventListener('input', (e) => {
  STATE.brushSize = Number(e.target.value);
});

autoTileInput.addEventListener('change', (e) => {
  STATE.autoTile = e.target.checked;
});

showGridInput.addEventListener('change', (e) => {
  STATE.showGrid = e.target.checked;
  render();
});

snapGridInput.addEventListener('change', (e) => {
  STATE.snapGrid = e.target.checked;
});

showCollisionInput.addEventListener('change', (e) => {
  STATE.showCollision = e.target.checked;
  render();
});

zoomRange.addEventListener('input', (e) => {
  STATE.zoom = Number(e.target.value);
  render();
});

fitBtn.addEventListener('click', (e) => {
  // center and fit based on canvas size
  const vpw = mapCanvas.width, vph = mapCanvas.height;
  const mapWpx = STATE.mapW * STATE.tileSize, mapHpx = STATE.mapH * STATE.tileSize;
  const zx = vpw / (mapWpx + 40), zy = vph / (mapHpx + 40);
  STATE.zoom = clamp(Math.min(zx, zy, 1), 0.25, 3);
  zoomRange.value = STATE.zoom;
  STATE.panX = (vpw - mapWpx * STATE.zoom) / 2;
  STATE.panY = (vph - mapHpx * STATE.zoom) / 2;
  render();
});

resizeMapBtn.addEventListener('click', () => {
  const w = clamp(Number(mapWInput.value), 8, 256);
  const h = clamp(Number(mapHInput.value), 8, 256);
  const oldW = STATE.mapW, oldH = STATE.mapH;
  const newLayers = [];
  for (const layer of STATE.layers) {
    const newLayer = createLayer(layer.name);
    newLayer.visible = layer.visible;
    // copy data
    for (let y = 0; y < Math.min(oldH, h); y++) {
      for (let x = 0; x < Math.min(oldW, w); x++) {
        newLayer.data[y * w + x] = layer.data[y * oldW + x];
        newLayer.collision[y * w + x] = layer.collision[y * oldW + x];
      }
    }
    newLayers.push(newLayer);
  }
  STATE.mapW = w; STATE.mapH = h;
  STATE.layers = newLayers;
  updateUIMapSize();
  rebuildLayersUI();
  pushHistory();
  render();
});

addLayerBtn.addEventListener('click', () => {
  STATE.layers.push(createLayer('Layer ' + (STATE.layers.length + 1)));
  rebuildLayersUI();
  pushHistory();
});

removeLayerBtn.addEventListener('click', () => {
  if (STATE.layers.length <= 1) return;
  STATE.layers.splice(STATE.activeLayer, 1);
  STATE.activeLayer = Math.max(0, STATE.activeLayer - 1);
  rebuildLayersUI();
  pushHistory();
  render();
});

undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);
saveProjectBtn.addEventListener('click', saveProjectToFile);

exportPNGBtn.addEventListener('click', () => exportPNG(1));
exportHighPNGBtn.addEventListener('click', () => {
  const scale = prompt('Hi-res scale factor (2 or 4 recommended):', '2');
  const s = clamp(Number(scale) || 2, 1, 8);
  exportPNG(s, `tileforge_map_${STATE.mapW}x${STATE.mapH}@${s}x.png`);
});
exportJSONBtn.addEventListener('click', exportProjectJSON);
exportTMXBtn.addEventListener('click', exportTMX);

exportPaletteBtn.addEventListener('click', () => {
  if (!STATE.tilesetImage) return alert('No tileset loaded');
  // export tileset image as is
  const imgData = STATE.tilesetImage.src;
  const a = document.createElement('a');
  a.href = imgData;
  a.download = 'tileset.png';
  a.click();
  logStatus('Exported tileset image');
});

clearPaletteBtn.addEventListener('click', () => {
  paletteDiv.innerHTML = '';
  STATE.tilesetImage = null;
  STATE.tilesetCols = 0;
  STATE.tilesetRows = 0;
  tilesetPreview.innerHTML = 'No tileset loaded';
  render();
});

/* save / load via localStorage button handled via autosave in history push */

/* ========== INITIALIZATION ========== */
function bootstrap() {
  fitCanvases();
  initMap(STATE.mapW, STATE.mapH, STATE.tileSize);
  rebuildLayersUI();
  updateUIMapSize();
  seedLabel.textContent = STATE.seed;
  // sample initial pan/zoom
  STATE.zoom = Number(zoomRange.value) || 1;
  STATE.panX = (mapCanvas.width - STATE.mapW * STATE.tileSize) / 2;
  STATE.panY = (mapCanvas.height - STATE.mapH * STATE.tileSize) / 2;
  // try load autosave
  loadFromLocal();
  render();
  attachKeyboardShortcuts();
  logStatus('Ready — paint tiles, export when done.');
}

/* ========== KEYBOARD SHORTCUTS ========== */
function attachKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); undo(); }
    if (e.key === 'y' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); redo(); }
    if (e.key === 'b') selectTool('brush');
    if (e.key === 'e') selectTool('erase');
    if (e.key === 'r') selectTool('rect');
    if (e.key === 'f') selectTool('bucket');
    if (e.key === 'p') selectTool('picker');
  });
}

function selectTool(name) {
  document.querySelectorAll('.tool').forEach(x => x.classList.remove('selected'));
  const btn = Array.from(document.querySelectorAll('.tool')).find(b => b.getAttribute('data-tool') === name);
  if (btn) btn.classList.add('selected');
  STATE.tool = name;
  modeLabel.textContent = name;
}

/* ========= UTILITIES: saveAs uses FileSaver (from CDN) ========= */
/* make sure JSZip and saveAs exist */
if (typeof JSZip === 'undefined') console.warn('JSZip not loaded: exports with zip will fail. (CDN not loaded?)');
if (typeof saveAs === 'undefined') console.warn('FileSaver not loaded: saveAs() may not be available.');

/* bootstrap */
bootstrap();