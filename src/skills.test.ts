/**
 * The chat skills stay in step with the tool: each has valid frontmatter, Claude Code sees the same
 * files Codex does, every command a skill runs exists, and copy-draft asks for exactly the keys the
 * draft schema takes.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { DRAFT_CHOICE_KEYS, DRAFT_STRING_KEYS } from "./draft.js";
import { ROOT } from "./paths.js";

const SKILLS = path.join(ROOT, ".agents/skills");
const scripts = Object.keys((JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts);
const names = fs.readdirSync(SKILLS).filter((d) => fs.statSync(path.join(SKILLS, d)).isDirectory()).sort();
assert.ok(names.length >= 5, `expected the workflow skills, found ${names.join(", ")}`);

for (const name of names) {
  const text = fs.readFileSync(path.join(SKILLS, name, "SKILL.md"), "utf8");
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(front, `${name}: no frontmatter`);
  const meta = YAML.parse(front![1]!) as { name?: string; description?: string };
  assert.equal(meta.name, name, `${name}: frontmatter name must match its folder`);
  assert.ok(meta.description && meta.description.length > 80 && meta.description.length <= 1024, `${name}: description missing or too long`);

  // Claude Code reads .claude/skills; it must be the same folder, not a copy that drifts.
  const link = path.join(ROOT, ".claude/skills", name);
  assert.ok(fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink(), `${name}: .claude/skills/${name} must be a symlink to .agents/skills/${name}`);
  assert.equal(fs.realpathSync(link), fs.realpathSync(path.join(SKILLS, name)));

  // Every command a skill runs in a code block is a real script (run as `npm run -s <cmd>` or `launch-agent <cmd>`).
  for (const [, block] of text.matchAll(/```bash\n([\s\S]*?)```/g)) {
    for (const line of block!.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))) {
      const cmd = line.split(/\s+/)[0]!;
      if (["npm", "git", "gh"].includes(cmd)) continue;
      assert.ok(scripts.includes(cmd), `${name}: runs "${cmd}", which is not a package.json script`);
    }
  }
  for (const [, cmd] of text.matchAll(/\| `([a-z]+(?::[a-z-]+)?) [^`|]*`/g)) {
    assert.ok(scripts.includes(cmd!), `${name}: table runs "${cmd}", which is not a package.json script`);
  }
}
for (const link of fs.readdirSync(path.join(ROOT, ".claude/skills"))) assert.ok(names.includes(link), `.claude/skills/${link} has no skill behind it`);

const copyDraft = fs.readFileSync(path.join(SKILLS, "copy-draft/SKILL.md"), "utf8");
for (const key of [...DRAFT_STRING_KEYS, ...DRAFT_CHOICE_KEYS]) assert.match(copyDraft, new RegExp(`"${key}"`), `copy-draft's JSON shape lacks ${key}`);

console.log(`skills ok (${names.length})`);
