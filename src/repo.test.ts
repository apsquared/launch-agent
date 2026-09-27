/** copy:sources --from reads the files that describe a product, and never secrets, ignored files or dependencies. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileScore, fileToText, readRepo, redact } from "./repo.js";

// --- Which files count ---
const ranked = ["README.md", "package.json", "llms.txt", "app/page.tsx", "app/(marketing)/page.tsx", "src/pages/index.astro", "src/routes/+page.svelte",
  "app/routes/_index.tsx", "apps/web/app/page.tsx", "index.html", "app/pricing/page.tsx", "components/Hero.tsx", "components/PricingTokens.tsx",
  "docs/getting-started.md", "content/features.mdx", "app/layout.tsx", "docs/product-overview.md", "app/how-it-works/page.tsx"];
for (const f of ranked) assert.ok(fileScore(f) > 0, `${f} should be read`);
const skipped = [".env", ".env.local", "config/secrets.json", "certs/server.pem", "id_rsa", ".npmrc", "package-lock.json", "pnpm-lock.yaml",
  "src/__tests__/page.test.tsx", "app/page.test.tsx", "tests/fixtures/landing.html", "AGENTS.md", "CLAUDE.md", "CLAUDE.local.md",
  ".github/workflows/ci.yml", ".claude/settings.json", "CHANGELOG.md", "LICENSE", "src/lib/db.ts", "src/server/pricing.ts", "components/Button.tsx",
  "tsconfig.json", "packages/ui/package.json", "public/logo.png", "notes.txt", "dist/index.min.js",
  // Written for the team, or not about the product.
  "docs/go-live-marketing-plan.md", "docs/marketing-tasks.md", "docs/pricing-research.md", "docs/pipeline-design.md", "docs/schema-rationale.md",
  "output/marketing/campaign.md", "spikes/README.md", "docs/README.md", "public/marketing/launch-social.md", "app/admin/page.tsx", "app/privacy/page.tsx",
  "app/signin/page.tsx", "app/dashboard/pricing/page.tsx", ".agents/skills/launch/SKILL.md", ".cursor/rules/product.md"];
for (const f of skipped) assert.equal(fileScore(f), 0, `${f} should not be read`);
assert.ok(fileScore("README.md") > fileScore("app/pricing/page.tsx"));
assert.ok(fileScore("app/pricing/page.tsx") > fileScore("docs/getting-started.md"));

// --- Credentials never leave the machine ---
const secrets = [
  "sk_live_abcdefghijklmnop1234", "pk_test_abcdefgh12345678", "sk-ant-api03-abcdefghijklmnopqrstuvwx", "AKIAABCDEFGHIJKLMNOP",
  "ghp_abcdefghijklmnopqrstuvwxyz0123", "xoxb-1234567890-abcdefghij", "AIzaSyA1234567890abcdefghijklmnopqrstuv",
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
];
for (const secret of secrets) assert.doesNotMatch(redact(`key: ${secret} end`), new RegExp(secret.slice(0, 12).replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")), secret);
assert.equal(redact("STRIPE_SECRET_KEY=abc123def456"), "STRIPE_SECRET_KEY=[redacted]");
assert.equal(redact("-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----"), "[redacted]");
assert.equal(redact("Buy 20 tokens for $19. Our API key feature is free."), "Buy 20 tokens for $19. Our API key feature is free.");

// --- Reading files as text ---
assert.equal(fileToText("package.json", JSON.stringify({ name: "acme", description: "Invoices", scripts: { dev: "next" }, dependencies: { next: "1" } })),
  JSON.stringify({ name: "acme", description: "Invoices" }, null, 2));
const tsx = fileToText("app/page.tsx", `import Link from "next/link";\nexport default function Page() {\n  return <h1 className="text-4xl font-bold">Get paid faster</h1>;\n}`);
assert.doesNotMatch(tsx, /import|text-4xl/);
assert.match(tsx, /Get paid faster/);

// --- A whole repo, with and without git ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "launch-agent-repo-"));
const write = (rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true }); fs.writeFileSync(path.join(tmp, rel), text); };
try {
  write("README.md", "# Acme\n\nAcme sends invoices and chases late payments for freelancers.\n\n## Setup\n\nnpm install");
  write("package.json", JSON.stringify({ name: "acme", description: "Invoices that chase themselves", private: true }));
  write("app/page.tsx", `import x from "y";\nexport default () => <main className="p-4"><h1>Get paid faster</h1><p>Send an invoice in one click.</p></main>;`);
  write("app/pricing/page.tsx", `export default () => <p>Free for 3 clients. Pro is $9/month. STRIPE_SECRET_KEY=sk_live_abcdefghijklmnop1234</p>;`);
  write(".env", "STRIPE_SECRET_KEY=sk_live_realsecretvalue123456");
  write("node_modules/some-lib/README.md", "# Some library readme that is long enough to be read if it were not skipped.");
  write("app/page.test.tsx", "test('renders the landing page with the headline text visible', () => {})");
  write("drafts/unreleased-features.md", "# Secret roadmap that must stay private because it is gitignored in this repo");
  write(".gitignore", "drafts/\n");
  fs.symlinkSync("/etc/hosts", path.join(tmp, "docs-intro.md"));

  const check = (label: string, expectIgnoredSkipped: boolean) => {
    const sources = readRepo(tmp);
    const refs = sources.map((s) => s.ref);
    assert.deepEqual(refs.slice(0, 2), ["README.md", "package.json"], `${label}: best files first`);
    assert.ok(refs.includes("app/page.tsx") && refs.includes("app/pricing/page.tsx"), `${label}: ${refs.join(", ")}`);
    for (const never of [".env", "node_modules/some-lib/README.md", "app/page.test.tsx", "docs-intro.md"]) assert.ok(!refs.includes(never), `${label}: read ${never}`);
    if (expectIgnoredSkipped) assert.ok(!refs.includes("drafts/unreleased-features.md"), `${label}: read a gitignored file`);
    const all = sources.map((s) => s.text).join("\n");
    assert.doesNotMatch(all, /sk_live|realsecret|localhost|"private"/);
    assert.match(all, /Pro is \$9\/month/);
    assert.ok(sources.every((s) => s.kind === "file"));
  };
  check("plain folder", false);
  if (spawnSync("git", ["--version"]).status === 0) {
    spawnSync("git", ["init", "-q", tmp]);
    check("git repo", true);
  }
  console.log("repo ok");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
