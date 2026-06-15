// Write an asset the web UI supplied into the game's assets/ folder — or, when the user
// picks place="shared", into the external shared-asset library mounted at res://x-shared-assets
// (see config.js ASSET_LIBRARY) — where godot-dev wires it. Supplied one of two ways
// (client/get-assets.js):
//   • native picker → a base64 data URL  (writeAsset)
//   • a local file path                  (writeAssetFromPath)
// Both funnel through writeBuffer, which routes by file type sniffed from the decoded bytes:
//   PNG  → <root>/textures/<slug>.png   (pixel-art texture)
//   GLB  → <root>/models/<slug>.glb     (sourced low-poly 3D prop)
// where <root> is the game's assets/ ("game", default) or ASSET_LIBRARY ("shared"). Narrow by
// design: those two media only, name slugified to [a-z0-9-], confined to the target folder,
// never clobbers. Sibling to level-write.js / transcript-write.js.
import { writeFileSync, mkdirSync, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { PROJECT_DIR, ASSET_LIBRARY, RES_ASSET_MOUNT } from "./config.js";

const PNG_MAX_BYTES = 5_000_000;
const GLB_MAX_BYTES = 25_000_000;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GLB_MAGIC = Buffer.from("glTF", "ascii"); // glTF-binary container magic

/** @param {string} s @returns {string} */
function slug(s) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "asset"
  );
}

/**
 * Route a decoded asset buffer to its destination by the sniffed file type: PNG →
 * <root>/textures/<slug>.png, GLB → <root>/models/<slug>.glb. `place` chooses the ROOT —
 * "game" (default) = the game's own assets/, "shared" = the external ASSET_LIBRARY mounted
 * at res://x-shared-assets. Suffixes -2, -3, … to avoid clobbering. The file type — not the
 * caller — decides the subdir, so a mismatched request can never put a GLB in textures/.
 * Returns a res://-relative path godot-dev can wire against (for "shared" that's the mount
 * path, never the external absolute path).
 * @param {string} name @param {Buffer} buf @param {"game"|"shared"} [place]
 * @returns {{ path: string } | { error: string }}
 */
function writeBuffer(name, buf, place = "game") {
  /** @type {{ subdir: string, ext: string } | null} */
  let kind = null;
  if (buf.subarray(0, 8).equals(PNG_MAGIC)) {
    if (buf.length > PNG_MAX_BYTES) return { error: "PNG too large (max 5 MB)" };
    kind = { subdir: "textures", ext: "png" };
  } else if (buf.subarray(0, 4).equals(GLB_MAGIC)) {
    if (buf.length > GLB_MAX_BYTES) return { error: "model too large (max 25 MB)" };
    kind = { subdir: "models", ext: "glb" };
  }
  if (!kind) {
    return { error: "unsupported file — provide a .png texture or a .glb (glTF-binary) model" };
  }

  const shared = place === "shared";
  const dir = shared
    ? path.join(ASSET_LIBRARY, kind.subdir)
    : path.join(PROJECT_DIR, "assets", kind.subdir);
  const stem = slug(name);
  let file = path.join(dir, `${stem}.${kind.ext}`);
  if (!file.startsWith(dir + path.sep)) return { error: "invalid name" }; // defense in depth
  mkdirSync(dir, { recursive: true });
  let n = 2;
  while (existsSync(file)) file = path.join(dir, `${stem}-${n++}.${kind.ext}`);
  writeFileSync(file, buf);
  // A shared asset lives outside the game, so report its res:// mount path
  // (res://x-shared-assets/<subdir>/<file>) rather than leaking the external absolute path.
  const rel = shared
    ? path.join(RES_ASSET_MOUNT, kind.subdir, path.basename(file))
    : path.relative(PROJECT_DIR, file);
  return { path: rel };
}

/**
 * Decode a base64 data URL (the native-picker upload) and write it into assets/.
 * The data URL's MIME is ignored (browsers report .glb inconsistently) — only the
 * magic bytes decide the destination.
 * @param {string} name @param {string} dataUrl @param {"game"|"shared"} [place]
 * @returns {{ path: string } | { error: string }}
 */
export function writeAsset(name, dataUrl, place = "game") {
  const m = /^data:[^;,]*;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? "");
  if (!m) return { error: "upload a base64 data URL (.png texture or .glb model)" };
  return writeBuffer(name, Buffer.from(m[1] ?? "", "base64"), place);
}

/**
 * Read a local file the user picked or named (a leading ~ expands to home) and copy
 * it into assets/. Reading an arbitrary local path is fine for this single-user local
 * dev tool; the DESTINATION stays confined to assets/ (writeBuffer's guard). The
 * coarse pre-read cap avoids slurping a huge non-asset file before writeBuffer's
 * precise per-type cap rejects it.
 * @param {string} name @param {string} srcPath @param {"game"|"shared"} [place]
 * @returns {{ path: string } | { error: string }}
 */
export function writeAssetFromPath(name, srcPath, place = "game") {
  const raw = (srcPath ?? "").trim();
  if (!raw) return { error: "enter a local file path (.png texture or .glb model)" };
  const expanded = raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw;
  const abs = path.resolve(expanded);
  /** @type {import("node:fs").Stats} */
  let st;
  try {
    st = statSync(abs);
  } catch {
    return { error: `no file at ${raw}` };
  }
  if (!st.isFile()) return { error: `not a file: ${raw}` };
  if (st.size > GLB_MAX_BYTES) return { error: "file too large (max 25 MB)" };
  return writeBuffer(name, readFileSync(abs), place);
}
