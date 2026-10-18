import type { Badge } from "./schemas.js";
import { loadProduct } from "./store.js";

/** The page a product's badges must appear on, or null when the product has none configured. */
export function badgeCheckUrl(product: string): string | null {
  const { badges } = loadProduct(product);
  return badges.enabled ? badges.check_url : null;
}

/** Why a plain request for a page failed, in words the owner can act on. */
export function unreadableReason(status: number): string {
  if (status === 429 || status === 403 || status === 503) {
    return `it answered HTTP ${status}, which usually means the host's bot protection or rate limit turned the request away. Directories' own server-side checks (badge verification, previews, site analyzers) will most likely be blocked too: allow plain requests to this page in the host's bot settings`;
  }
  return `it answered HTTP ${status}`;
}

/** A plain, cookie-less GET of a public page, with no browser headers, the way a directory's server fetches it. */
export async function readPublicPage(url: string): Promise<{ html: string } | { error: string }> {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { error: unreadableReason(res.status) };
    return { html: await res.text() };
  } catch (err) {
    return { error: `the request failed (${String((err as Error).cause ?? (err as Error).message).slice(0, 120)})` };
  }
}

export interface ProductionCheck {
  /** Badges whose link is not on the product's badge page yet; all of them when the page couldn't be read. */
  missing: Badge[];
  /** Set when the page couldn't be read: the missing list then says nothing about what's deployed. */
  unreadable: string | null;
}

export async function badgesMissingOnProduction(product: string, badges: readonly Badge[]): Promise<ProductionCheck> {
  const url = badgeCheckUrl(product);
  if (!badges.length) return { missing: [], unreadable: null };
  if (!url) return { missing: [...badges], unreadable: null };
  const page = await readPublicPage(url);
  if ("error" in page) return { missing: [...badges], unreadable: `couldn't read ${url}: ${page.error}` };
  return { missing: badges.filter((b) => !page.html.includes(b.href) && !page.html.includes(b.href.replace(/&/g, "&amp;"))), unreadable: null };
}
