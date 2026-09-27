/**
 * Guarded browser tools for one (batch, platform) item.
 *
 * The agent that submits a listing gets these tools and nothing else: no shell, no file access, no
 * JavaScript evaluation, and no way to type free text. Every value it can put into a form comes
 * from the approved copy bank or from the site's own option lists. Spend-shaped clicks, marketing
 * opt-ins, foreign hosts and payment pages are refused here in code.
 */
import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Browser, Frame, Locator, Page } from "playwright-core";
import { z } from "zod";
import { connect } from "../chrome.js";
import {
  checkboxVerdict, choiceAllowed, classifyUrl, clickVerdict, googleClickVerdict, hostOf, parseBadgeSnippet, pickVariant,
} from "../guards.js";
import { watchedItem } from "../item.js";
import { EVIDENCE_DIR, RUNS_DIR } from "../paths.js";
import { StateSchema, type Badge } from "../schemas.js";
import {
  appendProductNote, appendSiteNote, approvalFingerprint, assetPath, loadBatch, loadConfig, loadCopyBank, loadPlatform, loadPolicy,
  loadSiteNotes, loadTracker, platformInstructions, updateRecord,
} from "../store.js";

// A headless run passes its item in the environment. A watched run (the launch-watched subagent, which
// starts this server itself) takes the one item watch:start set up. Either way every check below applies.
const WATCHED = process.env.LA_WATCHED === "1";
const watched = WATCHED ? watchedItem() : null;
const PRODUCT = watched?.product ?? required("LA_PRODUCT");
const PLATFORM = watched?.platform ?? required("LA_PLATFORM");
const BATCH = watched?.batch ?? required("LA_BATCH");

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// --- Item context, validated once at startup. The server refuses to start outside an approval. ---

const policy = loadPolicy();
const config = loadConfig();
const platform = loadPlatform(PLATFORM);
const batch = loadBatch(BATCH);
const bank = loadCopyBank(PRODUCT);
const item = batch.items.find((i) => i.platform === PLATFORM);
if (batch.status !== "approved") throw new Error(`batch ${BATCH} is ${batch.status}, not approved`);
if (!item) throw new Error(`${PLATFORM} is not in batch ${BATCH}`);
if (batch.approval_fingerprint !== approvalFingerprint(PRODUCT)) throw new Error("copy bank, assets or directory instructions changed since approval; re-approve the batch");
if (platform.mode !== "auto") throw new Error(`${PLATFORM} is a manual platform`);

/** Maker-profile identity keys: filled only into fields the site marks as required. */
const PERSONAL_KEYS = new Set(["first_name", "last_name", "handle"]);
const urlOpts = { platformDomains: platform.domains, authHosts: policy.auth_hosts, paymentHosts: policy.payment_hosts };
const allChoices = [...bank.choices.categories, ...bank.choices.tags, ...bank.choices.pricing_models, ...bank.choices.alternatives_to, ...bank.choices.platforms];

const logFile = path.join(RUNS_DIR, BATCH, `${PLATFORM}.jsonl`);
fs.mkdirSync(path.dirname(logFile), { recursive: true });
function audit(event: string, data: Record<string, unknown>): void {
  fs.appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), event, ...data })}\n`);
}

// --- Browser state ---

let browser: Browser | null = null;
const pages: Page[] = [];
let active: Page | null = null;
let closed = false;
let paymentPageUrl: string | null = null;
let capturedBadge: Badge | null = null;
const screenshots: string[] = [];

async function page(): Promise<Page> {
  if (active && !active.isClosed()) return active;
  if (!browser) browser = await connect();
  const context = browser.contexts()[0];
  if (!context) throw new Error("the launch Chrome profile has no browser context");
  const p = await context.newPage();
  track(p);
  return p;
}

// Some sites (e.g. Findly.tools) only put their badge embed code on the clipboard behind a "Copy"
// button. This records what the page itself copies, in window.__laCopied, so capture_badge can read
// it. It never reads the system clipboard, so nothing the owner copied elsewhere is exposed.
const CLIPBOARD_HOOK_JS = String.raw`(() => {
  if (window.__laCopied) return;
  const box = [];
  Object.defineProperty(window, '__laCopied', { value: box });
  const keep = (t) => { if (typeof t === 'string' && t.trim()) { box.push(t.slice(0, 5000)); if (box.length > 20) box.shift(); } };
  const cb = navigator.clipboard;
  if (cb && cb.writeText) { const wt = cb.writeText.bind(cb); cb.writeText = (t) => { keep(t); return wt(t); }; }
  if (cb && cb.write) {
    const w = cb.write.bind(cb);
    cb.write = (items) => {
      try {
        for (const it of items || []) for (const type of it.types || []) {
          if (type === 'text/plain' || type === 'text/html') Promise.resolve(it.getType(type)).then((b) => b.text()).then(keep).catch(() => {});
        }
      } catch (e) {}
      return w(items);
    };
  }
  const setData = DataTransfer.prototype.setData;
  DataTransfer.prototype.setData = function (type, data) { if (/^text\//.test(type)) keep(data); return setData.call(this, type, data); };
  document.addEventListener('copy', () => {
    const a = document.activeElement;
    if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT') && typeof a.selectionStart === 'number') keep(a.value.slice(a.selectionStart, a.selectionEnd));
    else keep(String(document.getSelection() || ''));
  }, true);
})()`;

function track(p: Page): void {
  pages.push(p);
  active = p;
  p.addInitScript(CLIPBOARD_HOOK_JS).catch(() => {});
  // A popup may already have loaded its first document before we see it.
  p.evaluate(CLIPBOARD_HOOK_JS).catch(() => {});
  p.on("popup", (popup) => { track(popup); audit("popup", { url: popup.url() }); });
  p.on("close", () => { if (active === p) active = pages.filter((x) => !x.isClosed()).at(-1) ?? null; });
}

async function settle(p: Page): Promise<void> {
  await p.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
  await p.waitForTimeout(1200);
}

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };
// Compact JSON: an indented snapshot of a busy page overflows the agent's tool-result limit.
const ok = (data: unknown): Result => ({ content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data) }] });
const refuse = (reason: string): Result => { audit("refused", { reason }); return { content: [{ type: "text", text: `REFUSED: ${reason}` }], isError: true }; };

function guardOpen(): string | null {
  if (closed) return "this item is already recorded; stop now";
  return null;
}

/** After any action, check where we ended up. Foreign hosts are backed out of; payment pages lock. */
async function checkLocation(p: Page): Promise<string | null> {
  const url = p.url();
  const verdict = classifyUrl(url, urlOpts);
  if (verdict === "payment") {
    paymentPageUrl = url;
    audit("payment_page", { url });
    return `This is a payment page (${hostOf(url)}). Clicks and fills are now locked. If no free route exists, record deferred_paid.`;
  }
  if (verdict === "foreign") {
    audit("foreign_host", { url });
    await p.goBack({ timeout: 10_000 }).catch(() => {});
    return `Navigation to ${hostOf(url)} is outside this platform and was reversed.`;
  }
  return null;
}

// --- Page snapshot. A plain string so the bundler cannot inject helpers into the page. ---

const SNAPSHOT_JS = String.raw`((prefix) => {
  const out = [];
  let n = window.__laN || 0;
  const visible = (el) => {
    if (el.tagName === 'INPUT' && el.type === 'file') return true;
    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const labelOf = (el) => {
    const aria = el.getAttribute('aria-label'); if (aria) return aria;
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = clean(lb.split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' ')); if (t) return t; }
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && clean(l.innerText)) return l.innerText; }
    const wrap = el.closest('label'); if (wrap && clean(wrap.innerText)) return wrap.innerText;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) {
      let p = el.parentElement;
      for (let i = 0; i < 3 && p; i++, p = p.parentElement) {
        const l = p.querySelector('label, legend'); if (l && clean(l.innerText)) return l.innerText + (el.placeholder ? ' (' + el.placeholder + ')' : '');
      }
      if (el.placeholder) return el.placeholder;
    }
    return el.innerText || el.value || el.getAttribute('title') || el.getAttribute('name') || '';
  };
  const sel = 'input:not([type=hidden]), textarea, select, button, a[href], [role=button], [role=link], [role=checkbox], [role=radio], [role=combobox], [role=option], [role=menuitem], [role=tab], [role=switch], [contenteditable=""], [contenteditable=true], summary';
  for (const el of document.querySelectorAll(sel)) {
    if (!visible(el) || el.closest('[aria-hidden=true]')) continue;
    let ref = el.getAttribute('data-la-ref');
    if (!ref) { ref = prefix + 'e' + (++n); el.setAttribute('data-la-ref', ref); }
    const tag = el.tagName.toLowerCase();
    const d = { ref, tag, label: clean(labelOf(el)).slice(0, 100) };
    const role = el.getAttribute('role'); if (role) d.role = role;
    const type = el.getAttribute('type'); if (type) d.type = type;
    if (el.required || el.getAttribute('aria-required') === 'true') d.required = true;
    if (typeof el.maxLength === 'number' && el.maxLength > 0) d.maxlength = el.maxLength;
    if (tag === 'input' || tag === 'textarea') {
      if (el.type === 'checkbox' || el.type === 'radio') d.checked = el.checked;
      else if (el.type !== 'file' && el.type !== 'password') d.value = (el.value || '').slice(0, 80);
      if (el.accept) d.accept = el.accept;
      if (el.multiple) d.multiple = true;
    }
    if (el.getAttribute('aria-checked')) d.checked = el.getAttribute('aria-checked') === 'true';
    if (tag === 'select') d.options = [...el.options].slice(0, 100).map((o) => clean(o.label || o.text));
    if (tag === 'a') d.href = el.href.slice(0, 100);
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') d.disabled = true;
    if (el.isContentEditable && tag !== 'input' && tag !== 'textarea') { d.tag = 'richtext'; d.value = clean(el.innerText).slice(0, 80); }
    out.push(d);
  }
  window.__laN = n;
  // Stripe.js adds hidden 1px controller/metrics frames to any page that loads it; only a visible
  // card/payment frame or a card input counts.
  const payFrame = [...document.querySelectorAll('iframe[src*="stripe.com"], iframe[name^="__privateStripeFrame"], iframe[src*="paypal.com"]')]
    .some((f) => { const r = f.getBoundingClientRect(); return r.width > 2 && r.height > 2 && !/controller|m-outer|m\.stripe\.network/.test(f.src); });
  const payment = payFrame || !!document.querySelector('input[autocomplete^="cc-"], input[name*="cardnumber" i], input[name*="card_number" i], input[name*="cvc" i]');
  const password = !!document.querySelector('input[type=password]');
  const challenge = !!document.querySelector('iframe[src*="challenges.cloudflare.com"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .cf-turnstile, .g-recaptcha, .h-captcha');
  const text = (document.body ? document.body.innerText : '').replace(/\n{3,}/g, '\n\n').slice(0, 4000);
  // Busy pages (e.g. a launch-date picker under 300 testimonial links) overflow the agent's tool
  // result. Over the cap, keep every form control and drop links from the end first.
  const MAX = 180;
  let spareLinks = Math.max(0, MAX - out.filter((d) => d.tag !== 'a').length);
  const kept = out.length <= MAX ? out : out.filter((d) => d.tag !== 'a' || spareLinks-- > 0);
  return { elements: kept.slice(0, MAX), omitted: out.length - Math.min(kept.length, MAX), payment, password, challenge, text };
})`;

interface FrameSnapshot { elements: Record<string, unknown>[]; omitted: number; payment: boolean; password: boolean; challenge: boolean; text: string }

function framePrefix(p: Page, f: Frame): string {
  const i = p.frames().indexOf(f);
  return i <= 0 ? "" : `f${i}`;
}

async function snapshot(p: Page) {
  const frames = p.frames().filter((f) => {
    const host = hostOf(f.url());
    return f === p.mainFrame() || (host && !/stripe\.com|paypal\.com|doubleclick|google-analytics|googletagmanager|youtube\.com/.test(host));
  });
  const merged = { url: p.url(), title: await p.title().catch(() => ""), payment: false, password: false, challenge: false, frames: [] as { frame: string; url: string; text: string; elements: Record<string, unknown>[]; omitted_links?: number }[] };
  for (const f of frames) {
    const snap = await f.evaluate(`${SNAPSHOT_JS}(${JSON.stringify(framePrefix(p, f))})`).catch(() => null) as FrameSnapshot | null;
    if (!snap) continue;
    merged.payment ||= snap.payment;
    merged.password ||= snap.password;
    merged.challenge ||= snap.challenge;
    if (snap.elements.length || f === p.mainFrame()) merged.frames.push({ frame: framePrefix(p, f) || "main", url: f.url(), text: f === p.mainFrame() ? snap.text : snap.text.slice(0, 1500), elements: snap.elements, ...(snap.omitted ? { omitted_links: snap.omitted } : {}) });
  }
  if (p.frames().some((f) => /js\.stripe\.com\/v3\/elements-inner|paypal\.com/.test(f.url()))) merged.payment = true;
  if (merged.payment) { paymentPageUrl = p.url(); audit("payment_fields", { url: p.url() }); }
  return merged;
}

async function locate(ref: string): Promise<{ p: Page; loc: Locator }> {
  const p = await page();
  const m = /^(?:f(\d+))?e\d+$/.exec(ref);
  if (!m) throw new Error(`bad ref "${ref}"`);
  const frame = m[1] ? p.frames()[Number(m[1])] : p.mainFrame();
  if (!frame) throw new Error(`frame for ${ref} is gone; take a new snapshot`);
  const loc = frame.locator(`[data-la-ref="${ref}"]`);
  if ((await loc.count()) !== 1) throw new Error(`element ${ref} is gone; take a new snapshot`);
  return { p, loc };
}

// Locator.evaluate needs a real function: Playwright evaluates a string as an expression and never
// passes it the element. Keep these callbacks free of named inner functions (no bundler helpers).
async function describe(loc: Locator): Promise<{ label: string; tag: string; type: string; maxlength: number | null; editable: boolean; required: boolean }> {
  return loc.evaluate((el: HTMLElement) => {
    const input = el as HTMLInputElement;
    const forLabel = el.id ? document.querySelector<HTMLElement>(`label[for="${CSS.escape(el.id)}"]`) : null;
    const labelText = [el.closest("label")?.innerText ?? "", forLabel?.innerText ?? ""].join(" ").trim();
    // The field's own group: the widest ancestor (up to 3 levels) holding no other field. Its label
    // and any validation message the site shows there belong to this field.
    let group: HTMLElement | null = null;
    for (let a = el.parentElement, i = 0; a && i < 3; a = a.parentElement, i++) {
      if (a.querySelectorAll("input:not([type=hidden]), textarea, select, [contenteditable]").length > 1) break;
      group = a;
    }
    const near = group?.querySelector<HTMLElement>("label, legend")?.innerText ?? "";
    // e.g. TinyLaunch: no marker until a save shows "First name is required" under the field.
    const siteSaysRequired = el.getAttribute("aria-invalid") === "true"
      || /\bis required\b|\bmust be at least\b|\bcan(?:not|'t) be (?:blank|empty)\b/i.test(group?.innerText ?? "");
    return {
      label: [el.getAttribute("aria-label") ?? "", el.innerText || input.value || "", labelText]
        .join(" ").replace(/\s+/g, " ").trim().slice(0, 200),
      tag: el.tagName.toLowerCase(),
      type: (el.getAttribute("type") ?? "").toLowerCase(),
      maxlength: typeof input.maxLength === "number" && input.maxLength > 0 ? input.maxLength : null,
      editable: el.isContentEditable,
      // Marked required by attribute, by the usual "*" / "(required)" in its label, or by the site's
      // own validation message after a save attempt.
      required: input.required || el.getAttribute("aria-required") === "true" || siteSaysRequired
        || /\*|\brequired\b/i.test([labelText || near, el.getAttribute("aria-label") ?? ""].join(" ")),
    };
  });
}

function paymentLocked(): string | null {
  return paymentPageUrl ? `a payment page was detected at ${paymentPageUrl}; only goto, snapshot, screenshot and record are allowed` : null;
}

async function shot(label: string): Promise<string> {
  const p = await page();
  const dir = path.join(EVIDENCE_DIR, PRODUCT, PLATFORM);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${label.replace(/[^a-z0-9-]+/gi, "-").slice(0, 40)}.png`);
  await p.screenshot({ path: file, fullPage: false });
  screenshots.push(file);
  audit("screenshot", { file, url: p.url() });
  return file;
}

// --- Tools ---

const server = new McpServer({ name: "launch", version: "1.0.0" });

server.registerTool("status", {
  description: "Call first. Returns this item's platform playbook, batch grants, the approved copy bank (the ONLY text you may enter), allowed choices and assets.",
}, async () => ok({
  product: PRODUCT, batch: BATCH, launch_identity: config.launch_identity, grants: batch.grants, item,
  platform: { name: platform.name, home_url: platform.home_url, submit_url: platform.submit_url, domains: platform.domains, auth: platform.auth, badge: platform.badge, queue_note: platform.queue_note, eligibility: platform.eligibility, recipe: platform.recipe },
  owner_instructions: platformInstructions(PRODUCT, PLATFORM),
  site_notes: loadSiteNotes(PLATFORM),
  product_notes: loadTracker(PRODUCT).records[PLATFORM]?.notes ?? null,
  copy_bank: Object.fromEntries(Object.entries(bank.strings).map(([k, v]) => [k, v.map((t) => ({ length: t.length, text: t }))])),
  choices: bank.choices,
  assets: Object.keys(bank.assets),
}));

server.registerTool("goto", {
  description: "Open a URL on this platform's own domains. Other hosts are refused; Google sign-in is reached by clicking the site's Google button, and the inbox through find_email_link.",
  inputSchema: { url: z.url() },
}, async ({ url }) => {
  const blocked = guardOpen(); if (blocked) return refuse(blocked);
  if (classifyUrl(url, urlOpts) !== "platform") return refuse(`${hostOf(url)} is not one of ${platform.domains.join(", ")}`);
  const p = await page();
  audit("goto", { url });
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await settle(p);
  paymentPageUrl = null;
  const warn = await checkLocation(p);
  return ok({ url: p.url(), title: await p.title(), warning: warn });
});

server.registerTool("snapshot", {
  description: "List the page's visible interactive elements with refs, labels, max lengths and options, plus the page text. Refs are only valid until the next navigation.",
}, async () => {
  const blocked = guardOpen(); if (blocked) return refuse(blocked);
  const p = await page();
  const snap = await snapshot(p);
  const notes: string[] = [];
  if (snap.payment) notes.push("PAYMENT FIELDS PRESENT: clicks and fills are locked on this page.");
  if (snap.challenge) notes.push("A CAPTCHA/bot challenge is present. Do not try to solve it. If it blocks progress, record prepared_needs_human.");
  if (snap.password) notes.push("A password field is present. You may not enter passwords. If it blocks progress, record prepared_needs_human.");
  return ok({ tabs: pages.filter((x) => !x.isClosed()).map((x, i) => ({ index: i, url: x.url(), active: x === active })), notes, ...snap });
});

server.registerTool("fill", {
  description: "Fill a text field with an approved copy-bank string. The server picks the longest variant that fits the field's maxlength (or the shortest with prefer=short). You cannot type anything else.",
  inputSchema: { ref: z.string(), key: z.string(), prefer: z.enum(["long", "short"]).optional() },
}, async ({ ref, key, prefer }) => {
  const blocked = guardOpen() ?? paymentLocked(); if (blocked) return refuse(blocked);
  const variants = bank.strings[key];
  if (!variants) return refuse(`"${key}" is not in the copy bank. Allowed keys: ${Object.keys(bank.strings).join(", ")}. If a required field has no suitable key, record prepared_needs_human naming the field.`);
  const { p, loc } = await locate(ref);
  const info = await describe(loc);
  if (info.type === "password") return refuse("password fields are never filled");
  if (PERSONAL_KEYS.has(key) && !info.required) return refuse(`"${key}" is only entered into required fields, and this one is not marked required. Leave it empty. If the site may still need it, submit/save once without it: a validation message under the field (e.g. "is required") makes it count as required, then fill again.`);
  const value = pickVariant(variants, info.maxlength, prefer ?? "long");
  if (!value) return refuse(`no "${key}" variant fits maxlength ${info.maxlength}; lengths are ${variants.map((v) => v.length).join(", ")}`);
  if (info.editable && info.tag !== "input" && info.tag !== "textarea") {
    await loc.click();
    await p.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await p.keyboard.press("Backspace");
    await p.keyboard.insertText(value);
  } else {
    await loc.fill(value);
  }
  audit("fill", { ref, key, length: value.length, maxlength: info.maxlength });
  const after = await loc.evaluate((el: HTMLElement) => ((el as HTMLInputElement).value ?? el.innerText).length).catch(() => null);
  return ok({ filled: key, length: value.length, field_length_after: after, truncated_by_site: after != null && after < value.length - 2 });
});

server.registerTool("type_choice", {
  description: "Type an approved choice (category, tag, pricing model, alternative, platform) into a search box or combobox, then pick the matching option with click.",
  inputSchema: { ref: z.string(), value: z.string() },
}, async ({ ref, value }) => {
  const blocked = guardOpen() ?? paymentLocked(); if (blocked) return refuse(blocked);
  if (!choiceAllowed(value, allChoices)) return refuse(`"${value}" is not an approved choice: ${allChoices.join(", ")}`);
  const { p, loc } = await locate(ref);
  await loc.click();
  await loc.pressSequentially(value, { delay: 40 }).catch(async () => { await p.keyboard.insertText(value); });
  await p.waitForTimeout(800);
  audit("type_choice", { ref, value });
  return ok({ typed: value, next: "take a snapshot and click the matching option" });
});

server.registerTool("select_option", {
  description: "Choose one of a native <select>'s own options by its visible label.",
  inputSchema: { ref: z.string(), option: z.string() },
}, async ({ ref, option }) => {
  const blocked = guardOpen() ?? paymentLocked(); if (blocked) return refuse(blocked);
  const verdict = clickVerdict(option); if (!verdict.ok) return refuse(verdict.reason);
  const { loc } = await locate(ref);
  await loc.selectOption({ label: option });
  audit("select", { ref, option });
  return ok({ selected: option });
});

server.registerTool("set_checkbox", {
  description: "Tick or untick a checkbox/switch. Platform terms need the batch grant; newsletter and data-sharing opt-ins are always refused.",
  inputSchema: { ref: z.string(), checked: z.boolean() },
}, async ({ ref, checked }) => {
  const blocked = guardOpen() ?? paymentLocked(); if (blocked) return refuse(blocked);
  const { loc } = await locate(ref);
  const info = await describe(loc);
  if (checked) { const v = checkboxVerdict(info.label, batch.grants); if (!v.ok) return refuse(v.reason); }
  if (info.tag === "input") await loc.setChecked(checked);
  else {
    const now = await loc.getAttribute("aria-checked");
    if ((now === "true") !== checked) await loc.click();
  }
  audit("checkbox", { ref, checked, label: info.label.slice(0, 80) });
  return ok({ ref, checked });
});

server.registerTool("click", {
  description: "Click a button, link, option or tab. Spend-shaped labels (pay, upgrade, boost, prices...) are refused; so is anything on Google other than the launch account and Continue/Allow.",
  inputSchema: { ref: z.string() },
}, async ({ ref }) => {
  const blocked = guardOpen() ?? paymentLocked(); if (blocked) return refuse(blocked);
  const { p, loc } = await locate(ref);
  const info = await describe(loc);
  const host = hostOf(p.url()) ?? "";
  if (host === "accounts.google.com") {
    if (!batch.grants.sign_in_with_google) return refuse("Google sign-in is not granted in this batch");
    const hasPassword = await p.locator("input[type=password]:visible").count();
    if (hasPassword) return refuse("Google is asking for a password. Record prepared_needs_human: the launch profile needs a manual Google sign-in.");
    const v = googleClickVerdict(info.label, config.launch_identity); if (!v.ok) return refuse(v.reason);
  } else {
    const v = clickVerdict(info.label); if (!v.ok) return refuse(v.reason);
  }
  audit("click", { ref, label: info.label.slice(0, 100), url: p.url() });
  await loc.click({ timeout: 10_000 });
  const target = active ?? p;
  await settle(target);
  const warn = await checkLocation(target);
  return ok({ clicked: info.label.slice(0, 100), url: target.url(), warning: warn });
});

server.registerTool("upload", {
  description: "Attach approved assets (e.g. logo, screenshot_1) to a file input, or to a button that opens a file chooser.",
  inputSchema: { ref: z.string(), assets: z.array(z.string()).min(1).max(6) },
}, async ({ ref, assets }) => {
  const blocked = guardOpen() ?? paymentLocked(); if (blocked) return refuse(blocked);
  let files: string[];
  try { files = assets.map((a) => assetPath(PRODUCT, bank, a)); } catch (e) { return refuse(String(e)); }
  const { p, loc } = await locate(ref);
  const info = await describe(loc);
  if (info.tag === "input" && info.type === "file") await loc.setInputFiles(files);
  else {
    const chooser = p.waitForEvent("filechooser", { timeout: 8_000 });
    await loc.click();
    await (await chooser).setFiles(files);
  }
  await p.waitForTimeout(1500);
  audit("upload", { ref, assets });
  return ok({ uploaded: assets });
});

server.registerTool("press", {
  description: "Press a navigation key on the focused element.",
  inputSchema: { key: z.enum(["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp", "Space"]) },
}, async ({ key }) => {
  const blocked = guardOpen() ?? paymentLocked(); if (blocked) return refuse(blocked);
  const p = await page();
  await p.keyboard.press(key === "Space" ? " " : key);
  await p.waitForTimeout(600);
  const warn = await checkLocation(active ?? p);
  return ok({ pressed: key, warning: warn });
});

server.registerTool("scroll", { description: "Scroll the page to load lazy content.", inputSchema: { direction: z.enum(["down", "up"]) } }, async ({ direction }) => {
  const p = await page();
  await p.mouse.wheel(0, direction === "down" ? 900 : -900);
  await p.waitForTimeout(600);
  return ok({ scrolled: direction });
});

server.registerTool("switch_tab", { description: "Make another tab of this item active (e.g. a Google sign-in popup).", inputSchema: { index: z.int().min(0) } }, async ({ index }) => {
  const open = pages.filter((x) => !x.isClosed());
  const target = open[index];
  if (!target) return refuse(`no tab ${index}`);
  active = target;
  await target.bringToFront();
  return ok({ active: index, url: target.url() });
});

server.registerTool("wait", { description: "Wait for a page to finish something (max 15s).", inputSchema: { seconds: z.number().min(1).max(15) } }, async ({ seconds }) => {
  await (await page()).waitForTimeout(seconds * 1000);
  return ok({ waited: seconds });
});

server.registerTool("screenshot", { description: "Save a screenshot as evidence. Take one of every confirmation screen.", inputSchema: { label: z.string().max(40) } }, async ({ label }) => {
  return ok({ saved: await shot(label) });
});

server.registerTool("find_email_link", {
  description: "Search the launch inbox for a recent email from this platform and return the links in it that point at the platform's own domains (verification / magic links). Then open one with goto.",
}, async () => {
  const blocked = guardOpen(); if (blocked) return refuse(blocked);
  if (!batch.grants.open_verification_emails) return refuse("opening verification emails is not granted in this batch");
  if (!browser) await page();
  const context = browser!.contexts()[0]!;
  const inbox = await context.newPage();
  try {
    const q = encodeURIComponent(`from:(${platform.domains.join(" OR ")}) newer_than:1d`);
    await inbox.goto(`https://mail.google.com/mail/u/0/#search/${q}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await inbox.waitForTimeout(4000);
    const row = inbox.locator("tr.zA").first();
    if (!(await row.count())) return ok({ links: [], note: "no matching email in the last day; wait and retry once, then record prepared_needs_human" });
    await row.click();
    await inbox.waitForTimeout(2500);
    const hrefs = await inbox.locator("div.a3s a[href]").evaluateAll((els) => els.map((a) => (a as HTMLAnchorElement).href));
    const links = [...new Set(hrefs.map((h) => {
      // Gmail wraps links through google.com/url?q=...
      try { const u = new URL(h); return u.hostname.endsWith("google.com") && u.searchParams.get("q") ? u.searchParams.get("q")! : h; } catch { return h; }
    }))].filter((h) => classifyUrl(h, urlOpts) === "platform");
    audit("email_links", { count: links.length });
    return ok({ links: links.slice(0, 10) });
  } finally {
    await inbox.close().catch(() => {});
  }
});

server.registerTool("capture_badge", {
  description: "Read the platform's badge embed code and store it as structured data for the product's site. It reads the current page (textarea/code block) and whatever the page copied to the clipboard in this tab, so if the embed code is only behind a \"Copy embed code\" button, click that button first, then call this. Only an https link back to this platform plus an image are kept. When the page offers several badges (light/dark, sizes), prefer picks the snippet containing that word, e.g. \"dark\"; otherwise a light one is preferred.",
  inputSchema: { prefer: z.string().min(2).max(40).optional() },
}, async ({ prefer }) => {
  const blocked = guardOpen(); if (blocked) return refuse(blocked);
  if (!batch.grants.add_badge_to_footer) return refuse("badges are not granted in this batch");
  const p = await page();
  const onPage = await p.evaluate(`[...document.querySelectorAll('textarea, pre, code, input[type=text], [class*=code]')].map((e) => e.value || e.textContent || '')`) as string[];
  const copied: string[] = [];
  for (const f of p.frames()) copied.push(...(await f.evaluate(`[...(window.__laCopied || [])].reverse()`).catch(() => []) as string[]));
  const snippets = [...onPage, ...copied].filter((t) => /<a[\s>]/i.test(t) && /<img/i.test(t)).slice(0, 12);
  const wanted = prefer ? snippets.find((s) => s.toLowerCase().includes(prefer.toLowerCase())) : undefined;
  const chosen = wanted ?? snippets.find((s) => /light/i.test(s)) ?? snippets[0];
  const parsed = chosen ? parseBadgeSnippet(chosen, platform.domains) : null;
  if (!parsed) return refuse(`no usable badge snippet found (${snippets.length} candidate${snippets.length === 1 ? "" : "s"}). Snippets with scripts or non-platform links are rejected.`);
  capturedBadge = { platform: PLATFORM, ...parsed, captured_at: new Date().toISOString(), source_url: p.url() };
  audit("badge", { href: parsed.href, img: parsed.img_src, prefer: prefer ?? null, matched: !!wanted });
  return ok({ badge: capturedBadge, ...(prefer && !wanted ? { note: `no snippet mentions "${prefer}"; kept the default choice` } : {}) });
});

server.registerTool("note_recipe", {
  description: "Save a short, factual lesson for next time. scope \"site\": how this platform works for anyone (routes, field limits, dialogs to dismiss). scope \"product\": facts about this product here (its listing id or URL, categories chosen, queue date). No product copy.",
  inputSchema: { note: z.string().min(10).max(400), scope: z.enum(["site", "product"]) },
}, async ({ note, scope }) => {
  const line = `- ${new Date().toISOString().slice(0, 10)}: ${note.replace(/\s+/g, " ").trim()}`;
  if (scope === "site") appendSiteNote(PLATFORM, line);
  else appendProductNote(PRODUCT, PLATFORM, line);
  audit("recipe", { scope, note });
  return ok({ saved: line, scope });
});

const RECORDABLE = StateSchema.exclude(["planned"]);

server.registerTool("record", {
  description: "Finish this item. Call exactly once. Use the state the platform actually showed: submitted_pending_review, queued, scheduled, live (needs public_url), already_listed (needs public_url), waiting_badge (needs capture_badge first), prepared_needs_human (say exactly what the owner must do), blocked, deferred_paid, not_a_fit, unavailable.",
  inputSchema: {
    state: RECORDABLE,
    note: z.string().min(5).max(600),
    public_url: z.url().optional(),
    needs_human: z.string().max(300).optional(),
  },
}, async ({ state, note, public_url, needs_human }) => {
  if (closed) return refuse("already recorded");
  if ((state === "live" || state === "already_listed") && (!public_url || classifyUrl(public_url, urlOpts) !== "platform")) return refuse(`${state} needs a public_url on ${platform.domains.join(", ")}`);
  if (state === "waiting_badge" && !capturedBadge) return refuse("waiting_badge needs capture_badge first");
  if (state === "prepared_needs_human" && !needs_human) return refuse("say exactly what the owner must do in needs_human");
  const p = await page();
  const file = await shot(`record-${state}`).catch(() => null);
  const evidence = { at: new Date().toISOString(), url: p.url(), note, screenshot: file ? path.relative(EVIDENCE_DIR, file) : null };
  updateRecord(PRODUCT, PLATFORM, (r) => ({
    ...r, state, batch_id: BATCH, note,
    public_url: public_url ?? r.public_url,
    needs_human: state === "prepared_needs_human" ? needs_human ?? null : null,
    badge: capturedBadge ?? r.badge,
    evidence: [...r.evidence, evidence].slice(-20),
  }));
  closed = true;
  audit("record", { state, note, public_url });
  for (const x of pages) await x.close().catch(() => {});
  return ok({ recorded: state, next: "Stop now. Do not call any more tools." });
});

await server.connect(new StdioServerTransport());
