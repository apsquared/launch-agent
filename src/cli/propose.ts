/**
 * Propose the next batch for approval (step 5 of the promote workflow). Proposing never submits
 * anything. A new proposal replaces the product's earlier unapproved one, so "remove X" is a re-propose.
 *
 *   npm run batch:propose [-- --product <slug>] [--size 10] [--platforms saashub,uneed] [--exclude devhunt,fazier]
 */
import fs from "node:fs";
import { parseArgs } from "node:util";
import type { Batch, Platform } from "../schemas.js";
import { batchFile, copyBankPlaceholders, loadBatches, loadCopyBank, missingFromCopyBank, loadPlatforms, loadProduct, loadTracker, resolveProduct, saveBatch } from "../store.js";
import { renderBatch } from "./render.js";
import { cmd } from "../paths.js";

const { values } = parseArgs({ options: { product: { type: "string" }, size: { type: "string", default: "10" }, platforms: { type: "string" }, exclude: { type: "string" } } });
const product = resolveProduct(values.product);
const settings = loadProduct(product);
const size = Number(values.size);

// Unrated directories come after rated ones, so a new product still gets a batch to review. Within
// a fit, wider-reach sites go first, then ones whose listings are known to give a followed link.
const FIT_ORDER = { strong: 0, ok: 1, unrated: 2, weak: 3, none: 4 } as const;
const LINK_ORDER = { dofollow: 0, unknown: 1, nofollow: 2 } as const;
const fitOf = (p: Platform) => settings.platforms[p.slug]?.fit ?? "unrated";
const tracker = loadTracker(product);
const bank = loadCopyBank(product);
const hasRepoUrl = (bank.strings.repo_url ?? []).some((v) => !/\bTODO\b/.test(v));
// Unapproved proposals are drafts: this one replaces them. Approved batches keep their directories.
const drafts = loadBatches().filter((b) => b.product === product && b.status === "proposed");
const inOpenBatch = new Set(loadBatches().filter((b) => b.product === product && b.status === "approved").flatMap((b) => b.items.map((i) => i.platform)));

function eligible(p: Platform): string | null {
  if (p.mode !== "auto") return "manual platform";
  const fit = fitOf(p);
  if (fit === "none" || fit === "weak") return `fit ${fit}${settings.platforms[p.slug]?.note ? `: ${settings.platforms[p.slug]!.note}` : ""}`;
  if (p.free_route === "no") return "no free route";
  if (p.open_source_only && !settings.open_source_license) return "open-source projects only, and no open_source_license is confirmed in product.yaml";
  if (p.open_source_only && !hasRepoUrl) return "open-source projects only, and the copy bank has no repo_url";
  if (p.mcp_only && !settings.mcp_server) return "MCP servers only, and product.yaml doesn't confirm one (mcp_server: true)";
  const missing = missingFromCopyBank(bank, p.requires);
  if (missing.length) return `the site won't take a listing without ${missing.join(", ")}, which the copy bank doesn't have yet`;
  if (p.auth === "password" || p.auth === "github") return `auth ${p.auth} is outside the Google identity`;
  if (tracker.records[p.slug] && tracker.records[p.slug]!.state !== "planned") return `already ${tracker.records[p.slug]!.state}`;
  if (inOpenBatch.has(p.slug)) return "already in an open batch";
  return null;
}

function risks(p: Platform): string[] {
  const r: string[] = [];
  if (fitOf(p) === "unrated") r.push(`fit not rated for ${product} (audience: ${p.audience}); rate it in product.yaml`);
  if (p.badge === "required") r.push(settings.badges.enabled ? "requires the directory's badge on your site" : "requires the directory's badge on your site, but badges are off for this product (product.yaml): expect it to stop there");
  if (p.auth === "unknown") r.push("sign-in method not yet observed");
  if (p.auth === "email_code") r.push("sign-in uses an emailed code the agent cannot type: sign the launch profile in by hand first");
  if (p.free_route === "unknown") r.push("free route not yet confirmed");
  if (p.queue_note) r.push(p.queue_note);
  r.push(...p.eligibility);
  return r;
}

const all = loadPlatforms();
const list = (v: string | undefined) => v?.split(",").map((s) => s.trim()).filter(Boolean);
const wanted = list(values.platforms);
const excluded = new Set(list(values.exclude) ?? []);
const skipped: string[] = [];
const picked = (wanted ? all.filter((p) => wanted.includes(p.slug)) : all)
  .filter((p) => { if (excluded.has(p.slug)) { skipped.push(`${p.slug}: removed by you`); return false; } return true; })
  .filter((p) => { const why = eligible(p); if (why) skipped.push(`${p.slug}: ${why}`); return !why; })
  .sort((a, b) => FIT_ORDER[fitOf(a)] - FIT_ORDER[fitOf(b)] || a.tier - b.tier || LINK_ORDER[a.link] - LINK_ORDER[b.link] || a.slug.localeCompare(b.slug))
  .slice(0, size);

if (!picked.length) { console.log("Nothing eligible.\n" + skipped.join("\n")); process.exit(0); }

const date = new Date().toISOString().slice(0, 10);
const seq = loadBatches().filter((b) => b.id.startsWith(`${date}-${product}`) && !drafts.some((d) => d.id === b.id)).length + 1;
for (const draft of drafts) fs.rmSync(batchFile(draft.id));
if (drafts.length) console.log(`Replaced the unapproved proposal ${drafts.map((d) => d.id).join(", ")}.\n`);
const batch: Batch = {
  id: `${date}-${product}-${String(seq).padStart(2, "0")}`,
  product,
  status: "proposed",
  created_at: new Date().toISOString(),
  approved_at: null,
  approved_by: null,
  approval_fingerprint: null,
  grants: { sign_in_with_google: true, accept_platform_terms: true, add_badge_to_footer: settings.badges.enabled, open_verification_emails: true },
  items: picked.map((p) => ({
    platform: p.slug, submit_url: p.submit_url, auth: p.auth, badge: p.badge,
    expected: p.category === "product-launch" ? "scheduled or submitted_pending_review" : "submitted_pending_review",
    risks: risks(p),
  })),
};
saveBatch(batch);
console.log(renderBatch(batch));
if (skipped.length) console.log(`\nNot proposed:\n${skipped.map((s) => `  - ${s}`).join("\n")}`);
const todo = copyBankPlaceholders(bank);
if (todo.length) console.log(`\n${todo.length} copy-bank value(s) still say TODO; batch:approve refuses until they are replaced.`);
console.log(`\nWrote ${batchFile(batch.id)}. Review, edit items if needed, then: ${cmd("batch:approve", batch.id)}`);
