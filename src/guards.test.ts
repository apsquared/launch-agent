import assert from "node:assert/strict";
import { checkboxVerdict, choiceAllowed, classifyUrl, clickVerdict, googleClickVerdict, parseBadgeSnippet, pickVariant } from "./guards.js";
import { copyBankPlaceholders, missingFromCopyBank } from "./store.js";

const opts = { platformDomains: ["tinylaunch.com"], authHosts: ["accounts.google.com", "clerk.accounts.dev"], paymentHosts: ["checkout.stripe.com", "lemonsqueezy.com"] };

// URLs
assert.equal(classifyUrl("https://www.tinylaunch.com/submit", opts), "platform");
assert.equal(classifyUrl("https://tinylaunch.com/", opts), "platform");
assert.equal(classifyUrl("https://eviltinylaunch.com/", opts), "foreign");
assert.equal(classifyUrl("https://accounts.google.com/o/oauth2", opts), "auth");
assert.equal(classifyUrl("https://mail.google.com/mail/u/0/", opts), "inbox");
assert.equal(classifyUrl("https://checkout.stripe.com/c/pay/cs_123", opts), "payment");
assert.equal(classifyUrl("https://store.lemonsqueezy.com/buy/1", opts), "payment");
assert.equal(classifyUrl("https://www.tinylaunch.com/checkout?plan=premium", opts), "payment");
assert.equal(classifyUrl("https://www.tinylaunch.com/pricing", opts), "platform");
assert.equal(classifyUrl("about:blank", opts), "blank");

// Clicks
for (const bad of ["Upgrade to Premium", "Pay $49", "Checkout", "Boost my launch", "Buy now", "Get featured – $19", "Subscribe", "Sponsor this week"]) {
  assert.equal(clickVerdict(bad).ok, false, bad);
}
for (const good of ["Submit", "Continue with free launch", "No thanks", "Skip", "Next", "Schedule launch", "Continue with Google", "Save draft", "Stay on free plan", "Submit for free"]) {
  assert.equal(clickVerdict(good).ok, true, good);
}
assert.equal(clickVerdict("Delete account").ok, false);
assert.equal(clickVerdict("Launch for $0").ok, true);
assert.equal(clickVerdict("Launch for $0.99").ok, false);
assert.equal(clickVerdict("Launch for $09").ok, false);

// Checkboxes
assert.equal(checkboxVerdict("I agree to the Terms of Service", { accept_platform_terms: true }).ok, true);
assert.equal(checkboxVerdict("I agree to the Terms of Service", { accept_platform_terms: false }).ok, false);
assert.equal(checkboxVerdict("Subscribe to our newsletter", { accept_platform_terms: true }).ok, false);
assert.equal(checkboxVerdict("Share my data with partners", { accept_platform_terms: true }).ok, false);
assert.equal(checkboxVerdict("Free", { accept_platform_terms: true }).ok, true);

// Google
assert.equal(googleClickVerdict("Alex Example launch@example.com", "launch@example.com").ok, true);
assert.equal(googleClickVerdict("Continue", "launch@example.com").ok, true);
assert.equal(googleClickVerdict("Use another account", "launch@example.com").ok, false);
assert.equal(googleClickVerdict("Create account", "launch@example.com").ok, false);

// Variants
const v = ["Invoices in one click", "Send invoices and get paid without chasing clients", "Send invoices, track payments and follow up on late clients automatically"];
assert.equal(pickVariant(v, 30), v[0]);
assert.equal(pickVariant(v, 60), v[1]);
assert.equal(pickVariant(v, null), v[2]);
assert.equal(pickVariant(v, null, "short"), v[0]);
assert.equal(pickVariant(v, 10), null);

// Choices
assert.ok(choiceAllowed("project management", ["Project Management"]));
assert.ok(!choiceAllowed("Crypto", ["Project Management"]));

// Badges
const snippet = `<a href="https://www.tinylaunch.com/launch/123?utm_source=badge&amp;x=1" target="_blank"><img src="https://www.tinylaunch.com/tinylaunch_badge_light.svg" alt="TinyLaunch Badge" style="width: 202px; height: auto;" width="202" /></a>`;
const parsed = parseBadgeSnippet(snippet, ["tinylaunch.com"]);
assert.deepEqual(parsed, { href: "https://www.tinylaunch.com/launch/123?utm_source=badge&x=1", img_src: "https://www.tinylaunch.com/tinylaunch_badge_light.svg", alt: "TinyLaunch Badge", width: 202, height: null });
assert.equal(parseBadgeSnippet(`<script src="x"></script>${snippet}`, ["tinylaunch.com"]), null);
assert.equal(parseBadgeSnippet(snippet.replace(/www\.tinylaunch\.com\/launch/, "evil.com/launch"), ["tinylaunch.com"]), null);
assert.equal(parseBadgeSnippet(snippet.replace("https://www.tinylaunch.com/tinylaunch", "http://x.com/b"), ["tinylaunch.com"]), null);

// Template text can never be approved.
const bank = { product: "x", strings: { name: ["Acme"], tagline: ["TODO pitch", "Real pitch"] }, choices: { categories: ["TODO"], tags: [], pricing_models: ["Free"], alternatives_to: [], platforms: [], tech_stack: [] }, assets: {} };
assert.deepEqual(copyBankPlaceholders(bank), ["tagline: TODO pitch", "choices.categories: TODO"]);
assert.deepEqual(copyBankPlaceholders({ ...bank, strings: { name: ["Todoist clone"] }, choices: { ...bank.choices, categories: ["Tasks"] } }), []);

// A playbook's requires: absent, empty or TODO-only values are missing; real ones are not.
assert.deepEqual(missingFromCopyBank(bank, ["strings.name", "strings.tagline", "strings.repo_url", "choices.tech_stack", "choices.categories", "choices.pricing_models", "assets.logo"]),
  ["strings.repo_url", "choices.tech_stack", "choices.categories", "assets.logo"]);
assert.deepEqual(missingFromCopyBank({ ...bank, choices: { ...bank.choices, tech_stack: ["Next.js"] }, assets: { logo: "assets/logo.png" } }, ["choices.tech_stack", "assets.logo"]), []);

console.log("guards ok");
