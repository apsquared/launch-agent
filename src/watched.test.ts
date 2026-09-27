/** Watched runs keep the headless guarantees: only the launch tools, one set-up item, nothing stale. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { WATCHED_MAX_HOURS, watchedFile, watchedItem } from "./item.js";
import { ROOT } from "./paths.js";
import { PROJECT_AGENT_FILE, WATCHED_ADDENDUM, renderWatchedAgent } from "./watched-agent.js";

// --- The subagent: generated, only the launch tools, its own server, the same instructions ---
assert.equal(fs.readFileSync(PROJECT_AGENT_FILE, "utf8"), renderWatchedAgent(null), ".claude/agents/launch-watched.md is stale: run npm run watch:agent");
const front = (text: string) => YAML.parse(/^---\n([\s\S]*?)\n---\n/.exec(text)![1]!) as Record<string, unknown>;
const project = front(renderWatchedAgent(null));
assert.equal(project.tools, "mcp__launch", "the watched subagent gets the launch tools and nothing else");
assert.equal(project.disallowedTools, undefined);
const servers = project.mcpServers as Record<string, { command: string; args: string[]; env: Record<string, string> }>[];
assert.equal(servers.length, 1);
assert.deepEqual(Object.keys(servers[0]!), ["launch"]);
assert.deepEqual(servers[0]!.launch!.env, { LA_WATCHED: "1" });
assert.equal(servers[0]!.launch!.command, "node_modules/.bin/tsx");
assert.equal(project.omitClaudeMd, true);
const body = renderWatchedAgent(null);
assert.ok(body.includes(fs.readFileSync(path.join(ROOT, "prompts/submit.md"), "utf8").trim()), "the subagent follows prompts/submit.md");
assert.ok(body.includes(WATCHED_ADDENDUM));
assert.match(WATCHED_ADDENDUM, /NEEDS_YOU:/);

const user = front(renderWatchedAgent({ root: "/opt/launch-agent", workspace: "/home/u/.launch-agent/workspace" }));
const userServer = (user.mcpServers as Record<string, { command: string; args: string[]; env: Record<string, string> }>[])[0]!.launch!;
assert.equal(userServer.command, "/opt/launch-agent/node_modules/.bin/tsx");
assert.deepEqual(userServer.args, ["/opt/launch-agent/src/mcp/server.ts"]);
assert.deepEqual(userServer.env, { LA_WATCHED: "1", LAUNCH_AGENT_WORKSPACE: "/home/u/.launch-agent/workspace" });

// The project allows the launch tools without a prompt (the subagent runs in dontAsk mode), and nothing else.
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ROOT, ".claude/settings.json"), "utf8")), { permissions: { allow: ["mcp__launch"] } });

// --- The watched item ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "launch-agent-watched-"));
try {
  assert.throws(() => watchedItem(tmp), /no watched run is active/);
  const started = new Date("2026-01-01T10:00:00.000Z");
  fs.writeFileSync(watchedFile(tmp), JSON.stringify({ product: "acme", platform: "tinylaunch", batch: "b1", badge_retry: false, started_at: started.toISOString(), record_before: null }));
  assert.deepEqual(watchedItem(tmp, new Date(started.getTime() + 60_000)), { product: "acme", platform: "tinylaunch", batch: "b1" });
  assert.throws(() => watchedItem(tmp, new Date(started.getTime() + (WATCHED_MAX_HOURS + 1) * 3_600_000)), /expired/);
  fs.writeFileSync(watchedFile(tmp), JSON.stringify({ product: "acme" }));
  assert.throws(() => watchedItem(tmp));

  // A watched launch server with no watched run refuses to start.
  const workspace = path.join(tmp, "ws");
  fs.mkdirSync(workspace);
  const res = spawnSync(path.join(ROOT, "node_modules/.bin/tsx"), [path.join(ROOT, "src/mcp/server.ts")], {
    encoding: "utf8", timeout: 30_000, input: "",
    env: { ...process.env, LA_WATCHED: "1", LA_PRODUCT: "acme", LA_PLATFORM: "tinylaunch", LA_BATCH: "b1", LAUNCH_AGENT_WORKSPACE: workspace },
  });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /no watched run is active/, "in watched mode the environment's item is ignored");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("watched ok");
