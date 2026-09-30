import assert from "node:assert/strict";
import { looksPending, productLinkMatcher } from "./listing-check.js";

// Dev Hunt's free queue: a public page that has not launched.
assert.ok(looksPending("Launching October 9, 2029"));
assert.ok(looksPending("Launch Agent launches Oct 9"));
assert.ok(looksPending("Launching in 12 days"));
assert.ok(looksPending("Status: Pending review"));
assert.ok(!looksPending("Stop spending weekends on forms"));
assert.ok(!looksPending("For indie hackers launching a product"));
assert.ok(!looksPending("Launched October 9, 2026"));

// A product on a shared host: only links under its own path count.
const repo = productLinkMatcher("https://github.com/apsquared/launch-agent");
assert.ok(repo("https://github.com/apsquared/launch-agent?ref=devhunt"));
assert.ok(repo("https://www.github.com/apsquared/launch-agent/"));
assert.ok(repo("https://github.com/apsquared/launch-agent/blob/main/README.md"));
assert.ok(!repo("https://github.com/MarsX-dev/devhunt"));
assert.ok(!repo("https://github.com/apsquared/launch-agent-other"));
assert.ok(!repo("not a url"));

// A product on its own domain: any page there counts.
const site = productLinkMatcher("https://www.buyercue.io/");
assert.ok(site("https://buyercue.io/pricing?utm_source=x"));
assert.ok(!site("https://example.com/buyercue.io"));

console.log("listing check ok");
