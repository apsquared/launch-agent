import type { Badge } from "./schemas.js";
import { loadProduct } from "./store.js";

/** The page a product's badges must appear on, or null when the product has none configured. */
export function badgeCheckUrl(product: string): string | null {
  const { badges } = loadProduct(product);
  return badges.enabled ? badges.check_url : null;
}

/** Badges whose link is not on the product's badge page yet. If that page can't be fetched, all of them. */
export async function badgesMissingOnProduction(product: string, badges: readonly Badge[]): Promise<Badge[]> {
  const url = badgeCheckUrl(product);
  if (!badges.length) return [];
  if (!url) return [...badges];
  const html = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    .then((r) => (r.ok ? r.text() : "")).catch(() => "");
  return badges.filter((b) => !html.includes(b.href) && !html.includes(b.href.replace(/&/g, "&amp;")));
}
