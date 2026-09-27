# Security

launch-agent lets an AI agent drive a signed-in Chrome on third-party websites. Its core promise is
that the agent's limits are enforced in code, not left to the prompt. If you find a way around them,
please tell us privately first.

## Reporting

Use GitHub's private reporting: the **Security** tab of this repository → **Report a vulnerability**.
Please don't open a public issue, pull request or discussion for a security problem.

Include what you ran (commit, agent backend and model, directory), what the agent or a web page did,
and the log lines from `workspace/.runs/<batch>/<directory>.jsonl` if you have them. Remove your own
product data and anything from your Google account before sending.

We aim to acknowledge a report within 3 working days and to agree on a disclosure date with you once
a fix is ready. This is a small project, so there is no bug bounty, but we credit reporters who want it.

## In scope

Anything that breaks a guarantee in the "How it stays safe" section of HOW_TO.md, for example:

- **Guard bypasses:** the submitting agent typing text that isn't in the approved copy bank, reaching
  a host outside the directory's domains, spending money, filling a password field, ticking a
  marketing opt-in, or acting on a batch that isn't approved or whose copy changed since approval.
- **Lockdown escapes:** a headless submission session getting any tool besides the launch
  server's (shell, files, web, other MCP servers), or loading the user's own settings, hooks, plugins,
  skills or memory, without the watchdog stopping it.
- **Prompt injection that crosses the boundary:** a directory's page getting the agent to do something
  the guards should refuse, or getting a chat agent (through a digest or the copy source bundle) to take an action the user didn't ask for.
- **Data exposure:** workspace data (copy, tracker, evidence, site notes), the Chrome profile, or files
  `copy:sources` should skip (secrets, `.env`, gitignored files) ending up committed, sent to a
  directory or passed to a model.
- **Badges:** a captured badge that keeps a script, a non-https URL or a link away from its directory.

## Out of scope

- A directory rejecting, delaying or mis-listing a submission, or changing its form. That's an
  ordinary bug: open an issue with the "Directory changed" template.
- What a directory does with the data you chose to submit, and its own terms.
- Issues that need an attacker who can already edit your workspace, the repo, or your Claude Code
  or OpenCode configuration.
- The underlying agent CLIs, Chrome and Playwright themselves (report those to their maintainers),
  unless launch-agent uses them unsafely.

## Supported versions

Fixes land on `main`. Update your checkout with `git pull`.
