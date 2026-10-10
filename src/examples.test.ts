/**
 * The shipped templates work: examples/workspace validates, and `init` produces a workspace that
 * validates. Both run in temp directories, never inside the repo.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "./paths.js";

const tsx = path.join(ROOT, "node_modules/.bin/tsx");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "launch-agent-test-"));
const run = (workspace: string, script: string, ...args: string[]) => {
  const res = spawnSync(tsx, [path.join(ROOT, script), ...args], { cwd: ROOT, encoding: "utf8", env: { ...process.env, LAUNCH_AGENT_WORKSPACE: workspace } });
  assert.equal(res.status, 0, `${script} ${args.join(" ")} failed in ${workspace}:\n${res.stdout}${res.stderr}`);
  return res.stdout;
};

try {
  const example = path.join(tmp, "example");
  fs.cpSync(path.join(ROOT, "examples/workspace"), example, { recursive: true });
  run(example, "src/schemas.test.ts");

  // Chat review must show all approved inputs without changing any workspace file.
  run(example, "src/cli/propose.ts", "--platforms", "tinylaunch", "--size", "1");
  const batchName = fs.readdirSync(path.join(example, "batches"))[0]!;
  const snapshot = (dir: string): Record<string, string> => Object.fromEntries(
    (fs.readdirSync(dir, { recursive: true }) as string[])
      .filter((entry) => fs.statSync(path.join(dir, entry)).isFile())
      .map((entry) => [entry, fs.readFileSync(path.join(dir, entry)).toString("base64")]),
  );
  const beforeReview = snapshot(example);
  const review = run(example, "src/cli/show.ts", batchName.replace(/\.yaml$/, ""));
  assert.match(review, /\(proposed\)/);
  assert.match(review, /Grants for every item/);
  assert.match(review, /TinyLaunch/);
  assert.match(review, /Copy bank: the only text/);
  assert.match(review, /Choices:/);
  assert.match(review, /Assets:/);
  assert.deepEqual(snapshot(example), beforeReview, "batch:show changed the workspace");

  // Re-proposing replaces the unapproved proposal ("remove X" is a re-propose with --exclude).
  const reproposed = run(example, "src/cli/propose.ts", "--platforms", "tinylaunch,uneed", "--exclude", "uneed", "--size", "5");
  assert.match(reproposed, /Replaced the unapproved proposal/);
  assert.match(reproposed, /uneed: removed by you/);
  const batches = fs.readdirSync(path.join(example, "batches"));
  assert.equal(batches.length, 1, "the earlier proposal was not replaced");
  const replaced = fs.readFileSync(path.join(example, "batches", batches[0]!), "utf8");
  assert.match(replaced, /platform: tinylaunch/);
  assert.doesNotMatch(replaced, /platform: uneed/);

  // Open-source-only directories need a confirmed license in product.yaml and a repo_url in the copy bank.
  const ossOnly = ["--platforms", "openalternative,opensourcestartups", "--size", "5"] as const;
  assert.match(run(example, "src/cli/propose.ts", ...ossOnly), /openalternative: open-source projects only, and no open_source_license/);
  const exampleProduct = path.join(example, "products/example/product.yaml");
  fs.writeFileSync(exampleProduct, fs.readFileSync(exampleProduct, "utf8").replace("open_source_license: null", "open_source_license: MIT"));
  assert.match(run(example, "src/cli/propose.ts", ...ossOnly), /opensourcestartups: open-source projects only, and the copy bank has no repo_url/);
  const exampleBank = path.join(example, "products/example/copy-bank.yaml");
  fs.writeFileSync(exampleBank, fs.readFileSync(exampleBank, "utf8").replace("  # repo_url:\n  #   - ", "  repo_url:\n    - "));
  const ossProposed = run(example, "src/cli/propose.ts", ...ossOnly);
  assert.match(ossProposed, /OpenAlternative/);
  assert.match(ossProposed, /Open Source Startups/);
  assert.doesNotMatch(ossProposed, /Not proposed/);

  // MCP-only directories are proposed only once product.yaml confirms an MCP server.
  const mcpOnly = ["--platforms", "mcpservers,mcp-directory", "--size", "5"] as const;
  const noMcp = run(example, "src/cli/propose.ts", ...mcpOnly);
  assert.match(noMcp, /mcpservers: MCP servers only, and product.yaml doesn't confirm one/);
  assert.match(noMcp, /mcp-directory: MCP servers only/);
  fs.writeFileSync(exampleProduct, fs.readFileSync(exampleProduct, "utf8").replace("mcp_server: false", "mcp_server: true"));
  assert.match(run(example, "src/cli/propose.ts", ...mcpOnly), /mcp-directory: the site won't take a listing without strings.mcp_repo_url/);
  fs.writeFileSync(exampleBank, fs.readFileSync(exampleBank, "utf8").replace("  # mcp_repo_url:\n  #   - ", "  mcp_repo_url:\n    - "));
  const mcpProposed = run(example, "src/cli/propose.ts", ...mcpOnly);
  assert.match(mcpProposed, /Awesome MCP Servers/);
  assert.match(mcpProposed, /MCP\.Directory/);
  assert.doesNotMatch(mcpProposed, /Not proposed/);

  // A product on a shared code host isn't proposed where the site needs its own domain.
  const ownDomain = ["--platforms", "buildhop,tinylaunch", "--size", "5"] as const;
  assert.doesNotMatch(run(example, "src/cli/propose.ts", ...ownDomain), /Not proposed/);
  const bankText = fs.readFileSync(exampleBank, "utf8");
  fs.writeFileSync(exampleBank, bankText.replace("  url:\n    - https://example.com", "  url:\n    - https://github.com/example/example"));
  const onGithub = run(example, "src/cli/propose.ts", ...ownDomain);
  assert.match(onGithub, /buildhop: needs the product on its own domain, and its url is on github\.com/);
  assert.match(onGithub, /TinyLaunch/);
  fs.writeFileSync(exampleBank, bankText);

  // With badges off, directories whose free listing needs their badge aren't proposed.
  const badgeRequired = ["--platforms", "tooldirs", "--size", "5"] as const;
  assert.match(run(example, "src/cli/propose.ts", ...badgeRequired), /ToolDirs/);
  fs.writeFileSync(exampleProduct, fs.readFileSync(exampleProduct, "utf8").replace("  enabled: true", "  enabled: false"));
  assert.match(run(example, "src/cli/propose.ts", ...badgeRequired), /tooldirs: the free listing needs the directory's badge on your site, and badges are off/);

  const fresh = path.join(tmp, "fresh");
  run(fresh, "src/cli/setup.ts", "alpha", "--name", "Alpha: Notes", "--url", "https://alpha.example", "--identity", "launch@example.com");
  run(fresh, "src/cli/setup.ts", "beta", "--name", "Beta", "--url", "https://beta.example");
  const out = run(fresh, "src/schemas.test.ts");
  assert.match(out, /2 product\(s\)/);

  // Per-directory instructions are covered by the approval fingerprint; fit ratings are not.
  const fingerprint = () => spawnSync(tsx, ["-e", 'import { approvalFingerprint } from "./src/store.ts"; console.log(approvalFingerprint("alpha"))'],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, LAUNCH_AGENT_WORKSPACE: fresh } }).stdout.trim();
  const productFile = path.join(fresh, "products/alpha/product.yaml");
  const original = fs.readFileSync(productFile, "utf8");
  const base = fingerprint();
  assert.match(base, /^[0-9a-f]{64}$/, "could not compute the approval fingerprint");
  fs.writeFileSync(productFile, original.replace(/^platforms:$/m, "platforms:\n  tinylaunch: { fit: strong }"));
  assert.equal(fingerprint(), base, "a fit rating changed the approval fingerprint");
  fs.writeFileSync(productFile, original.replace(/^platforms:$/m, 'platforms:\n  tinylaunch: { fit: strong, instructions: "Use the dark badge." }'));
  assert.notEqual(fingerprint(), base, "instructions did not change the approval fingerprint");
  // Copy drafting: copy:sources bundles a repo (filtered), copy:apply writes the draft into the copy bank.
  const repo = path.join(tmp, "alpha-repo");
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, "README.md"), "# Alpha Notes\n\nAlpha turns meeting recordings into searchable notes for small teams. Upload a recording or connect your calendar, and every meeting gets a transcript, a summary and the decisions made, searchable across your whole team.");
  fs.writeFileSync(path.join(repo, ".env"), "OPENAI_API_KEY=" + "sk-" + "abcdefghijklmnopqrstuvwxyz123456");
  run(fresh, "src/cli/copy-sources.ts", "--product", "alpha", "--from", repo, "--no-site");
  const bundle = fs.readFileSync(path.join(fresh, ".runs/copy-sources-alpha.md"), "utf8");
  assert.match(bundle, /searchable notes/);
  assert.doesNotMatch(bundle, /sk-abc|OPENAI/);
  const bankFile = path.join(fresh, "products/alpha/copy-bank.yaml");
  const bankBefore = fs.readFileSync(bankFile, "utf8");
  const v = (text: string) => [text];
  fs.writeFileSync(path.join(fresh, ".runs/copy-draft-alpha.json"), JSON.stringify({
    strings: { tagline: ["Searchable meeting notes", "Meeting recordings, turned into searchable notes"], short_description: v("Alpha turns meeting recordings into searchable notes for small teams."),
      description: v("d".repeat(520)), long_description: v(Array(230).fill("word").join(" ")), target_audience: v("Small teams"), use_case: v("Find what was decided in a meeting."),
      features: v("Transcripts, summaries and search."), feature_1: v("Searchable transcripts"), feature_2: v("Meeting summaries"), feature_3: v("Search across meetings"), pricing_text: v("TODO pricing"), launch_comment: v("I built Alpha to stop rewatching meetings.") },
    choices: { categories: ["Productivity"], tags: ["meetings"], pricing_models: ["Freemium"], alternatives_to: [], platforms: ["Web"] },
  }));
  assert.match(run(fresh, "src/cli/copy-apply.ts", "--product", "alpha", "--dry-run"), /Would write: strings\.tagline/);
  assert.equal(fs.readFileSync(bankFile, "utf8"), bankBefore, "copy:apply --dry-run changed the copy bank");
  const applied = run(fresh, "src/cli/copy-apply.ts", "--product", "alpha");
  assert.match(applied, /Still TODO[\s\S]*pricing_text: TODO pricing/);
  const bankAfter = fs.readFileSync(bankFile, "utf8");
  assert.match(bankAfter, new RegExp(`^# Drafted from ${repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} on `));
  assert.match(bankAfter, /- Searchable meeting notes/);
  assert.equal(fs.readFileSync(`${bankFile}.bak`, "utf8"), bankBefore);
  assert.match(run(fresh, "src/cli/copy-apply.ts", "--product", "alpha"), /Nothing written/);

  // mark records what the owner decided about a directory.
  fs.mkdirSync(path.join(fresh, "tracker"), { recursive: true });
  fs.writeFileSync(path.join(fresh, "tracker/alpha.json"), JSON.stringify({ product: "alpha", records: { tinylaunch: {
    platform: "tinylaunch", state: "prepared_needs_human", batch_id: "b1", updated_at: new Date().toISOString(), public_url: null, verified_live_at: null,
    note: "captcha", needs_human: "Solve the CAPTCHA", notes: null, attempts: 3, badge: null, evidence: [] } } }));
  assert.match(run(fresh, "src/cli/mark.ts", "tinylaunch", "not_a_fit", "--product", "alpha"), /prepared_needs_human → not_a_fit \(cleared: Solve the CAPTCHA\)/);
  assert.match(run(fresh, "src/cli/mark.ts", "tinylaunch", "planned", "--product", "alpha"), /not_a_fit → planned/);

  console.log("examples ok (template workspace, two products from setup, copy and mark commands)");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
