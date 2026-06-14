// "Get assets" — the human-in-the-loop art-sourcing loop, in a modal (the
// sidebar was too cramped). Two parts:
//   1. Open asset requests — owner:"user" tasks the orchestrator filed when it
//      hit an art gap, titled "Asset: <name>" with the generation prompt in the
//      note. The prompt is contextual to what's being built, never hardcoded.
//   2. Generators — the stable catalog of free, no-signup pixel-art sites.
// The user generates a PNG (or sources a free .glb), uploads it here (POST
// /api/asset writes a PNG to assets/textures/ or a GLB to assets/models/, routed
// by file type), and we ask the orchestrator to run asset-advisor to verify it,
// then dispatch godot-dev (on PASS) to import + wire + verify.
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

/** @param {string} s @returns {string} */
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "texture";

/** @typedef {{ id: string, name: string, prompt: string, dest: string }} Ask */

/** Open asset requests from the task board (owner:user, "Asset: …", not done).
 * @returns {Promise<Ask[]>} */
async function loadAsks() {
  try {
    const tasks = /** @type {import("../lib/types.js").Task[]} */ (await fetchJSON("/api/tasks"));
    return tasks
      .filter((t) => t.owner === "user" && t.status !== "done" && ASK_RE.test(t.title))
      .map((t) => {
        const name = t.title.replace(ASK_RE, "").trim() || "texture";
        return { id: t.id, name, prompt: t.note ?? "", dest: `assets/textures/${slug(name)}.png` };
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
      `placement in assets/models/, licence). Only on PASS, dispatch godot-dev to wire it per skill ` +
      `godot-mesh-import-pixel-art — import, scale to the prop's footprint, instance it in place of the ` +
      `matching greybox node (keep its name + position), NEAREST + Make-Unique only if it carries a ` +
      `texture — then verify with godot-verify and mark the task done once it renders. If asset-advisor ` +
      `fails it, report why and the corrected sourcing spec instead of wiring.`
    );
  }
  return (
    `I generated the "${ask.name}" texture and saved it to ${savedPath}${task}. ` +
    `First run the asset-advisor agent to verify it against the request (type, dimensions, alpha, ` +
    `placement in assets/textures/, import settings). Only on PASS, dispatch godot-dev to import it ` +
    `(Filter = Nearest, Mipmaps = Off) and wire it per the asset-sourcing loop — e.g. bind ` +
    `blade_texture and set use_texture = true in resources/grass_blade_material.tres, or swap the ` +
    `relevant StandardMaterial3D albedo — then verify with godot-verify and mark the task done once it ` +
    `renders. If asset-advisor fails it, report why and the corrected generation prompt instead of wiring.`
  );
}

/** Upload the chosen PNG, then hand wiring to the orchestrator.
 * @param {Ask} ask @param {File} file */
async function upload(ask, file) {
  const err = $("assets-error");
  err.textContent = "";
  /** @type {string} */
  let dataUrl;
  try {
    dataUrl = await fileToDataUrl(file);
  } catch {
    err.textContent = "Could not read that file.";
    return;
  }
  /** @type {{ path?: string, error?: string }} */
  let data;
  try {
    data = /** @type {{ path?: string, error?: string }} */ (
      await postJSON("/api/asset", { name: ask.name, dataUrl })
    );
  } catch {
    err.textContent = "Upload failed — restart the UI server (npm start) and try again.";
    return;
  }
  if (!data.path) {
    err.textContent = data.error ?? "Could not save the image.";
    return;
  }
  close();
  void loadState();
  const prompt = wirePrompt(ask, data.path);
  addUser(prompt);
  send({ type: "user_input", text: prompt });
  if (ask.id) send({ type: "task_update", op: "update", id: ask.id, status: "in_progress" });
}

/** A file picker that uploads on selection. @param {Ask} ask @returns {HTMLElement} */
function uploadControl(ask) {
  const label = el("label", "btn primary", "Upload PNG / GLB");
  label.style.cursor = "pointer";
  const input = /** @type {HTMLInputElement} */ (el("input"));
  input.type = "file";
  input.accept = "image/png,.glb,model/gltf-binary";
  input.style.display = "none";
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) void upload(ask, f);
  };
  label.append(input);
  return label;
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

/** Card for one open asset request. @param {Ask} ask @returns {HTMLElement} */
function askCard(ask) {
  const card = el("div", "asset-card");
  card.append(el("div", "modal-head", ask.name));
  card.append(el("div", "modal-sub", "→ .png saves to assets/textures/ · .glb to assets/models/"));
  if (ask.prompt) {
    const ta = /** @type {HTMLTextAreaElement} */ (el("textarea", "form-input"));
    ta.value = ask.prompt;
    ta.rows = 3;
    ta.readOnly = true;
    card.append(ta);
  }
  const actions = el("div", "modal-actions");
  if (ask.prompt) actions.append(copyBtn(ask.prompt));
  actions.append(uploadControl(ask));
  card.append(actions);
  return card;
}

/** Ad-hoc card when there's no pending request — name it, upload it.
 * @returns {HTMLElement} */
function adhocCard() {
  const card = el("div", "asset-card");
  card.append(
    el("div", "modal-sub", "No open requests — upload an ad-hoc texture (.png) or model (.glb):"),
  );
  const nameInput = /** @type {HTMLInputElement} */ (el("input", "form-input"));
  nameInput.placeholder = "name, e.g. grass_blade";
  card.append(nameInput);
  const actions = el("div", "modal-actions");
  const label = el("label", "btn primary", "Upload PNG / GLB");
  label.style.cursor = "pointer";
  const input = /** @type {HTMLInputElement} */ (el("input"));
  input.type = "file";
  input.accept = "image/png,.glb,model/gltf-binary";
  input.style.display = "none";
  input.onchange = () => {
    const f = input.files?.[0];
    const name = nameInput.value.trim() || "texture";
    if (f) void upload({ id: "", name, prompt: "", dest: `assets/textures/${slug(name)}.png` }, f);
  };
  label.append(input);
  actions.append(label);
  card.append(actions);
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
