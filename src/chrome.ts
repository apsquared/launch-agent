import { spawn } from "node:child_process";
import fs from "node:fs";
import { chromium, type Browser } from "playwright-core";
import { CDP_PORT, CHROME_BINARY, CHROME_PROFILE_DIR } from "./paths.js";

/**
 * The runner drives an ordinary Chrome over the DevTools protocol, the same way Chrome DevTools
 * MCP does. The profile is a normal Chrome profile the operator signed into by hand; there is no
 * stealth patching, fingerprint spoofing or challenge solving anywhere in this repo.
 */
export async function cdpAlive(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch { return false; }
}

export function launchChrome(opts: { debugging: boolean; url?: string }): void {
  fs.mkdirSync(CHROME_PROFILE_DIR, { recursive: true });
  const args = [`--user-data-dir=${CHROME_PROFILE_DIR}`, "--no-first-run", "--no-default-browser-check"];
  if (opts.debugging) args.push(`--remote-debugging-port=${CDP_PORT}`, "--remote-debugging-address=127.0.0.1");
  if (opts.url) args.push(opts.url);
  spawn(CHROME_BINARY, args, { detached: true, stdio: "ignore" }).unref();
}

export async function ensureChrome(): Promise<void> {
  if (await cdpAlive()) return;
  launchChrome({ debugging: true });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await cdpAlive()) return;
  }
  throw new Error(`Chrome did not expose DevTools on port ${CDP_PORT}. Is another Chrome using ${CHROME_PROFILE_DIR} without debugging? Quit it and retry.`);
}

/**
 * A macOS Chrome with no windows left (record closes the item's tabs) rejects connectOverCDP with
 * "Browser context management is not supported", so make sure one tab exists first.
 */
async function ensurePage(): Promise<void> {
  const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json() as Promise<{ type: string }[]>).catch(() => []);
  if (targets.some((t) => t.type === "page")) return;
  await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: "PUT" }).catch(() => {});
}

export async function connect(): Promise<Browser> {
  await ensureChrome();
  await ensurePage();
  return chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
}

/**
 * Whether the launch profile is still signed in to Google: myaccount.google.com stays put when it
 * is and redirects to Google's sign-in page once the session has expired. null when it can't tell
 * (offline, a timeout, an unexpected page), so callers carry on. Opens and closes one tab in the
 * running launch Chrome; it reads no cookies.
 */
export async function googleSignedIn(): Promise<boolean | null> {
  let browser: Browser | null = null;
  try {
    browser = await connect();
    const page = await browser.contexts()[0]!.newPage();
    try {
      await page.goto("https://myaccount.google.com/", { waitUntil: "domcontentloaded", timeout: 20_000 });
      const host = new URL(page.url()).hostname;
      return host === "myaccount.google.com" ? true : host === "accounts.google.com" ? false : null;
    } finally {
      await page.close().catch(() => {});
    }
  } catch {
    return null;
  } finally {
    await browser?.close().catch(() => {}); // disconnects; the launch Chrome keeps running
  }
}
