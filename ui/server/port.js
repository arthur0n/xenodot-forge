// Friendly port-conflict handling for `npm start`. The usual cause of EADDRINUSE on our port is a
// previous `npm start` you forgot to stop — so instead of crashing with an unhandled-error stack
// dump, we name the process holding the port and, when running interactively, ASK before stopping
// it (never kill behind your back). A non-interactive shell (piped / CI) prints guidance and exits.
// macOS/Linux only (uses `lsof`/`ps`); if those aren't available it degrades to "assume free" and
// the caller's listen-error handler prints a clean line.
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

/** PIDs LISTENing on TCP `port` (via lsof), de-duped; [] if none or lsof is unavailable.
 * @param {number} port @returns {number[]} */
export function listenersOnPort(port) {
  const r = spawnSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
  return [...new Set((r.stdout ?? "").split("\n").map((s) => Number(s.trim())))].filter(
    (n) => Number.isInteger(n) && n > 0,
  );
}

/** Best-effort one-line command for a PID, for naming what holds the port. @param {number} pid
 * @returns {string} */
function commandOf(pid) {
  const r = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  return (r.stdout ?? "").trim();
}

/** Resolve once nothing LISTENs on `port`, or after `timeoutMs`. @param {number} port
 * @param {number} timeoutMs @returns {Promise<void>} */
async function waitForPortFree(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (listenersOnPort(port).length && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** Ask a y/N question on the terminal; true only on an explicit yes. @param {string} q
 * @returns {Promise<boolean>} */
async function askYesNo(q) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const a = (await rl.question(q)).trim().toLowerCase();
    return a === "y" || a === "yes";
  } finally {
    rl.close();
  }
}

/** Make `port` available for the UI server. Free → returns at once. Held → names the process and,
 * interactively, offers to stop it (SIGTERM) then waits for the port to clear; declining, a
 * non-TTY shell, or a port that won't free prints guidance and exits. Call BEFORE server.listen.
 * @param {number} port @returns {Promise<void>} */
export async function reclaimPortIfBusy(port) {
  const pids = listenersOnPort(port);
  if (!pids.length) return;
  const who = pids
    .map((p) => (commandOf(p) ? `PID ${p} (${commandOf(p)})` : `PID ${p}`))
    .join(", ");
  const elsewhere = `   Or start elsewhere:  PORT=<n> npm start`;
  console.error(`\n⚠  Port ${port} is already in use by ${who}.`);
  if (!stdin.isTTY) {
    console.error(`   Stop it first (it's likely a previous \`npm start\`).\n${elsewhere}`);
    process.exit(1);
  }
  if (!(await askYesNo(`   Stop it and start here? [y/N] `))) {
    console.error(`   Left it running.\n${elsewhere}`);
    process.exit(1);
  }
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone — fine */
    }
  }
  await waitForPortFree(port, 5000);
  if (listenersOnPort(port).length) {
    console.error(`   Port ${port} is still busy — stop ${pids.join(", ")} manually. Aborting.`);
    process.exit(1);
  }
  console.error(`   Stopped ${pids.join(", ")}. Starting…\n`);
}
