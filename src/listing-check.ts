/** Pure checks behind `verify`: does a public listing page link to the product, and is it still pending? */

// Whole words only: listing copy often says "spending", which contains "pending". The rest are how
// Huzzler ("Not published"), PeerPush ("Coming soon"), Uneed ("Launching in N days") and Dev Hunt
// ("Launching October 9, 2029", "launches Oct 9") mark a public page that has not launched yet.
const PENDING_LABEL =
  /\b(?:pending|under review|awaiting approval|waiting for approval|not (?:yet )?published|coming soon|launching in|launch(?:ing|es) (?:on )?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b)/i;

export function looksPending(pageText: string): boolean {
  return PENDING_LABEL.test(pageText);
}

/**
 * A matcher for links to the product. On its own domain any page counts; on a shared host (a GitHub
 * repo, say) only links under the product's path do, so the directory's own GitHub link doesn't.
 */
export function productLinkMatcher(siteUrl: string): (href: string) => boolean {
  const site = new URL(siteUrl);
  const host = (h: string) => h.toLowerCase().replace(/^www\./, "");
  const base = site.pathname.replace(/\/+$/, "").toLowerCase();
  return (href) => {
    let u: URL;
    try { u = new URL(href); } catch { return false; }
    if (host(u.hostname) !== host(site.hostname)) return false;
    const p = u.pathname.toLowerCase();
    return !base || p === base || p.startsWith(base + "/");
  };
}
