# Codex submission backend assessment

Codex can operate the repo through `AGENTS.md` and the existing npm commands. This does not
make Codex the agent executing each directory submission. That backend remains Claude Code or
OpenCode, selected in the private workspace config.

## Required boundary

`src/agents/types.ts` requires a submission session to expose only the guarded launch MCP tools:
no shell, filesystem, browser, web, unrelated MCP, or delegation tools. The transcript watchdog
is secondary detection, not authorization: observing a foreign call after execution cannot undo it.

The current Codex CLI configuration has not been verified to provide this boundary. Do not add
`codex` to the accepted `agent` values or advertise native submission support until it does.

## Findings (2026-09-26)

- The local npm-installed CLI package was `@openai/codex` 0.101.0. `codex --version` exited 137
  both in the sandbox and on an unsandboxed retry. No live Codex submission was attempted.
  Diagnose or repair that CLI before attempting integration validation; the cause is unconfirmed.
- The [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
  exposes a shell feature toggle, web-search controls and MCP-specific tool filters. These are
  not a general allowlist for all built-in tools. Unknown configuration keys must not be assumed
  to enforce restrictions.
- [Hooks](https://learn.chatgpt.com/docs/hooks) can deny supported calls, but hosted tools and
  specialized paths can bypass the hook path. Hook failures also need careful handling.
  A hook-only adapter would not establish this repo's required boundary.
- The upstream Rust implementation has `ToolPolicy.allowed_tools`, supplied through
  `ExtensionDataInit` before thread startup. This is a promising **embedded host** route,
  not a verified stock CLI option. Its applicability, stability and build requirements need
  validation before choosing it. See the
  [tool policy source](https://github.com/openai/codex/blob/7f6c0f9387a0a60f396f61cc58f6b38bc98f2473/codex-rs/ext/extension-api/src/tool_policy.rs)
  and [tool construction source](https://github.com/openai/codex/blob/7f6c0f9387a0a60f396f61cc58f6b38bc98f2473/codex-rs/core/src/tools/spec_plan.rs).

## Implementation and acceptance steps

1. Obtain a working Codex executable and pin the tested version. Verify a supported way to set
   a startup tool allowlist, or build a small embedded host using the Rust tool policy. Do not
   substitute `read-only` sandboxing, instructions, or a post-execution watchdog for the allowlist.
2. Implement `src/agents/codex.ts` using `AgentBackend`: one fresh session per directory, the same
   submission prompt and MCP environment, optional model selection, and deterministic cleanup.
   Isolate configuration, project instructions, hooks, skills, plugins and memory while using a
   documented authentication mechanism. Never log or commit account credentials.
3. Before exposing a real launch server, test the actual tool catalog and attempted forbidden
   calls against a fixture MCP server. Verify that shell execution, file reads/edits, web access,
   unrelated MCP tools and subagents cannot execute. Include adversarial page text in the fixture.
4. Implement event-stream watchdog handling and prove that foreign tool events stop the child
   and remaining submissions. Cover process errors, timeout, cleanup and malformed events.
5. Only then register the backend, update `ConfigSchema` and example config comments, document
   authentication/model selection, and add unit and CLI integration tests to `npm test`.
6. Smoke-test one explicitly approved directory batch. Report the recorded result and evidence,
   and keep incomplete/live-unverified outcomes distinct from successful submissions.

No workspace configuration or existing batch approvals were changed as part of the chat port.
