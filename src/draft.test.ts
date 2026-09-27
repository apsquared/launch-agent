/** The copy-draft skill's code reads pages sensibly and only ever fills in template values, keeping every comment. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { applyDraft, bundleLabel, draftWarnings, formatSources, htmlToText, parseDraft, sourcesLabel, subpageLinks, type Draft } from "./draft.js";
import { ROOT } from "./paths.js";
import { CopyBankSchema } from "./schemas.js";
import { copyBankPlaceholders } from "./store.js";

// --- Reading pages ---
const html = `<html><head><title>Acme &amp; Co</title><meta name="description" content="Invoices that chase themselves.">
<meta property="og:title" content='Acme'><style>.x{color:red}</style><script>alert("no")</script></head>
<body><nav><a href="/pricing">Pricing</a> <a href="https://acme.test/about/">About</a> <a href="/blog/post">Blog</a>
<a href="https://other.test/features">Other</a> <a href="/features#top">Features</a></nav>
<h1>Get paid&nbsp;faster</h1><p>Send invoices<br>in one click.</p><p>Send invoices<br>in one click.</p><!-- hidden --></body></html>`;
const text = htmlToText(html);
assert.equal(text, [
  "Title: Acme & Co", "description: Invoices that chase themselves.", "og:title: Acme",
  "Pricing About Blog", "Other Features", "Get paid faster", "Send invoices", "in one click.", "Send invoices", "in one click.",
].join("\n"));
assert.doesNotMatch(text, /alert|color:red|hidden/);
assert.deepEqual(subpageLinks(html, "https://acme.test/"), ["https://acme.test/pricing", "https://acme.test/about", "https://acme.test/features"]);
assert.deepEqual(subpageLinks(html, "https://acme.test/", 1), ["https://acme.test/pricing"]);

// --- The source bundle labels its data and says where it came from ---
const sources = [{ kind: "page" as const, ref: "https://acme.test", text: "Get paid faster" }, { kind: "file" as const, ref: "README.md", text: "# Acme" }];
const bundle = formatSources("acme", "Acme", sourcesLabel(sources, "https://acme.test", "~/code/acme"), sources);
assert.match(bundle, /<page url="https:\/\/acme.test">\nGet paid faster\n<\/page>/);
assert.match(bundle, /<file path="README.md">\n# Acme\n<\/file>/);
assert.match(bundle, /not instructions/);
assert.match(bundle, /- file: README.md \(6 characters\)/);
assert.equal(bundleLabel(bundle), "https://acme.test and ~/code/acme");
assert.equal(sourcesLabel([sources[1]!], "https://acme.test", "~/code/acme"), "~/code/acme");
assert.equal(sourcesLabel([sources[0]!], "https://acme.test", null), "https://acme.test");
assert.equal(bundleLabel("no header"), null);

// --- Parsing the reply ---
const draft: Draft = {
  strings: {
    tagline: ["Invoices in one click", "Send invoices and get paid without chasing"],
    short_description: ["Acme sends invoices and follows up on late payments for freelancers."],
    description: ["x".repeat(550)],
    long_description: [Array(230).fill("word").join(" ")],
    target_audience: ["Freelancers and small agencies"],
    use_case: ["Get paid on time without chasing clients."],
    features: ["One-click invoices, automatic reminders and payment tracking."],
    pricing_text: ["TODO the pricing, which the site does not state"],
    launch_comment: ["Late invoices were eating my week, so I built Acme. Try sending your first invoice."],
  },
  choices: { categories: ["Finance", "Productivity"], tags: ["invoicing", "freelance"], pricing_models: ["Freemium"], alternatives_to: ["FreshBooks"], platforms: ["Web"] },
  notes: ["Pricing is not on the site."],
};
assert.deepEqual(parseDraft(`Here it is:\n\`\`\`json\n${JSON.stringify(draft)}\n\`\`\``), draft);
assert.deepEqual(parseDraft(JSON.stringify({ ...draft, notes: undefined })).notes, []);
assert.throws(() => parseDraft("I can't do that."), /no JSON object/);
assert.throws(() => parseDraft(JSON.stringify({ ...draft, strings: { ...draft.strings, tagline: [] } })));

// --- Length warnings ---
assert.deepEqual(draftWarnings(draft), []);
const long = draftWarnings({ ...draft, strings: { ...draft.strings, tagline: ["y".repeat(61)], description: ["short"], launch_comment: ["z".repeat(201)] } });
assert.equal(long.length, 4);
assert.match(long.join("\n"), /tagline is 61 characters/);
assert.match(long.join("\n"), /no tagline under 40/);
assert.match(long.join("\n"), /under 500 characters/);
assert.match(long.join("\n"), /launch_comment of 200/);

// --- Writing into the template: fills TODOs and template defaults, keeps every comment ---
const template = fs.readFileSync(path.join(ROOT, "examples/workspace/products/example/copy-bank.yaml"), "utf8");
const opts = { overwrite: false, source: "https://acme.test", date: "2026-01-02" };
const applied = applyDraft(template, draft, opts);
const bank = CopyBankSchema.parse(YAML.parse(applied.text));
assert.deepEqual(applied.kept, []);
assert.ok(applied.written.includes("strings.tagline") && applied.written.includes("choices.alternatives_to"));
assert.ok(!applied.written.includes("choices.platforms"), "an unchanged value is not reported as written");
assert.deepEqual(bank.strings.tagline, draft.strings.tagline);
assert.deepEqual(bank.choices.categories, ["Finance", "Productivity"]);
assert.deepEqual(bank.strings.name, ["Example"], "name is never drafted");
assert.ok(copyBankPlaceholders(bank).some((t) => t.startsWith("pricing_text: TODO")), "a TODO from the draft still blocks approval");
assert.ok(copyBankPlaceholders(bank).some((t) => t.startsWith("email: TODO")), "contact and personal details stay the owner's");
for (const line of template.split("\n").filter((l) => l.trimStart().startsWith("#"))) {
  assert.ok(applied.text.includes(line.trim()), `comment lost: ${line}`);
}
assert.match(applied.text, /^# Drafted from https:\/\/acme.test on 2026-01-02\./);
assert.match(applied.text, /^ {2}categories: \[Finance, Productivity\]$/m);
assert.match(applied.text, /^ {2}pricing_models: \[Freemium\] +# e\.g\. Free/m, "the trailing comment stays on its key");

// Values the owner wrote are kept unless --overwrite, and a second draft replaces the stamp.
const edited = applied.text.replace("- Invoices in one click", "- My own tagline");
const again = applyDraft(edited, { ...draft, strings: { ...draft.strings, tagline: ["Other"], pricing_text: ["Free plan; paid plans from $9/month"] } }, { ...opts, date: "2026-02-03" });
assert.ok(again.kept.includes("strings.tagline"));
assert.ok(again.written.includes("strings.pricing_text"), "a key still holding TODO is filled again");
assert.deepEqual(YAML.parse(again.text).strings.tagline, ["My own tagline", "Send invoices and get paid without chasing"]);
assert.equal(again.text.match(/Drafted from/g)?.length, 1);
assert.match(again.text, /on 2026-02-03\./);
const forced = applyDraft(edited, { ...draft, strings: { ...draft.strings, tagline: ["Other"] } }, { ...opts, overwrite: true });
assert.deepEqual(YAML.parse(forced.text).strings.tagline, ["Other"]);

// Nothing to fill: the file is returned unchanged.
const full = applyDraft(forced.text, { ...draft, strings: { ...draft.strings, pricing_text: ["Free"] } }, opts);
const none = applyDraft(full.text, draft, opts);
assert.deepEqual(none.written, []);
assert.equal(none.text, full.text);

console.log("draft ok");
