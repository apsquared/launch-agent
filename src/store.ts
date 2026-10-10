import { createHash } from "node:crypto";
import { badgeFormat } from "./badge-output.js";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { BATCHES_DIR, CONFIG_FILE, PLATFORMS_DIR, POLICY_FILE, SITE_NOTES_DIR, TRACKER_DIR, WORKSPACE, productDir } from "./paths.js";
import {
  BatchSchema, ConfigSchema, CopyBankSchema, PlatformSchema, PolicySchema, ProductSchema, TERMINAL_STATES, TrackerSchema,
  type BadgeFormat, type Batch, type Config, type CopyBank, type Platform, type Policy, type ProductSettings, type State, type Tracker, type TrackerRecord,
} from "./schemas.js";

function readYaml(file: string): unknown { return YAML.parse(fs.readFileSync(file, "utf8")); }

function writeAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

export function loadPolicy(): Policy { return PolicySchema.parse(readYaml(POLICY_FILE)); }

export function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_FILE)) throw new Error(`No workspace config at ${CONFIG_FILE}. Copy examples/workspace to ${WORKSPACE} and edit it, or set LAUNCH_AGENT_WORKSPACE.`);
  return ConfigSchema.parse(readYaml(CONFIG_FILE));
}

/** The --product a command was given, else the workspace default. */
export function resolveProduct(flag: string | undefined): string {
  const product = flag ?? loadConfig().default_product;
  if (!product) throw new Error("--product is required (no default_product in the workspace config)");
  return product;
}

export function platformFile(slug: string): string { return path.join(PLATFORMS_DIR, `${slug}.yaml`); }

export function loadPlatform(slug: string): Platform { return PlatformSchema.parse(readYaml(platformFile(slug))); }

export function loadPlatforms(): Platform[] {
  return fs.readdirSync(PLATFORMS_DIR).filter((f) => f.endsWith(".yaml")).sort()
    .map((f) => PlatformSchema.parse(readYaml(path.join(PLATFORMS_DIR, f))));
}

/** Site lessons this operator's runs learned. Kept out of platforms/ so pulls never conflict; promote good ones upstream by hand. */
function siteNotesFile(slug: string): string { return path.join(SITE_NOTES_DIR, `${slug}.md`); }

export function loadSiteNotes(slug: string): string | null {
  const file = siteNotesFile(slug);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() || null : null;
}

export function appendSiteNote(slug: string, line: string): void {
  const text = [loadSiteNotes(slug), line].filter(Boolean).join("\n").slice(-3900);
  writeAtomic(siteNotesFile(slug), `${text}\n`);
}

export function loadProduct(product: string): ProductSettings {
  return ProductSchema.parse(readYaml(path.join(productDir(product), "product.yaml")));
}

/** Where and how badges:sync writes this product's badge list, or null when badges are off. */
export function badgeOutput(product: string): { file: string; format: BadgeFormat } | null {
  const { badges } = loadProduct(product);
  if (!badges.enabled) return null;
  const file = path.resolve(productDir(product), badges.output_file ?? "badges.html");
  return { file, format: badgeFormat(file, badges.format) };
}

/** The owner's instructions for one directory, if any. */
export function platformInstructions(product: string, platform: string): string | null {
  return loadProduct(product).platforms[platform]?.instructions?.trim() || null;
}

export function loadCopyBank(product: string): CopyBank {
  return CopyBankSchema.parse(readYaml(path.join(productDir(product), "copy-bank.yaml")));
}

/** Template text still in the copy bank ("TODO ..."). Nothing with a placeholder may be approved. */
export function copyBankPlaceholders(bank: CopyBank): string[] {
  const values = [...Object.entries(bank.strings).flatMap(([k, vs]) => vs.map((v) => [k, v] as const)),
    ...Object.entries(bank.choices).flatMap(([k, vs]) => vs.map((v) => [`choices.${k}`, v] as const))];
  return values.filter(([, v]) => /\bTODO\b/.test(v)).map(([k, v]) => `${k}: ${v}`);
}

/** The refs (strings.x, choices.x, assets.x) a copy bank has no real value for: absent, empty or only TODO. */
export function missingFromCopyBank(bank: CopyBank, refs: readonly string[]): string[] {
  return refs.filter((ref) => {
    const [section, key] = ref.split(".") as [string, string];
    if (section === "assets") return !bank.assets[key];
    const values = section === "strings" ? bank.strings[key] : (bank.choices as Record<string, string[] | undefined>)[key];
    return !values?.some((v) => v.trim() && !/\bTODO\b/.test(v));
  });
}

export function assetPath(product: string, bank: CopyBank, key: string): string {
  const rel = bank.assets[key];
  if (!rel) throw new Error(`unknown asset "${key}"`);
  return path.join(productDir(product), rel);
}

/**
 * What an approval covers: the exact copy bank text, every asset's bytes, and the owner's
 * per-directory instructions. If any of it changes after approval, the fingerprint no longer
 * matches and the runner refuses the batch. (Fit ratings and badge settings are not covered.)
 */
export function approvalFingerprint(product: string): string {
  const bank = loadCopyBank(product);
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(path.join(productDir(product), "copy-bank.yaml")));
  for (const key of Object.keys(bank.assets).sort()) {
    hash.update(key);
    hash.update(fs.readFileSync(assetPath(product, bank, key)));
  }
  // Only directories with instructions add to the hash, so a product without any keeps its fingerprint.
  const { platforms } = loadProduct(product);
  for (const slug of Object.keys(platforms).sort()) {
    const text = platformInstructions(product, slug);
    if (text) hash.update(`instructions:${slug}\n${text}`);
  }
  return hash.digest("hex");
}

/** An approved batch whose copy bank, assets or instructions changed since; runs refuse it until it is approved again. */
export function approvalIsStale(batch: Batch): boolean {
  return batch.status === "approved" && batch.approval_fingerprint !== approvalFingerprint(batch.product);
}

/** Items worth attempting now. waiting_badge retries only once the badge has shipped (see pass.ts). */
export function pendingItems(batch: Batch, retryWaiting: boolean, tracker: Tracker = loadTracker(batch.product)): string[] {
  return batch.items.map((i) => i.platform).filter((slug) => {
    const r = tracker.records[slug];
    if (!r) return true;
    if (TERMINAL_STATES.has(r.state)) return false;
    if (r.state === "waiting_badge") return retryWaiting;
    if (r.state === "prepared_needs_human" || r.state === "blocked" || r.state === "unavailable") return false; // needs a person or a new batch
    return r.attempts < 3;
  });
}

export function batchFile(id: string): string { return path.join(BATCHES_DIR, `${id}.yaml`); }

export function loadBatch(id: string): Batch { return BatchSchema.parse(readYaml(batchFile(id))); }

export function loadBatches(): Batch[] {
  if (!fs.existsSync(BATCHES_DIR)) return [];
  return fs.readdirSync(BATCHES_DIR).filter((f) => f.endsWith(".yaml")).sort()
    .map((f) => BatchSchema.parse(readYaml(path.join(BATCHES_DIR, f))));
}

export function saveBatch(batch: Batch): void {
  writeAtomic(batchFile(batch.id), YAML.stringify(BatchSchema.parse(batch), { lineWidth: 100 }));
}

function trackerFile(product: string): string { return path.join(TRACKER_DIR, `${product}.json`); }

export function loadTracker(product: string): Tracker {
  const file = trackerFile(product);
  if (!fs.existsSync(file)) return { product, records: {} };
  return TrackerSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function saveTracker(tracker: Tracker): void {
  writeAtomic(trackerFile(tracker.product), `${JSON.stringify(TrackerSchema.parse(tracker), null, 2)}\n`);
}

export function emptyRecord(platform: string, batchId: string | null): TrackerRecord {
  return {
    platform, state: "planned", batch_id: batchId, updated_at: new Date().toISOString(), public_url: null,
    verified_live_at: null, note: "", needs_human: null, notes: null, attempts: 0, badge: null, link: null, evidence: [],
  };
}

/** Read-modify-write one record. Callers never hold a tracker across an await. */
export function updateRecord(product: string, platform: string, fn: (r: TrackerRecord) => TrackerRecord): TrackerRecord {
  const tracker = loadTracker(product);
  const next = fn(tracker.records[platform] ?? emptyRecord(platform, null));
  next.updated_at = new Date().toISOString();
  tracker.records[platform] = next;
  saveTracker(tracker);
  return next;
}

/** Append a product-specific lesson. Leaves updated_at alone: run.ts reads that as "the agent recorded a result". */
export function appendProductNote(product: string, platform: string, line: string): void {
  const tracker = loadTracker(product);
  const r = tracker.records[platform] ?? emptyRecord(platform, null);
  tracker.records[platform] = { ...r, notes: [r.notes, line].filter(Boolean).join("\n").slice(-3900) };
  saveTracker(tracker);
}

export function stateOf(product: string, platform: string): State | null {
  return loadTracker(product).records[platform]?.state ?? null;
}
