/**
 * Read a product's own source repository for copy:sources (the copy-draft skill). The agent doesn't browse it: this
 * picks the files that describe the product (README, landing, pricing and feature pages, docs,
 * package metadata), leaves out gitignored files, secrets, dependencies, builds and tests, and
 * hides anything shaped like a credential before the text is sent anywhere.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { htmlToText, type Source } from "./draft.js";

const MAX_FILE_CHARS = 12_000;
const MAX_TOTAL_CHARS = 60_000;
const MAX_FILE_BYTES = 200_000;
const MAX_WALK = 20_000;

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", ".astro", ".output",
  ".vercel", ".netlify", ".turbo", ".cache", "coverage", "vendor", "venv", ".venv", "__pycache__", "target", "tmp", ".idea", ".vscode",
  "output", "spikes", "scratch", "archive", "examples", "scripts",
]);
/** Never read, whatever their extension: secrets, keys, local config, lockfiles, generated or test code. */
const NEVER = [
  /(^|\/)\.env(\.|$)/i, /\.(pem|key|p12|pfx|crt|cer|keystore|jks)$/i, /(^|\/)id_(rsa|ed25519|ecdsa)/i, /(^|\/)[^/]*(secret|credential|password|passwd)[^/]*$/i,
  /(^|\/)\.(npmrc|pypirc|netrc|git-credentials)$/i, /(^|\/)(package-lock|yarn|pnpm-lock|bun|composer|Gemfile|Cargo|poetry)\.lock$|pnpm-lock\.yaml$/i,
  /\.min\.(js|css)$/i, /(^|\/)(__tests__|__mocks__|tests?|spec|fixtures|mocks|e2e|cypress|playwright|migrations|seeds?|stories)\//i,
  /\.(test|spec|stories)\.[a-z]+$/i, /\.d\.ts$/i,
  // Instructions for coding agents and contributors describe the codebase, not the product.
  /(^|\/)(AGENTS|CLAUDE|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY)(\.local)?\.md$/i,
  // Hidden folders hold tooling and agent config (.github, .claude, .cursor, .agents, ...), never the product's pages.
  /(^|\/)\.[^/]+\//,
];
const TEXT_EXT = /\.(md|mdx|markdown|txt|html?|jsx|tsx|vue|svelte|astro|json|webmanifest)$/i;

/** Pages the public sees, as opposed to documents written for the team. */
const PAGE_EXT = /\.(jsx|tsx|vue|svelte|astro|html?|mdx)$/;
/** Written for the team, not for buyers: plans, specs, research, notes, campaign material. */
const INTERNAL = /plan|tasks?\b|todo|roadmap|backlog|capture|design|spec\b|rationale|notes?\b|spikes?|prompts?\b|evidence|verification|inventory|adr\b|decision|meeting|retro|postmortem|runbook|internal|draft|brainstorm|campaign|storyboard|review|research|candidates|changelog|history|license|licence|notice/;
/** App routes that say nothing about the product. */
const NOT_MARKETING = /(^|\/)(admin|dashboard|account|settings|signin|sign-in|signup|sign-up|login|logout|auth|privacy|terms|legal|cookies?|api)(\/|\.|$)/;
/** What a user-facing page or doc is about, and how useful that is for directory copy. */
const TOPICS: [RegExp, number][] = [
  [/pricing|plans?\b/, 80],
  [/(^|[/_.(-])(landing|home|hero)([/_.)-]|$)/, 70],
  [/features?|benefits|use-?cases|how-it-works|faq|testimonials?|comparison|\bvs\b|alternatives?/, 65],
  [/(^|\/)about|overview|product|positioning|messaging|why-/, 60],
  [/intro|getting-started|quick-?start/, 50],
];

/** How likely a file is to describe the product to a buyer. 0 = skip. */
export function fileScore(rel: string): number {
  const p = rel.toLowerCase();
  const base = path.posix.basename(p);
  const depth = p.split("/").length - 1;
  if (NEVER.some((re) => re.test(rel)) || !TEXT_EXT.test(p)) return 0;
  if (base === "llms.txt" || base === "llms-full.txt") return 95;
  if (/^readme(\.[a-z]+)?$/.test(base)) return depth === 0 ? 100 : 0;
  if (base === "package.json") return depth === 0 ? 90 : 0;
  if (/\.(json|webmanifest)$/.test(base)) return /^(manifest|site)\.(json|webmanifest)$/.test(base) ? 40 : 0;
  if (base.endsWith(".txt") || INTERNAL.test(base)) return 0;
  const topic = Math.max(0, ...TOPICS.filter(([re]) => re.test(p)).map(([, n]) => n));
  let score = 0;
  if (PAGE_EXT.test(p)) {
    if (NOT_MARKETING.test(p)) return 0;
    // A framework's root page is usually the landing page.
    const app = p.replace(/^((apps|packages)\/[^/]+|web|frontend|site|website)\//, "");
    if (/^(src\/)?(app\/)?((\([^/]+\)\/)?page|pages\/index|routes\/(\+page|index|_index))\.[a-z]+$/.test(app) || /^(public\/|src\/)?index\.html?$/.test(app)) score = 75;
    else if (/^(src\/)?app\/layout\.[jt]sx$/.test(app)) score = 45;
    score = Math.max(score, topic);
  } else if (/\.(md|markdown)$/.test(p)) {
    // Markdown is only read when its name says it is about the product; most docs are for the team.
    score = topic ? Math.min(topic, 55) : 0;
  }
  return score > 0 ? Math.max(1, score - Math.min(depth, 6)) : 0;
}

/** Anything shaped like a credential, replaced before the text leaves this machine. */
export function redact(text: string): string {
  return text
    .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, "[redacted]")
    .replace(/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}\b/g, "[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[redacted]")
    .replace(/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, "[redacted]")
    .replace(/\b(ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/g, "[redacted]")
    .replace(/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, "[redacted]")
    .replace(/\bAIza[0-9A-Za-z_-]{35}\b/g, "[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted]")
    .replace(/\b([A-Z0-9_]*(SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*[=:]\s*["']?[^\s"']{8,}["']?/g, "$1=[redacted]");
}

/** The readable part of a file: page markup to text, component code without imports and styling. */
export function fileToText(rel: string, raw: string): string {
  const ext = path.extname(rel).toLowerCase();
  if (path.basename(rel).toLowerCase() === "package.json") {
    try {
      const pkg = JSON.parse(raw) as Record<string, unknown>;
      const keep = Object.fromEntries(["name", "description", "keywords", "homepage"].filter((k) => pkg[k] != null).map((k) => [k, pkg[k]]));
      return Object.keys(keep).length ? JSON.stringify(keep, null, 2) : "";
    } catch { return ""; }
  }
  if (ext === ".html" || ext === ".htm") return htmlToText(raw);
  if ([".jsx", ".tsx", ".vue", ".svelte", ".astro"].includes(ext)) {
    return raw
      .replace(/<style\b[\s\S]*?<\/style>/gi, "")
      .replace(/^\s*(import|export \* from|export \{[^}]*\} from)\b.*$/gm, "")
      .replace(/\b(className|class|style|tw)\s*=\s*(\{`[^`]*`\}|"[^"]*"|'[^']*'|\{[^{}]*\})/g, "")
      .replace(/\b(d|viewBox|fill|stroke|xmlns|strokeWidth|strokeLinecap|strokeLinejoin)\s*=\s*"[^"]*"/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n");
  }
  if (ext === ".mdx") return raw.replace(/^\s*(import|export)\b.*$/gm, "");
  return raw;
}

/** Files in the repo, relative, with `/`: git's view (tracked and not ignored) when it is a git repo. */
function listFiles(dir: string): string[] {
  const git = spawnSync("git", ["-C", dir, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (git.status === 0) return git.stdout.split("\0").filter(Boolean);
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (out.length >= MAX_WALK) return;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(child); }
      else if (entry.isFile()) out.push(child);
    }
  };
  walk("");
  return out;
}

/** The files that best describe the product, most useful first, within the size budget. */
export function readRepo(dir: string): Source[] {
  const candidates = listFiles(dir)
    .filter((rel) => !rel.split("/").some((part) => SKIP_DIRS.has(part)))
    .map((rel) => ({ rel, score: fileScore(rel) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.rel.length - b.rel.length || a.rel.localeCompare(b.rel));
  const sources: Source[] = [];
  let total = 0;
  for (const { rel } of candidates) {
    if (total >= MAX_TOTAL_CHARS) break;
    const file = path.join(dir, rel);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(file); } catch { continue; }
    // Symlinks could point anywhere on the machine; only plain files inside the repo are read.
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
    const raw = fs.readFileSync(file, "utf8");
    if (raw.includes("\0")) continue;
    const text = redact(fileToText(rel, raw)).trim().slice(0, Math.min(MAX_FILE_CHARS, MAX_TOTAL_CHARS - total));
    if (text.length < 40) continue;
    sources.push({ kind: "file", ref: rel, text });
    total += text.length;
  }
  return sources;
}
