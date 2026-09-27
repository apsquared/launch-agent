/** Render the complete approval review without prompting, approving, or writing anything. */
import { parseArgs } from "node:util";
import { loadBatch } from "../store.js";
import { renderBatch } from "./render.js";
import { cmd } from "../paths.js";

const { positionals } = parseArgs({ allowPositionals: true, options: {} });
if (positionals.length !== 1) throw new Error(`usage: ${cmd("batch:show", "<batch-id>")}`);
console.log(renderBatch(loadBatch(positionals[0]!), { withCopy: true }));
