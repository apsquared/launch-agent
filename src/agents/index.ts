import { spawnSync } from "node:child_process";
import { claude } from "./claude.js";
import { opencode } from "./opencode.js";
import type { AgentBackend } from "./types.js";

export const AGENTS = { claude, opencode } as const satisfies Record<string, AgentBackend>;
export type AgentName = keyof typeof AGENTS;
export const AGENT_NAMES = Object.keys(AGENTS) as [AgentName, ...AgentName[]];

/** True when the backend's CLI runs. */
export function agentInstalled(agent: AgentBackend): boolean {
  return spawnSync(agent.binary, ["--version"], { stdio: "ignore", timeout: 20_000 }).status === 0;
}
