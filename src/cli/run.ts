/**
 * Work through approved batches, one platform at a time, each in its own headless agent session
 * (config `agent`: claude or opencode) whose only tools are the guarded browser server.
 *
 *   npm run run                       # all approved batches, up to config max_items_per_run
 *   npm run run -- --product <slug>   # only that product's batches
 *   npm run run -- --batch <id>       # one batch
 *   npm run run -- --batch <id> --only saashub
 *   npm run run -- --max 5            # override max_items_per_run for this run
 *   npm run run -- --dry-run          # show what would run
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { AGENTS, agentInstalled } from "../agents/index.js";
import { runAgent, type AgentResult } from "../agents/spawn.js";
import { ensureChrome } from "../chrome.js";
import { ROOT, RUNS_DIR, WORKSPACE, cmd } from "../paths.js";
import { itemTask, settleItem } from "../item.js";
import { badgeCheckUrl, badgesMissingOnProduction } from "../production.js";
import type { Batch } from "../schemas.js";
import { approvalIsStale, loadBatch, loadBatches, loadConfig, loadCopyBank, loadPlatform, loadTracker, missingFromCopyBank, pendingItems, updateRecord } from "../store.js";

const { values } = parseArgs({ options: { product: { type: "string" }, batch: { type: "string" }, only: { type: "string" }, max: { type: "string" }, "dry-run": { type: "boolean" }, "retry-waiting": { type: "boolean" } } });
const config = loadConfig();

const backend = AGENTS[config.agent];

function runItem(batch: Batch, slug: string, badgeLive: boolean): Promise<AgentResult> {
  const runDir = path.join(RUNS_DIR, batch.id);
  fs.mkdirSync(runDir, { recursive: true });
  // The server needs the item and the workspace, plus any LAUNCH_AGENT_* overrides (Chrome path, port, profile).
  const passThrough = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[0].startsWith("LAUNCH_AGENT_") && e[1] !== undefined));
  const task = itemTask(batch, slug, badgeLive);
  return runAgent(backend, {
    runDir, item: slug, task,
    instructions: fs.readFileSync(path.join(ROOT, "prompts/submit.md"), "utf8"),
    mcp: {
      name: "launch",
      command: path.join(ROOT, "node_modules/.bin/tsx"),
      args: [path.join(ROOT, "src/mcp/server.ts")],
      env: { ...passThrough, LA_PRODUCT: batch.product, LA_PLATFORM: slug, LA_BATCH: batch.id, LAUNCH_AGENT_WORKSPACE: WORKSPACE, PATH: process.env.PATH ?? "" },
    },
    model: config.model,
  }, { timeoutMs: config.item_timeout_minutes * 60_000, transcript: path.join(runDir, `${slug}.transcript.jsonl`) });
}

async function main(): Promise<void> {
  const batches = (values.batch ? [loadBatch(values.batch)] : loadBatches()).filter((b) => b.status === "approved" && (!values.product || b.product === values.product));
  if (!batches.length) { console.log(`No approved batches. Propose one with \`${cmd("batch:propose")}\`, then approve it.`); return; }

  if (!values["dry-run"] && !agentInstalled(backend)) {
    console.error(`The ${backend.name} CLI (\`${backend.binary}\`) is not installed or not working. ${backend.setupHint}`);
    process.exitCode = 1;
    return;
  }

  let budget = values.max ? Math.min(Number(values.max), 10) : config.max_items_per_run;
  for (const batch of batches) {
    // A stale approval only matters while something is left to run; a finished batch just has nothing runnable.
    const open = pendingItems(batch, true);
    if (open.length && approvalIsStale(batch)) {
      console.error(`✗ ${batch.id}: the copy bank, assets or directory instructions changed after approval, and ${open.join(", ")} still to run. Re-run batch:approve.`);
      continue;
    }
    // --only also retries a waiting_badge item; either way it runs only once its own badge is on production.
    const candidates = pendingItems(batch, (values["retry-waiting"] ?? false) || !!values.only).filter((s) => !values.only || s === values.only);
    const tracker = loadTracker(batch.product);
    const waiting = candidates.map((s) => tracker.records[s]).filter((r) => r?.state === "waiting_badge" && r.badge);
    const notLive = new Set((await badgesMissingOnProduction(batch.product, waiting.map((r) => r!.badge!))).map((b) => b.platform));
    for (const slug of notLive) console.log(`  … ${slug}: badge not on ${badgeCheckUrl(batch.product) ?? "the product site (no badges.check_url)"} yet; skipping`);
    // A playbook pulled after approval may require a value this copy bank lacks: the item would only stop mid-form.
    const bank = loadCopyBank(batch.product);
    const unmet = new Map(candidates.map((s) => [s, missingFromCopyBank(bank, loadPlatform(s).requires)] as const).filter(([, m]) => m.length));
    for (const [slug, m] of unmet) console.log(`  … ${slug}: the site won't take a listing without ${m.join(", ")}; add it to the copy bank and re-approve ${batch.id}. Skipping`);
    const todo = candidates.filter((s) => !notLive.has(s) && !unmet.has(s));
    if (!todo.length) {
      const r = values.only ? loadTracker(batch.product).records[values.only] : undefined;
      console.log(values.only
        ? `Nothing to run for ${values.only} in ${batch.id}${r ? ` (state: ${r.state}, attempts: ${r.attempts})` : " (not in this batch)"}.`
        : `Nothing runnable in ${batch.id}.`);
    }
    for (const slug of todo) {
      if (budget <= 0) break;
      budget--;
      if (values["dry-run"]) { console.log(`would run ${batch.id} / ${slug}`); continue; }
      await ensureChrome();
      const badgeLive = tracker.records[slug]?.state === "waiting_badge";
      updateRecord(batch.product, slug, (r) => ({ ...r, batch_id: batch.id, attempts: r.attempts + 1 }));
      const before = loadTracker(batch.product).records[slug]?.updated_at;
      console.log(`→ ${batch.id} / ${slug}`);
      const { code, timedOut, stopped } = await runItem(batch, slug, badgeLive);
      if (stopped) {
        // The backend exposed or used a tool outside the launch server, or loaded the user's customizations: its setup is wrong, so stop the whole run.
        updateRecord(batch.product, slug, (r) => ({
          ...r, state: "prepared_needs_human", note: `run stopped by the watchdog: ${stopped}`,
          needs_human: `The ${backend.name} agent was not locked down to the launch server (${stopped}). Fix its setup, then set this item back to planned.`,
        }));
        console.error(`  ✗ ${slug}: stopped: ${stopped}. No further items run until the ${backend.name} setup is fixed.`);
        return;
      }
      // The agent records through the MCP server. If it never did, say so rather than guessing.
      const result = settleItem(batch.product, slug, {
        before, badgeRetry: badgeLive,
        why: timedOut ? `run timed out after ${config.item_timeout_minutes} min without recording` : `agent exited (code ${code}) without recording`,
      });
      if (!result.recorded) console.log(`  ! ${slug}: no result recorded${timedOut ? " (timeout)" : ""}; will retry next run (attempt cap 3)`);
      else console.log(`  = ${slug}: ${result.state}${result.needsHuman ? ` — needs you: ${result.needsHuman}` : ""}`);
    }
    if (pendingItems(batch, true).length === 0 && batch.items.every((i) => loadTracker(batch.product).records[i.platform])) {
      console.log(`  batch ${batch.id} has no runnable items left`);
    }
  }
}

await main();
