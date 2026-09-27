import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { jsonLine, type AgentBackend } from "./types.js";

const AGENT = "launch-submit";

/** Headless: no sharing, no update checks mid-run. */
const HEADLESS = { share: "disabled", autoupdate: false };

/**
 * An empty directory outside the repo, so OpenCode finds no project instruction files (AGENTS.md,
 * CLAUDE.md) to add to the agent's context.
 */
function emptyWorkDir(label: string): { cwd: string; cleanup: () => void } {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `launch-agent-${label}-`));
  return { cwd, cleanup: () => fs.rmSync(cwd, { recursive: true, force: true }) };
}

/**
 * OpenCode: `opencode run --agent launch-submit`, configured per run through OPENCODE_CONFIG_CONTENT.
 * The agent's permissions deny every tool ("*") and then allow only the launch server's tools
 * ("launch_*"); OpenCode applies the last matching rule, and agent rules come after the user's own
 * config, so nothing the user configured elsewhere (other MCP servers, skills) is reachable.
 * Nothing is ever "ask": a headless run has nobody to answer.
 */
export const opencode: AgentBackend = {
  name: "opencode",
  binary: "opencode",
  setupHint: "Install OpenCode (https://opencode.ai) and connect a model provider with `opencode auth login`. Set `model` in config.yaml as provider/model.",

  invocation({ runDir, task, instructions, mcp, model }) {
    const config = {
      $schema: "https://opencode.ai/config.json",
      mcp: { [mcp.name]: { type: "local", command: [mcp.command, ...mcp.args], environment: mcp.env, enabled: true } },
      agent: {
        [AGENT]: {
          description: "Submits one product to one directory using only the guarded launch tools.",
          mode: "primary",
          prompt: instructions,
          ...(model ? { model } : {}),
          permission: { "*": "deny", [`${mcp.name}_*`]: "allow" },
        },
      },
      ...HEADLESS,
    };
    const work = emptyWorkDir(path.basename(runDir));
    const args = ["run", "--agent", AGENT, "--format", "json", "--dir", work.cwd];
    if (model) args.push("--model", model);
    args.push(task);
    return { command: "opencode", args, ...work, env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config) } };
  },

  foreignTool(line, mcpName) {
    const event = jsonLine(line);
    if (!event) return null;
    // `run --format json` emits {"type":"tool_use","part":{"type":"tool","tool":"<name>","state":{...}}}
    // when a call completes or fails. A denied built-in still shows up here, as an error.
    if (event.type !== "tool_use") return null;
    const part = (event.part ?? {}) as { type?: string; tool?: string };
    if (part.type === "tool" && part.tool && !part.tool.startsWith(`${mcpName}_`)) return `opencode tried to call ${part.tool}, which is not a ${mcpName} tool`;
    return null;
  },
};
