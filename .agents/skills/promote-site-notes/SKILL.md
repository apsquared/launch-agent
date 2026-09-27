---
name: promote-site-notes
description: >
  Turn what launch-agent runs learned about directory sites (workspace site-notes) into shared
  platform recipes in platforms/*.yaml, with anything about one product removed, ready for a pull
  request. Use when the user asks to promote, share, upstream or contribute site notes or recipes,
  or after a pass learned something general about a directory. Needs a launch-agent git checkout.
---

# Promote site notes into shared recipes

Runs save what they learn about a directory's flow (the real submit route, a field limit, an
upsell dialog to dismiss) to `<workspace>/site-notes/<directory>.md`. Lessons that help everyone
belong in that directory's `recipe` in `platforms/<directory>.yaml`, which every user's agent reads.

This edits the shared, public tool. It needs a git checkout of launch-agent (with the plugin, clone
the repo first and work there, with `LAUNCH_AGENT_WORKSPACE` pointing at the plugin's workspace,
`~/.launch-agent/workspace`, so the notes are found).

## 1. Find the candidates

For each file in `<workspace>/site-notes/`, compare it with the `recipe` in
`platforms/<directory>.yaml` and list what the notes add. Skip lessons the recipe already covers.

## 2. Strip everything about one product

A recipe describes the site, never a product. Remove or generalize:
- product names, URLs, slugs, listing or draft IDs, and the product's own copy or taglines;
- categories, tags or choices picked for one product ("chose Marketing" → "Category is a
  required dropdown");
- anything from the user's workspace, accounts or email;
- dates and counts that only held for one run ("earliest free slot was 56 weeks out" → "the free
  queue can be over a year long").

Keep route paths with placeholders (`/dashboard/<slug>/badges`), field limits, required steps, the
exact labels of buttons to click or avoid, and dialogs to dismiss.

## 3. Propose, then write

Show the user each proposed recipe addition as a before/after, with what you removed. Write only
what they agree to. Recipes are a YAML string of dated bullets (`- YYYY-MM-DD: ...`), at most 4000
characters; condense older bullets the new ones supersede. Set `observed_at` to the newest date.
Update `auth`, `free_route`, `badge` or `submit_url` only when the notes show them directly.

## 4. Check and offer a PR

Run `npm test` (it validates every playbook). Then grep the changed files for the product's name,
domain and copy-bank strings; none may appear. Offer a branch, commit and pull request; do each only
when the user says so. The site-notes files themselves stay in the workspace.
