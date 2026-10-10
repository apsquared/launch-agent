import { spawn } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline";
import type { AgentBackend, AgentInput } from "./types.js";

export interface AgentResult {
  code: number | null;
  timedOut: boolean;
  /** Set when the watchdog stopped the run because a non-launch tool appeared. */
  stopped: string | null;
  /** The provider's message when the account hit its usage limit (e.g. "...resets 11:20pm"). */
  limited: string | null;
}

/**
 * Run one submission with a backend, writing its raw output to `transcript`. Every output line
 * passes the backend's watchdog; a tool outside the launch server ends the run at once.
 */
export function runAgent(backend: AgentBackend, input: AgentInput, opts: { timeoutMs: number; transcript: string }): Promise<AgentResult> {
  const { command, args, env, cwd, cleanup } = backend.invocation(input);
  const out = fs.createWriteStream(opts.transcript, { flags: "a" });
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: cwd ?? input.runDir, env, stdio: ["ignore", "pipe", "pipe"] });
    let timedOut = false;
    let stopped: string | null = null;
    let limited: string | null = null;
    const stop = (reason: string) => {
      if (stopped) return;
      stopped = reason;
      out.write(`${JSON.stringify({ type: "launch_agent_watchdog", stopped: reason })}\n`);
      child.kill("SIGTERM");
    };
    for (const stream of [child.stdout, child.stderr]) {
      readline.createInterface({ input: stream }).on("line", (line) => {
        out.write(`${line}\n`);
        const reason = backend.foreignTool(line, input.mcp.name);
        if (reason) stop(reason);
        limited ??= backend.usageLimit?.(line) ?? null;
      });
    }
    child.on("error", (err) => stop(`could not start ${command}: ${err.message}`));
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, opts.timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      out.end();
      try { cleanup?.(); } catch { /* a leftover temp dir is harmless */ }
      resolve({ code, timedOut, stopped, limited });
    });
  });
}
