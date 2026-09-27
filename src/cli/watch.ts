/**
 * Watched runs: one directory submitted by the launch-watched Claude Code subagent while the owner
 * watches and does the steps it can't (CAPTCHAs, emailed codes, payment-page checkboxes). The
 * subagent has only the launch tools and starts its own launch server, which serves the item set up
 * here; everything the headless runner guarantees holds the same way. See the launch-watched skill.
 *
 *   npm run watch:start -- --batch <id> --only <directory>   # set up the item (checks, attempts, Chrome)
 *   npm run watch:finish                                     # after the subagent is done, or to give up
 *   npm run watch:agent [-- --user]                          # (re)write the subagent file
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { ensureChrome } from "../chrome.js";
import { itemTask, readWatched, settleItem, watchedExpired, watchedFile, type Watched } from "../item.js";
import { ROOT, RUNS_DIR, WORKSPACE } from "../paths.js";
import { badgeCheckUrl, badgesMissingOnProduction } from "../production.js";
import { TERMINAL_STATES } from "../schemas.js";
import { approvalFingerprint, loadBatch, loadPlatform, loadTracker, updateRecord } from "../store.js";
import { PROJECT_AGENT_FILE, WATCHED_AGENT, renderWatchedAgent } from "../watched-agent.js";

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({ args: rest, options: { batch: { type: "string" }, only: { type: "string" }, user: { type: "boolean" }, force: { type: "boolean" } } });
const fail = (msg: string): never => { console.error(msg); process.exit(1); };

async function start(): Promise<void> {
  const batchId = values.batch ?? fail("usage: watch:start --batch <id> --only <directory>");
  const slug = values.only ?? fail("usage: watch:start --batch <id> --only <directory>");
  const current = readWatched();
  if (current && !watchedExpired(current) && !values.force) {
    fail(`A watched run of ${current.platform} (${current.batch}) is already active since ${current.started_at}. Finish it with watch:finish first.`);
  }
  const batch = loadBatch(batchId);
  if (batch.status !== "approved") fail(`Batch ${batchId} is ${batch.status}, not approved. Review and approve it first.`);
  if (batch.approval_fingerprint !== approvalFingerprint(batch.product)) fail(`The copy bank, assets or directory instructions changed after ${batchId} was approved. Show and approve it again.`);
  if (!batch.items.some((i) => i.platform === slug)) fail(`${slug} is not in batch ${batchId}.`);
  if (loadPlatform(slug).mode !== "auto") fail(`${slug} is a manual directory: it is never submitted by the agent.`);

  // A watched run is how a person helps with a stuck item, so needs-human, blocked and exhausted items
  // may run again; finished ones may not.
  const record = loadTracker(batch.product).records[slug];
  if (record && TERMINAL_STATES.has(record.state)) fail(`${slug} is already ${record.state} for ${batch.product}; nothing to do.`);
  const badgeRetry = record?.state === "waiting_badge";
  if (badgeRetry && record.badge && (await badgesMissingOnProduction(batch.product, [record.badge])).length) {
    fail(`${slug} is waiting for its badge, which isn't on ${badgeCheckUrl(batch.product) ?? "the product site"} yet. Deploy the badge first.`);
  }

  await ensureChrome();
  const before = updateRecord(batch.product, slug, (r) => ({ ...r, batch_id: batch.id, attempts: r.attempts + 1 }));
  const watched: Watched = { product: batch.product, platform: slug, batch: batch.id, badge_retry: badgeRetry, started_at: new Date().toISOString(), record_before: before.updated_at };
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.writeFileSync(watchedFile(), `${JSON.stringify(watched, null, 2)}\n`);

  console.log(`Watched run ready: ${batch.product} → ${loadPlatform(slug).name} (${slug}), batch ${batch.id}.
The launch Chrome window is where it happens; the owner can watch it there.

Task for the ${WATCHED_AGENT} subagent:
${itemTask(batch, slug, badgeRetry)}

When the subagent is done (or to give up): watch:finish`);
}

function finish(): void {
  const w = readWatched() ?? fail("No watched run is active.");
  const result = settleItem(w.product, w.platform, { before: w.record_before ?? undefined, badgeRetry: w.badge_retry, why: "watched run ended without recording a result" });
  fs.rmSync(watchedFile(), { force: true });
  console.log(result.recorded
    ? `${w.product} / ${w.platform}: ${result.state}${result.needsHuman ? ` — needs you: ${result.needsHuman}` : ""}`
    : `${w.product} / ${w.platform}: nothing was recorded; it is ${result.state} again, for the next pass or another watched run.`);
}

function agent(): void {
  if (values.user) {
    const file = path.join(os.homedir(), ".claude/agents", `${WATCHED_AGENT}.md`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, renderWatchedAgent({ root: ROOT, workspace: WORKSPACE }));
    console.log(`Wrote ${file} (tool at ${ROOT}, workspace ${WORKSPACE}). Start a new Claude Code session to load it. Run this again after updating launch-agent.`);
  } else {
    fs.mkdirSync(path.dirname(PROJECT_AGENT_FILE), { recursive: true });
    fs.writeFileSync(PROJECT_AGENT_FILE, renderWatchedAgent(null));
    console.log(`Wrote ${path.relative(ROOT, PROJECT_AGENT_FILE)}.`);
  }
}

if (command === "start") await start();
else if (command === "finish") finish();
else if (command === "agent") agent();
else fail("usage: watch.ts start|finish|agent");
