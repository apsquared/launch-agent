# Contributing

Thanks for helping. The most useful contributions, in order:

1. **Fixing a directory playbook** when a site changed its flow.
2. **Adding a directory.**
3. **Code**: bugs, platform support (Linux, Windows), new sign-in routes.

Security problems (a way around the guards, a data leak) go through private reporting instead: see
[SECURITY.md](SECURITY.md).

## Setup

```bash
git clone https://github.com/apsquared/launch-agent.git && cd launch-agent
npm install
npm test
```

`npm test` runs the typecheck and every check: guards, badge output, copy drafting, the repo reader,
skill and subagent drift, privacy, the example workspace, a fresh `init`, and every platform playbook.
It needs no Chrome, no agent CLI and no workspace. CI runs it on Linux and macOS.

## Directory playbooks

Each `platforms/<slug>.yaml` describes one site. The submitting agent reads it before it starts, so
an accurate playbook is the difference between a clean submission and a `prepared_needs_human`.

**A playbook is about the site, never about a product.** No product names, URLs, listing IDs,
copy, or the categories one product picked. Those belong in the user's own workspace.

| Field | What goes in it |
|---|---|
| `slug`, `name` | lowercase-dashed id (also the file name), and the site's display name |
| `category` | `product-launch`, `ai-tools`, `software-tools`, `b2b-software`, `company-profile` or `community` |
| `home_url`, `submit_url` | the homepage, and the page where a submission starts (`null` if there isn't a stable one) |
| `domains` | every hostname the flow stays on. The agent's `goto` is confined to these, so list exactly what's needed (`www.` counts) |
| `auth` | how you sign in: `google`, `github`, `email_magic_link`, `email_code`, `password`, `none` or `unknown`. Only `google` and `none` are automated |
| `free_route` | `yes`, `no` or `unknown`: can a product be listed without paying? |
| `badge` | `required`, `optional`, `none` or `unknown`: must their badge be on the product's site for the free route? |
| `mode` | `auto`, or `manual` for founder-led launches and communities (never submitted by the agent) |
| `audience` | one sentence: who the site lists and who reads it. Users rate their fit from this |
| `queue_note` | how long the free route takes, or `null` |
| `eligibility` | conditions a product must meet (list, may be empty) |
| `recipe` | how the flow actually goes: dated bullets, at most 4000 characters (below) |
| `observed_at` | the date of the newest fact in the file |
| `sources` | pages you took facts from |

### Writing a recipe

A recipe is what you'd tell someone about to submit there for the first time. Write dated bullets:

```yaml
recipe: >-
  - 2026-09-26: /submit → Google login → Standard Launch form. Tagline max 60, first comment max 200
  (skip it if launch_comment is longer). After Submit → /plans: click "Join the free queue", then
  "Wait ~63 days in queue" in the upsell dialog.
```

Good recipe content: the real submit route, required fields and their limits, which buttons to click
and which to avoid (quote their labels), upsell dialogs to dismiss, where the badge embed code is,
how badge verification is triggered, and anything that trips the agent (hidden radios, comboboxes
that append text). Use placeholders for per-product parts of routes (`/dashboard/<slug>/badges`).
When a site changes, rewrite the bullets that no longer hold rather than piling up contradictions.

### Sharing what your runs learned

Runs save site lessons to `workspace/site-notes/<directory>.md`. The `promote-site-notes` skill (ask
Claude Code or Codex to "promote what the runs learned") turns them into recipe changes with your
product's details removed and shows you each change first. Check the diff yourself too: grep it for
your product's name and domain before you commit.

### Adding a directory

Copy a similar playbook, fill every field from the site itself (or `unknown` where you can't tell),
and set `mode: manual` if the site is a community or a founder-led launch where an automated
submission would be unwelcome. Only add directories whose free submission is meant for makers to
list their own products; launch-agent is not for sites that forbid automated or repeated submissions.

## Code

- Read the README's "How it stays safe" first. The guards (`src/guards.ts`, `src/mcp/server.ts`,
  `policy.yaml`) and the agent lockdown (`src/agents/`, the `launch-watched` subagent) are the
  project's core promise. A change that loosens any of them needs a strong reason in the pull
  request, and a test.
- Submissions only ever run in a session whose sole tools are the launch server's. Don't add a path
  that lets a chat agent, a skill or a new backend reach a directory's pages with other tools.
- Nothing about one user's product belongs in `src/`, `platforms/`, `prompts/`, skills or examples.
  Test fixtures use made-up products (`example.com`, "Acme").
- `.claude/agents/launch-watched.md` is generated: change `prompts/submit.md` or
  `src/watched-agent.ts`, then run `npm run watch:agent`.
- Skills live in `.agents/skills/<name>/SKILL.md`; `.claude/skills/<name>` is a symlink to the same
  folder. Commands in a skill's code blocks must be real `package.json` scripts (the tests check).
- Match the surrounding style: small modules, comments that say why, messages that tell the user
  the exact command or edit that fixes the problem.

## Pull requests

Keep each one to one change, run `npm test`, and fill in the template's checklist. For a playbook
change, say when you saw the flow and link a source if there is one.
