/**
 * An agent backend: the CLI that runs one submission. Every backend gets the same prompt and the
 * same guarded MCP server, and must expose nothing else: no shell, no file access, no web tools.
 * The guards live in the MCP server, so safety never depends on the backend; only how well a
 * submission goes does.
 */

/** The one MCP server a submission may use, as a command the backend launches over stdio. */
export interface McpLaunch {
  /** Server name. Backends prefix tool names with it (mcp__launch__goto, launch_goto). */
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface AgentInput {
  /** Working directory for the child: the batch's run dir, never the repo. */
  runDir: string;
  /** Item slug, for naming per-item files. */
  item: string;
  /** The user-turn message: which product, platform and batch. */
  task: string;
  /** prompts/submit.md: appended to or used as the system prompt. */
  instructions: string;
  mcp: McpLaunch;
  /** Backend-specific model id; null = the backend's default. */
  model: string | null;
}

export interface AgentInvocation {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  /** Working directory for the child; defaults to runDir. */
  cwd?: string;
  /** Called once the child has exited, e.g. to remove a temp working directory. */
  cleanup?: () => void;
}

export interface AgentBackend {
  name: string;
  /** Executable that must be on PATH. */
  binary: string;
  /** How to install and log in, for error messages. */
  setupHint: string;
  invocation(input: AgentInput): AgentInvocation;
  /**
   * Inspect one line of the child's output. Return a reason to stop the run when it shows a tool
   * that is not the launch server's: a startup tool list, or an attempted call. This is a second
   * line of defence behind each backend's own lockdown, and never replaces it.
   */
  foreignTool(line: string, mcpName: string): string | null;
  /**
   * Inspect one line of the child's output. Return the provider's message when it shows the account
   * hit its usage limit, so the runner stops instead of spending attempts on every remaining item.
   */
  usageLimit?(line: string): string | null;
}

/** Parse one JSON line, or null. Backends emit one event per line. */
export function jsonLine(line: string): Record<string, unknown> | null {
  if (!line.startsWith("{")) return null;
  try { return JSON.parse(line) as Record<string, unknown>; } catch { return null; }
}
