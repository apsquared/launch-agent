/**
 * Tell the tracker what the owner did, instead of hand-editing workspace/tracker/<product>.json.
 *
 *   npm run mark -- <directory> planned [--product <slug>]     # I did the step it needed; try it again
 *   npm run mark -- <directory> not_a_fit [--product <slug>]   # never propose or run it for this product
 *   npm run mark -- <directory> submitted [--url <page>] [--product <slug>]   # I submitted it myself
 *   npm run mark -- <directory> live [--url <page>] [--product <slug>]        # my listing is public
 *
 * `planned` clears the step the digest asked for and resets the attempt count, so the next pass
 * picks the directory up again. `submitted` and `live` record a listing the owner made by hand
 * (a manual directory no batch lists, for example), so the digest counts it and proposals skip it;
 * with `--url`, `verify` re-checks that page.
 */
import fs from "node:fs";
import { parseArgs } from "node:util";
import { loadTracker, platformFile, resolveProduct, updateRecord } from "../store.js";
import { cmd } from "../paths.js";
import type { State } from "../schemas.js";

const MARKS: Record<string, State> = { planned: "planned", not_a_fit: "not_a_fit", submitted: "submitted_pending_review", live: "live" };
const { values, positionals } = parseArgs({ allowPositionals: true, options: { product: { type: "string" }, note: { type: "string" }, url: { type: "string" } } });
const [platform, mark] = positionals;
if (!platform || !mark || !Object.hasOwn(MARKS, mark)) {
  console.error(`usage: ${cmd("mark", `<directory> ${Object.keys(MARKS).join("|")} [--url <listing page>] [--product <slug>] [--note "..."]`)}`);
  process.exit(1);
}
const byHand = mark === "submitted" || mark === "live";
if (values.url && !byHand) { console.error("--url goes with submitted or live."); process.exit(1); }
if (values.url && !/^https?:\/\/\S+$/.test(values.url)) { console.error("--url must be the listing's http(s) page."); process.exit(1); }
const product = resolveProduct(values.product);
const before = loadTracker(product).records[platform];
if (!before && !byHand) {
  console.error(`${platform} has no record for ${product}. It is planned already once a batch lists it.`);
  process.exit(1);
}
if (!before && !fs.existsSync(platformFile(platform))) { // a listing made by hand still has to be a known directory
  console.error(`No directory called ${platform}: use a playbook slug from platforms/.`);
  process.exit(1);
}
const notes: Record<string, string> = {
  planned: `owner marked planned (was ${before?.state})`,
  not_a_fit: "owner marked not a fit",
  submitted: "owner submitted it by hand",
  live: "owner reported the listing live",
};
const after = updateRecord(product, platform, (r) => ({
  ...r,
  state: MARKS[mark]!,
  needs_human: null,
  attempts: mark === "planned" ? 0 : r.attempts,
  public_url: values.url ?? r.public_url,
  note: values.note ?? notes[mark]!,
}));
console.log(`${product} / ${platform}: ${before?.state ?? "no record"} → ${after.state}${byHand && after.public_url ? ` (${after.public_url})` : ""}${before?.needs_human ? ` (cleared: ${before.needs_human})` : ""}`);
