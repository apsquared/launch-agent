import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { jsonLine, type AgentBackend } from "./types.js";

/** No user, project or local settings files (managed/admin settings still apply), no skills, no memory. */
const ISOLATION = [
  "--setting-sources", "",
  "--settings", JSON.stringify({ autoMemoryEnabled: false }),
  "--disable-slash-commands",
  "--restricted",
  "--no-session-persistence",
];

/**
 * An empty directory outside the repo, so no project CLAUDE.md, CLAUDE.local.md or project memory is
 * found even if a flag stops covering it.
 */
function emptyWorkDir(label: string): { cwd: string; cleanup: () => void } {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `launch-agent-${label}-`));
  return { cwd, cleanup: () => fs.rmSync(cwd, { recursive: true, force: true }) };
}

/**
 * The environment for the headless claude child. When a pass is started from a Claude Code chat,
 * that session's own variables (CLAUDECODE, CLAUDE_CODE_SESSION_ID, its messaging socket, ...)
 * would leak into the child; drop them so it behaves as if started from a terminal. Account and
 * provider settings (CLAUDE_CONFIG_DIR, CLAUDE_CODE_USE_*) are kept.
 */
function childEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([k]) =>
    !/^CLAUDE/.test(k) || k === "CLAUDE_CONFIG_DIR" || k.startsWith("CLAUDE_CODE_USE_")));
}

/**
 * Claude Code: `claude -p` with every built-in tool removed and only the launch MCP server. The
 * session also loads none of the user's or project's customizations: no settings files (and so no
 * hooks, enabled plugins or settings env), no CLAUDE.md, no skills or slash commands, no auto-memory.
 * Login still comes from the account (keychain / CLAUDE_CONFIG_DIR / CLAUDE_CODE_USE_*).
 */
export const claude: AgentBackend = {
  name: "claude",
  binary: "claude",
  setupHint: "Install Claude Code (https://claude.com/claude-code) and log in with `claude`.",

  invocation({ runDir, item, task, instructions, mcp, model }) {
    const mcpConfig = path.join(runDir, `${item}.mcp.json`);
    fs.writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { [mcp.name]: { command: mcp.command, args: mcp.args, env: mcp.env } } }, null, 2));
    const args = [
      "-p", task,
      "--append-system-prompt", instructions,
      "--mcp-config", mcpConfig,
      "--strict-mcp-config",
      "--tools", "",
      "--allowedTools", `mcp__${mcp.name}`,
      "--permission-mode", "dontAsk",
      ...ISOLATION,
      "--output-format", "stream-json", "--verbose",
    ];
    if (model) args.push("--model", model);
    return { command: "claude", args, env: childEnv(), ...emptyWorkDir(path.basename(runDir)) };
  },

  foreignTool(line, mcpName) {
    const event = jsonLine(line);
    if (!event) return null;
    const prefix = `mcp__${mcpName}__`;
    // The init event lists every tool the session has.
    if (event.type === "system" && event.subtype === "init" && Array.isArray(event.tools)) {
      const foreign = (event.tools as string[]).filter((t) => !t.startsWith(prefix));
      if (foreign.length) return `claude session started with tools outside ${mcpName}: ${foreign.slice(0, 8).join(", ")}`;
      const leak = customizations(event);
      if (leak) return `claude session started with the user's customizations loaded: ${leak}`;
    }
    if (event.type === "assistant") {
      const content = (event.message as { content?: { type: string; name?: string }[] } | undefined)?.content ?? [];
      const call = content.find((c) => c.type === "tool_use" && !c.name?.startsWith(prefix));
      if (call) return `claude tried to call ${call.name}, which is not a ${mcpName} tool`;
    }
    return null;
  },
};

/**
 * What the init event shows of the user's own setup: plugins other than Claude Code's built-in ones
 * (they can bring hooks), skills or slash commands, and an auto-memory folder. The flags in
 * `invocation` should leave none of these; if a CLI update brings them back, the run stops.
 */
function customizations(init: Record<string, unknown>): string | null {
  const found: string[] = [];
  const plugins = Array.isArray(init.plugins) ? init.plugins as { name?: string; source?: string }[] : [];
  const installed = plugins.filter((p) => !p.source?.endsWith("@builtin")).map((p) => p.source ?? p.name ?? "?");
  if (installed.length) found.push(`plugins ${installed.slice(0, 8).join(", ")}`);
  for (const key of ["skills", "slash_commands"]) {
    const list = init[key];
    if (Array.isArray(list) && list.length) found.push(`${list.length} ${key}`);
  }
  const memory = init.memory_paths;
  if (memory && typeof memory === "object" && Object.values(memory).some(Boolean)) found.push(`memory ${Object.values(memory).filter(Boolean).join(", ")}`);
  return found.length ? found.join("; ") : null;
}
