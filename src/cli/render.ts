import type { Batch } from "../schemas.js";
import { loadCopyBank, loadPlatform, platformInstructions } from "../store.js";

/** The text an approver reads: every platform, every grant, and every string that may be used. */
export function renderBatch(batch: Batch, opts: { withCopy?: boolean } = {}): string {
  const lines = [`# Batch ${batch.id} (${batch.status})`, "", `Product: ${batch.product}`, "", "## Grants for every item in this batch", ""];
  for (const [k, v] of Object.entries(batch.grants)) lines.push(`- ${k.replace(/_/g, " ")}: ${v ? "yes" : "no"}`);
  lines.push("- payments: never (enforced in code)", "", "## Platforms", "", "| # | Platform | Auth | Badge | Expect | Risks |", "|---|---|---|---|---|---|");
  batch.items.forEach((item, i) => {
    const p = loadPlatform(item.platform);
    lines.push(`| ${i + 1} | ${p.name} (${p.home_url}) | ${item.auth} | ${item.badge} | ${item.expected} | ${item.risks.join("; ") || "—"} |`);
  });
  const instructions = batch.items.flatMap((item) => {
    const text = platformInstructions(batch.product, item.platform);
    return text ? [`- **${loadPlatform(item.platform).name}**: ${text}`] : [];
  });
  if (instructions.length) lines.push("", "## Your instructions for specific directories (approved with the batch)", "", ...instructions);
  if (opts.withCopy) {
    const bank = loadCopyBank(batch.product);
    lines.push("", "## Copy bank: the only text that can be entered", "");
    for (const [key, variants] of Object.entries(bank.strings)) {
      lines.push(`**${key}**`);
      for (const v of variants) lines.push(`  - (${v.length}) ${v}`);
    }
    lines.push("", `Choices: ${JSON.stringify(bank.choices)}`, `Assets: ${Object.entries(bank.assets).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
  return lines.join("\n");
}
