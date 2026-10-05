import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig, parseConfig, ruleStatus, selectRules } from "../src/config.ts";

const model = { provider: "openai", id: "gpt-5", name: "GPT 5" };
const match = (rule: Record<string, unknown>) =>
  selectRules(parseConfig({ rules: [{ prompt: "calibrate", ...rule }] }), model).length === 1;

test("plain strings and exact objects match case-sensitively", () => {
  assert.ok(match({ provider: "openai", model: { exact: "gpt-5" } }));
  assert.ok(!match({ provider: "OpenAI" }));
  assert.ok(!match({ model: "gpt" }));
});

test("regexes support flags, unanchored searches and both dimensions", () => {
  assert.ok(match({ provider: { regex: "^OPENAI$", flags: "i" }, model: { regex: "gpt-" } }));
  assert.ok(!match({ provider: "anthropic", model: { regex: "^gpt-" } }));
  assert.ok(!match({ provider: "openai", model: { regex: "^claude-" } }));
});

test("model ID and display name are separate matchers, combined with AND", () => {
  assert.ok(match({ modelName: { regex: "^GPT" }, model: "gpt-5" }));
  assert.ok(!match({ model: "GPT 5" }));
  assert.ok(!match({ modelName: "Other", model: "gpt-5" }));
});

test("all matching rules are selected in declaration order", () => {
  const config = parseConfig({ rules: [
    { name: "global", prompt: " first " },
    { name: "provider", provider: "openai", prompt: "second" },
    { name: "skip", provider: "anthropic", prompt: "skip" },
    { name: "model", model: "gpt-5", prompt: "third" },
  ] });
  assert.deepEqual(selectRules(config, model).map((rule) => rule.prompt), ["first", "second", "third"]);
  assert.deepEqual(selectRules(config), []);
});

test("config and individual rules can be disabled", () => {
  assert.ok(!match({ enabled: false }));
  assert.deepEqual(selectRules(parseConfig({ enabled: false, rules: [{ prompt: "x" }] }), model), []);
});

test("stateful g/y regexes are reset on each evaluation", () => {
  for (const flags of ["g", "y"]) {
    const config = parseConfig({ rules: [{ model: { regex: "gpt", flags }, prompt: "x" }] });
    for (let i = 0; i < 5; i++) assert.equal(selectRules(config, model).length, 1);
  }
});

for (const [description, config] of [
  ["non-object config", null],
  ["missing rules", {}],
  ["non-array rules", { rules: {} }],
  ["invalid enabled flag", { enabled: "true", rules: [] }],
  ["unknown config field", { rule: [], rules: [] }],
  ["unknown rule field", { rules: [{ provder: "openai", prompt: "x" }] }],
  ["empty prompt", { rules: [{ prompt: " " }] }],
  ["missing prompt source", { rules: [{}] }],
  ["conflicting prompt sources", { rules: [{ prompt: "x", promptFile: "x.md" }] }],
  ["empty prompt file", { rules: [{ promptFile: " " }] }],
  ["non-string prompt file", { rules: [{ promptFile: 42 }] }],
  ["null prompt file", { rules: [{ promptFile: null }] }],
  ["GLM schema instead of this extension's schema", { rules: [{ match: { model: "gpt-5" }, prompt: "x" }] }],
  ["empty name", { rules: [{ name: "", prompt: "x" }] }],
  ["invalid rule enabled flag", { rules: [{ enabled: 0, prompt: "x" }] }],
  ["null matcher", { rules: [{ model: null, prompt: "x" }] }],
  ["empty matcher", { rules: [{ model: {}, prompt: "x" }] }],
  ["conflicting matcher", { rules: [{ model: { exact: "x", regex: "x" }, prompt: "x" }] }],
  ["flags on exact matcher", { rules: [{ model: { exact: "x", flags: "i" }, prompt: "x" }] }],
  ["invalid regex", { rules: [{ model: { regex: "[" }, prompt: "x" }] }],
  ["invalid regex flags", { rules: [{ model: { regex: "x", flags: "bad" }, prompt: "x" }] }],
] as const) {
  test(`rejects ${description}`, () => assert.throws(() => parseConfig(config)));
}

test("missing default config is a no-op; explicit missing config is an error", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "model-calibration-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "missing.json");
  assert.deepEqual(await loadConfig(path), { enabled: true, rules: [] });
  await assert.rejects(loadConfig(path, false), { code: "ENOENT" });
  await writeFile(path, "{ broken");
  await assert.rejects(loadConfig(path));
});

test("shipped example parses successfully", async () => {
  const data = await readFile(new URL("../model-calibration.example.json", import.meta.url), "utf8");
  const config = parseConfig(JSON.parse(data));
  assert.equal(config.rules.length, 4);
  assert.equal(config.rules.filter((rule) => rule.enabled).length, 3);
});

test("keeps disabled rules for diagnostics without selecting them", () => {
  const config = parseConfig({ rules: [
    { name: "active", model: "gpt-5", prompt: "x" },
    { name: "other", model: "claude", prompt: "y" },
    { name: "disabled", enabled: false, promptFile: "missing.md" },
  ] });
  assert.deepEqual(config.rules.map((rule) => ruleStatus(config, rule, model)), [
    "matched", "not matched", "rule disabled",
  ]);
  assert.equal(ruleStatus(config, config.rules[0]), "no model");
  assert.deepEqual(selectRules(config, model).map((rule) => rule.name), ["active"]);
  config.enabled = false;
  assert.ok(config.rules.every((rule) => ruleStatus(config, rule, model) === "config disabled"));
  assert.deepEqual(selectRules(config, model), []);
});
