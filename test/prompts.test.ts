import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { loadConfig, parseConfig, selectRules } from "../src/config.ts";
import { resolvePrompts } from "../src/prompts.ts";

const model = { provider: "openai", id: "gpt-5" };

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "calibration-prompts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, "config");
  await mkdir(join(dir, "prompts"), { recursive: true });
  const path = join(dir, "rules.json");
  const load = async (config: unknown) => {
    await writeFile(path, JSON.stringify(config));
    return resolvePrompts(selectRules(await loadConfig(path), model), path, model);
  };
  return { root, dir, path, load };
}

test("resolves prompt files relative to config, preserves order and refreshes contents", async (t) => {
  const h = await fixture(t);
  const file = join(h.dir, "prompts/model.md");
  await writeFile(file, "\n# Model\nFirst version\n");
  const config = { rules: [
    { prompt: " before " }, { model: "gpt-5", promptFile: "prompts/model.md" }, { prompt: "after" },
  ] };
  assert.deepEqual((await h.load(config)).map((rule) => rule.prompt), ["before", "# Model\nFirst version", "after"]);
  await writeFile(file, "# Model\nOther version");
  assert.equal((await h.load(config))[1].prompt, "# Model\nOther version");
});

test("renders placeholders in inline and file prompts, leaving unrelated braces intact", async (t) => {
  const h = await fixture(t);
  const template = '你是 {provider} 提供的 {model} 模型。\\n{provider}/{model} {unknown} {Model} {"key": "value"}';
  const expected = '你是 openai 提供的 gpt-5 模型。\\nopenai/gpt-5 {unknown} {Model} {"key": "value"}';
  // Only content is interpolated, not the promptFile path.
  await writeFile(join(h.dir, "{model}.md"), template);
  const rules = await h.load({ rules: [{ prompt: template }, { promptFile: "{model}.md" }] });
  assert.deepEqual(rules.map((rule) => rule.prompt), [expected, expected]);
});

test("placeholder values are literal and not recursively expanded", async () => {
  const identity = { provider: "$&-{model}", id: "$1-{provider}" };
  const config = parseConfig({ rules: [{ prompt: "{provider} / {model}" }] });
  const rules = await resolvePrompts(selectRules(config, identity), "rules.json", identity);
  assert.equal(rules[0].prompt, "$&-{model} / $1-{provider}");
  assert.equal(config.rules[0].prompt, "{provider} / {model}");
});

test("does not read files for disabled or unmatched rules", async (t) => {
  const h = await fixture(t);
  assert.equal((await h.load({ rules: [
    { enabled: false, promptFile: "missing.md" },
    { model: "claude", promptFile: "also-missing.md" },
    { prompt: "active" },
  ] }))[0].prompt, "active");
  assert.deepEqual(await h.load({ enabled: false, rules: [{ promptFile: "missing.md" }] }), []);
});

test("missing matched file rejects the whole batch with rule and file details", async (t) => {
  const h = await fixture(t);
  await assert.rejects(h.load({ rules: [
    { prompt: "must not apply partially" }, { name: "broken", promptFile: "missing.md" },
  ] }), /rule "broken" promptFile "missing.md":.*ENOENT/);
});

test("empty files and directories are rejected", async (t) => {
  const h = await fixture(t);
  await writeFile(join(h.dir, "empty.md"), " \n\t ");
  await assert.rejects(h.load({ rules: [{ promptFile: "empty.md" }] }), /non-empty prompt/);
  await assert.rejects(h.load({ rules: [{ promptFile: "prompts" }] }), /regular file/);
});

for (const file of ["../outside.md", "prompts/../../outside.md", "~/prompt.md", "/etc/passwd", "C:\\secrets\\prompt.md"]) {
  test(`rejects disallowed prompt path ${file}`, async (t) => {
    const h = await fixture(t);
    await assert.rejects(h.load({ rules: [{ promptFile: file }] }), /relative path within the configuration directory/);
  });
}

test("rejects symlinks escaping the config directory, including sibling prefix paths", async (t) => {
  const h = await fixture(t);
  const outside = join(h.root, "config-other");
  await mkdir(outside);
  await writeFile(join(outside, "secret.md"), "must not be sent");
  await symlink(join(outside, "secret.md"), join(h.dir, "linked.md"));
  await symlink(outside, join(h.dir, "linked-dir"), "dir");
  for (const promptFile of ["linked.md", "linked-dir/secret.md"]) {
    await assert.rejects(h.load({ rules: [{ promptFile }] }), /symlink target must stay within/);
  }
});

test("allows internal symlinks and config directories reached through a symlink", async (t) => {
  const h = await fixture(t);
  await writeFile(join(h.dir, "prompts/model.md"), "internal");
  await symlink(join(h.dir, "prompts/model.md"), join(h.dir, "linked.md"));
  const config = { rules: [{ promptFile: "linked.md" }] };
  assert.equal((await h.load(config))[0].prompt, "internal");
  const alias = join(h.root, "alias");
  await symlink(h.dir, alias, "dir");
  const aliasPath = join(alias, "rules.json");
  assert.equal((await resolvePrompts(selectRules(await loadConfig(aliasPath), model), aliasPath))[0].prompt, "internal");
});
