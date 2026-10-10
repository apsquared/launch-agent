/** Each agent backend gets only the launch tools, and its watchdog spots anything else. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claude } from "./agents/claude.js";
import { opencode } from "./agents/opencode.js";
import type { AgentInput } from "./agents/types.js";

const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "launch-agent-agents-"));
const input: AgentInput = {
  runDir, item: "tinylaunch", task: "Submit x to TinyLaunch.", instructions: "PROMPT", model: null,
  mcp: { name: "launch", command: "/repo/node_modules/.bin/tsx", args: ["/repo/src/mcp/server.ts"], env: { LA_PLATFORM: "tinylaunch" } },
};

try {
  // --- Claude: the exact lockdown flags, and none of the user's or project's customizations. ---
  const c = claude.invocation(input);
  assert.equal(c.command, "claude");
  assert.deepEqual(c.args, [
    "-p", "Submit x to TinyLaunch.", "--append-system-prompt", "PROMPT",
    "--mcp-config", path.join(runDir, "tinylaunch.mcp.json"), "--strict-mcp-config",
    "--tools", "", "--allowedTools", "mcp__launch", "--permission-mode", "dontAsk",
    "--setting-sources", "", "--settings", '{"autoMemoryEnabled":false}', "--disable-slash-commands", "--restricted",
    "--no-session-persistence", "--output-format", "stream-json", "--verbose",
  ]);
  assert.ok(!path.relative(os.tmpdir(), c.cwd!).startsWith(".."), "claude runs in an empty temp dir, outside any repo");
  assert.deepEqual(fs.readdirSync(c.cwd!), []);
  c.cleanup!();
  assert.equal(fs.existsSync(c.cwd!), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(runDir, "tinylaunch.mcp.json"), "utf8")).mcpServers.launch.env, { LA_PLATFORM: "tinylaunch" });
  const withModel = claude.invocation({ ...input, model: "opus" });
  withModel.cleanup!();
  assert.deepEqual(withModel.args.slice(-2), ["--model", "opus"]);
  assert.ok(Object.keys(withModel.env).every((k) => !/^CLAUDE/.test(k) || k === "CLAUDE_CONFIG_DIR" || k.startsWith("CLAUDE_CODE_USE_")));

  const init = (tools: string[]) => JSON.stringify({ type: "system", subtype: "init", tools });
  const call = (name: string) => JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "ok" }, { type: "tool_use", id: "t1", name, input: {} }] } });
  assert.equal(claude.foreignTool(init(["mcp__launch__goto", "mcp__launch__record"]), "launch"), null);
  assert.match(claude.foreignTool(init(["mcp__launch__goto", "Bash", "Read"]), "launch") ?? "", /Bash, Read/);
  assert.equal(claude.foreignTool(call("mcp__launch__click"), "launch"), null);
  assert.match(claude.foreignTool(call("WebFetch"), "launch") ?? "", /WebFetch/);
  assert.match(claude.foreignTool(call("mcp__other__x"), "launch") ?? "", /mcp__other__x/);
  assert.equal(claude.foreignTool("not json", "launch"), null);
  // The usage limit ends a session with a 429 result; anything else is not a limit.
  const result = (extra: object) => JSON.stringify({ type: "result", subtype: "success", is_error: true, ...extra });
  assert.equal(claude.usageLimit!(result({ api_error_status: 429, result: "You've hit your session limit · resets 11:20pm" })), "You've hit your session limit · resets 11:20pm");
  assert.equal(claude.usageLimit!(result({ api_error_status: 429 })), "usage limit reached");
  assert.equal(claude.usageLimit!(result({ api_error_status: null, is_error: false, result: "Submitted." })), null);
  assert.equal(claude.usageLimit!(JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } })), null);
  assert.equal(claude.usageLimit!("not json"), null);

  // The init event must show none of the user's setup: installed plugins, skills, slash commands, memory.
  const clean = { type: "system", subtype: "init", tools: ["mcp__launch__status"], skills: [], slash_commands: [],
    plugins: [{ name: "agents-md", path: "/x", source: "agents-md@builtin" }] };
  const leaks = (extra: object) => claude.foreignTool(JSON.stringify({ ...clean, ...extra }), "launch") ?? "";
  assert.equal(claude.foreignTool(JSON.stringify(clean), "launch"), null);
  assert.match(leaks({ plugins: [...clean.plugins, { name: "hooky", path: "/p", source: "hooky@some-market" }] }), /customizations.*hooky@some-market/);
  assert.match(leaks({ plugins: [{ name: "nosource", path: "/p" }] }), /nosource/);
  assert.match(leaks({ skills: ["copywriting"], slash_commands: ["copywriting", "compact"] }), /1 skills; 2 slash_commands/);
  assert.match(leaks({ memory_paths: { auto: "/home/u/.claude/projects/x/memory/" } }), /memory \/home\/u/);
  assert.equal(leaks({ memory_paths: {} }), "");

  // --- OpenCode: deny everything, then allow only launch_*; never "ask"; prompt and MCP server passed through. ---
  const o = opencode.invocation({ ...input, model: "opencode/some-model" });
  assert.equal(o.command, "opencode");
  assert.deepEqual(o.args.slice(0, 6), ["run", "--agent", "launch-submit", "--format", "json", "--dir"]);
  assert.equal(o.args[6], o.cwd);
  assert.ok(!path.relative(os.tmpdir(), o.cwd!).startsWith(".."), "opencode runs in an empty temp dir, outside any repo");
  assert.deepEqual(fs.readdirSync(o.cwd!), []);
  o.cleanup!();
  assert.equal(fs.existsSync(o.cwd!), false);
  assert.deepEqual(o.args.slice(-3), ["--model", "opencode/some-model", "Submit x to TinyLaunch."]);
  const config = JSON.parse(o.env.OPENCODE_CONFIG_CONTENT!);
  const agent = config.agent["launch-submit"];
  assert.deepEqual(Object.entries(agent.permission), [["*", "deny"], ["launch_*", "allow"]], "rule order matters: the last match wins");
  assert.doesNotMatch(JSON.stringify(config), /"ask"/);
  assert.equal(agent.prompt, "PROMPT");
  assert.deepEqual(config.mcp.launch, { type: "local", command: ["/repo/node_modules/.bin/tsx", "/repo/src/mcp/server.ts"], environment: { LA_PLATFORM: "tinylaunch" }, enabled: true });
  assert.deepEqual(Object.keys(config.mcp), ["launch"]);

  const event = (type: string, part: object) => JSON.stringify({ type, timestamp: 1, sessionID: "s", part });
  assert.equal(opencode.foreignTool(event("tool_use", { type: "tool", tool: "launch_status", state: { status: "completed" } }), "launch"), null);
  assert.match(opencode.foreignTool(event("tool_use", { type: "tool", tool: "bash", state: { status: "error" } }), "launch") ?? "", /bash/);
  assert.match(opencode.foreignTool(event("tool_use", { type: "tool", tool: "otherserver_query", state: { status: "completed" } }), "launch") ?? "", /otherserver_query/);
  assert.equal(opencode.foreignTool(event("text", { type: "text", text: "I'll use bash" }), "launch"), null);
  assert.equal(opencode.foreignTool(JSON.stringify({ type: "error", error: { name: "APIError" } }), "launch"), null);

  console.log("agents ok");
} finally {
  fs.rmSync(runDir, { recursive: true, force: true });
}
