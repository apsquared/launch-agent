/**
 * Write a drafted copy into a product's copy bank: the last step of the copy-draft skill. Only keys
 * still holding template text are filled (unless --overwrite), every comment is kept, the previous
 * file is saved as copy-bank.yaml.bak, and the result must validate or nothing changes. Nothing is
 * approved or submitted.
 *
 *   npm run copy:apply                          # default product, workspace/.runs/copy-draft-<product>.json
 *   npm run copy:apply -- --product <slug> [--draft <file.json>]
 *   npm run copy:apply -- --dry-run             # check the draft and show what would change
 *   npm run copy:apply -- --overwrite           # also replace values the owner already filled in
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { applyDraft, bundleLabel, draftWarnings, parseDraft, type Draft } from "../draft.js";
import { RUNS_DIR, cmd, productDir } from "../paths.js";
import { copyBankPlaceholders, loadBatches, loadCopyBank, resolveProduct } from "../store.js";

const { values } = parseArgs({ options: { product: { type: "string" }, draft: { type: "string" }, "dry-run": { type: "boolean" }, overwrite: { type: "boolean" } } });
const fail = (msg: string): never => { console.error(msg); process.exit(1); };

const product = resolveProduct(values.product);
const bankFile = path.join(productDir(product), "copy-bank.yaml");
if (!fs.existsSync(bankFile)) fail(`No copy bank at ${bankFile}. Create the product first: ${cmd("init", `${product} --name "..." --url https://...`)}`);
const draftFile = values.draft ? path.resolve(process.env.INIT_CWD ?? process.cwd(), values.draft) : path.join(RUNS_DIR, `copy-draft-${product}.json`);
if (!fs.existsSync(draftFile)) fail(`No draft at ${draftFile}. The copy-draft skill writes it; see .agents/skills/copy-draft/SKILL.md.`);

const draft = ((): Draft => {
  try { return parseDraft(fs.readFileSync(draftFile, "utf8")); } catch (err) {
    return fail(`${draftFile} is not a usable draft:\n${(err as Error).message}`);
  }
})();
const bundle = path.join(RUNS_DIR, `copy-sources-${product}.md`);
const source = (fs.existsSync(bundle) && bundleLabel(fs.readFileSync(bundle, "utf8"))) || "the product's own site";

const before = fs.readFileSync(bankFile, "utf8");
const applied = applyDraft(before, draft, { overwrite: values.overwrite ?? false, source, date: new Date().toISOString().slice(0, 10) });
const warnings = draftWarnings(draft);
const report = () => {
  if (warnings.length) console.log(`\nCheck these lengths:\n${warnings.map((w) => `  - ${w}`).join("\n")}`);
  if (draft.notes.length) console.log(`\nNotes from the draft:\n${draft.notes.map((n) => `  - ${n}`).join("\n")}`);
};

if (values["dry-run"]) {
  console.log(applied.written.length ? `Would write: ${applied.written.join(", ")}` : "Would write nothing.");
  if (applied.kept.length) console.log(`Would keep the owner's values for: ${applied.kept.join(", ")}`);
  report();
  process.exit(0);
}
if (!applied.written.length) {
  console.log(`Nothing written: ${applied.kept.length ? `the owner already filled in ${applied.kept.join(", ")}. Use --overwrite to replace them` : "the draft matches the copy bank"}.`);
  report();
  process.exit(0);
}

const backup = `${bankFile}.bak`;
fs.writeFileSync(backup, before);
fs.writeFileSync(bankFile, applied.text);
try {
  loadCopyBank(product);
} catch (err) {
  fs.writeFileSync(bankFile, before);
  fail(`The drafted copy bank did not validate, so it was not kept: ${(err as Error).message}`);
}

console.log(`Wrote ${applied.written.length} key(s) to ${bankFile}: ${applied.written.join(", ")}`);
if (applied.kept.length) console.log(`Kept the owner's values for: ${applied.kept.join(", ")}`);
console.log(`The previous file is in ${backup}.`);
report();
const todos = copyBankPlaceholders(loadCopyBank(product));
if (todos.length) console.log(`\nStill TODO (batch:approve refuses until these are filled):\n${todos.map((t) => `  - ${t}`).join("\n")}`);
const approved = loadBatches().filter((b) => b.product === product && b.status === "approved");
if (approved.length) console.log(`\nThe copy bank changed, so approved batch(es) ${approved.map((b) => b.id).join(", ")} must be shown and approved again before they run.`);
