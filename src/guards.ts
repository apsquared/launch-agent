/**
 * Hard rules the browser tools enforce in code. The agent's prompt repeats them, but nothing here
 * depends on the agent following its prompt: a blocked action is refused before it reaches the page.
 */

export function hostOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

export function hostMatches(host: string, allowed: readonly string[]): boolean {
  return allowed.some((a) => host === a || host.endsWith(`.${a}`));
}

export type UrlVerdict = "platform" | "auth" | "inbox" | "payment" | "blank" | "foreign";

export function classifyUrl(url: string, opts: { platformDomains: readonly string[]; authHosts: readonly string[]; paymentHosts: readonly string[] }): UrlVerdict {
  if (url === "about:blank" || url.startsWith("chrome://")) return "blank";
  const host = hostOf(url);
  if (!host) return "foreign";
  // Payment first: a platform can host its own checkout on a subdomain we otherwise allow.
  if (hostMatches(host, opts.paymentHosts) || /\/(checkout|billing|payment|pay)(\/|$|\?)/i.test(new URL(url).pathname)) return "payment";
  if (hostMatches(host, opts.platformDomains)) return "platform";
  if (host === "mail.google.com") return "inbox";
  if (hostMatches(host, opts.authHosts)) return "auth";
  return "foreign";
}

const SPEND_WORDS = /\b(pay|payment|checkout|purchase|buy|upgrade|subscribe|boost|premium|pro plan|go pro|add to cart|order now|donate|tip|sponsor|featured listing|promote)\b|[$€£]\s?\d|\d\s?(usd|eur)\b/i;
const DECLINE_WORDS = /\b(free|no,? thanks|skip|not now|maybe later|continue without|decline|stay on free|keep free)\b|[$€£]\s?0(\.00)?(?![\d.])/i;

/** A click is refused if its label talks about spending money, unless it is plainly the way out. */
export function clickVerdict(label: string): { ok: true } | { ok: false; reason: string } {
  const text = label.replace(/\s+/g, " ").trim();
  if (SPEND_WORDS.test(text) && !DECLINE_WORDS.test(text)) return { ok: false, reason: `label "${text.slice(0, 80)}" looks like a paid action` };
  if (/\b(delete|remove) (my )?(account|product|listing)\b/i.test(text)) return { ok: false, reason: "destructive account action" };
  return { ok: true };
}

const TERMS = /\b(terms|conditions|privacy|policy|guidelines|rules|agree|accept|pledge|code of conduct)\b/i;
const MARKETING = /\b(newsletter|marketing|promotional|offers|updates from|subscribe|partners?|third[- ]part(y|ies)|share my)\b/i;

/** Checkboxes: platform terms need the batch grant; marketing opt-ins are always left unticked. */
export function checkboxVerdict(label: string, grants: { accept_platform_terms: boolean }): { ok: true } | { ok: false; reason: string } {
  if (MARKETING.test(label) && !TERMS.test(label)) return { ok: false, reason: "marketing or data-sharing opt-in; leave unticked" };
  if (TERMS.test(label) && !grants.accept_platform_terms) return { ok: false, reason: "accepting terms is not granted in this batch" };
  return { ok: true };
}

/** On Google's own pages only account choice and consent continuation are allowed. */
export function googleClickVerdict(label: string, identity: string): { ok: true } | { ok: false; reason: string } {
  const text = label.toLowerCase();
  if (text.includes(identity.toLowerCase())) return { ok: true };
  if (/^(continue|allow|next|confirm|sign in|choose|select)\b/.test(text.trim())) return { ok: true };
  return { ok: false, reason: `on Google, only the ${identity} account tile and Continue/Allow are clickable` };
}

/** Pick the longest approved variant that fits a field's maximum length. */
export function pickVariant(variants: readonly string[], maxLength: number | null, prefer: "long" | "short" = "long"): string | null {
  const fitting = variants.filter((v) => maxLength == null || maxLength <= 0 || v.length <= maxLength);
  if (!fitting.length) return null;
  const sorted = [...fitting].sort((a, b) => a.length - b.length);
  return prefer === "short" ? sorted[0]! : sorted[sorted.length - 1]!;
}

/** A value typed into a search box or combobox must be one of the approved choices. */
export function choiceAllowed(value: string, allowed: readonly string[]): boolean {
  const v = value.trim().toLowerCase();
  return allowed.some((a) => a.trim().toLowerCase() === v);
}

export interface ParsedBadge { href: string; img_src: string; alt: string; width: number | null; height: number | null }

/**
 * Parse a platform's embed snippet into plain data. Scripts, inline styles and anything not
 * https are dropped: the site renders the badge from these fields, never from the raw HTML.
 */
export function parseBadgeSnippet(snippet: string, platformDomains: readonly string[]): ParsedBadge | null {
  if (/<script/i.test(snippet)) return null;
  const href = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(snippet)?.[1];
  const img = /<img\b[^>]*>/i.exec(snippet)?.[0];
  if (!href || !img) return null;
  const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(img)?.[1];
  const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(img)?.[1] ?? "";
  const width = Number(/\bwidth\s*=\s*["']?(\d+)/i.exec(img)?.[1] ?? NaN);
  const height = Number(/\bheight\s*=\s*["']?(\d+)/i.exec(img)?.[1] ?? NaN);
  const decode = (s: string) => s.replace(/&amp;/g, "&");
  const hrefUrl = decode(href);
  const srcUrl = src ? decode(src) : null;
  const hrefHost = hostOf(hrefUrl);
  if (!srcUrl || !hrefUrl.startsWith("https://") || !srcUrl.startsWith("https://") || !hrefHost) return null;
  if (!hostMatches(hrefHost, platformDomains)) return null;
  return {
    href: hrefUrl, img_src: srcUrl, alt: alt.slice(0, 120),
    width: Number.isFinite(width) && width > 0 ? width : null,
    height: Number.isFinite(height) && height > 0 ? height : null,
  };
}
