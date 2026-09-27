# launch-agent

Submit your product to startup and SaaS directories without spending days on forms.

You write your product's copy once and approve a **batch**: the directories and the exact text and
images to use. Then an AI agent (Claude Code or OpenCode, driving your own Chrome) works through those
directories one at a time. It signs in with Google, fills each form from your approved copy, takes
the free route every time, and leaves you a digest with anything that needs you.

It is built to be left alone while it works. The agent cannot type free text, spend money, solve
CAPTCHAs, enter passwords or leave the directory's own site, and those limits are enforced in code
rather than left to the prompt (see [How it stays safe](#how-it-stays-safe)).

> **Status:** early. Used in production for one product so far, on macOS. Expect rough edges,
> and expect directories to change their forms under you.

## What you need

- **macOS** with **Google Chrome**. Other platforms may work (set `LAUNCH_AGENT_CHROME` to your
  Chrome binary) but are untested.
- **Node.js 20+**.
- **An agent CLI** to run each submission (see [Agent backends](#agent-backends)):
  [Claude Code](https://claude.com/claude-code) (the default, and the most tested) or
  [OpenCode](https://opencode.ai). Runs use that tool's account or provider and count against it.
- **A Google account for launches.** Most directories offer "Sign in with Google", and verification
  emails are read from that account's Gmail. A dedicated account (e.g. `launch@yourcompany.com`) keeps
  directory newsletters out of your main inbox.

## Install

**As a Claude Code plugin** (recommended with Claude Code):

```
/plugin marketplace add apsquared/launch-agent
/plugin install launch-agent@launch-agent
```

Then ask any Claude Code session to "set me up with launch-agent". Your data lives in
`~/.launch-agent/workspace` (set `LAUNCH_AGENT_WORKSPACE` to move it, e.g. into its own private
repo), and the commands run as `launch-agent <command>`, which installs its own dependencies the
first time. For [watched runs](#watched-runs), run `launch-agent watch:agent --user` once, and again
after updating the plugin (`launch-agent doctor` tells you when).

**As a checkout** (Codex, Claude Code, or just a terminal):

```bash
git clone https://github.com/apsquared/launch-agent.git && cd launch-agent
npm install
```

Open the folder in Claude Code or Codex. Your data lives in `workspace/` (gitignored), and the
commands run as `npm run <command> -- <args>`.

## Quick start

Everything that needs your judgment happens in chat, through skills that Claude Code and Codex both
load from `.agents/skills/`. Ask, in order:

| Ask | Skill | What happens |
|---|---|---|
| "Set me up with launch-agent for my product" | `launch-setup` | creates the product, gathers assets, rates directories, signs in the launch Chrome, runs `doctor` |
| "Draft my copy bank" (or "… from ~/code/my-product") | `copy-draft` | drafts every listing text from your site and code, revises it with you, writes it |
| "Propose a batch and show it to me", then "approve" | `batch-review` | shows every directory, grant and string it will submit; records your approval only when you give it in chat |
| "Run a pass" | `launch-pass` | runs the guarded submissions and reports the digest: what needs you, badges to deploy, what went live |
| "Let me watch it do TinyLaunch" | `launch-watched` | one directory while you watch, pausing for CAPTCHAs and emailed codes (Claude Code only) |
| "Promote what the runs learned" | `promote-site-notes` | turns your runs' site lessons into shared recipes for a pull request |

Read the digest after each pass, do anything it lists under **Needs you** (or do it live with a
watched run), and run another pass. Repeat until nothing is left.

**Without a chat client**, the same steps are commands (write the copy bank yourself):

```bash
npm run init -- my-product --name "My Product" --url https://myproduct.com --identity launch@example.com
# fill in workspace/products/my-product/copy-bank.yaml and add assets
npm run chrome:login        # sign the launch Chrome profile into your launch Google account, then quit it (⌘Q)
npm run doctor              # every problem comes with the command or edit that fixes it
npm run batch:propose
npm run batch:approve -- <batch-id>     # prints every directory and every string, asks you to type "approve"
npm run pass                # 3 directories by default, about 5-15 minutes each
npm run mark -- <directory> planned     # after doing a step the digest asked of you
```

### What runs where

Chat handles setup, copy, batch review and approval, and reading digests: work that needs your
judgment and touches only your own files. **Submissions, the one step that reads third-party
sites, never run in your chat session.** A pass starts a separate headless agent per directory
whose only tools are the guarded launch server (see [How it stays safe](#how-it-stays-safe)); a
watched run uses a subagent with the same single set of tools. Your chat agent's shell, files and
browser are never exposed to a directory's pages.

### Drafting your copy

The copy-draft skill gathers your sources with `copy:sources`, drafts the taglines, descriptions,
launch comment, categories and tags, goes through them with you until they're right, and writes
them with `copy:apply`. It uses only what your sources say and writes `TODO` where they don't say
something, such as pricing. Your name, handle and contact email are never drafted.

Point it at your product's repo when the site is thin or not live yet. The agent doesn't browse the
repo itself: `copy:sources` picks the files and prints which ones it used. It reads the README,
`llms.txt`, the landing, pricing, feature and about pages, `package.json`'s description, and docs
whose names say they're about the product. It leaves out gitignored files, hidden folders, `.env`
and key files, dependencies, builds, tests, internal-sounding docs (plans, specs, notes, research)
and sign-in, admin and legal pages, and it redacts anything shaped like an API key. Where the site
and the repo disagree, the site wins. `copy:apply` fills only values that still hold template text
(`--overwrite` replaces yours), keeps the file's comments and saves the old file as
`copy-bank.yaml.bak`. The copy is published as written once you approve a batch, so read it like
you wrote it.

### Watched runs

Some directories stop at a step only a person can do: a CAPTCHA, an emailed code, a checkbox on a
page the guards treat as a payment page. A pass parks those as **Needs you**. A watched run does
one directory while you watch the launch Chrome window instead: when the agent reaches such a step
it pauses and tells you exactly what to do, you do it in that window, and it carries on.

It is the same guarded agent. `watch:start` checks the batch like a pass does and sets up the one
item; the `launch-watched` Claude Code subagent (`.claude/agents/launch-watched.md`, generated from
`prompts/submit.md`) has only the launch tools and starts its own launch server, which serves only
that item; `watch:finish` closes it. Your chat agent never gets the launch tools and never touches
the directory's page. Watched runs need Claude Code; with other clients, use
`npm run run -- --batch <id> --only <directory>`.

### Chat notes

Use the existing checkout for launches: a new worktree will not contain your gitignored workspace.
Private shared instructions can go in `AGENTS.local.md` (gitignored and explicitly read by the
workflow). Existing `CLAUDE.local.md` remains Claude-specific.

**Codex chat support is available; Codex as the headless submission backend is not yet enabled.**
Keep `agent: claude` or `agent: opencode` in your workspace config. No global Codex MCP setup is
needed. See [the Codex backend assessment](docs/codex-backend.md) for the remaining implementation
gate and verification requirements.

## How it works

```
propose → you review and approve → pass → digest → (you act on "Needs you") → pass → …
```

**Batches.** `batch:propose` picks directories you haven't submitted to, best fit first, and writes
`workspace/batches/<id>.yaml` with the risks it knows about for each (badge required, sign-in not yet
observed, long free queue). `batch:approve` shows the batch plus your full copy bank and records a
fingerprint of the copy bank and assets. If you edit either afterwards, runs refuse the batch until
you approve it again. It also refuses to approve a copy bank that still contains `TODO`.

**Passes.** `npm run pass` covers every product with an approved batch (or one, with
`--product <slug>`), and runs, in order:

1. `badges:sync`: writes captured badges to your site's badge file and checks which are live.
2. `run`: one headless session of the configured submission backend per directory. Items waiting on a badge are retried once
   the badge shows on your site.
3. `verify`: opens each public listing in a clean, logged-out browser to confirm it's live.
4. `digest`: writes `workspace/.runs/digest-<product>-<date>.md` for each product.

The pass's directory budget (`max_items_per_run`, default 3) is shared across products.

Nothing runs on a schedule. Your Mac needs to stay awake while a pass runs.

**Acting on the digest.**

| Digest section | What to do |
|---|---|
| Needs you | Do the exact step it names (e.g. solve a CAPTCHA, verify an email code), then `npm run mark -- <directory> planned` and run a pass; or do it live with a [watched run](#watched-runs) |
| Waiting for the badge to deploy | Commit and deploy your site with the new badge file, then run a pass |
| Badge live, site verification still to do | Nothing: the next pass finishes them |
| Paid only | Nothing was bought. Decide yourself whether a paid listing is worth it |

**States.** `planned` → `submitted_pending_review` | `queued` | `scheduled` → `live` (confirmed
logged-out by `verify`). Also `already_listed`, `waiting_badge`, `prepared_needs_human`,
`deferred_paid`, `blocked`, `not_a_fit`, `unavailable`. An item is retried up to 3 times if a run
ends without a result.

Other commands: `npm run run -- --batch <id> --only <directory>` runs one directory headless; `npm run pass -- --max 5` does more per pass (cap 10); `npm run digest` shows status
without running anything; `npm run doctor` checks the setup when something won't start.

## How it stays safe

The submitting agent is headless Claude Code with **no built-in tools** (`--tools ""`): no shell, no
file access, no JavaScript. Its only tools come from one MCP server, `src/mcp/server.ts`, which
enforces these rules in code:

| Rule | Enforced by |
|---|---|
| Only approved batches, and only their listed directories | server refuses to start otherwise |
| Copy bank or assets edited after approval → refused | sha256 fingerprint checked at start |
| No free text: every value comes from `copy-bank.yaml` or the site's own options | `fill` takes a key, not text; `type_choice` only accepts approved choices |
| `goto` only on the directory's own domains | `classifyUrl` |
| No payments | spend-shaped clicks refused; payment hosts, `/checkout` paths and card fields lock the page |
| No passwords, no CAPTCHA solving | password fields never filled; challenges → `prepared_needs_human` |
| Google: only the launch account + Continue/Allow | `googleClickVerdict` |
| Marketing opt-ins stay unticked; terms only with the batch grant | `checkboxVerdict` |
| Personal details (`first_name`, `last_name`, `handle`) only in fields the site marks required | `fill` checks `describe().required` |
| Badges are reduced to link + image (no scripts, https, link must point at the directory) | `parseBadgeSnippet` |
| Every action is logged | `workspace/.runs/<batch>/<directory>.jsonl`, screenshots in `workspace/evidence/` |

The shared rules live in `policy.yaml`; `allow_payments` is a literal `false` that the schema
refuses to change. The Chrome profile in `~/.launch-agent/chrome-profile` is an ordinary profile you
signed into by hand. There is no stealth patching, fingerprint spoofing or challenge solving.

**Use it responsibly.** It is for listing your own products, once per directory, through each
directory's normal free submission flow. It is not a tool for mass or repeated submissions, and each
directory's terms still apply to you.

## Agent backends

Each submission runs in a fresh, headless session of an agent CLI. Pick one with `agent:` in
`workspace/config.yaml`, and its model with `model:`:

| `agent:` | Needs | `model:` | Lockdown |
|---|---|---|---|
| `claude` (default) | `claude` logged in | e.g. `opus`, `sonnet`; `null` = default | `--tools ""` removes every built-in tool; `--strict-mcp-config` loads only the launch server; `--setting-sources ""`, `--disable-slash-commands`, `--restricted` and `autoMemoryEnabled: false`, run from an empty temp dir, keep out your settings, hooks, plugins, skills, CLAUDE.md files and memory |
| `opencode` | `opencode` with a provider set up (`opencode auth login`) | `provider/model`, e.g. `anthropic/claude-sonnet-4-5` | a per-run agent whose permissions deny every tool (`"*": "deny"`) and then allow only `launch_*` |

Whichever backend you choose, the agent gets the same prompt and the same guarded tools, and nothing
else: no shell, no file access, no web tools. Every rule in the table above is checked by the MCP
server, so it holds no matter which backend or model is used. As a second line of defence, the
runner watches each session's event stream: if a tool other than the launch tools is listed or
called, or (for `claude`) the session shows installed plugins, skills or a memory folder, it stops the
run and the rest of the pass, and the digest tells you to fix the backend's setup.

The prompt was tuned on Claude models. Other models may need more attempts on tricky sites. Codex
chat can operate either backend today. A native Codex submission backend remains gated on a verified
tool allowlist; see [the assessment](docs/codex-backend.md).

## Directories

21 directories so far, in `platforms/`:

| Directory | Kind | Sign-in | Free route | Badge | Mode |
|---|---|---|---|---|---|
| [AlternativeTo](https://alternativeto.net/) | software-tools | unknown | yes | none | auto |
| [ComingUp](https://www.comingup.io/) | product-launch | password | yes | none | auto |
| [DailyPings](https://dailypings.com/) | product-launch | google | yes | required | auto |
| [Dev Hunt](https://devhunt.org/) | product-launch | google | yes | none | auto |
| [Fazier](https://fazier.com/) | product-launch | google | yes | required | manual |
| [Findly.tools](https://findly.tools/) | software-tools | google | unknown | unknown | auto |
| [Huzzler](https://huzzler.so/) | product-launch | google | yes | unknown | auto |
| [IndieHunt](https://indiehunt.io/) | product-launch | google | yes | required | auto |
| [LaunchBoard](https://www.launchboard.dev/) | product-launch | unknown | yes | required | auto |
| [LaunchNest](https://launchnest.io/) | product-launch | email_code | yes | required | auto |
| [Nick Launches](https://nicklaunches.com/) | product-launch | google | unknown | optional | auto |
| [PeerPush](https://peerpush.com/) | product-launch | google | yes | unknown | auto |
| [PitchWall](https://pitchwall.co/) | product-launch | unknown | yes | unknown | auto |
| [Product Hunt](https://www.producthunt.com/) | product-launch | google | yes | optional | manual |
| [SaaSHub](https://www.saashub.com/) | software-tools | unknown | yes | unknown | auto |
| [SaaSworthy](https://www.saasworthy.com/) | b2b-software | unknown | unknown | unknown | auto |
| [Startup Fame](https://startupfa.me/) | product-launch | google | yes | required | auto |
| [TinyLaunch](https://www.tinylaunch.com/) | product-launch | google | yes | optional | auto |
| [ToolDirs](https://tooldirs.com/) | software-tools | none | yes | unknown | auto |
| [Uneed](https://www.uneed.best/) | product-launch | google | yes | optional | auto |
| [Uno Directory](https://uno.directory/) | software-tools | google | unknown | unknown | auto |

**Manual** directories (founder-led launches like Product Hunt) are never submitted automatically.
Only Google sign-in is automated: directories that need a password are skipped, and ones that sign
in by emailed code need you to sign the launch profile in by hand first.

## Badges

Many directories list you for free only if their badge on your site links back to them. Runs capture
each directory's embed code, reduced to a plain link and image (scripts and tracking code are
dropped). `npm run badges:sync`, which every pass runs, writes all of them to one file for your
site. Set it up under `badges` in `workspace/products/<slug>/product.yaml`:

```yaml
badges:
  enabled: true
  output_file: null     # see below
  format: null          # html | json | ts; null = from output_file's extension
  check_url: https://myproduct.com/
```

| Your site | Set `output_file` to | You get |
|---|---|---|
| Webflow, Framer, WordPress, Squarespace, any site builder | `null` | `badges.html` in the product folder. Paste it into an embed/HTML block in your footer, and paste it again when it changes |
| Static site or server templates | a path in your site's code ending in `.html` | an HTML partial to include |
| React, Next.js, Astro, Vue, … | a path ending in `.json` | a list of `{ platform, name, href, img_src, alt, width, height }` to render |
| TypeScript codebase | a path ending in `.ts` | a module exporting `DIRECTORY_BADGES` |

`check_url` is the public page the badges appear on, usually your homepage. Putting the file live
(commit and deploy, or paste) stays with you. Items that need the badge live wait in
`waiting_badge`, and the first pass after their badge shows up on `check_url` completes the
directory's verification step.

## Instructions for specific directories

Give the agent your own instructions for a directory in `product.yaml`:

```yaml
platforms:
  tinylaunch:
    fit: strong
    instructions: Pick the Marketing & Sales category. Use the dark badge.
  peerpush:
    instructions: Skip the optional first comment.
```

The agent reads them before it starts on that directory and follows them where the site allows it,
choosing the closest free option (and saying so in its report) when it can't. They are guidance
inside the safety rules, not exceptions to them: the agent still can't type anything outside your
copy bank, pay, or leave the directory's site. The batch shows your instructions before you approve
it, and they are part of what you approve. Editing them later means approving the batch again.

## Your workspace

One workspace holds any number of products. Everything in it is yours and stays out of the tool's
git history: in a checkout it is `workspace/` (gitignored); with the plugin it is
`~/.launch-agent/workspace`; `LAUNCH_AGENT_WORKSPACE` can point it anywhere else, such as its own
private git repo. Any other location inside this repo is refused, so product data
can't end up committed by accident.

```
workspace/
  config.yaml                      launch identity, default product, items per pass, model
  products/<slug>/
    copy-bank.yaml                 the only text the agent can submit
    assets/                        the only files it can upload
    product.yaml                   badge settings, fit rating per directory
  batches/<id>.yaml                proposals and approvals
  tracker/<slug>.json              state, evidence and notes per directory
  site-notes/<directory>.md        what your runs learned about each site
  .runs/  evidence/                transcripts, action logs, digests, screenshots
```

Run `npm run init -- <slug> --name ... --url ...` again to add another product. Commands take
`--product <slug>` and default to `default_product` from `config.yaml`. All products share one launch
identity and Chrome profile, and site notes learned for one product help the others.

## Contributing

Directory playbooks are the most useful contribution: when a site changes its flow, or you've
submitted somewhere that isn't listed yet. [CONTRIBUTING.md](CONTRIBUTING.md) explains the playbook
format, how to share what your runs learned (the `promote-site-notes` skill), and the rules for code
changes. Security problems go through [private reporting](SECURITY.md).

## Known limitations

- Only tested on macOS. Notifications (`digest --notify`) are macOS-only.
- Google is the only automated sign-in, and verification emails are read from Gmail's web UI.
- Directories change their forms often. Expect some items to end as `prepared_needs_human` until a
  playbook's recipe catches up.

## License

[MIT](LICENSE)
