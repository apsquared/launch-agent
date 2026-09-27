/**
 * Write captured directory badges to the product's badge file (product.yaml badges.output_file,
 * as HTML, JSON or a TS module), and optionally check whether the live site already shows them.
 * Putting the file on the site (commit and deploy, or paste into a site builder) stays with the owner.
 *
 *   npm run badges:sync [-- --product <slug>] [--check-production]
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { renderBadges } from "../badge-output.js";
import { badgesMissingOnProduction } from "../production.js";
import type { Badge } from "../schemas.js";
import { badgeOutput, loadPlatforms, loadTracker, resolveProduct } from "../store.js";

const { values } = parseArgs({ options: { product: { type: "string" }, "check-production": { type: "boolean" } } });
const product = resolveProduct(values.product);
const output = badgeOutput(product);
if (!output) { console.log(`Badges are off for ${product} (badges.enabled in product.yaml).`); process.exit(0); }

const DROP = new Set(["not_a_fit", "deferred_paid", "blocked", "unavailable"]);
const badges: Badge[] = Object.values(loadTracker(product).records)
  .filter((r) => r.badge && !DROP.has(r.state))
  .map((r) => r.badge!)
  .sort((a, b) => a.platform.localeCompare(b.platform));
const names = Object.fromEntries(loadPlatforms().map((p) => [p.slug, p.name]));
const body = renderBadges(output.format, badges, names);

const { file, format } = output;
const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
if (before === body) console.log(`Badges unchanged (${badges.length}, ${format}).`);
else {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  console.log(`Wrote ${badges.length} badge(s) as ${format} to ${file}. Put it on your site (commit and deploy, or paste it into your site builder) to publish them.`);
}

/** Exit 0 when production shows every badge, 3 otherwise. Informational; run.ts checks each waiting item itself. */
if (values["check-production"] && badges.length) {
  const missing = await badgesMissingOnProduction(product, badges);
  if (missing.length) { console.log(`Not yet on production: ${missing.map((b) => b.platform).join(", ")}`); process.exit(3); }
  console.log("All badges are live on production.");
}
