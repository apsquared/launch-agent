/** Product data can't end up in the tool's git history. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILE, PRODUCTS_DIR, ROOT, workspaceProblem } from "./paths.js";
import { badgeOutput, loadConfig, loadCopyBank, loadProduct } from "./store.js";

// In-repo workspaces other than workspace/ are refused; outside the repo is fine.
assert.equal(workspaceProblem("/repo/workspace", "/repo"), null);
assert.equal(workspaceProblem("/repo/workspace/team-a", "/repo"), null);
assert.equal(workspaceProblem("/elsewhere/launch-data", "/repo"), null);
assert.equal(workspaceProblem("/repo-data", "/repo"), null);
assert.notEqual(workspaceProblem("/repo", "/repo"), null);
assert.notEqual(workspaceProblem("/repo/data", "/repo"), null);
assert.notEqual(workspaceProblem("/repo/examples/workspace", "/repo"), null);

// In a checkout, the default workspace and personal instructions are ignored and never tracked.
const git = (...args: string[]) => spawnSync("git", ["-C", ROOT, ...args], { encoding: "utf8" });
if (fs.existsSync(path.join(ROOT, ".git")) && git("--version").status === 0) {
  for (const p of ["workspace/config.yaml", "workspace/products/x/copy-bank.yaml", "CLAUDE.local.md", "AGENTS.local.md"]) {
    assert.equal(git("check-ignore", "-q", p).status, 0, `${p} is not gitignored`);
  }
  assert.equal(git("ls-files", "--", "workspace", "CLAUDE.local.md", "AGENTS.local.md").stdout.trim(), "", "workspace data or personal instructions are tracked by git");

  // Nothing identifying from this operator's workspace appears in a file that would be committed:
  // product names and domains, contact and launch emails, company and handle, copy-bank text, and
  // the paths badges are written to. Personal first and last names are left out (too common to match).
  // The project's own publisher (package.json's author and the GitHub owner) is public by design.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { author?: string; repository?: { url?: string } };
  const publisher = new Set([pkg.author, /github\.com\/([^/]+)\//.exec(pkg.repository?.url ?? "")?.[1]].filter(Boolean).map((v) => v!.toLowerCase()));
  // The README's "Results so far" names the maintainer's product on purpose. Only its name and
  // domain are exempt; its copy, emails and handles are still checked.
  const showcased = new Set(["buyercue", "buyercue.io"]);
  const markers = new Map<string, string>();
  const add = (value: string | null | undefined, why: string, min = 4) => {
    const v = value?.trim();
    if (v && v.length >= min && !/\bTODO\b/.test(v) && !/example\.(com|org|net)|^example$|^acme$/i.test(v) && !publisher.has(v.toLowerCase()) && !showcased.has(v.toLowerCase())) markers.set(v, why);
  };
  if (fs.existsSync(CONFIG_FILE)) add(loadConfig().launch_identity, "the launch identity");
  const products = fs.existsSync(PRODUCTS_DIR) ? fs.readdirSync(PRODUCTS_DIR).filter((d) => fs.existsSync(path.join(PRODUCTS_DIR, d, "copy-bank.yaml"))) : [];
  for (const product of products) {
    const bank = loadCopyBank(product);
    const s = bank.strings;
    for (const name of s.name ?? []) add(name, `${product}'s name`);
    for (const url of [...(s.url ?? []), loadProduct(product).badges.check_url ?? ""]) {
      try { add(new URL(url).hostname.replace(/^www\./, ""), `${product}'s domain`); } catch { /* not a URL */ }
    }
    for (const key of ["email", "company_name", "handle"]) for (const v of s[key] ?? []) add(v, `${product}'s ${key}`);
    for (const [key, values] of Object.entries(s)) if (!["name", "url", "first_name", "last_name"].includes(key)) for (const v of values) add(v, `${product}'s ${key} copy`, 20);
    const badges = badgeOutput(product);
    if (badges && path.isAbsolute(loadProduct(product).badges.output_file ?? "")) add(path.dirname(badges.file), `${product}'s badge output folder`);
  }
  if (markers.size) {
    const files = git("ls-files", "-z", "--cached", "--others", "--exclude-standard").stdout.split("\0").filter(Boolean);
    const found: string[] = [];
    for (const file of files) {
      const full = path.join(ROOT, file);
      const stat = fs.lstatSync(full, { throwIfNoEntry: false });
      if (!stat?.isFile() || stat.size > 2_000_000) continue;
      const text = fs.readFileSync(full, "utf8").toLowerCase();
      for (const [marker, why] of markers) if (text.includes(marker.toLowerCase())) found.push(`${file} contains ${why}: ${JSON.stringify(marker.slice(0, 60))}`);
    }
    assert.deepEqual(found, [], `workspace data would be committed:\n${found.join("\n")}`);
  }
}

console.log("privacy ok");
