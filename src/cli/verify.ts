/**
 * Logged-out check of every listing with a public URL. A fresh, cookie-less Chrome opens the page;
 * it counts as live when it resolves and links to our site. On a live listing it also records whether
 * that link is followed and whether the page may be indexed. Never touches the launch profile.
 *
 *   npm run verify [-- --product <slug>]
 */
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";
import { CHROME_BINARY } from "../paths.js";
import { CONFIRMED_STATES } from "../schemas.js";
import { loadCopyBank, loadTracker, resolveProduct, updateRecord } from "../store.js";
import { looksPending, productLinkMatcher } from "../listing-check.js";

const { values } = parseArgs({ options: { product: { type: "string" } } });
const product = resolveProduct(values.product);
const bank = loadCopyBank(product);
const siteUrl = bank.strings.url?.[0];
if (!siteUrl) throw new Error("copy bank has no url");
const linksToProduct = productLinkMatcher(siteUrl);

const records = Object.values(loadTracker(product).records)
  .filter((r) => r.public_url && (CONFIRMED_STATES.has(r.state) || r.state === "already_listed"));
if (!records.length) { console.log("Nothing with a public URL to verify yet."); process.exit(0); }

const browser = await chromium.launch({ executablePath: CHROME_BINARY, headless: true });
try {
  for (const r of records) {
    const page = await browser.newPage();
    try {
      const res = await page.goto(r.public_url!, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(2500);
      const links = await page.locator("a[href]").evaluateAll((els) => els.map((a) => ({ href: (a as HTMLAnchorElement).href, rel: a.getAttribute("rel") ?? "" })));
      const ours = links.filter((l) => linksToProduct(l.href));
      const linksUs = ours.length > 0;
      const ok = !!res && res.status() < 400 && linksUs;
      const pending = looksPending(await page.locator("body").innerText().catch(() => ""));
      if (ok && !pending) {
        // A page-wide robots nofollow (meta tag or X-Robots-Tag header) overrides each link's own rel.
        const metas = await page.locator('meta[name="robots" i], meta[name="googlebot" i]').evaluateAll((els) => els.map((m) => m.getAttribute("content") ?? ""));
        const robots = [...metas, res!.headers()["x-robots-tag"] ?? ""].join(",").toLowerCase();
        const link = {
          follow: !/\b(?:nofollow|none)\b/.test(robots) && ours.some((l) => !/\b(?:nofollow|ugc|sponsored)\b/i.test(l.rel)),
          indexable: !/\b(?:noindex|none)\b/.test(robots),
          checked_at: new Date().toISOString(),
        };
        updateRecord(product, r.platform, (x) => ({ ...x, state: x.state === "already_listed" ? x.state : "live", verified_live_at: link.checked_at, link }));
        console.log(`✓ ${r.platform} live, ${link.follow ? "dofollow" : "nofollow"}${link.indexable ? "" : ", page noindex"}: ${r.public_url}`);
      } else {
        console.log(`· ${r.platform} not live yet (status ${res?.status() ?? "none"}, links to us: ${linksUs}, pending label: ${pending})`);
      }
    } catch (e) {
      console.log(`· ${r.platform} check failed: ${String(e).slice(0, 120)}`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
