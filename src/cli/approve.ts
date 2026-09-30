/**
 * Approve a proposed batch (or re-approve one whose copy bank changed after approval). This is the
 * one decision point: after it, the runner may sign in with
 * Google, accept each listed platform's terms, fill forms from the copy bank, submit, and add
 * badges, for exactly the listed platforms and exactly this copy bank.
 *
 *   npm run batch:approve -- <batch-id>            # prints everything, then asks you to type "approve"
 *   npm run batch:approve -- <batch-id> --yes      # non-interactive (only on the owner's instruction)
 */
import os from "node:os";
import readline from "node:readline/promises";
import { parseArgs } from "node:util";
import { approvalFingerprint, copyBankPlaceholders, loadBatch, loadCopyBank, loadPlatform, loadTracker, missingFromCopyBank, saveBatch, saveTracker, emptyRecord } from "../store.js";
import { renderBatch } from "./render.js";
import { cmd } from "../paths.js";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { yes: { type: "boolean" }, by: { type: "string" } } });
const id = positionals[0];
if (!id) throw new Error(`usage: ${cmd("batch:approve", "<batch-id>")}`);
const batch = loadBatch(id);
// An approved batch whose copy bank, assets or instructions changed since approval can be approved again;
// runs refuse it until then. Tracker progress is kept.
const stale = batch.status === "approved" && batch.approval_fingerprint !== approvalFingerprint(batch.product);
if (batch.status !== "proposed" && !stale) throw new Error(`batch ${id} is already ${batch.status}`);
if (stale) console.log(`The copy bank, assets or directory instructions changed since ${id} was approved on ${batch.approved_at}. Review everything below and approve again.\n`);

console.log(renderBatch(batch, { withCopy: true }));

const bank = loadCopyBank(batch.product);
const todo = copyBankPlaceholders(bank);
if (todo.length) {
  console.error(`\nNot approvable: the copy bank still has template text. Replace every TODO in products/${batch.product}/copy-bank.yaml:\n${todo.map((t) => `  - ${t}`).join("\n")}`);
  process.exit(1);
}
const unmet = batch.items.flatMap((i) => { const m = missingFromCopyBank(bank, loadPlatform(i.platform).requires); return m.length ? [`${i.platform}: ${m.join(", ")}`] : []; });
if (unmet.length) {
  console.error(`\nNot approvable: these directories won't take a listing without values the copy bank doesn't have. Add them to products/${batch.product}/copy-bank.yaml, or propose again with --exclude:\n${unmet.map((u) => `  - ${u}`).join("\n")}`);
  process.exit(1);
}

if (!values.yes) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('\nType "approve" to authorize these submissions: ');
  rl.close();
  if (answer.trim() !== "approve") { console.log("Not approved."); process.exit(1); }
}

const approved = {
  ...batch,
  status: "approved" as const,
  approved_at: new Date().toISOString(),
  approved_by: values.by ?? os.userInfo().username,
  approval_fingerprint: approvalFingerprint(batch.product),
};
saveBatch(approved);

const tracker = loadTracker(batch.product);
for (const item of batch.items) tracker.records[item.platform] ??= emptyRecord(item.platform, batch.id);
saveTracker(tracker);
console.log(`\nApproved ${id}. Kick off a run with \`${cmd("pass")}\` (or \`${cmd("run", `--batch ${id}`)}\`).`);
