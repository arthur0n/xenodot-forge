// "Get assets" — the human-in-the-loop art-sourcing loop, in a modal (the
// sidebar was too cramped). Two parts:
//   1. Open asset requests — owner:"user" tasks the agent filed (via the
//      mcp__ui__request_asset tool) when it hit an art gap: titled "Asset: <name>"
//      with the kind + tailored brief in the note ("[texture|model] <brief>"). The
//      brief is contextual to what's being built, never hardcoded.
//   2. Generators — the stable catalog of free, no-signup pixel-art sites.
// For each request the user supplies a file two ways — pick a local file (native
// dialog) or paste its local path — and chooses a destination "place": the game's own
// assets/ (default) or the external shared-asset library (res://x-shared-assets, for
// free-library example assets kept out of the game tree). The server (POST /api/asset)
// copies it into <place>/textures/ (PNG) or <place>/models/ (GLB), routed by file type. The panel
// stays open so several requests can be filled in one session; each then asks the
// orchestrator to run asset-advisor to verify it and dispatch godot-dev (on PASS).
import { $, el } from "./dom.js";
import { fetchJSON, postJSON } from "../lib/json.js";
import { send } from "./websocket.js";
import { addUser } from "./chat.js";
import { loadState } from "./project-tree.js";

/** Free sources — the stable WHERE (catalogue detail: library/sources/asset-sources.md
 * for textures, library/sources/model-sources.md for 3D models).
 * @type {{ name: string, url: string, fit: string }[]} */
const GENERATORS = [
  {
    name: "pixler.dev",
    url: "https://pixler.dev/",
    fit: "no signup · transparent PNG · blade, tree, props",
  },
  {
    name: "SEELE AI",
    url: "https://www.seeles.ai/features/tools/sprite",
    fit: "no login · PNG + frame JSON · sprite sheets",
  },
  {
    name: "SpriteLab",
    url: "https://spritelab.dev/",
    fit: "free tier (signup) · packs & variants",
  },
  {
    name: "Perchance",
    url: "https://perchance.org/ai-pixel-art-generator",
    fit: "no signup · quick concepts",
  },
  {
    name: "Pixelorama",
    url: "https://www.pixelorama.org/",
    fit: "free editor · tile/seam fix, downscale",
  },
  {
    name: "Poly Pizza",
    url: "https://poly.pizza/",
    fit: "no login · .glb 3D models · CC0/CC-BY · furniture/props",
  },
  {
    name: "Kenney",
    url: "https://kenney.nl/assets",
    fit: "no signup · CC0 model packs · consistent style",
  },
  {
    name: "Quaternius",
    url: "https://quaternius.com/",
    fit: "no signup · CC0 low-poly model packs",
  },
];

const ASK_RE = /^asset:\s*/i;
const KIND_RE = /^\[(texture|model)\]\s*/i;

// Requests the user filled this page-session. The server marks a supplied task
// in_progress, but the GET /api/tasks refetch can race the websocket task_update —
// so we also drop fulfilled ids locally, removing the card immediately and keeping
// it gone across reopen.
/** @type {Set<string>} */
const fulfilled = new Set();

/** @param {string} s @returns {string} */
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "texture";

/** @typedef {"texture"|"model"} Kind */
/** @typedef {{ id: string, name: string, kind: Kind, prompt: string, dest: string }} Ask */

/** @param {string} name @param {Kind} kind @param {"game"|"shared"} [place] @returns {string} */
const destFor = (name, kind, place) => {
  const root = place === "shared" ? "x-shared-assets" : "assets";
  return kind === "model"
    ? `${root}/models/${slug(name)}.glb`
    : `${root}/textures/${slug(name)}.png`;
};

/** Open asset requests from the task board (owner:user, "Asset: …", not done/in-progress).
 * The note carries "[texture|model] <brief>"; we split the kind hint off the brief.
 * @returns {Promise<Ask[]>} */
async function loadAsks() {
  try {
    const tasks = /** @type {import("../lib/types.js").Task[]} */ (await fetchJSON("/api/tasks"));
    return tasks
      .filter(
        (t) =>
          t.owner === "user" &&
          t.status !== "done" &&
          t.status !== "in_progress" &&
          !fulfilled.has(t.id) &&
          ASK_RE.test(t.title),
      )
      .map((t) => {
        const name = t.title.replace(ASK_RE, "").trim() || "texture";
        const note = t.note ?? "";
        const km = KIND_RE.exec(note);
        /** @type {Kind} */
        const kind = km?.[1]?.toLowerCase() === "model" ? "model" : "texture";
        return {
          id: t.id,
          name,
          kind,
          prompt: note.replace(KIND_RE, ""),
          dest: destFor(name, kind),
        };
      });
  } catch {
    return [];
  }
}

/** @param {File} file @returns {Promise<string>} */
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      resolve(/** @type {string} */ (r.result));
    };
    r.onerror = () => {
      reject(new Error("read failed"));
    };
    r.readAsDataURL(file);
  });
}

/** @param {Ask} ask @param {string} savedPath @returns {string} */
function wirePrompt(ask, savedPath) {
  const task = ask.id ? ` (task ${ask.id})` : "";
  if (savedPath.endsWith(".glb")) {
    return (
      `I sourced the "${ask.name}" model and saved it to ${savedPath}${task}. ` +
      `First run the asset-advisor agent (gate 2) to verify it (.glb format, scale/units, materials, ` +
      `placement, licence). Only on PASS, dispatch godot-dev to wire it per skill ` +
      `godot-mesh-import-pixel-art — import, scale to the prop's footprint, instance it in place of the ` +
      `matching greybox node (keep its name + position), NEAREST + Make-Unique only if it carries a ` +
      `texture — then verify with godot-verify and mark the task done once it renders. If asset-advisor ` +
      `fails it, report why and the corrected sourcing spec instead of wiring.`
    );
  }
  return (
    `I generated the "${ask.name}" texture and saved it to ${savedPath}${task}. ` +
    `First run the asset-advisor agent to verify it against the request (type, dimensions, alpha, ` +
    `placement, import settings). Only on PASS, dispatch godot-dev to import it ` +
    `(Filter = Nearest, Mipmaps = Off) and wire it per the asset-sourcing loop — e.g. bind ` +
    `blade_texture and set use_texture = true in resources/grass_blade_material.tres, or swap the ` +
    `relevant StandardMaterial3D albedo — then verify with godot-verify and mark the task done once it ` +
    `renders. If asset-advisor fails it, report why and the corrected generation prompt instead of wiring.`
  );
}

/** Send the asset body to the server, then hand wiring to the orchestrator and
 * refresh the cards. Does NOT close the modal — many requests can be filled in one
 * session. @param {Ask} ask
 * @param {{ name: string, dataUrl?: string, srcPath?: string, place?: "game"|"shared" }} body
 * @param {HTMLElement} errEl @returns {Promise<void>} */
async function saveAndWire(ask, body, errEl) {
  errEl.textContent = "";
  /** @type {{ path?: string, error?: string }} */
  let data;
  try {
    data = /** @type {{ path?: string, error?: string }} */ (await postJSON("/api/asset", body));
  } catch {
    errEl.textContent = "Save failed — restart the UI server (npm start) and try again.";
    return;
  }
  if (!data.path) {
    errEl.textContent = data.error ?? "Could not save the asset.";
    return;
  }
  if (ask.id) fulfilled.add(ask.id);
  void loadState();
  const prompt = wirePrompt(ask, data.path);
  addUser(prompt);
  send({ type: "user_input", text: prompt });
  if (ask.id) send({ type: "task_update", op: "update", id: ask.id, status: "in_progress" });
  void refresh();
}

/** @param {Ask} ask @param {File} file @param {"game"|"shared"} place @param {HTMLElement} errEl
 * @returns {Promise<void>} */
async function upload(ask, file, place, errEl) {
  errEl.textContent = "";
  /** @type {string} */
  let dataUrl;
  try {
    dataUrl = await fileToDataUrl(file);
  } catch {
    errEl.textContent = "Could not read that file.";
    return;
  }
  await saveAndWire(ask, { name: ask.name, dataUrl, place }, errEl);
}

/** @param {Ask} ask @param {string} value @param {"game"|"shared"} place @param {HTMLElement} errEl
 * @returns {Promise<void>} */
async function submitPath(ask, value, place, errEl) {
  const srcPath = value.trim();
  if (!srcPath) {
    errEl.textContent = "Enter a local file path first.";
    return;
  }
  await saveAndWire(ask, { name: ask.name, srcPath, place }, errEl);
}

/** Native file picker that saves the chosen file on selection.
 * @param {() => Ask} getAsk @param {() => "game"|"shared"} getPlace @param {HTMLElement} errEl
 * @returns {HTMLElement} */
function pickControl(getAsk, getPlace, errEl) {
  const label = el("label", "btn primary", "Pick file…");
  label.style.cursor = "pointer";
  const input = /** @type {HTMLInputElement} */ (el("input"));
  input.type = "file";
  input.accept = "image/png,.glb,model/gltf-binary";
  input.style.display = "none";
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) void upload(getAsk(), f, getPlace(), errEl);
  };
  label.append(input);
  return label;
}

/** Text field + button to supply the asset by a local path (no byte transfer).
 * @param {() => Ask} getAsk @param {() => "game"|"shared"} getPlace @param {HTMLElement} errEl
 * @param {string} placeholder @returns {HTMLElement} */
function pathRow(getAsk, getPlace, errEl, placeholder) {
  const row = el("div", "asset-path-row");
  const input = /** @type {HTMLInputElement} */ (el("input", "form-input"));
  input.placeholder = placeholder;
  const go = () => {
    void submitPath(getAsk(), input.value, getPlace(), errEl);
  };
  input.onkeydown = (e) => {
    if (e.key === "Enter") go();
  };
  const btn = el("button", "btn ghost", "Use path");
  btn.onclick = go;
  row.append(input, btn);
  return row;
}

/** A copy-to-clipboard button for the contextual prompt. @param {string} text @returns {HTMLElement} */
function copyBtn(text) {
  const btn = el("button", "btn ghost", "copy prompt");
  btn.onclick = () => {
    void navigator.clipboard?.writeText(text);
    btn.textContent = "copied";
    setTimeout(() => {
      btn.textContent = "copy prompt";
    }, 1200);
  };
  return btn;
}

/** Destination "place" selector: the game's own assets/ (default) or the external
 * shared-asset library (res://x-shared-assets) — for free-library example assets kept out of
 * the game tree. @returns {{ row: HTMLElement, get: () => "game"|"shared",
 * onChange: (cb: () => void) => void }} */
function placeSelect() {
  const row = el("div", "asset-place-row");
  row.append(el("span", "desc", "Place: "));
  const sel = /** @type {HTMLSelectElement} */ (el("select", "form-input"));
  const game = /** @type {HTMLOptionElement} */ (el("option", undefined, "Game (assets/)"));
  game.value = "game";
  const shared = /** @type {HTMLOptionElement} */ (
    el("option", undefined, "Shared (x-shared-assets/)")
  );
  shared.value = "shared";
  sel.append(game, shared);
  row.append(sel);
  return {
    row,
    get: () => (sel.value === "shared" ? "shared" : "game"),
    onChange: (cb) => {
      sel.onchange = cb;
    },
  };
}

/** Card for one open asset request. @param {Ask} ask @returns {HTMLElement} */
function askCard(ask) {
  const card = el("div", "asset-card");
  card.append(el("div", "modal-head", ask.name));
  const sub = el("div", "modal-sub", `${ask.kind} → ${ask.dest}`);
  card.append(sub);
  if (ask.prompt) {
    const ta = /** @type {HTMLTextAreaElement} */ (el("textarea", "form-input"));
    ta.value = ask.prompt;
    ta.rows = 3;
    ta.readOnly = true;
    card.append(ta);
  }
  const errEl = el("div", "modal-error");
  const getAsk = () => ask;
  const place = placeSelect();
  place.onChange(() => {
    sub.textContent = `${ask.kind} → ${destFor(ask.name, ask.kind, place.get())}`;
  });
  card.append(place.row);
  const actions = el("div", "modal-actions");
  if (ask.prompt) actions.append(copyBtn(ask.prompt));
  actions.append(pickControl(getAsk, place.get, errEl));
  card.append(actions);
  card.append(
    pathRow(
      getAsk,
      place.get,
      errEl,
      `or paste a local path, e.g. ~/Downloads/${slug(ask.name)}.${ask.kind === "model" ? "glb" : "png"}`,
    ),
  );
  card.append(errEl);
  return card;
}

/** Ad-hoc card when there's no pending request — name it, then pick or path it.
 * @returns {HTMLElement} */
function adhocCard() {
  const card = el("div", "asset-card");
  card.append(
    el("div", "modal-sub", "No open requests — supply an ad-hoc texture (.png) or model (.glb):"),
  );
  const nameInput = /** @type {HTMLInputElement} */ (el("input", "form-input"));
  nameInput.placeholder = "name, e.g. grass_blade";
  card.append(nameInput);
  const errEl = el("div", "modal-error");
  // The file type decides texture vs model on the server; kind here is just a default.
  /** @returns {Ask} */
  const getAsk = () => {
    const name = nameInput.value.trim() || "texture";
    return { id: "", name, kind: "texture", prompt: "", dest: destFor(name, "texture") };
  };
  const place = placeSelect();
  card.append(place.row);
  const actions = el("div", "modal-actions");
  actions.append(pickControl(getAsk, place.get, errEl));
  card.append(actions);
  card.append(
    pathRow(getAsk, place.get, errEl, "or paste a local path, e.g. ~/Downloads/grass.png"),
  );
  card.append(errEl);
  return card;
}

/** @param {{ name: string, url: string, fit: string }} g @returns {HTMLElement} */
function genRow(g) {
  const item = el("div", "tree-item");
  const link = /** @type {HTMLAnchorElement} */ (el("a", "tree-item-path", g.name + " ↗"));
  link.href = g.url;
  link.target = "_blank";
  link.rel = "noopener";
  link.style.color = "inherit";
  link.style.textDecoration = "none";
  item.append(link, el("span", "desc", `— ${g.fit}`));
  return item;
}

async function refresh() {
  const asksEl = $("assets-asks");
  asksEl.replaceChildren();
  const asks = await loadAsks();
  if (!asks.length) {
    asksEl.append(adhocCard());
  } else {
    asks.forEach((a) => {
      asksEl.append(askCard(a));
    });
  }

  const gens = $("assets-generators");
  gens.replaceChildren();
  GENERATORS.forEach((g) => {
    gens.append(genRow(g));
  });
}

function open() {
  $("assets-error").textContent = "";
  $("assets-modal").style.display = "";
  void refresh();
}
function close() {
  $("assets-modal").style.display = "none";
}

export function initGetAssets() {
  const trigger = document.getElementById("assets-open");
  if (trigger) trigger.onclick = open;
  const closeBtn = document.getElementById("assets-close");
  if (closeBtn) closeBtn.onclick = close;
  const modal = document.getElementById("assets-modal");
  if (modal)
    modal.addEventListener("click", (e) => {
      if (e.target === modal) close();
    });
}
