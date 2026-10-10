# launch-agent: how to

Everything about setting up and running launch-agent. For what it is and why, see the
[README](README.md).

- [What you need](#what-you-need)
- [Getting started](#getting-started)
- [How it works](#how-it-works)
- [How it stays safe](#how-it-stays-safe)
- [Agent backends](#agent-backends)
- [Directories](#directories)
- [Badges](#badges)
- [Instructions for specific directories](#instructions-for-specific-directories)
- [Your workspace](#your-workspace)
- [Known limitations](#known-limitations)

## What you need

- **macOS** with **Google Chrome**. Other platforms may work (set `LAUNCH_AGENT_CHROME` to your
  Chrome binary) but are untested.
- **Node.js 20+**.
- **A coding agent to talk to**: [Claude Code](https://claude.com/claude-code),
  [Codex](https://developers.openai.com/codex) or [OpenCode](https://opencode.ai).
- **Claude Code or OpenCode installed** for the submissions themselves, even if you chat in Codex
  (see [Agent backends](#agent-backends)). Runs count against that tool's account or provider.
- **A Google account for launches.** Most directories offer "Sign in with Google", and verification
  emails are read from that account's Gmail. A dedicated account (e.g. `launch@yourcompany.com`) keeps
  directory newsletters out of your main inbox.

## Getting started

```bash
git clone https://github.com/apsquared/launch-agent.git && cd launch-agent
npm install
```

Open Claude Code, Codex or OpenCode in that folder and talk to it:

1. **"Set up my site myproduct.com for promotion."** It asks for the product's name, your launch
   Google account, and where the product's code is, if you have it.
2. **Point it at your product's repo, or answer its questions.** It writes the listing copy
   (taglines, descriptions, a launch comment, categories, tags) from your code and site, goes
   through it with you until it reads right, picks up your logo, and sets up where directory badges
   go on your site.
3. **"Start promotion."** You sign a dedicated Chrome profile into your launch Google account once,
   by hand.
4. **It shows you the first directories** (10 unless you ask for another number). Remove any you
   don't want, then approve.
5. **It submits to the approved directories**, a few at a time, and between rounds handles what
   comes back: it adds new badges to your site (with your OK), tells you the exact step when a
   directory needs a person (a CAPTCHA, an emailed code), and keeps going until everything is
   submitted.

Later, ask "what's the status?", "promote on more directories", or tell it "I did the step for
TinyLaunch". The whole workflow is in [AGENTS.md](AGENTS.md) and the
[promote skill](.agents/skills/promote/SKILL.md), which all three clients read.

### What runs where

Your chat agent does the setup, the copy, the proposal and the reporting: work that needs your
judgment and only touches your own files. **Submissions never run in your chat session.** Each
directory is submitted by a separate headless agent whose only tools are launch-agent's guarded
browser server (see [How it stays safe](#how-it-stays-safe)), so your chat agent's shell, files and
browser are never exposed to a directory's pages.

### Your copy

The copy is written only from what your site, your repo and your answers say; where they don't say
something (pricing, say), it asks. Your name, username and contact email are never made up. When it
reads your repo, it doesn't browse it: `npm run copy:sources` picks the files and prints which ones
it used. It reads the README, `llms.txt`, the landing, pricing, feature and about pages,
`package.json`'s description, and docs whose names say they're about the product. It leaves out
gitignored files, hidden folders, `.env` and key files, dependencies, builds, tests,
internal-sounding docs (plans, specs, notes, research) and sign-in, admin and legal pages, and it
redacts anything shaped like an API key. Where the site and the repo disagree, the site wins.

Every value is published as written once you approve, so read it like you wrote it.

### Without a chat client

The same steps are commands; you write `workspace/products/<slug>/copy-bank.yaml` yourself:

```bash
npm run setup -- my-product --name "My Product" --url https://myproduct.com --identity launch@example.com
npm run chrome:login        # sign the launch Chrome profile into your launch Google account, then quit it (⌘Q)
npm run doctor              # every problem comes with the command or edit that fixes it
npm run batch:propose -- --size 10 [--exclude devhunt,fazier]
npm run batch:approve -- <batch-id>     # prints every directory and every string, asks you to type "approve"
npm run pass                # 3 directories by default (--max up to 10), about 5-15 minutes each
npm run mark -- <directory> planned     # after doing a step the digest asked of you
```

**Codex as the submission backend is not enabled yet**: chat in Codex, and keep `agent: claude` or
`agent: opencode` in `workspace/config.yaml` for the submissions. See
[the Codex backend assessment](docs/codex-backend.md).

## How it works

```
propose → you review and approve → pass → digest → (you act on "Needs you") → pass → …
```

**Batches.** `batch:propose` picks directories you haven't submitted to, best fit first, then the
widest-reach sites (the directory's tier, below) and those known to give a followed link, and writes
`workspace/batches/<id>.yaml` with the risks it knows about for each (badge required, sign-in not yet
observed, long free queue). `batch:approve` shows the batch plus your full copy bank and records a
fingerprint of the copy bank and assets. If you edit either afterwards, runs refuse the batch until
you approve it again. It also refuses to approve a copy bank that still contains `TODO`.

**Passes.** `npm run pass` covers every product with an approved batch (or one, with
`--product <slug>`), and runs, in order:

1. `badges:sync`: writes captured badges to your site's badge file and checks which are live.
2. `run`: one headless session of the configured submission backend per directory. Items waiting on a badge are retried once
   the badge shows on your site.
3. `verify`: opens each public listing in a clean, logged-out browser to confirm it's live, and
   records whether its link to your site is followed (dofollow) and whether the page may be indexed.
   The digest counts both.
4. `digest`: writes `workspace/.runs/digest-<product>-<date>.md` for each product.

The pass's directory budget (`max_items_per_run`, default 3) is shared across products.

Nothing runs on a schedule. Your Mac needs to stay awake while a pass runs.

**Acting on the digest.**

| Digest section | What to do |
|---|---|
| Needs you | Do the exact step it names (e.g. solve a CAPTCHA, verify an email code), then `npm run mark -- <directory> planned` and run a pass |
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

57 directories so far, in `platforms/`: 15 proven in a real run, 26 more with a written recipe, 9
not tried yet, and 7 you do yourself (founder-led launches, restricted automation, the MCP Registry and SourceForge). Five of them (marked
*open source only*) list only open-source projects, and are proposed only for one. Seven (marked *MCP
servers only*) list only MCP servers, and are proposed only for a product that is or ships one.

**Tested** says how far each playbook is proven. **real run**: launch-agent has been through the
site's flow in a real run (September 2026). **recipe**: the flow was observed on the site
and written up, but hasn't had a full submission yet. **not yet**: no recipe, so the agent works the
form out from the page. **Tier** is the site's reach, from its [Tranco](https://tranco-list.eu/)
traffic rank: 1 is top 100k, 2 is top 1M, 3 is beyond that or unranked. `unknown` in the other
columns means that part of the site hasn't been seen yet; runs fill it in.

| Directory | Tested | Tier | Kind | Sign-in | Free route | Badge | Mode |
|---|---|---|---|---|---|---|---|
| [AllMCPs](https://allmcps.com/) *(MCP servers only)* | recipe | 3 | mcp-servers | none | yes | none | auto |
| [Alternative.me](https://alternative.me/) | recipe | 3 | software-tools | unknown | unknown | unknown | auto |
| [AlternativeTo](https://alternativeto.net/) | real run | 1 | software-tools | google | yes | none | auto |
| [Awesome MCP Servers](https://mcpservers.org/) *(MCP servers only)* | recipe | 2 | mcp-servers | none | yes | none | auto |
| [AZN8](https://azn8.com/) | recipe | 3 | software-tools | google | yes | optional | auto |
| [BuildHop](https://buildhop.io/) | not yet | 3 | product-launch | google | yes | optional | auto |
| [BuiltByMe](https://builtbyme.io/) | recipe | 3 | product-launch | google | yes | unknown | auto |
| [Capterra](https://www.capterra.com/) | recipe | 3 | b2b-software | unknown | yes | none | auto |
| [ComingUp](https://www.comingup.io/) | not yet | 3 | product-launch | password | yes | none | auto |
| [DailyPings](https://dailypings.com/) | real run | 3 | product-launch | google | yes | required | auto |
| [Dev Hunt](https://devhunt.org/) | not yet | 2 | product-launch | google | yes | none | auto |
| [Fazier](https://fazier.com/) | — | 2 | product-launch | google | yes | required | manual |
| [Findly.tools](https://findly.tools/) | real run | 2 | software-tools | google | yes | required | auto |
| [FoundrList](https://www.foundrlist.com/) | not yet | 3 | product-launch | google | yes | unknown | auto |
| [FutureTools](https://futuretools.io/) *(AI tools only)* | recipe | 3 | ai-tools | none | yes | none | auto |
| [G2](https://www.g2.com/) | recipe | 3 | b2b-software | unknown | yes | none | auto |
| [Glama MCP Registry](https://glama.ai/mcp/servers) *(MCP servers only)* | not yet | 1 | mcp-servers | unknown | unknown | none | auto |
| [Hacker News (Show HN)](https://news.ycombinator.com/) | — | 1 | community | password | yes | none | manual |
| [Huzzler](https://huzzler.so/) | real run | 3 | product-launch | google | yes | required | auto |
| [IndieHunt](https://indiehunt.io/) | real run | 3 | product-launch | google | yes | required | auto |
| [IndieHustles](https://indiehustles.com/) | recipe | 3 | software-tools | none | yes | unknown | auto |
| [LaunchBoard](https://www.launchboard.dev/) | real run | 3 | product-launch | google | yes | required | auto |
| [LaunchIgniter](https://launchigniter.com/) | recipe | 2 | product-launch | google | yes | required | auto |
| [Launching Next](https://www.launchingnext.com/) | recipe | 3 | product-launch | none | yes | none | auto |
| [Launch Llama](https://tools.launchllama.co/) | — | 3 | product-launch | unknown | yes | unknown | manual |
| [LaunchNest](https://launchnest.io/) | real run | 3 | product-launch | email_code | yes | required | auto |
| [LibHunt](https://www.libhunt.com/) *(open source only)* | recipe | 1 | software-tools | unknown | yes | none | auto |
| [MCP Market](https://mcpmarket.com/) *(MCP servers only)* | recipe | 2 | mcp-servers | unknown | yes | none | auto |
| [MCP Repository](https://mcprepository.com/) *(MCP servers only)* | recipe | 3 | mcp-servers | none | yes | none | auto |
| [MCP.Directory](https://mcp.directory/) *(MCP servers only)* | recipe | 3 | mcp-servers | none | yes | none | auto |
| [Microlaunch](https://microlaunch.net/) | recipe | 3 | product-launch | google | unknown | unknown | auto |
| [Nick Launches](https://nicklaunches.com/) | real run | 3 | product-launch | google | yes | optional | auto |
| [NxGn Tools](https://www.nxgntools.com/) | recipe | 3 | software-tools | google | yes | unknown | auto |
| [Official MCP Registry](https://registry.modelcontextprotocol.io/) *(MCP servers only)* | — | 1 | mcp-servers | github | yes | none | manual |
| [Open Source Startups](https://www.opensourcestartups.com/) *(open source only)* | recipe | 3 | software-tools | none | yes | unknown | auto |
| [OpenAlternative](https://openalternative.co/) *(open source only)* | not yet | 2 | software-tools | google | yes | unknown | auto |
| [OpenSourceAlternative.to](https://www.opensourcealternative.to/) *(open source only)* | recipe | 3 | software-tools | none | yes | none | auto |
| [Peerlist Launchpad](https://peerlist.io/launchpad) | recipe | 2 | product-launch | google | yes | none | auto |
| [PeerPush](https://peerpush.com/) | real run | 2 | product-launch | google | yes | unknown | auto |
| [PitchWall](https://pitchwall.co/) | real run | 2 | product-launch | google | yes | none | auto |
| [Product Hunt](https://www.producthunt.com/) | — | 1 | product-launch | google | yes | optional | manual |
| [SaaS Hive](https://saashive.com/) | — | 3 | product-launch | unknown | yes | optional | manual |
| [SaaSHub](https://www.saashub.com/) | real run | 1 | software-tools | none | yes | none | auto |
| [SaaSworthy](https://www.saasworthy.com/) | not yet | 2 | b2b-software | email_code | unknown | unknown | auto |
| [selfh.st](https://selfh.st/apps/) | recipe | 2 | software-tools | none | yes | none | auto |
| [SideProjectors](https://www.sideprojectors.com/) | recipe | 2 | community | google | yes | unknown | auto |
| [SourceForge](https://sourceforge.net/) *(open source only)* | — | 1 | software-tools | password | yes | none | manual |
| [Startup Fame](https://startupfa.me/) | real run | 2 | product-launch | google | yes | required | auto |
| [Startup Ranking](https://www.startupranking.com/) | recipe | 2 | company-profile | google | yes | none | auto |
| [StartupInspire](https://www.startupinspire.com/) | recipe | 3 | product-launch | password | yes | none | auto |
| [The SaaS Harbor](https://thesaasharbor.com/) | not yet | 3 | software-tools | google | yes | optional | auto |
| [Tiny Startups](https://www.tinystartups.com/) | recipe | 3 | product-launch | google | yes | unknown | auto |
| [TinyLaunch](https://www.tinylaunch.com/) | real run | 3 | product-launch | google | yes | optional | auto |
| [ToolPilot](https://www.toolpilot.ai/) *(AI tools only)* | recipe | 3 | ai-tools | unknown | yes | required | auto |
| [ToolDirs](https://tooldirs.com/) | real run | 3 | software-tools | google | yes | required | auto |
| [Uneed](https://www.uneed.best/) | not yet | 2 | product-launch | google | yes | optional | auto |
| [Uno Directory](https://uno.directory/) | real run | 3 | software-tools | google | yes | required | auto |

The seven directories added on October 5 (Alternative.me, Capterra, FutureTools, G2, Launching
Next, Launch Llama and ToolPilot) have public-page research, not completed submissions. Their tier
is conservatively 3 pending Tranco measurement; link follow status is unknown. Account-only fields
and sign-in methods remain unknown where they could not be inspected.

**AI tools only** applies to FutureTools and ToolPilot. This condition is shown in proposals for
fit review; it is not an automatic eligibility filter. Rate them `none` for products without AI
functionality. ToolPilot requires a badge/backlink; FutureTools has a CAPTCHA. Launching Next also
has an anti-bot check. Launch Llama requires founder confirmation and is manual.

**Open source only** directories reject closed-source products, so they're proposed only when
`product.yaml` confirms the product's license (`open_source_license: MIT`, for example) and the copy
bank has its public repo as `repo_url`. Otherwise they're left out of every batch.

**MCP servers only** directories list Model Context Protocol servers, so they're proposed only when
`product.yaml` says `mcp_server: true`. Most want the server's public repo, as `mcp_repo_url` in the
copy bank; a hosted server can give its endpoint as `mcp_url` where a site takes one. Publish to the
Official MCP Registry yourself first, with its `mcp-publisher` CLI: several MCP directories copy
from it.

**Manual** directories (founder-led launches like Product Hunt) are never submitted automatically.
SaaS Hive is manual pending clarification of its restriction on automated data extraction in
terms section 3.1(e). Its free plan includes one category; dofollow links are a paid feature.
The playbook is based on public documentation, with sign-in and actual submission untested.
Its tier is conservatively 3 pending Tranco measurement.
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
git history: `workspace/` is gitignored, and `LAUNCH_AGENT_WORKSPACE` can point it somewhere else,
such as its own private git repo. Any other location inside this repo is refused, so product data
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

Run `npm run setup -- <slug> --name ... --url ...` again (or ask your chat agent to set up another
site) to add another product. Commands take
`--product <slug>` and default to `default_product` from `config.yaml`. All products share one launch
identity and Chrome profile, and site notes learned for one product help the others.

## Known limitations

- Only tested on macOS. Notifications (`digest --notify`) are macOS-only.
- Google is the only automated sign-in, and verification emails are read from Gmail's web UI.
- Directories change their forms often. Expect some items to end as `prepared_needs_human` until a
  playbook's recipe catches up.
