/**
 * One-time (and occasional) manual step: sign the dedicated Chrome profile into the launch Google
 * account. Chrome starts without remote debugging so Google sees an ordinary browser session.
 * The password is typed by the owner, never by this repo.
 */
import { cdpAlive, launchChrome } from "../chrome.js";
import { CHROME_PROFILE_DIR } from "../paths.js";
import { loadConfig } from "../store.js";

const config = loadConfig();
if (await cdpAlive()) {
  console.log("The launch Chrome is running with remote debugging (a run may be in progress). Quit that window (Cmd+Q) and re-run this.");
  process.exit(1);
}
launchChrome({ debugging: false, url: "https://accounts.google.com/" });
console.log(`Opened Chrome with the launch profile (${CHROME_PROFILE_DIR}).

  1. Sign in as ${config.launch_identity}. Tick "stay signed in" if offered.
  2. Open https://mail.google.com once so the inbox is ready for verification links.
  3. Quit that Chrome window (Cmd+Q). Runs start it again with debugging enabled.

Use this profile for nothing else.`);
