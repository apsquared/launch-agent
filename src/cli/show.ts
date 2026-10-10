/** Render the complete approval review without prompting, approving, or writing anything. */
import { parseArgs } from "node:util";
import { approvalIsStale, loadBatch, pendingItems } from "../store.js";
import { renderBatch } from "./render.js";
import { cmd } from "../paths.js";

const { positionals } = parseArgs({ allowPositionals: true, options: {} });
if (positionals.length !== 1) throw new Error(`usage: ${cmd("batch:show", "<batch-id>")}`);
const batch = loadBatch(positionals[0]!);
const open = pendingItems(batch, true);
if (open.length && approvalIsStale(batch)) {
  console.log(`! The copy bank, assets or directory instructions changed since ${batch.id} was approved on ${batch.approved_at}. ` +
    `${open.join(", ")} won't run until it is approved again: ${cmd("batch:approve", batch.id)}\n`);
}
console.log(renderBatch(batch, { withCopy: true }));
