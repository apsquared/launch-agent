/**
 * One (batch, directory) item's lifecycle in the runner (cli/run.ts): the task the submitting agent
 * gets, and what the tracker says when a session ends without recording a result.
 */
import { badgeCheckUrl } from "./production.js";
import type { Batch, Platform, TrackerRecord } from "./schemas.js";
import { hostMatches, hostOf } from "./guards.js";
import { loadPlatform, loadTracker, updateRecord } from "./store.js";

/** A retried item: its badge just went live (`badge`), or its live listing awaits the site's badge re-check (`recheck`). */
export type Retry = "badge" | "recheck" | null;

/**
 * A live listing whose link stays nofollow until the site sees our badge: its playbook advertises a
 * badge-conditional dofollow and this product captured the badge. Ranking offers don't count; already_listed
 * listings may not be ours to manage. Badge-only directories are the ones a re-check can still change.
 */
export function awaitsBadgeRecheck(r: TrackerRecord | undefined, p: Pick<Platform, "link" | "link_requirement">): boolean {
  return r?.state === "live" && !!r.public_url && !!r.badge && r.link?.follow === false && p.link === "dofollow" && p.link_requirement === "badge";
}

/** The user-turn task for the submitting agent. A retry means the runner confirmed the badge is live. */
export function itemTask(batch: Batch, slug: string, retry: Retry, publicUrl?: string | null): string {
  const name = loadPlatform(slug).name;
  if (retry === "recheck") {
    return `Re-check our ${name} (${slug}) badge for ${batch.product}, batch ${batch.id}. Begin with the status tool. The listing is already live at ${publicUrl}, but its link to us is still nofollow, and the runner just confirmed our ${slug} badge is live on ${badgeCheckUrl(batch.product)}. Do not submit again or change the listing. Find the site's badge or backlink verification (its dashboard, the listing's edit page), tick its confirmation checkboxes and click its verify or re-check button. Then record live with public_url ${publicUrl}, quoting what the site showed. If there is no such button, or the site's check fails, still record live and say so in the note.`;
  }
  return `Submit ${batch.product} to ${name} (${slug}) for batch ${batch.id}. Begin with the status tool.` + (retry === "badge"
    ? ` This is a badge retry: the runner just confirmed our ${slug} badge is live on ${badgeCheckUrl(batch.product)}. Go to the site's badge verification step, tick its confirmation checkboxes and click its verify button. Record waiting_badge again only if the site's own verification fails, quoting its message.`
    : "");
}

/**
 * After a session ends: if the agent never recorded, say so and put the item back where the next run
 * picks it up (waiting_badge stays waiting_badge: that item's work is done). A re-check never takes a
 * listing out of live: whatever the agent recorded, its words go in the note and `verify` decides the
 * link. Returns the record's state and whether the agent recorded it.
 */
export function settleItem(product: string, slug: string, opts: { before: string | undefined; retry: Retry; why: string }): { state: string; recorded: boolean; needsHuman: string | null } {
  const after = loadTracker(product).records[slug];
  const recorded = !!after && after.updated_at !== opts.before && after.state !== "planned";
  if (opts.retry === "recheck") {
    if (recorded && after.state === "live") return { state: after.state, recorded, needsHuman: null };
    const needsHuman = recorded ? after.needs_human : null;
    const note = recorded ? `badge re-check: ${after.state}: ${after.note}${needsHuman ? ` Needs you: ${needsHuman}` : ""}` : `badge re-check: ${opts.why}`;
    updateRecord(product, slug, (rec) => ({ ...rec, state: "live", needs_human: null, note }));
    return { state: "live", recorded, needsHuman };
  }
  if (!recorded) {
    const r = updateRecord(product, slug, (rec) => ({ ...rec, state: opts.retry === "badge" ? "waiting_badge" : "planned", note: opts.why }));
    return { state: r.state, recorded: false, needsHuman: null };
  }
  return { state: after.state, recorded: true, needsHuman: after.needs_human };
}

/** The item stopped for the owner on a Google sign-in page: the launch profile's session has expired. */
export function stoppedAtGoogleSignIn(r: TrackerRecord | undefined): boolean {
  return r?.state === "prepared_needs_human" && hostOf(r.evidence.at(-1)?.url ?? "") === "accounts.google.com";
}

/** Where the owner picks up an item: the page it stopped on if that is the directory's own, never a sign-in URL with Google's tokens in it. */
export function whereToAct(r: TrackerRecord, p: Pick<Platform, "domains" | "submit_url" | "home_url">): string {
  const last = r.evidence.at(-1)?.url;
  const host = last ? hostOf(last) : null;
  return last && host && hostMatches(host, p.domains) ? last : p.submit_url ?? p.home_url;
}
