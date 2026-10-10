/** What the runner and digest read from an item's last record. */
import assert from "node:assert/strict";
import { stoppedAtGoogleSignIn, whereToAct } from "./item.js";
import type { State } from "./schemas.js";
import { emptyRecord } from "./store.js";

const at = (state: State, url: string | null) => ({
  ...emptyRecord("site", null), state,
  evidence: url ? [{ at: "2026-01-01T00:00:00.000Z", url, note: "n", screenshot: null }] : [],
});
const google = "https://accounts.google.com/v3/signin/challenge/pwd?TL=abc&client_id=1&state=xyz";

// An item that stopped on Google's password prompt means the launch profile's session expired.
assert.equal(stoppedAtGoogleSignIn(at("prepared_needs_human", google)), true);
assert.equal(stoppedAtGoogleSignIn(at("prepared_needs_human", "https://site.example/submit")), false);
assert.equal(stoppedAtGoogleSignIn(at("blocked", google)), false);
assert.equal(stoppedAtGoogleSignIn(undefined), false);

// The digest links to the directory, never to a Google sign-in URL carrying tokens.
const platform = { domains: ["site.example"], submit_url: "https://site.example/submit", home_url: "https://site.example/" };
assert.equal(whereToAct(at("prepared_needs_human", google), platform), "https://site.example/submit");
assert.equal(whereToAct(at("prepared_needs_human", "https://app.site.example/verify"), platform), "https://app.site.example/verify");
assert.equal(whereToAct(at("prepared_needs_human", null), { ...platform, submit_url: null }), "https://site.example/");

console.log("item ok");
