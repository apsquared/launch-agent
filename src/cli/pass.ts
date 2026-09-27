/**
 * One on-demand pass, started when the owner asks for it: sync and check badges, retry
 * waiting_badge items whose badge is live, work through approved batches, verify live
 * listings, write a digest per product. Nothing here is scheduled.
 *
 *   npm run pass                        # every product with an approved batch; config max_items_per_run directories in total
 *   npm run pass -- --product <slug>    # one product
 *   npm run pass -- --max 5
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { parseArgs } from "node:util";
import { ROOT, cmd } from "../paths.js";
import { loadBatch, loadBatches } from "../store.js";

const { values } = parseArgs({ options: { product: { type: "string" }, max: { type: "string" }, batch: { type: "string" } } });
const products = values.product ? [values.product]
  : values.batch ? [loadBatch(values.batch).product]
  : [...new Set(loadBatches().filter((b) => b.status === "approved").map((b) => b.product))].sort();
if (!products.length) { console.log(`No approved batches. Propose one with \`${cmd("batch:propose")}\`, then approve it.`); process.exit(0); }

const tsx = path.join(ROOT, "node_modules/.bin/tsx");
const step = (script: string, ...args: string[]) => spawnSync(tsx, [path.join(ROOT, "src/cli", script), ...args], { cwd: ROOT, stdio: "inherit" }).status;

for (const product of products) step("badges.ts", "--product", product, "--check-production");
// run.ts retries a waiting_badge item only once its own badge shows on production.
step("run.ts", "--retry-waiting",
  ...(values.product ? ["--product", values.product] : []),
  ...(values.max ? ["--max", values.max] : []),
  ...(values.batch ? ["--batch", values.batch] : []));
for (const product of products) {
  // Badges captured during this run go into the badge file now, so the digest's "waiting for the
  // badge to deploy" list can be deployed without another pass.
  step("badges.ts", "--product", product);
  step("verify.ts", "--product", product);
  step("digest.ts", "--product", product);
}
