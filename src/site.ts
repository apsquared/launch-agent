/**
 * Read a product's own public pages for copy:sources (the copy-draft skill). Plain HTTP first; a site that renders its text
 * with JavaScript is opened in a throwaway headless Chrome with a fresh profile, never the launch
 * profile, so nothing is signed in.
 */
import fs from "node:fs";
import { chromium } from "playwright-core";
import { htmlToText, subpageLinks, type Source } from "./draft.js";
import { CHROME_BINARY } from "./paths.js";

/** Below this much text, the page most likely renders client-side. */
const THIN = 500;
const MAX_PAGE_CHARS = 12_000;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}

async function renderHtml(urls: readonly string[]): Promise<string[]> {
  const browser = await chromium.launch({ executablePath: CHROME_BINARY, headless: true });
  try {
    const page = await browser.newPage({ userAgent: UA });
    const out: string[] = [];
    for (const url of urls) {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 }).catch(() => page.waitForTimeout(3000));
      out.push(await page.content());
    }
    return out;
  } finally {
    await browser.close();
  }
}

/** The homepage plus up to three pricing/features/about pages, as text. `log` hears what happened. */
export async function readSite(url: string, log: (msg: string) => void): Promise<Source[]> {
  let fetchError: Error | null = null;
  const home = await fetchHtml(url).catch((err: Error) => { fetchError = err; return ""; });
  const urls = [url, ...subpageLinks(home, url).filter((u) => u !== url.replace(/\/$/, ""))];
  let htmls = [home, ...await Promise.all(urls.slice(1).map((u) => fetchHtml(u).catch(() => "")))];
  if (htmlToText(home).length < THIN) {
    if (fs.existsSync(CHROME_BINARY)) {
      log(`${fetchError ? `A plain request failed (${(fetchError as Error).message})` : "The page has little text without JavaScript"}; rendering it in a headless Chrome (fresh profile).`);
      const rendered = await renderHtml([url]);
      const more = subpageLinks(rendered[0]!, url).filter((u) => u !== url.replace(/\/$/, ""));
      urls.splice(1, urls.length, ...more);
      htmls = [rendered[0]!, ...(more.length ? await renderHtml(more) : [])];
    } else if (fetchError) {
      throw fetchError;
    } else {
      log(`The page has little text without JavaScript, and Chrome was not found at ${CHROME_BINARY} to render it.`);
    }
  }
  return urls.map((u, i): Source => ({ kind: "page", ref: u, text: htmlToText(htmls[i] ?? "").slice(0, MAX_PAGE_CHARS) })).filter((p) => p.text.length > 0);
}
