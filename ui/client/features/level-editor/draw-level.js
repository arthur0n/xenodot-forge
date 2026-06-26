// "Draw level" — sketch a top-down blockout in the browser and ship it to the
// game as a tile grid the level-designer briefs and godot-dev builds into a
// GridMap level (skill: godot-gridmap-level). The grid is a build-time spatial
// reference, NOT loaded at runtime. Sibling to get-assets.js — same modal → POST
// → file → user_input handoff plumbing. Prototype, "for an idea": a small 24×16
// grid with a numbered ruler + a palette of tile types, sized so every cell is
// visible (no zoom needed).
// Structure codes: 0 floor · 1 wall · 2 door · 3 window · 4 item. Items carry an
// id (same id = the same item); rooms are a separate multi-cell numbered overlay.
import { $, el } from "../../core/dom.js";
import { fetchJSON, postJSON } from "../../../lib/json.js";
import { send } from "../../core/websocket.js";
import { addUser } from "../chat/chat.js";
import { loadState } from "../project/project-tree.js";

const GRID_W = 24; // cells across (X)
const GRID_H = 16; // cells down (Z) — small + rectangular so every cell is visible
const CELL_PX = 22; // on-canvas size of one cell, in px
const RULER = 18; // px margin on top + left for ruler numbers
const PAD = 14; // px margin on right + bottom so the last ruler number isn't clipped
const MAJOR = 4; // a heavier gridline + a ruler number every N cells
const CELL_SIZE = 1; // default world units/cell; the level-designer settles the real scale
const MAX_ID = 99; // id range for item / room numbers

const WALL_COLOR = "#5cc99a";
const DOOR_COLOR = "#e0a44a";
const WINDOW_COLOR = "#5aa6d9";
const ITEM_COLOR = "#a87de0"; // one colour for every item — the id (not the colour) distinguishes them

/** A palette tool. `code` is the structure tile written to `cells`; rooms are an
 * overlay (no structure code). `numbered` tools paint the active id.
 * @typedef {{ key: string, label: string, color: string, code?: number, numbered?: boolean, overlay?: boolean }} Tool */
/** @type {Tool} */
const WALL_TOOL = { key: "wall", label: "Wall", color: WALL_COLOR, code: 1 };
/** @type {Tool[]} */
const TOOLS = [
  WALL_TOOL,
  { key: "door", label: "Door", color: DOOR_COLOR, code: 2 },
  { key: "window", label: "Window", color: WINDOW_COLOR, code: 3 },
  { key: "item", label: "Item", color: ITEM_COLOR, code: 4, numbered: true },
  { key: "room", label: "Room", color: "#d8b24a", numbered: true, overlay: true },
  { key: "erase", label: "Erase", color: "" },
];

/** Structure tile per cell (0 floor · 1 wall · 2 door · 3 window · 4 item), row-major. @type {Uint8Array} */
const cells = new Uint8Array(GRID_W * GRID_H);
/** Item id (1..MAX_ID where cells==4, else 0), row-major. @type {Uint8Array} */
const itemIds = new Uint8Array(GRID_W * GRID_H);
/** Room id (1..MAX_ID overlay, else 0), row-major. @type {Uint8Array} */
const roomIds = new Uint8Array(GRID_W * GRID_H);

let toolKey = "wall"; // active tool key (default: Wall)
let activeId = 1; // active id painted by numbered tools (Item / Room)
let painting = false;
let lastX = -1;
let lastY = -1;

/** A numbered cell tag in the export / saved grids.
 * @typedef {{ id: number, x: number, y: number }} Tag */
/** A saved drawn level (older saves may carry colour items in `cells` and single-cell `labels`).
 * @typedef {{ width: number, height: number, cells: number[], items?: Tag[], rooms?: Tag[], labels?: { n: number, x: number, y: number }[] }} SavedGrid */
/** Saved drawn levels for the load picker (name -> grid). @type {Map<string, SavedGrid>} */
const saved = new Map();

/** @returns {Tool} */
function activeTool() {
  return TOOLS.find((t) => t.key === toolKey) ?? WALL_TOOL;
}

/** @param {number} code @returns {string} */
function colorFor(code) {
  switch (code) {
    case 1:
      return WALL_COLOR;
    case 2:
      return DOOR_COLOR;
    case 3:
      return WINDOW_COLOR;
    case 4:
      return ITEM_COLOR;
    default:
      return "";
  }
}

/** Distinct translucent tint per room id. @param {number} id @param {number} alpha @returns {string} */
function roomColor(id, alpha) {
  const hue = (id * 67) % 360;
  return `hsl(${hue} 65% 55% / ${alpha})`;
}

/** @returns {HTMLCanvasElement} */
const canvasEl = () => /** @type {HTMLCanvasElement} */ ($("draw-level-canvas"));

/** Outlined white label for ids drawn over the grid.
 * @param {CanvasRenderingContext2D} ctx @param {string} t @param {number} cx @param {number} cy */
function outlinedText(ctx, t, cx, cy) {
  ctx.strokeStyle = "rgba(0,0,0,0.78)";
  ctx.strokeText(t, cx, cy);
  ctx.fillStyle = "#fff";
  ctx.fillText(t, cx, cy);
}

/** Sum of cell coords per room id, for placing one number at each room's centroid.
 * @returns {Map<number, { sx: number, sy: number, n: number }>} */
function roomCentroids() {
  /** @type {Map<number, { sx: number, sy: number, n: number }>} */
  const m = new Map();
  for (let i = 0; i < roomIds.length; i++) {
    const id = roomIds[i];
    if (!id) continue;
    const a = m.get(id) ?? { sx: 0, sy: 0, n: 0 };
    a.sx += i % GRID_W;
    a.sy += Math.floor(i / GRID_W);
    a.n += 1;
    m.set(id, a);
  }
  return m;
}

function render() {
  const canvas = canvasEl();
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  const gridRight = RULER + GRID_W * CELL_PX;
  const gridBottom = RULER + GRID_H * CELL_PX;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // structure cells
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const code = cells[y * GRID_W + x];
      if (code) {
        ctx.fillStyle = colorFor(code);
        ctx.fillRect(RULER + x * CELL_PX, RULER + y * CELL_PX, CELL_PX, CELL_PX);
      }
    }
  }

  // room overlay — translucent tint over whatever structure is underneath
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const rid = roomIds[y * GRID_W + x];
      if (rid) {
        ctx.fillStyle = roomColor(rid, 0.24);
        ctx.fillRect(RULER + x * CELL_PX, RULER + y * CELL_PX, CELL_PX, CELL_PX);
      }
    }
  }

  // grid lines — every cell, heavier every MAJOR cells
  ctx.lineWidth = 1;
  for (let i = 0; i <= GRID_W; i++) {
    ctx.strokeStyle = i % MAJOR === 0 ? "rgba(255,255,255,0.24)" : "rgba(255,255,255,0.09)";
    const gx = RULER + i * CELL_PX + 0.5;
    ctx.beginPath();
    ctx.moveTo(gx, RULER);
    ctx.lineTo(gx, gridBottom);
    ctx.stroke();
  }
  for (let j = 0; j <= GRID_H; j++) {
    ctx.strokeStyle = j % MAJOR === 0 ? "rgba(255,255,255,0.24)" : "rgba(255,255,255,0.09)";
    const gy = RULER + j * CELL_PX + 0.5;
    ctx.beginPath();
    ctx.moveTo(RULER, gy);
    ctx.lineTo(gridRight, gy);
    ctx.stroke();
  }

  // ruler numbers along the top + left, every MAJOR cells
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "9px ui-monospace, monospace";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  for (let i = 0; i <= GRID_W; i += MAJOR) {
    ctx.fillText(String(i), RULER + i * CELL_PX, RULER * 0.5);
  }
  for (let j = 0; j <= GRID_H; j += MAJOR) {
    ctx.fillText(String(j), RULER * 0.5, RULER + j * CELL_PX);
  }

  // item ids — one number per item cell
  ctx.font = "bold 10px ui-monospace, monospace";
  ctx.lineWidth = 3;
  for (let i = 0; i < cells.length; i++) {
    const iid = itemIds[i] ?? 0;
    if (cells[i] === 4 && iid > 0) {
      const cx = RULER + (i % GRID_W) * CELL_PX + CELL_PX / 2;
      const cy = RULER + Math.floor(i / GRID_W) * CELL_PX + CELL_PX / 2;
      outlinedText(ctx, String(iid), cx, cy);
    }
  }

  // room ids — one number at each room's centroid
  ctx.font = "bold 13px ui-monospace, monospace";
  for (const [id, a] of roomCentroids()) {
    const cx = RULER + (a.sx / a.n + 0.5) * CELL_PX;
    const cy = RULER + (a.sy / a.n + 0.5) * CELL_PX;
    outlinedText(ctx, String(id), cx, cy);
  }
}

/** Apply the active tool (or erase) to one cell.
 * @param {number} x @param {number} y @param {boolean} erase */
function applyCell(x, y, erase) {
  if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return;
  const idx = y * GRID_W + x;
  const t = activeTool();
  if (t.key === "erase") {
    cells[idx] = 0;
    itemIds[idx] = 0;
    roomIds[idx] = 0;
    return;
  }
  if (t.overlay) {
    roomIds[idx] = erase ? 0 : activeId; // Room: overlay layer only
    return;
  }
  if (erase) {
    cells[idx] = 0;
    itemIds[idx] = 0;
    return;
  }
  cells[idx] = t.code ?? 0;
  itemIds[idx] = t.code === 4 ? activeId : 0;
}

/** Apply along a line (Bresenham) so fast drags leave no gaps.
 * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 @param {boolean} erase */
function paintLine(x0, y0, x1, y1, erase) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  for (;;) {
    applyCell(x, y, erase);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Grid cell under a pointer event, or {x:-1} if outside the grid.
 * @param {PointerEvent} e @returns {{ x: number, y: number }} */
function cellAt(e) {
  const canvas = canvasEl();
  const rect = canvas.getBoundingClientRect();
  const px = ((e.clientX - rect.left) / rect.width) * canvas.width;
  const py = ((e.clientY - rect.top) / rect.height) * canvas.height;
  const x = Math.floor((px - RULER) / CELL_PX);
  const y = Math.floor((py - RULER) / CELL_PX);
  if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return { x: -1, y: -1 };
  return { x, y };
}

/** Paint the active tool (right-button erases) under a pointer event.
 * @param {PointerEvent} e */
function paintAt(e) {
  const { x, y } = cellAt(e);
  if (x < 0) {
    lastX = -1;
    lastY = -1;
    return;
  }
  const erase = (e.buttons & 2) !== 0;
  if (lastX >= 0) paintLine(lastX, lastY, x, y, erase);
  else applyCell(x, y, erase);
  lastX = x;
  lastY = y;
  render();
}

/** @returns {HTMLInputElement | null} */
const numInput = () =>
  /** @type {HTMLInputElement | null} */ (document.getElementById("draw-level-num-val"));

/** Clamp + store the active id and reflect it in the stepper input. @param {number} n */
function setActiveId(n) {
  activeId = Math.max(1, Math.min(MAX_ID, Math.trunc(n) || 1));
  const inp = numInput();
  if (inp) inp.value = String(activeId);
}

/** Show the id stepper only while a numbered tool (Item / Room) is active. */
function syncNumberUI() {
  const box = document.getElementById("draw-level-number");
  if (box) box.style.visibility = activeTool().numbered ? "visible" : "hidden";
}

/** Build the tool palette buttons and wire selection. */
function buildPalette() {
  const wrap = $("draw-level-palette");
  wrap.replaceChildren();
  TOOLS.forEach((p) => {
    const btn = el("button", "draw-level-swatch");
    btn.setAttribute("aria-pressed", String(p.key === toolKey));
    const dot = el("span", "draw-level-dot");
    if (p.color) {
      dot.style.background = p.color;
    } else {
      dot.style.background = "var(--well)";
      dot.style.border = "1px dashed var(--border-strong)";
    }
    btn.append(dot, document.createTextNode(p.label));
    btn.onclick = () => {
      toolKey = p.key;
      Array.from(wrap.children).forEach((c) => {
        c.setAttribute("aria-pressed", String(c === btn));
      });
      syncNumberUI();
    };
    wrap.append(btn);
  });
  syncNumberUI();
}

/** Load a saved level's grid onto the canvas (view + continue editing).
 * @param {SavedGrid} lv */
function applyLevel(lv) {
  const err = $("draw-level-error");
  if (lv.width !== GRID_W || lv.height !== GRID_H) {
    err.textContent = `Saved at ${lv.width}×${lv.height}; the painter is ${GRID_W}×${GRID_H} — can't load.`;
    return;
  }
  err.textContent = "";
  cells.fill(0);
  itemIds.fill(0);
  roomIds.fill(0);
  const src = lv.cells.slice(0, GRID_W * GRID_H);
  for (let i = 0; i < src.length; i++) {
    const c = src[i] ?? 0;
    if (c >= 5 && c <= 7) {
      cells[i] = 4; // legacy colour items (5/6/7) → item with id 2/3/4
      itemIds[i] = c - 3;
    } else if (c === 4) {
      cells[i] = 4;
      itemIds[i] = 1;
    } else if (c >= 1 && c <= 3) {
      cells[i] = c;
    }
  }
  for (const it of lv.items ?? []) {
    const idx = it.y * GRID_W + it.x;
    if (idx >= 0 && idx < cells.length) {
      cells[idx] = 4;
      itemIds[idx] = Math.max(1, Math.min(MAX_ID, it.id));
    }
  }
  if (lv.rooms) {
    for (const r of lv.rooms) {
      const idx = r.y * GRID_W + r.x;
      if (idx >= 0 && idx < roomIds.length) roomIds[idx] = Math.max(1, Math.min(MAX_ID, r.id));
    }
  } else {
    for (const l of lv.labels ?? []) {
      const idx = l.y * GRID_W + l.x; // legacy single-cell numbers → room ids
      if (idx >= 0 && idx < roomIds.length) roomIds[idx] = Math.max(1, Math.min(MAX_ID, l.n));
    }
  }
  render();
}

/** Fetch the saved levels and (re)fill the load picker. */
async function loadLevels() {
  const sel = /** @type {HTMLSelectElement} */ ($("draw-level-load"));
  /** @type {(SavedGrid & { name: string })[]} */
  let list;
  try {
    list = /** @type {(SavedGrid & { name: string })[]} */ (await fetchJSON("/api/levels"));
  } catch {
    return;
  }
  saved.clear();
  sel.replaceChildren();
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = "— load saved —";
  sel.append(ph);
  for (const lv of list) {
    saved.set(lv.name, lv);
    const o = document.createElement("option");
    o.value = lv.name;
    o.textContent = `${lv.name} (${lv.width}×${lv.height})`;
    sel.append(o);
  }
}

function open() {
  $("draw-level-error").textContent = "";
  $("draw-level-modal").style.display = "";
  void loadLevels();
  render();
}
function close() {
  $("draw-level-modal").style.display = "none";
}

async function exportLevel() {
  const err = $("draw-level-error");
  err.textContent = "";
  /** @type {Tag[]} */
  const items = [];
  /** @type {Tag[]} */
  const rooms = [];
  let nWall = 0;
  let nDoor = 0;
  let nWindow = 0;
  for (let i = 0; i < cells.length; i++) {
    const x = i % GRID_W;
    const y = Math.floor(i / GRID_W);
    const iid = itemIds[i] ?? 0;
    const rid = roomIds[i] ?? 0;
    if (cells[i] === 1) nWall++;
    else if (cells[i] === 2) nDoor++;
    else if (cells[i] === 3) nWindow++;
    else if (cells[i] === 4 && iid > 0) items.push({ id: iid, x, y });
    if (rid > 0) rooms.push({ id: rid, x, y });
  }
  if (nWall + nDoor + nWindow + items.length + rooms.length === 0) {
    err.textContent = "Paint at least one tile, item, or room first.";
    return;
  }
  const grid = {
    width: GRID_W,
    height: GRID_H,
    cell_size: CELL_SIZE,
    cells: Array.from(cells),
    items,
    rooms,
  };
  /** @type {{ path?: string, error?: string }} */
  let data;
  try {
    data = /** @type {{ path?: string, error?: string }} */ (
      await postJSON("/api/level", { grid })
    );
  } catch {
    err.textContent = "Export failed — restart the UI server (npm start) and try again.";
    return;
  }
  if (!data.path) {
    err.textContent = data.error ?? "Could not save the level.";
    return;
  }
  close();
  void loadState();
  const itemIdCount = new Set(items.map((t) => t.id)).size;
  const roomIdCount = new Set(rooms.map((t) => t.id)).size;
  const summary =
    `${nWall} wall, ${nDoor} door, ${nWindow} window, ` +
    `${items.length} item cell${items.length === 1 ? "" : "s"} across ${itemIdCount} id${itemIdCount === 1 ? "" : "s"}, ` +
    `${rooms.length} room cell${rooms.length === 1 ? "" : "s"} across ${roomIdCount} room${roomIdCount === 1 ? "" : "s"}`;
  const gridmapEl = /** @type {HTMLInputElement | null} */ (
    document.getElementById("draw-level-gridmap")
  );
  const buildClause = gridmapEl?.checked
    ? "build it as a GridMap + MeshLibrary scene (skill: godot-gridmap-level)"
    : "build it as a hand-authored STATIC greybox blockout — real StaticBody3D + BoxMesh nodes written " +
      "directly into the saved .tscn (selectable/movable in the editor), NOT generated at runtime and " +
      "NOT a GridMap (position + rotation only, never Transform3D literals; skill: godot-greybox)";
  const prompt =
    `I drew a level (${summary}) and saved the grid to ${data.path} ` +
    `(${GRID_W}×${GRID_H}; structure codes 0 floor, 1 wall, 2 door, 3 window, 4 item; ` +
    `plus "items": [{id,x,y}] where the same id means the same item, and "rooms": [{id,x,y}] ` +
    `tagging cells into numbered rooms — same id = one room region). ` +
    `Dispatch the level-designer agent: have it read the grid, ask me what the level is ABOUT (the concept) ` +
    `first, then the name and level-design details (metres per cell, wall height, what each item id and each room ` +
    `are, player spawn, theme); it writes a level-design brief to design/levels/<name>.md and hands off to the ` +
    `game-designer agent, which decides how to build it (splitting a large level into small pieces) and dispatches ` +
    `godot-dev to ${buildClause}, register it in ` +
    `main.gd, and verify with godot-verify.`;
  addUser(prompt);
  send({ type: "user_input", text: prompt });
}

export function initDrawLevel() {
  const trigger = document.getElementById("draw-level-open");
  if (trigger) trigger.onclick = open;
  const closeBtn = document.getElementById("draw-level-close");
  if (closeBtn) closeBtn.onclick = close;
  const exportBtn = document.getElementById("draw-level-export");
  if (exportBtn) exportBtn.onclick = () => void exportLevel();
  const clearBtn = document.getElementById("draw-level-clear");
  if (clearBtn)
    clearBtn.onclick = () => {
      cells.fill(0);
      itemIds.fill(0);
      roomIds.fill(0);
      render();
    };

  const dec = document.getElementById("draw-level-num-dec");
  if (dec)
    dec.onclick = () => {
      setActiveId(activeId - 1);
    };
  const inc = document.getElementById("draw-level-num-inc");
  if (inc)
    inc.onclick = () => {
      setActiveId(activeId + 1);
    };
  const inp = numInput();
  if (inp)
    inp.onchange = () => {
      setActiveId(Number(inp.value));
    };

  const loadSel = /** @type {HTMLSelectElement | null} */ (
    document.getElementById("draw-level-load")
  );
  if (loadSel)
    loadSel.onchange = () => {
      const lv = saved.get(loadSel.value);
      if (lv) applyLevel(lv);
    };

  buildPalette();
  setActiveId(activeId);

  const canvas = canvasEl();
  if (canvas) {
    canvas.width = RULER + GRID_W * CELL_PX + PAD;
    canvas.height = RULER + GRID_H * CELL_PX + PAD;
    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      painting = true;
      lastX = -1;
      lastY = -1;
      paintAt(e);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (painting) paintAt(e);
    });
    canvas.addEventListener("pointerup", () => {
      painting = false;
      lastX = -1;
      lastY = -1;
    });
    canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });
  }

  const modal = document.getElementById("draw-level-modal");
  if (modal)
    modal.addEventListener("click", (e) => {
      if (e.target === modal) close();
    });
}
