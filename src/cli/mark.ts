/**
 * Tell the tracker what the owner did, instead of hand-editing workspace/tracker/<product>.json.
 *
 *   npm run mark -- <directory> planned [--product <slug>]     # I did the step it needed; try it again
 *   npm run mark -- <directory> not_a_fit [--product <slug>]   # never propose or run it for this product
 *
 * `planned` clears the step the digest asked for and resets the attempt count, so the next pass (or a
 * watched run) picks the directory up again.
 */
import { parseArgs } from "node:util";
import { loadTracker, resolveProduct, updateRecord } from "../store.js";
import { cmd } from "../paths.js";

const MARKS = ["planned", "not_a_fit"] as const;
const { values, positionals } = parseArgs({ allowPositionals: true, options: { product: { type: "string" }, note: { type: "string" } } });
const [platform, state] = positionals;
if (!platform || !MARKS.includes(state as (typeof MARKS)[number])) {
  console.error(`usage: ${cmd("mark", `<directory> ${MARKS.join("|")} [--product <slug>] [--note "..."]`)}`);
  process.exit(1);
}
const product = resolveProduct(values.product);
const before = loadTracker(product).records[platform!];
if (!before) {
  console.error(`${platform} has no record for ${product}. It is planned already once a batch lists it.`);
  process.exit(1);
}
const after = updateRecord(product, platform!, (r) => ({
  ...r,
  state: state as (typeof MARKS)[number],
  needs_human: null,
  attempts: state === "planned" ? 0 : r.attempts,
  note: values.note ?? (state === "planned" ? `owner marked planned (was ${r.state})` : "owner marked not a fit"),
}));
console.log(`${product} / ${platform}: ${before.state} → ${after.state}${before.needs_human ? ` (cleared: ${before.needs_human})` : ""}`);
