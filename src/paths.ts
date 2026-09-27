import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The tool itself: code, prompts, the shared directory catalog and the shared safety policy. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PLATFORMS_DIR = path.join(ROOT, "platforms");
export const POLICY_FILE = path.join(ROOT, "policy.yaml");

/**
 * The operator's own data: config, products, batches, tracker, run logs and evidence. Never part of
 * the tool repo (`workspace/` is gitignored); point LAUNCH_AGENT_WORKSPACE elsewhere to keep it in
 * its own private repo.
 */
export const WORKSPACE = path.resolve(process.env.LAUNCH_AGENT_WORKSPACE ?? path.join(ROOT, "workspace"));

function within(dir: string, parent: string): boolean {
  const rel = path.relative(parent, dir);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Product data must never be committed with the tool. Inside the repo only `workspace/` is
 * gitignored, so any other in-repo location is refused; anywhere outside the repo is fine.
 */
export function workspaceProblem(workspace: string, root: string = ROOT): string | null {
  if (!within(workspace, root) || within(workspace, path.join(root, "workspace"))) return null;
  return `LAUNCH_AGENT_WORKSPACE (${workspace}) is inside the launch-agent repo, where it would be committed. Use ${path.join(root, "workspace")} (gitignored) or a directory outside the repo.`;
}
const problem = workspaceProblem(WORKSPACE);
if (problem) throw new Error(problem);
export const CONFIG_FILE = path.join(WORKSPACE, "config.yaml");
export const PRODUCTS_DIR = path.join(WORKSPACE, "products");
export const BATCHES_DIR = path.join(WORKSPACE, "batches");
export const TRACKER_DIR = path.join(WORKSPACE, "tracker");
/** Site lessons learned by this operator's runs, read alongside the catalog's own recipe. */
export const SITE_NOTES_DIR = path.join(WORKSPACE, "site-notes");
export const EVIDENCE_DIR = path.join(WORKSPACE, "evidence");
export const RUNS_DIR = path.join(WORKSPACE, ".runs");

/**
 * The dedicated Chrome profile lives outside the repo: it holds live Google session cookies and
 * must never be committed. One profile, used only for directory work, signed in as the launch
 * identity and nothing else.
 */
export const STATE_DIR = process.env.LAUNCH_AGENT_HOME ?? path.join(os.homedir(), ".launch-agent");
export const CHROME_PROFILE_DIR = path.join(STATE_DIR, "chrome-profile");
export const CHROME_BINARY = process.env.LAUNCH_AGENT_CHROME
  ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const CDP_PORT = Number(process.env.LAUNCH_AGENT_CDP_PORT ?? 9333);

export function productDir(product: string): string { return path.join(PRODUCTS_DIR, product); }

/** A command as the user runs it from the checkout. */
export function cmd(command: string, args = ""): string {
  return `npm run ${command}${args ? ` -- ${args}` : ""}`;
}
