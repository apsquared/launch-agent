# launch-agent: running it from chat

The user drives this repo from Codex or Claude Code chat. Read README.md for the design and safety rules;
this file is the chat workflow. A workspace can hold several products; `<product>` below is
`default_product` in `workspace/config.yaml` unless the user names another. `AGENTS.local.md`, if present, holds private additions for both clients. Read it explicitly; it is not auto-discovered. In Claude Code, also honor `CLAUDE.local.md`.

The repo is split in two. The tool (`src/`, `prompts/`, `platforms/`, `policy.yaml`, `examples/`) is shared
and open source; the user's data is in `workspace/` (gitignored, or `$LAUNCH_AGENT_WORKSPACE`):
`config.yaml`, `products/<slug>/` (product.yaml, copy bank, assets), `batches/`, `tracker/`, `site-notes/`,
`.runs/`, `evidence/`. None of it may ever be committed: only `workspace/` is ignored inside the repo, and
`src/paths.ts` refuses any other in-repo workspace.

## What the user will ask, and which skill does it

Each workflow is a skill in `.agents/skills/` (Codex reads them there; `.claude/skills/` links to the
same files for Claude Code). If your client doesn't load skills, read the `SKILL.md` and follow it.

| User says | Skill |
|---|---|
| "set up a new product", "is everything set up?", something won't start, "on <directory>, always …" | `launch-setup` |
| "draft my copy", "fill in the copy bank", "use my repo at <path>" | `copy-draft` |
| "propose a batch", "show me the batch", "approve" | `batch-review` |
| "run a pass", "just run <directory>", "status", "what's left", "I did the step for <directory>" | `launch-pass` |
| "let me watch it do <directory>", "do <directory> with me", a directory stuck on a CAPTCHA or email code | `launch-watched` (Claude Code only) |
| "share/promote what the runs learned", "update the recipes" | `promote-site-notes` |

## Running commands from chat

- The chat client and submission backend are independent. Codex operates these npm commands;
  `workspace/config.yaml` still selects `claude` or `opencode` for guarded submissions.
- Use the existing checkout for launch operations so it uses the existing gitignored workspace.
  If operating from an isolated worktree, explicitly set `LAUNCH_AGENT_WORKSPACE` to the owner's
  existing workspace; do not initialize a replacement or copy private data into tracked files.
- In Codex, launch `pass` or `run` with a short shell yield timeout, retain the returned process/session
  ID, and poll that same process until it exits. In Claude Code use `run_in_background: true` and
  follow its task output. Never start a second pass because the first command is still running.
- Do not report success from the launch acknowledgment. Read the completed command output and
  per-product digests, and report errors or incomplete items accurately.
- Use the guarded runner for submissions. Do not bypass it with the chat client's browser, shell,
  direct HTTP, or other MCP tools to fill forms or submit listings.
- No global Codex settings, plugins, or MCP registration are required for this chat workflow.
  Do not register the launch MCP server globally or in this project's `.mcp.json`: it runs only inside a
  headless submission session, or inside the `launch-watched` subagent, which starts its own copy.

## Things that stay with the user

- **Google sign-in** (`npm run chrome:login`): you may launch it, but the user types the password.
  Never enter credentials, email codes or CAPTCHA answers, in Chrome or anywhere else.
- **Emailed sign-in codes** (`auth: email_code` platforms): the user signs the launch profile in by hand.
- **Paid tiers**: nothing is bought; `deferred_paid` items stay parked unless the user acts.

## Changing the tool

- Product-specific details (names, URLs, copy, assets, badge sites, fit ratings, listing ids) belong in the
  workspace, never in `src/`, `platforms/` or `policy.yaml`. `platforms/*.yaml` describe the site only; a
  run's lesson that is really about one product belongs in that tracker record's `notes`.
- Keep the user's data (anything in `workspace/`, the Chrome profile) out of anything meant to be shared,
  and flag it if a change would expose it.
- Good `workspace/site-notes/` lessons can be promoted into a platform's `recipe` for everyone. Offer it
  when a pass learned something general; strip anything product-specific first.

## Don'ts

- Don't edit `workspace/products/*/copy-bank.yaml` (including with `copy:apply`), `assets/` or a directory's
  `instructions` without the user asking. Any change invalidates the approval fingerprint, and the batch then needs a fresh review and approval
  in chat. (Fit ratings and badge settings are not part of the approval.)
- Don't hand-edit `workspace/batches/*.yaml` approval fields or `approval_fingerprint`.
- Don't loosen `policy.yaml`, `src/guards.ts`, or the tool lockdown and watchdog in `src/agents/`. Run `npm test` after touching `platforms/*.yaml` or the
  workspace's YAML (it validates `examples/workspace` and `workspace/`).
- Chrome on port 9333 must be the launch profile. If a run fails with "did not expose DevTools", the
  user still has the login Chrome open: ask them to quit it (⌘Q).
