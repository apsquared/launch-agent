/**
 * Check that everything a pass needs is in place, and say how to fix what isn't. Read-only: it
 * starts nothing and changes nothing.
 *
 *   npm run doctor
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { AGENTS, agentInstalled } from "../agents/index.js";
import { cdpAlive } from "../chrome.js";
import { DRAFT_CHOICE_KEYS, DRAFT_STRING_KEYS } from "../draft.js";
import { CDP_PORT, CHROME_BINARY, CHROME_PROFILE_DIR, CONFIG_FILE, PRODUCTS_DIR, ROOT, WORKSPACE, cmd, productDir } from "../paths.js";
import { WATCHED_AGENT, renderWatchedAgent } from "../watched-agent.js";
import { badgeOutput, copyBankPlaceholders, loadBatches, loadConfig, loadCopyBank, loadProduct } from "../store.js";

type Level = "ok" | "warn" | "fail";
const MARK: Record<Level, string> = { ok: "✓", warn: "!", fail: "✗" };
let failures = 0;
function check(level: Level, what: string, fix?: string): void {
  if (level === "fail") failures++;
  console.log(`${MARK[level]} ${what}${fix ? `\n    → ${fix}` : ""}`);
}
const errorLine = (err: unknown) => (err as Error).message.split("\n")[0];

// --- Tools ---
const major = Number(process.versions.node.split(".")[0]);
check(major >= 20 ? "ok" : "fail", `Node.js ${process.versions.node}`, major >= 20 ? undefined : "Install Node.js 20 or newer.");

// --- Workspace ---
const config = (() => {
  try { return loadConfig(); } catch (err) {
    check("fail", fs.existsSync(CONFIG_FILE) ? `Workspace config ${CONFIG_FILE} is invalid: ${errorLine(err)}` : `No workspace at ${WORKSPACE}`,
      fs.existsSync(CONFIG_FILE) ? "Fix the file; examples/workspace/config.yaml shows every field." : cmd("init", '<slug> --name "My Product" --url https://myproduct.com --identity <google account>'));
    return null;
  }
})();
if (config) check("ok", `Workspace ${WORKSPACE} (launch identity ${config.launch_identity})`);

// --- Agent backend ---
if (config) {
  const backend = AGENTS[config.agent];
  if (!agentInstalled(backend)) {
    check("fail", `Agent CLI \`${backend.binary}\` not found (agent: ${backend.name} in config.yaml)`, backend.setupHint);
  } else if (backend.name === "claude") {
    const status = spawnSync("claude", ["auth", "status", "--json"], { encoding: "utf8", timeout: 20_000 });
    const loggedIn = (() => { try { return JSON.parse(status.stdout).loggedIn === true; } catch { return null; } })();
    if (loggedIn === false) check("fail", "Claude Code is installed but not logged in", "Run `claude` once and log in.");
    else check("ok", `Claude Code${loggedIn ? ", logged in" : " (could not read its login status)"}${config.model ? `, model ${config.model}` : ""}`);
  } else {
    check(config.model ? "ok" : "warn", `OpenCode${config.model ? `, model ${config.model}` : ""}`,
      config.model ? undefined : "Set model: provider/model in config.yaml so runs don't depend on OpenCode's default.");
  }
}

// --- Chrome ---
const chromeFound = fs.existsSync(CHROME_BINARY);
check(chromeFound ? "ok" : "fail", `Chrome at ${CHROME_BINARY}`, chromeFound ? undefined : "Install Google Chrome, or set LAUNCH_AGENT_CHROME to its binary.");
const profileFound = fs.existsSync(path.join(CHROME_PROFILE_DIR, "Default"));
check(profileFound ? "ok" : "fail", profileFound ? `Launch Chrome profile at ${CHROME_PROFILE_DIR}` : "The launch Chrome profile has not been set up",
  profileFound ? undefined : `${cmd("chrome:login")}, sign in as ${config?.launch_identity ?? "your launch Google account"}, then quit that Chrome (Cmd+Q).`);

/** The pid in Chrome's SingletonLock ("host-pid"), when that process is still running. */
function profileOpenBy(): number | null {
  try {
    const pid = Number(fs.readlinkSync(path.join(CHROME_PROFILE_DIR, "SingletonLock")).split("-").pop());
    if (!pid) return null;
    process.kill(pid, 0);
    return pid;
  } catch { return null; }
}
const portInUse = () => new Promise<boolean>((resolve) => {
  const socket = net.connect({ port: CDP_PORT, host: "127.0.0.1" });
  socket.setTimeout(1500);
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => resolve(false));
  socket.once("timeout", () => { socket.destroy(); resolve(false); });
});
if (await cdpAlive()) {
  check("ok", `The launch Chrome is running with remote debugging on port ${CDP_PORT} (a run may be in progress; runs reuse it)`);
} else if (await portInUse()) {
  check("fail", `Port ${CDP_PORT} is taken by something other than the launch Chrome`, "Stop that process, or set LAUNCH_AGENT_CDP_PORT to a free port.");
} else if (profileFound && profileOpenBy() != null) {
  check("fail", "The launch Chrome profile is open without remote debugging (probably the chrome:login window)", "Quit that Chrome (Cmd+Q); runs start it again with debugging.");
}

// --- Watched runs (Claude Code) ---
// The plugin can't ship a subagent that starts its own MCP server, so watch:agent --user installs one
// pointing at this install. It goes stale when the plugin updates (its folder moves).
const userAgent = path.join(os.homedir(), ".claude/agents", `${WATCHED_AGENT}.md`);
const installedAsPlugin = ROOT.split(path.sep).join("/").includes("/.claude/plugins/");
if (fs.existsSync(userAgent)) {
  const current = fs.readFileSync(userAgent, "utf8") === renderWatchedAgent({ root: ROOT, workspace: WORKSPACE });
  check(current ? "ok" : "warn", current ? "Watched-run subagent installed" : `Watched-run subagent ${userAgent} is from another launch-agent install or version`,
    current ? undefined : `${cmd("watch:agent", "--user")}, then start a new Claude Code session.`);
} else if (installedAsPlugin) {
  check("warn", "Watched runs aren't set up (optional: lets you watch a submission and help with CAPTCHAs)", `${cmd("watch:agent", "--user")}, then start a new Claude Code session.`);
}

// --- Products ---
const products = fs.existsSync(PRODUCTS_DIR) ? fs.readdirSync(PRODUCTS_DIR).filter((d) => fs.existsSync(path.join(PRODUCTS_DIR, d, "copy-bank.yaml"))).sort() : [];
if (config && !products.length) check("fail", "No products in the workspace", cmd("init", '<slug> --name "My Product" --url https://myproduct.com'));
const batches = (() => { try { return loadBatches(); } catch (err) { check("fail", `A batch file is invalid: ${errorLine(err)}`); return []; } })();
for (const product of products) {
  const dir = productDir(product);
  const label = `${product}:`;
  let bank;
  try { bank = loadCopyBank(product); } catch (err) {
    check("fail", `${label} copy-bank.yaml is invalid: ${errorLine(err)}`, "Compare it with examples/workspace/products/example/copy-bank.yaml.");
    continue;
  }
  const todoKeys = [...new Set(copyBankPlaceholders(bank).map((t) => t.slice(0, t.indexOf(":"))))];
  const draftable = todoKeys.filter((k) => (DRAFT_STRING_KEYS as readonly string[]).includes(k) || (DRAFT_CHOICE_KEYS as readonly string[]).includes(k.replace(/^choices\./, "")));
  const byHand = todoKeys.filter((k) => !draftable.includes(k));
  check(todoKeys.length ? "warn" : "ok", todoKeys.length ? `${label} TODO left in the copy bank: ${todoKeys.join(", ")}` : `${label} copy bank filled in`,
    todoKeys.length ? [
      draftable.length && `Draft ${draftable.length === todoKeys.length ? "them" : `the ${draftable.length} descriptive ones`} with the copy-draft skill: ask your Claude Code or Codex chat to "draft my copy bank for ${product}".`,
      byHand.length && `Fill in ${byHand.join(", ")} by hand in ${path.join(dir, "copy-bank.yaml")} (or delete keys you won't share).`,
    ].filter(Boolean).join(" ") : undefined);

  const assets = Object.entries(bank.assets);
  const missing = assets.filter(([, rel]) => !fs.existsSync(path.join(dir, rel)));
  if (missing.length) check("fail", `${label} asset file(s) not found: ${missing.map(([k, rel]) => `${k} (${rel})`).join(", ")}`, `Put them under ${path.join(dir, "assets")} or fix the paths in copy-bank.yaml.`);
  else if (!bank.assets.logo) check("warn", `${label} no logo asset`, "Most directories require one: add a square PNG (512x512) and list it as logo: under assets:.");
  else check("ok", `${label} ${assets.length} asset(s)`);

  try {
    loadProduct(product);
    const out = badgeOutput(product);
    if (out && !fs.existsSync(path.dirname(out.file))) check("fail", `${label} badge output folder does not exist: ${path.dirname(out.file)}`, "Fix badges.output_file in product.yaml.");
  } catch (err) {
    check("fail", `${label} product.yaml is invalid: ${errorLine(err)}`);
  }

  const mine = batches.filter((b) => b.product === product);
  const approved = mine.filter((b) => b.status === "approved");
  if (approved.length) check("ok", `${label} approved batch ${approved.map((b) => b.id).join(", ")}`);
  else if (mine.some((b) => b.status === "proposed")) check("warn", `${label} a batch is proposed but not approved`, cmd("batch:approve", "<batch-id>"));
  else check("warn", `${label} no batch yet`, cmd("batch:propose", `--product ${product}`));
}

console.log(failures ? `\n${failures} problem(s) to fix before a pass.` : "\nReady for a pass.");
process.exit(failures ? 1 : 0);
