/**
 * Set up a product in the workspace, and the workspace itself the first time: step 2 of the
 * promote workflow (AGENTS.md). Writes templates only: nothing is proposed, approved or submitted.
 *
 *   npm run setup -- <slug> --name "My Product" --url https://myproduct.com [--identity launch@example.com]
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { AGENTS, agentInstalled } from "../agents/index.js";
import type { AgentBackend } from "../agents/types.js";
import { CONFIG_FILE, ROOT, WORKSPACE, cmd, productDir } from "../paths.js";
import { ConfigSchema } from "../schemas.js";
import { loadConfig, loadCopyBank, loadPlatforms, loadProduct } from "../store.js";

const TEMPLATE = path.join(ROOT, "examples/workspace");
const USAGE = `usage: ${cmd("setup", '<slug> --name "My Product" --url https://myproduct.com [--identity launch@example.com]')}`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { name: { type: "string" }, url: { type: "string" }, identity: { type: "string" } },
});
/** Relative to where the command was run, unless that path would climb out of it. */
const show = (p: string) => { const r = path.relative(process.cwd(), p); return r.startsWith("..") ? p : r; };
/** Set a top-level scalar, keeping the comment after it in the same column. */
const setValue = (text: string, key: string, value: string) =>
  text.replace(new RegExp(`^(${key}: )(\\S+)( *)(?=#|$)`, "m"), (_m, k: string, old: string, pad: string) => `${k}${value}${" ".repeat(pad ? Math.max(1, old.length + pad.length - value.length) : 0)}`);
const fail = (msg: string): never => { console.error(`${msg}\n${USAGE}`); process.exit(1); };

const SLUG_HELP = "Give the product a slug: lowercase letters, digits and dashes (e.g. my-product).";
const slug = positionals[0] ?? fail(SLUG_HELP);
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) fail(SLUG_HELP);
const name = values.name ?? fail("--name is required: the product name as directories should show it.");
const url = values.url ?? fail("--url is required: the product's https:// URL.");
if (!/^https:\/\/[^\s/]+\.[^\s]+$/.test(url)) fail(`--url ${url} is not an https:// URL.`);
const dir = productDir(slug);
if (fs.existsSync(dir)) fail(`${dir} already exists. Edit it directly, or pick another slug.`);

// --- The workspace config, the first time. ---
if (!fs.existsSync(CONFIG_FILE)) {
  if (!values.identity) fail(`No workspace yet at ${WORKSPACE}. Pass --identity with the Google account the launch Chrome profile will sign into.`);
  if (!ConfigSchema.shape.launch_identity.safeParse(values.identity).success) fail(`--identity ${values.identity} is not an email address.`);
  // Submissions need Claude Code or OpenCode installed, whichever chat client the user is in.
  const installed = (Object.values(AGENTS) as AgentBackend[]).find((a) => agentInstalled(a));
  const text = setValue(setValue(setValue(fs.readFileSync(path.join(TEMPLATE, "config.yaml"), "utf8"),
    "launch_identity", values.identity!), "default_product", slug), "agent", installed?.name ?? "claude");
  fs.mkdirSync(WORKSPACE, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, text);
  loadConfig();
  console.log(`Created ${show(CONFIG_FILE)} (launch identity ${values.identity}).`);
} else {
  const config = loadConfig();
  if (values.identity && values.identity !== config.launch_identity) {
    console.log(`Note: the workspace already uses ${config.launch_identity}; --identity was ignored. Edit ${CONFIG_FILE} to change it.`);
  }
  if (!config.default_product) {
    fs.writeFileSync(CONFIG_FILE, setValue(fs.readFileSync(CONFIG_FILE, "utf8"), "default_product", slug));
    console.log(`Set default_product to ${slug}.`);
  }
}

// --- The product: copy bank from the template, product.yaml listing every directory to rate. ---
fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
const bank = fs.readFileSync(path.join(TEMPLATE, "products/example/copy-bank.yaml"), "utf8")
  .replace(/^product: example$/m, `product: ${slug}`)
  .replace(/^( {2}name:\n {4}- )Example$/m, `$1${JSON.stringify(name)}`)
  .replace(/^( {2}url:\n {4}- )https:\/\/example\.com$/m, `$1${url}`);
fs.writeFileSync(path.join(dir, "copy-bank.yaml"), bank);

const platforms = loadPlatforms();
const width = Math.max(...platforms.map((p) => p.slug.length));
const product = `# Settings for ${name}: badges, and how each directory should be handled.
product: ${slug}
badges:
  # Many directories list you for free only if their badge on your site links back to them. When on,
  # runs capture each directory's badge and badges:sync writes them all to output_file.
  enabled: false
  output_file: null        # null = badges.html in this directory, to paste into your site builder;
                           # or a file in your site's code, e.g. /path/to/site/src/badges.json
  format: null             # html | json | ts; null = from output_file's extension
  check_url: ${url.replace(/\/?$/, "/")}   # public page the badges appear on once deployed
# Open-source products only: the license of the public repo in the copy bank's repo_url (e.g. MIT),
# once you've confirmed it. While null, directories for open-source projects are never proposed.
open_source_license: null
# true if ${name} is, or ships, an MCP (Model Context Protocol) server. While false, directories for
# MCP servers are never proposed.
mcp_server: false
# Rate each directory for ${name} (strong | ok | weak | none) and, optionally, give the agent your own
# instructions for it. Uncomment a line to use it, e.g.
#   tinylaunch: { fit: strong, instructions: "Pick the Marketing & Sales category. Use the dark badge." }
# weak and none are never proposed; unrated directories are proposed after rated ones. Instructions are
# shown in the batch and covered by its approval, so editing them later means approving again.
# Manual directories (founder-led launches, communities) are never submitted automatically.
platforms:
${platforms.map((p) => `  # ${`${p.slug}:`.padEnd(width + 1)} { fit: ok }  # ${p.mode === "manual" ? "[manual] " : ""}${p.open_source_only ? "[open source only] " : ""}${p.mcp_only ? "[MCP servers only] " : ""}${p.audience}`).join("\n")}
`;
fs.writeFileSync(path.join(dir, "product.yaml"), product);

// Both files must load, or the templates and this script have drifted apart.
loadCopyBank(slug);
loadProduct(slug);

const rel = show(dir);
console.log(`Created ${rel}/ with copy-bank.yaml (the text directories will get), product.yaml and assets/.
Next: the copy (drafted from the product's repo or site, or from your answers), a logo and screenshots,
and where directory badges go on the site. See AGENTS.md, step 3.`);

const backend = AGENTS[loadConfig().agent];
if (!agentInstalled(backend)) {
  console.log(`\nSubmissions run in Claude Code or OpenCode, and neither was found on PATH (agent: ${backend.name} in config.yaml). ${backend.setupHint}`);
}
