---
name: launch-pass
description: >
  Run launch-agent's guarded submissions (a pass, or one directory), then report the digest the way
  the user acts on it: what needs them, badges to deploy, what moved or went live. Also status
  ("what's left?") and recording that the user did a step a directory needed. Use when the user asks
  to run a pass, launch, submit, retry a directory, check status or progress, or says they did a step.
---

# Run a pass and report it

Commands: in the launch-agent checkout run `npm run -s <command> -- <args>` from its root. With the
launch-agent plugin, run `launch-agent <command> <args>` instead (it is on PATH). `<product>` is
`default_product` in the workspace config unless the user names another.

Submissions never happen in this chat. `pass` and `run` start a separate, headless agent session per
directory whose only tools are the guarded launch server: no shell, no files, no other browser.
Don't fill forms or submit listings yourself with your own browser, shell or HTTP tools, even to
"help" with a stuck directory; use the launch-watched skill for that.

## Run

| The user wants | Run |
|---|---|
| a pass (the usual) | `pass [--product <product>] [--max N]` (without `--product`: every product with an approved batch) |
| one directory, now | `run --batch <id> --only <directory>` |
| to see what would run | `run --dry-run` |

Each directory takes 5-15 minutes; a pass does 3 by default (`--max` up to 10). Run it in the
background (Claude Code: `run_in_background: true`; Codex: a short yield timeout, then poll the same
process) and follow its output. Never start a second pass while one is running. The user's computer
must stay awake.

If a run fails with "did not expose DevTools", the login Chrome is still open: ask the user to quit
it (Cmd+Q). For anything else that won't start, use the launch-setup skill (doctor).

## Report

Don't report from the launch acknowledgment. When the command exits, read its output and the newest
`<workspace>/.runs/digest-<product>-<date>.md` for each product it covered, and report grouped by
what the user does next:

- **Needs you**: quote the exact step each item names (solve a CAPTCHA, verify an email code, ...).
  Offer the launch-watched skill: they can do it live while the agent carries on.
- **Waiting for the badge to deploy**: the badge file the digest names has to go live on their
  site. If it is in a site repo, offer to commit and deploy it, and do it only after the user says
  yes for this deploy. If it is `badges.html`, ask them to paste it into their site builder's footer
  embed. The next pass finishes those directories.
- **Paid only** (`deferred_paid`): nothing was bought. The choice to pay is theirs.
- **Moved / live**: one line each.

## Status

`digest` prints status without running anything; summarize it the same way.

## "I did the step for <directory>"

```bash
mark <directory> planned --product <product>
```

It clears the step and resets the attempts, so the next pass tries again. Offer a pass (or a
watched run). If the user decides a directory isn't worth it, `mark <directory> not_a_fit`.
