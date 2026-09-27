/**
 * One (batch, directory) item's lifecycle, shared by the headless runner (cli/run.ts) and watched
 * runs (cli/watch.ts): the task the submitting agent gets, and what the tracker says when a session
 * ends without recording a result.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { RUNS_DIR } from "./paths.js";
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

// ---------------------------------------------------------------------------------------------
// Watched runs: one item at a time, run by the launch-watched subagent in the owner's chat.
// ---------------------------------------------------------------------------------------------

/** A watched session older than this is abandoned: the server refuses it and watch:start replaces it. */
export const WATCHED_MAX_HOURS = 3;

export const WatchedSchema = z.strictObject({
  product: z.string(),
  platform: z.string(),
  batch: z.string(),
  badge_retry: z.boolean(),
  started_at: z.iso.datetime(),
  /** The tracker record's updated_at when the session started, to tell whether the agent recorded. */
  record_before: z.string().nullable(),
});
export type Watched = z.infer<typeof WatchedSchema>;

export function watchedFile(runsDir: string = RUNS_DIR): string { return path.join(runsDir, "watched.json"); }

export function readWatched(runsDir: string = RUNS_DIR): Watched | null {
  const file = watchedFile(runsDir);
  if (!fs.existsSync(file)) return null;
  return WatchedSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function watchedExpired(w: Watched, now: Date = new Date()): boolean {
  return now.getTime() - Date.parse(w.started_at) > WATCHED_MAX_HOURS * 3_600_000;
}

/** The item a watched launch server serves, or why it can't serve one. */
export function watchedItem(runsDir: string = RUNS_DIR, now: Date = new Date()): { product: string; platform: string; batch: string } {
  const w = readWatched(runsDir);
  if (!w) throw new Error("no watched run is active: start one with watch:start --batch <id> --only <directory>");
  if (watchedExpired(w, now)) throw new Error(`the watched run of ${w.platform} started ${w.started_at} and has expired; start it again with watch:start`);
  return { product: w.product, platform: w.platform, batch: w.batch };
}
