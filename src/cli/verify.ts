/**
 * Logged-out check of every listing with a public URL. A fresh, cookie-less Chrome opens the page;
 * it counts as live when it resolves and links to our site. Never touches the launch profile.
 *
 *   npm run verify [-- --product <slug>]
 */
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";
import { CHROME_BINARY } from "../paths.js";
import { CONFIRMED_STATES } from "../schemas.js";
import { loadCopyBank, loadTracker, resolveProduct, updateRecord } from "../store.js";

const { values } = parseArgs({ options: { product: { type: "string" } } });
const product = resolveProduct(values.product);
const bank = loadCopyBank(product);
const siteUrl = bank.strings.url?.[0];
if (!siteUrl) throw new Error("copy bank has no url");
const siteHost = new URL(siteUrl).hostname.replace(/^www\./, "");

// Whole words only: listing copy often says "spending", which contains "pending". The last three are
// how Huzzler ("Not published"), PeerPush ("Coming soon") and Uneed ("Launching in N days") mark a
// public page that has not launched yet.
const PENDING_LABEL = /\b(?:pending|under review|awaiting approval|waiting for approval|not (?:yet )?published|coming soon|launching in)\b/i;

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
      const links = await page.locator("a[href]").evaluateAll((els) => els.map((a) => (a as HTMLAnchorElement).href));
      const linksUs = links.some((h) => { try { return new URL(h).hostname.replace(/^www\./, "") === siteHost; } catch { return false; } });
      const ok = !!res && res.status() < 400 && linksUs;
      const pending = PENDING_LABEL.test(await page.locator("body").innerText().catch(() => ""));
      if (ok && !pending) {
        updateRecord(product, r.platform, (x) => ({ ...x, state: x.state === "already_listed" ? x.state : "live", verified_live_at: new Date().toISOString() }));
        console.log(`✓ ${r.platform} live: ${r.public_url}`);
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
