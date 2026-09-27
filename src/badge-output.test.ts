import assert from "node:assert/strict";
import { badgeFormat, renderBadges } from "./badge-output.js";
import type { Badge } from "./schemas.js";

assert.equal(badgeFormat("/site/lib/badges.ts", null), "ts");
assert.equal(badgeFormat("/site/data/badges.JSON", null), "json");
assert.equal(badgeFormat("/site/partials/badges.htm", null), "html");
assert.equal(badgeFormat("/site/badges.txt", null), "html");
assert.equal(badgeFormat("/site/badges.ts", "json"), "json");

const badge: Badge = {
  platform: "huzzler", href: "https://huzzler.so/p/x?utm_source=a&utm_medium=b", img_src: "https://huzzler.so/b.png",
  alt: 'Huzzler "featured" <badge>', width: 159, height: null, captured_at: "2026-09-26T00:00:00.000Z", source_url: "https://huzzler.so/p/x/badges",
};

const html = renderBadges("html", [badge], { huzzler: "Huzzler" });
assert.match(html, /<a href="https:\/\/huzzler\.so\/p\/x\?utm_source=a&amp;utm_medium=b" target="_blank" rel="noopener">/);
assert.match(html, /alt="Huzzler &quot;featured&quot; &lt;badge&gt;" width="159" loading="lazy">/);
assert.doesNotMatch(html, /height=/);
assert.doesNotMatch(html, /nofollow/); // directories check for a followed link back

const json = JSON.parse(renderBadges("json", [badge], { huzzler: "Huzzler" }));
assert.deepEqual(Object.keys(json[0]), ["platform", "href", "img_src", "alt", "width", "height", "name"]);
assert.equal(json[0].name, "Huzzler");

const ts = renderBadges("ts", [badge]);
assert.match(ts, /export const DIRECTORY_BADGES: readonly DirectoryBadge\[\] = \[/);
assert.doesNotMatch(ts, /captured_at|source_url/);

console.log("badge output ok");
