/**
 * Every shared file parses, the policy cannot be flipped to allow payments, and the workspace in
 * LAUNCH_AGENT_WORKSPACE (default ./workspace) is consistent. A missing workspace is skipped.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PRODUCTS_DIR, WORKSPACE } from "./paths.js";
import { PlatformSchema, PolicySchema } from "./schemas.js";
import { approvalFingerprint, loadBatches, loadConfig, loadCopyBank, loadPlatforms, loadPolicy, loadProduct, loadTracker } from "./store.js";

const policy = loadPolicy();
assert.equal(PolicySchema.safeParse({ ...policy, allow_payments: true }).success, false);

const platforms = loadPlatforms();
for (const p of platforms) assert.ok(p.domains.every((d) => new URL(p.home_url).hostname.endsWith(d) || p.home_url.includes(d)), `${p.slug}: home_url outside its domains`);
const slugs = new Set(platforms.map((p) => p.slug));
// requires names real copy-bank places, so a typo can't silently never match.
const withRequires = (requires: string[]) => PlatformSchema.safeParse({ ...platforms[0], requires }).success;
assert.ok(withRequires(["choices.tech_stack", "strings.repo_url", "assets.logo"]));
for (const bad of ["choices.stack", "tech_stack", "strings.Repo", "copy.name"]) assert.equal(withRequires([bad]), false, bad);

if (!fs.existsSync(WORKSPACE)) {
  console.log(`files ok (${platforms.length} platforms; no workspace at ${WORKSPACE})`);
  process.exit(0);
}

const config = loadConfig();
const products = fs.existsSync(PRODUCTS_DIR) ? fs.readdirSync(PRODUCTS_DIR).filter((d) => !d.startsWith(".")) : [];
if (config.default_product) assert.ok(products.includes(config.default_product), `default_product ${config.default_product} has no products/ directory`);
for (const product of products) {
  const settings = loadProduct(product);
  assert.equal(settings.product, product, `${product}/product.yaml names ${settings.product}`);
  for (const slug of Object.keys(settings.platforms)) assert.ok(slugs.has(slug), `${product}: fit for unknown platform ${slug}`);
  const bank = loadCopyBank(product);
  for (const [key, rel] of Object.entries(bank.assets)) assert.ok(fs.existsSync(path.join(PRODUCTS_DIR, product, rel)), `${product}: asset ${key} missing`);
  approvalFingerprint(product);
  loadTracker(product);
}

for (const b of loadBatches()) for (const i of b.items) assert.ok(slugs.has(i.platform), `${b.id}: unknown platform ${i.platform}`);

console.log(`files ok (${platforms.length} platforms; workspace ${path.relative(process.cwd(), WORKSPACE) || "."}: ${products.length} product(s))`);
