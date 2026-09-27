/**
 * One (batch, directory) item's lifecycle in the runner (cli/run.ts): the task the submitting agent
 * gets, and what the tracker says when a session ends without recording a result.
 */
import { badgeCheckUrl } from "./production.js";
import type { Batch } from "./schemas.js";
import { loadPlatform, loadTracker, updateRecord } from "./store.js";

/** The user-turn task for the submitting agent. `badgeRetry`: the runner confirmed the badge is live. */
export function itemTask(batch: Batch, slug: string, badgeRetry: boolean): string {
  return `Submit ${batch.product} to ${loadPlatform(slug).name} (${slug}) for batch ${batch.id}. Begin with the status tool.` + (badgeRetry
    ? ` This is a badge retry: the runner just confirmed our ${slug} badge is live on ${badgeCheckUrl(batch.product)}. Go to the site's badge verification step, tick its confirmation checkboxes and click its verify button. Record waiting_badge again only if the site's own verification fails, quoting its message.`
    : "");
}

/**
 * After a session ends: if the agent never recorded, say so and put the item back where the next run
 * picks it up (waiting_badge stays waiting_badge: that item's work is done). Returns the record's
 * state and whether the agent recorded it.
 */
export function settleItem(product: string, slug: string, opts: { before: string | undefined; badgeRetry: boolean; why: string }): { state: string; recorded: boolean; needsHuman: string | null } {
  const after = loadTracker(product).records[slug];
  if (!after || after.updated_at === opts.before || after.state === "planned") {
    const r = updateRecord(product, slug, (rec) => ({ ...rec, state: opts.badgeRetry ? "waiting_badge" : "planned", note: opts.why }));
    return { state: r.state, recorded: false, needsHuman: null };
  }
  return { state: after.state, recorded: true, needsHuman: after.needs_human };
}
