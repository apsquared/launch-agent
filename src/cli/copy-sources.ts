/**
 * Gather what the copy-draft skill drafts a product's copy from: its live site and, optionally, its
 * source repo, filtered and redacted (src/site.ts, src/repo.ts). Writes one bundle file in the
 * workspace for the chat agent to read, and prints what went into it. Changes nothing else.
 *
 *   npm run copy:sources                        # default product, its url from the copy bank
 *   npm run copy:sources -- --product <slug> [--url https://...]
 *   npm run copy:sources -- --from ../my-app    # also the product's repo (the site is optional then)
 *   npm run copy:sources -- --from ../my-app --no-site   # only the repo, e.g. before the site is live
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { formatSources, sourcesLabel, type Source } from "../draft.js";
import { RUNS_DIR, cmd, productDir } from "../paths.js";
import { readRepo } from "../repo.js";
import { readSite } from "../site.js";
import { loadCopyBank, resolveProduct } from "../store.js";

const { values } = parseArgs({ options: { product: { type: "string" }, url: { type: "string" }, from: { type: "string" }, "no-site": { type: "boolean" } } });
const fail = (msg: string): never => { console.error(msg); process.exit(1); };

const product = resolveProduct(values.product);
if (!fs.existsSync(path.join(productDir(product), "copy-bank.yaml"))) fail(`No product "${product}" yet. Create it first: ${cmd("init", `${product} --name "..." --url https://...`)}`);
const bank = loadCopyBank(product);
const name = bank.strings.name?.[0] ?? product;
const url = values.url ?? bank.strings.url?.[0] ?? fail("No url in the copy bank; pass --url https://...");
if (!/^https?:\/\/[^\s/]+\.[^\s]+$/.test(url)) fail(`${url} is not an http(s) URL.`);

// npm runs scripts from this repo's root; a relative --from means relative to where the user typed it.
const fromDir = values.from ? path.resolve(process.env.INIT_CWD ?? process.cwd(), values.from.replace(/^~(?=$|\/)/, os.homedir())) : null;
if (fromDir && !fs.statSync(fromDir, { throwIfNoEntry: false })?.isDirectory()) fail(`--from ${values.from}: ${fromDir} is not a directory.`);
if (values["no-site"] && !fromDir) fail("--no-site needs --from <the product's repo>: there would be nothing to read.");
const shortPath = (p: string) => p.startsWith(os.homedir() + path.sep) ? `~${p.slice(os.homedir().length)}` : p;
const chars = (list: readonly Source[]) => list.reduce((n, s) => n + s.text.length, 0);

let pages: Source[] = [];
if (!values["no-site"]) {
  console.log(`Reading ${url} ...`);
  pages = await readSite(url, (msg) => console.log(`  ${msg}`)).catch((err: Error) => {
    if (!fromDir) return fail(`Could not read ${url}: ${err.message}`);
    console.log(`  Could not read it (${err.message}); using the repo only.`);
    return [];
  });
  if (pages.length) console.log(`  ${pages.length} page(s): ${pages.map((p) => new URL(p.ref).pathname).join(", ")} (${chars(pages)} characters)`);
}
let files: Source[] = [];
if (fromDir) {
  console.log(`Reading ${shortPath(fromDir)} ...`);
  files = readRepo(fromDir);
  console.log(files.length
    ? `  ${files.length} file(s) (${chars(files)} characters): ${files.map((f) => f.ref).join(", ")}`
    : "  No README, landing, pricing, feature or docs files found there.");
}
const sources = [...pages, ...files];
if (chars(sources) < 200) fail("There is too little readable text to draft from. Fill in the copy bank by hand.");

const out = path.join(RUNS_DIR, `copy-sources-${product}.md`);
fs.mkdirSync(RUNS_DIR, { recursive: true });
fs.writeFileSync(out, formatSources(product, name, sourcesLabel(sources, url, fromDir && shortPath(fromDir)), sources));
console.log(`\nWrote ${out} (${chars(sources)} characters). Draft from it with the copy-draft skill, then: ${cmd("copy:apply", `--product ${product}`)}`);
