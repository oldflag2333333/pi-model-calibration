import type { BeforeAgentStartEvent, BeforeAgentStartEventResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { registerCalibration } from "../src/extension.ts";

async function harness(t: TestContext, initial?: unknown, override?: string) {
  const dir = await mkdtemp(join(tmpdir(), "model-calibration-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "rules.json");
  const handlers = new Map<string, (event: BeforeAgentStartEvent, ctx: ExtensionContext) =>
    Promise<BeforeAgentStartEventResult | void>>();
  const commands = new Map<string, { handler: (args: string, ctx: ExtensionContext) => Promise<void> }>();
  const notices: string[] = [];
  const ctx = {
    cwd: dir, hasUI: true,
    model: { provider: "openai", id: "gpt-5", name: "GPT 5" },
    ui: { notify: (message: string) => notices.push(message) },
  } as unknown as ExtensionContext;
  const pi = {
    registerFlag: () => {},
    getFlag: () => override,
    on: (name: string, handler: typeof handlers extends Map<string, infer H> ? H : never) => handlers.set(name, handler),
    registerCommand: (name: string, command: typeof commands extends Map<string, infer C> ? C : never) => commands.set(name, command),
  } as unknown as ExtensionAPI;
  registerCalibration(pi, path);
  const update = (config: unknown) => writeFile(path, JSON.stringify(config));
  if (initial !== undefined) await update(initial);
  const event = (forceSystemPrompt?: string): BeforeAgentStartEvent => {
    // Pi 1.0.4 requires hiddenTools; the intersection also keeps this fixture
    // type-checked against Pi 1.0.2, whose prompt options do not declare it.
    const systemPromptOptions: BeforeAgentStartEvent["systemPromptOptions"] & { hiddenTools: string[] } = {
      cwd: dir, sections: { existing: "preserve me" }, appendSystemPrompt: "original addendum",
      selectedTools: [], hiddenTools: [], toolSnippets: {}, toolGuidelines: {}, promptGuidelines: [],
      contextFiles: [], skills: [], forceSystemPrompt,
    };
    return {
      type: "before_agent_start", prompt: "test", systemPrompt: forceSystemPrompt ?? "original",
      systemPromptOptions,
    } satisfies BeforeAgentStartEvent;
  };
  const run = async (input = event()) => {
    const result = await handlers.get("before_agent_start")!(input, ctx);
    return { input, result };
  };
  return { dir, ctx, notices, handlers, commands, update, event, run };
}

test("appends a structured section while preserving unrelated prompt state", async (t) => {
  const h = await harness(t, { rules: [{ provider: "openai", prompt: "first" }, { model: "gpt-5", prompt: "second" }] });
  const { input, result } = await h.run();
  assert.equal(result, undefined);
  assert.deepEqual(input.systemPromptOptions.sections, { existing: "preserve me", model_calibration: "first\n\nsecond" });
  assert.equal(input.systemPromptOptions.appendSystemPrompt, "original addendum");
  assert.equal((await h.run()).input.systemPromptOptions.sections.model_calibration, "first\n\nsecond");
});

test("switching models removes old calibration on the next run", async (t) => {
  const h = await harness(t, { rules: [
    { model: "gpt-5", prompt: "GPT only" }, { model: "claude-sonnet", prompt: "Claude only" },
  ] });
  assert.equal((await h.run()).input.systemPromptOptions.sections.model_calibration, "GPT only");
  h.ctx.model = { ...h.ctx.model!, provider: "anthropic", id: "claude-sonnet" };
  assert.equal((await h.run()).input.systemPromptOptions.sections.model_calibration, "Claude only");
  h.ctx.model = { ...h.ctx.model, id: "other" };
  const event = h.event();
  event.systemPromptOptions.sections = { existing: "preserve me", model_calibration: "stale" };
  assert.equal((await h.run(event)).input.systemPromptOptions.sections.model_calibration, undefined);
});

test("reads changed config on every run without needing reload", async (t) => {
  const h = await harness(t, { rules: [{ prompt: "before" }] });
  assert.equal((await h.run()).input.systemPromptOptions.sections.model_calibration, "before");
  await h.update({ rules: [{ prompt: "after" }] });
  assert.equal((await h.run()).input.systemPromptOptions.sections.model_calibration, "after");
  await h.update({ enabled: false, rules: [{ prompt: "after" }] });
  assert.equal((await h.run()).input.systemPromptOptions.sections.model_calibration, undefined);
});

test("invalid config warns once, never applies stale rules, and recovers", async (t) => {
  const h = await harness(t, { rules: [{ prompt: "good" }] });
  await h.run();
  await h.update({ rules: [{ prompt: "partial" }, { model: { regex: "[" }, prompt: "broken" }] });
  assert.equal((await h.run()).input.systemPromptOptions.sections.model_calibration, undefined);
  await h.run();
  assert.equal(h.notices.length, 1);
  await h.update({ rules: [{ prompt: "recovered" }] });
  assert.equal((await h.run()).input.systemPromptOptions.sections.model_calibration, "recovered");
  await h.update({});
  await h.run();
  assert.equal(h.notices.length, 2);
});

test("no config or no active model is a no-op", async (t) => {
  const h = await harness(t);
  assert.equal((await h.run()).input.systemPromptOptions.sections.model_calibration, undefined);
  assert.deepEqual(h.notices, []);
  await h.update({ rules: [{ prompt: "global" }] });
  h.ctx.model = undefined;
  assert.equal((await h.run()).input.systemPromptOptions.sections.model_calibration, undefined);
});

test("relative explicit config path resolves against cwd", async (t) => {
  const h = await harness(t, undefined, "custom.json");
  await writeFile(join(h.dir, "custom.json"), JSON.stringify({ rules: [{ prompt: "custom" }] }));
  assert.equal((await h.run()).input.systemPromptOptions.sections.model_calibration, "custom");
});

test("missing explicit config warns rather than silently using defaults", async (t) => {
  const h = await harness(t, { rules: [{ prompt: "default" }] }, "missing.json");
  assert.equal((await h.run()).input.systemPromptOptions.sections.model_calibration, undefined);
  assert.match(h.notices[0], /missing.json/);
});

test("preserves a previous extension's opaque system prompt override", async (t) => {
  const h = await harness(t, { rules: [{ prompt: "calibrate" }] });
  const { result } = await h.run(h.event("opaque prompt"));
  assert.equal(result?.systemPrompt, "opaque prompt\n\n<model_calibration>\ncalibrate\n</model_calibration>");
});

test("inspection command shows the path, model and matching prompts", async (t) => {
  const h = await harness(t, { rules: [{ name: "my-rule", prompt: "calibrate" }] });
  await h.commands.get("model-calibration")!.handler("", h.ctx);
  assert.match(h.notices[0], /rules.json/);
  assert.match(h.notices[0], /openai\/gpt-5/);
  assert.match(h.notices[0], /\[my-rule\]\ncalibrate/);
});

test("headless failures use stderr rather than UI", async (t) => {
  const h = await harness(t, {});
  h.ctx.hasUI = false;
  const messages: string[] = [];
  t.mock.method(console, "error", (message: string) => messages.push(message));
  await h.run();
  assert.equal(h.notices.length, 0);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /config.rules must be an array/);
});

test("prompt files refresh on every run and failure applies no partial or stale prompts", async (t) => {
  const h = await harness(t, { rules: [{ prompt: "inline" }, { name: "file-rule", promptFile: "prompt.md" }] });
  const file = join(h.dir, "prompt.md");
  await writeFile(file, "before");
  assert.equal((await h.run()).input.systemPromptOptions.sections.model_calibration, "inline\n\nbefore");
  await writeFile(file, "after");
  assert.equal((await h.run()).input.systemPromptOptions.sections.model_calibration, "inline\n\nafter");
  await rm(file);
  const stale = h.event();
  stale.systemPromptOptions.sections.model_calibration = "stale";
  assert.equal((await h.run(stale)).input.systemPromptOptions.sections.model_calibration, undefined);
  await h.run();
  assert.equal(h.notices.length, 1);
  assert.match(h.notices[0], /file-rule.*promptFile.*prompt.md/);
  await writeFile(file, "recovered");
  assert.equal((await h.run()).input.systemPromptOptions.sections.model_calibration, "inline\n\nrecovered");
});

test("inspection distinguishes matching, unmatched and disabled rules and shows file sources", async (t) => {
  const h = await harness(t, { rules: [
    { name: "file-rule", model: "gpt-5", promptFile: "prompt.md" },
    { name: "other", model: "claude", promptFile: "missing.md" },
    { name: "off", enabled: false, prompt: "disabled content" },
  ] });
  await writeFile(join(h.dir, "prompt.md"), "file content");
  await h.commands.get("model-calibration")!.handler("", h.ctx);
  const message = h.notices[0];
  assert.match(message, /Rules: 3; matched: 1/);
  assert.match(message, /\[matched\] file-rule \(file: prompt.md\)/);
  assert.match(message, /\[not matched\] other/);
  assert.match(message, /\[rule disabled\] off/);
  assert.match(message, /Model name: GPT 5/);
  assert.match(message, /\[file-rule\]\nfile content/);
  assert.ok(!message.includes("disabled content"));
});

test("inspection shows global disable and no model separately", async (t) => {
  const h = await harness(t, { enabled: false, rules: [{ prompt: "x" }] });
  await h.commands.get("model-calibration")!.handler("", h.ctx);
  assert.match(h.notices[0], /\[config disabled\]/);
  await h.update({ rules: [{ prompt: "x" }] });
  h.ctx.model = undefined;
  await h.commands.get("model-calibration")!.handler("", h.ctx);
  assert.match(h.notices[1], /\[no model\]/);
});

test("explicit inspection repeats an error even after automatic warning deduplication", async (t) => {
  const h = await harness(t, {});
  await h.run();
  await h.run();
  assert.equal(h.notices.length, 1);
  await h.commands.get("model-calibration")!.handler("", h.ctx);
  assert.equal(h.notices.length, 2);
  assert.equal(h.notices[0], h.notices[1]);
});

test("headless inspection uses stderr without touching UI", async (t) => {
  const h = await harness(t, { rules: [{ prompt: "calibrate" }] });
  h.ctx.hasUI = false;
  const messages: string[] = [];
  t.mock.method(console, "error", (message: string) => messages.push(message));
  await h.commands.get("model-calibration")!.handler("", h.ctx);
  assert.equal(h.notices.length, 0);
  assert.match(messages[0], /\[matched\]/);
});

test("does not auto-load a project config when the default config is absent", async (t) => {
  const h = await harness(t);
  await mkdir(join(h.dir, ".pi"));
  await writeFile(join(h.dir, ".pi/model-calibration.json"), JSON.stringify({ rules: [{ prompt: "PROJECT" }] }));
  assert.equal((await h.run()).input.systemPromptOptions.sections.model_calibration, undefined);
  assert.deepEqual(h.notices, []);
});
