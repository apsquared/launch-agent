---
name: launch-setup
description: >
  Set up launch-agent for a product: create the workspace and product, get the copy bank, assets and
  directory fit ratings ready, sign in the launch Chrome profile and check everything with doctor.
  Use when the user wants to start using launch-agent, add a product, asks "is everything set up?",
  gives standing instructions for a directory ("on TinyLaunch, always ..."), or a command won't start.
---

# Set up a product

Commands: in the launch-agent checkout run `npm run -s <command> -- <args>` from its root. With the
launch-agent plugin, run `launch-agent <command> <args>` instead (it is on PATH). `<product>` is
`default_product` in the workspace config unless the user names another.

The workspace (the checkout's gitignored `workspace/`, or `~/.launch-agent/workspace` with the plugin,
or `$LAUNCH_AGENT_WORKSPACE`) holds the user's private data. Never copy any of it into tracked files.

## 1. Check where things stand

Run `doctor`. It is read-only and prints each problem with its fix. Start from the first ✗.

## 2. Create the product

Ask for the product's name and public https URL, and a slug (lowercase, dashes). The first time,
also ask for the launch identity: a Google account used only for launches (a dedicated one keeps
directory newsletters out of their inbox).

```bash
init <slug> --name "<Name>" --url https://... [--identity <google account>]
```

## 3. The copy bank

Offer the copy-draft skill ("I can draft it from your site, and from your code if you point me at
the repo"). Personal keys (`email`, `company_name`, `first_name`, `last_name`, `handle`) are the
user's: ask for them, or offer to delete keys they don't want to share. Edit
`products/<product>/copy-bank.yaml` only with the user's go-ahead on each value.

## 4. Assets

Directories want a square logo (512x512 PNG works almost everywhere) and a few 1440x900 screenshots.
Ask the user for the files, copy them into `products/<product>/assets/`, and list them under
`assets:` in the copy bank (`logo`, `screenshot_1`, ...). Don't create or edit images yourself.

## 5. Directory fit and instructions

`products/<product>/product.yaml` lists every directory with its audience. Suggest a fit for each
(`strong | ok | weak | none`) from what the product is and who each directory reaches, show the
suggestions, and write the ones the user agrees with. `weak` and `none` are never proposed.

When the user gives a standing instruction for a directory ("pick the Marketing category", "use the
dark badge"), offer to save it as that directory's `instructions` and write it once they agree on
the wording. Instructions are part of what a batch approval covers: say that approved batches for
this product will need showing and approving again.

## 6. Badges (optional)

Many directories list for free only with their badge on the product's site. Ask how their site is
built and set `badges` in `product.yaml` (see the README's Badges section): `output_file: null` gives
a `badges.html` to paste into a site builder; a path in their site's code gives a `.html`, `.json`
or `.ts` file to include. `check_url` is the public page the badges appear on.

## 7. Sign in the launch Chrome profile

Run `chrome:login`. It opens a dedicated Chrome profile at Google's sign-in page. The user signs in
as the launch identity themselves, opens Gmail once, and quits that Chrome (Cmd+Q). Never type
credentials, codes or CAPTCHA answers for them.

## 8. Done

Run `doctor` again. When it says "Ready for a pass", offer the batch-review skill to propose and
review the first batch.
