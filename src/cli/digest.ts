/**
 * The morning summary: what moved, what is waiting on you, and what is parked behind a paywall.
 *
 *   npm run digest [-- --product <slug>] [--notify]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { RUNS_DIR, cmd } from "../paths.js";
import { badgesMissingOnProduction } from "../production.js";
import { CONFIRMED_STATES, STATES, type TrackerRecord } from "../schemas.js";
import { badgeOutput, loadPlatform, loadTracker, resolveProduct } from "../store.js";

const { values } = parseArgs({ options: { product: { type: "string" }, notify: { type: "boolean" } } });
const product = resolveProduct(values.product);
const records = Object.values(loadTracker(product).records);
const since = Date.now() - 24 * 3600_000;
const name = (r: TrackerRecord) => { try { return loadPlatform(r.platform).name; } catch { return r.platform; } };

const lines = [`# ${product} directory digest, ${new Date().toISOString().slice(0, 10)}`, ""];
const counts = STATES.map((s) => [s, records.filter((r) => r.state === s).length] as const).filter(([, n]) => n > 0);
lines.push(counts.map(([s, n]) => `${s}: ${n}`).join(" · ") || "No records yet.", "");

const confirmed = records.filter((r) => CONFIRMED_STATES.has(r.state)).length;
lines.push(`Confirmed submissions: ${confirmed}`, "");

const moved = records.filter((r) => Date.parse(r.updated_at) >= since && r.state !== "planned");
if (moved.length) {
  lines.push("## Last 24 hours", "");
  for (const r of moved) lines.push(`- **${name(r)}** → ${r.state}${r.public_url ? ` (${r.public_url})` : ""}: ${r.note}`);
  lines.push("");
}
const needs = records.filter((r) => r.state === "prepared_needs_human");
if (needs.length) {
  lines.push("## Needs you", "");
  for (const r of needs) lines.push(`- **${name(r)}**: ${r.needs_human} (${r.evidence.at(-1)?.url ?? loadPlatform(r.platform).home_url})`);
  lines.push("");
}
const waiting = records.filter((r) => r.state === "waiting_badge");
const notLive = new Set((await badgesMissingOnProduction(product, waiting.flatMap((r) => (r.badge ? [r.badge] : [])))).map((b) => b.platform));
const undeployed = waiting.filter((r) => !r.badge || notLive.has(r.platform));
const badgeFile = badgeOutput(product)?.file;
const deployed = waiting.filter((r) => !undeployed.includes(r));
if (undeployed.length) lines.push("## Waiting for the badge to deploy", "", ...undeployed.map((r) => `- ${name(r)}`), "", `Put the updated badge file${badgeFile ? ` (${badgeFile})` : ""} on your site: commit and deploy it, or paste it into your site builder. Then run \`${cmd("pass")}\`.`, "");
if (deployed.length) lines.push("## Badge live, site verification still to do", "", ...deployed.map((r) => `- ${name(r)}`), "", `The next \`${cmd("pass")}\` retries these and completes each site's badge verification.`, "");
const paid = records.filter((r) => r.state === "deferred_paid");
if (paid.length) lines.push("## Paid only (nothing bought)", "", ...paid.map((r) => `- ${name(r)}: ${r.note}`), "");

const text = lines.join("\n");
fs.mkdirSync(RUNS_DIR, { recursive: true });
const file = path.join(RUNS_DIR, `digest-${product}-${new Date().toISOString().slice(0, 10)}.md`);
fs.writeFileSync(file, text);
console.log(text);
if (values.notify && process.platform === "darwin") {
  const summary = `${moved.length} updated, ${needs.length} need you, ${confirmed} confirmed`;
  execFileSync("osascript", ["-e", `display notification ${JSON.stringify(summary)} with title "launch-agent: ${product}"`]);
}
