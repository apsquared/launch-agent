/** What the runner and digest read from an item's last record. */
import assert from "node:assert/strict";
import { awaitsBadgeRecheck, stoppedAtGoogleSignIn, whereToAct } from "./item.js";
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

// A live listing waits on the site's badge re-check only when its dofollow is badge-conditional,
// the badge was captured, and verify saw the link nofollow.
const badge = { platform: "site", href: "https://site.example/", img_src: "https://site.example/b.svg", alt: "Featured", width: null, height: null, captured_at: "2026-01-01T00:00:00.000Z", source_url: "https://site.example/badges" };
const live = (follow: boolean | null) => ({
  ...at("live", null), public_url: "https://site.example/p/acme", badge,
  link: follow === null ? null : { follow, indexable: true, checked_at: "2026-01-01T00:00:00.000Z" },
});
const badgeOffer = { link: "dofollow", link_requirement: "badge" } as const;
assert.equal(awaitsBadgeRecheck(live(false), badgeOffer), true);
assert.equal(awaitsBadgeRecheck(live(true), badgeOffer), false);
assert.equal(awaitsBadgeRecheck(live(null), badgeOffer), false, "verify hasn't read the link yet");
assert.equal(awaitsBadgeRecheck({ ...live(false), badge: null }, badgeOffer), false, "no badge to re-check");
assert.equal(awaitsBadgeRecheck({ ...live(false), state: "already_listed" }, badgeOffer), false, "may not be our listing");
assert.equal(awaitsBadgeRecheck(live(false), { link: "dofollow", link_requirement: "none" }), false, "a re-check can't change an unconditional link");
assert.equal(awaitsBadgeRecheck(live(false), { link: "dofollow", link_requirement: "badge-and-ranking" }), false, "a badge alone can't earn it");
assert.equal(awaitsBadgeRecheck(live(false), { link: "nofollow", link_requirement: "badge" }), false);
assert.equal(awaitsBadgeRecheck(undefined, badgeOffer), false);

console.log("item ok");
