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
