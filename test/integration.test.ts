import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import {
  createEventBus, discoverAndLoadExtensions, ExtensionRunner, ModelRegistry, ModelRuntime, SessionManager,
  type BuildSystemPromptOptions, type ExtensionContext, type ExtensionError,
} from "@earendil-works/pi-coding-agent";

// Exercise Pi's actual package discovery, jiti loader, event runner and lazy prompt
// renderer. Only host actions/model selection are supplied here; no LLM calls occur.
async function harness(t: TestContext, config: unknown) {
  const root = await mkdtemp(join(tmpdir(), "calibration-integration-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  await mkdir(agentDir);
  await mkdir(cwd);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(root, { recursive: true, force: true });
  });
  const configPath = join(agentDir, "model-calibration.json");
  const update = (value: unknown) => writeFile(configPath, JSON.stringify(value));
  await update(config);
  const paths = [fileURLToPath(new URL("../", import.meta.url))];
  const observer = join(root, "observer.ts");
  await writeFile(observer, `export default function(pi) {
    pi.on("before_agent_start", event => { pi.events.emit("calibration:test:prompt", event.systemPrompt); });
  }`);
  paths.push(observer);
  const bus = createEventBus();
  const prompts: string[] = [];
  const unsubscribe = bus.on("calibration:test:prompt", (value) => {
    assert.equal(typeof value, "string");
    prompts.push(value as string);
  });
  t.after(unsubscribe);
  const loaded = await discoverAndLoadExtensions(paths, cwd, agentDir, bus);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, paths.length);

  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"), modelsPath: null,
    allowModelNetwork: false, refreshOnCreate: false,
  });
  const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, cwd,
    SessionManager.inMemory(cwd), new ModelRegistry(modelRuntime));
  t.after(() => runner.invalidate());
  let model: ExtensionContext["model"] = {
    provider: "test", id: "model-a", name: "Model A", api: "openai-responses",
    baseUrl: "https://example.invalid", input: ["text"], reasoning: false,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 4096,
  };
  const base: BuildSystemPromptOptions = {
    cwd, customPrompt: "BASE", appendSystemPrompt: "USER ADDENDUM", sections: { existing: "KEEP" },
  };
  runner.bindCore(loaded.runtime, {
    getModel: () => model, getScopedModels: () => [], isIdle: () => true,
    isProjectTrusted: () => false, getSignal: () => undefined, abort: () => {},
    hasPendingMessages: () => false, shutdown: () => {}, getContextUsage: () => undefined,
    compact: () => {}, getSystemPrompt: () => "BASE", getSystemPromptOptions: () => base,
  });
  const notices: string[] = [];
  runner.setUIContext({ ...runner.getUIContext(), notify: (message) => { notices.push(message); } }, "tui");
  const errors: ExtensionError[] = [];
  runner.onError((error) => errors.push(error));
  assert.ok(runner.getFlags().has("model-calibration-config"));
  assert.ok(runner.getCommand("model-calibration"));
  const run = async () => {
    const result = await runner.emitBeforeAgentStart("test", undefined, base);
    assert.deepEqual(errors, []);
    return { ...result, text: prompts.at(-1)! };
  };
  const select = (id?: string) => { model = id ? { ...model!, id, name: id } : undefined; };
  return { runner, cwd, agentDir, base, notices, update, run, select };
}

test("Pi loads the package manifest, respects agent dir and switches calibration without accumulation", async (t) => {
  const h = await harness(t, { rules: [
    { model: "model-a", prompt: "A_ONLY" }, { model: "model-b", prompt: "B_ONLY" },
  ] });
  await h.runner.emit({ type: "session_start", reason: "startup" });
  const first = await h.run();
  assert.match(first.text, /<model_calibration>\nA_ONLY\n<\/model_calibration>/);
  assert.match(first.text, /USER ADDENDUM/);
  assert.match(first.text, /<existing>\nKEEP/);
  assert.equal((await h.run()).text, first.text);
  assert.deepEqual(h.base.sections, { existing: "KEEP" });
  h.select("model-b");
  const second = await h.run();
  assert.match(second.text, /B_ONLY/);
  assert.ok(!second.text.includes("A_ONLY"));
  h.select("other");
  assert.ok(!(await h.run()).text.includes("model_calibration"));
  h.select();
  assert.ok(!(await h.run()).text.includes("model_calibration"));
});

for (const append of ["", "USER ADDENDUM"]) {
  test(`Pi places calibration before project context with addendum ${JSON.stringify(append)}`, async (t) => {
    const h = await harness(t, { rules: [
      { model: "model-a", prompt: "A_{model}" }, { model: "model-b", prompt: "B_{model}" },
    ] });
    h.base.appendSystemPrompt = append;
    if (!append) h.base.customPrompt = undefined;
    h.base.contextFiles = [{ path: "AGENTS.md", content: "PROJECT INSTRUCTIONS" }];
    const first = (await h.run()).text;
    assert.ok(first.includes("<model_calibration>\nA_model-a\n</model_calibration>"));
    assert.ok(first.indexOf("<model_calibration>") < first.indexOf("<project_context>"));
    assert.ok(first.indexOf("</model_calibration>") < first.indexOf("</addendum>"));
    assert.ok(first.includes("PROJECT INSTRUCTIONS"));
    assert.ok(first.includes("<existing>\nKEEP"));
    if (append) assert.ok(first.indexOf(append) < first.indexOf("<model_calibration>"));
    assert.equal((await h.run()).text, first);
    assert.equal(h.base.appendSystemPrompt, append);
    h.select("model-b");
    const second = (await h.run()).text;
    assert.ok(second.includes("B_model-b"));
    assert.ok(!second.includes("A_model-a"));

    await h.update({ rules: [{ prompt: "UPDATED" }] });
    const updated = (await h.run()).text;
    assert.ok(updated.includes("UPDATED"));
    assert.ok(updated.indexOf("<model_calibration>") < updated.indexOf("<project_context>"));
    assert.equal(updated.split("<model_calibration>").length, 2);
    await h.update({ enabled: false, rules: [{ prompt: "OFF" }] });
    assert.ok(!(await h.run()).text.includes("model_calibration"));
    await h.update({ rules: [{ promptFile: "missing.md" }] });
    assert.ok(!(await h.run()).text.includes("model_calibration"));
  });
}

test("Pi inserts calibration into addendum even without project context", async (t) => {
  const h = await harness(t, { rules: [{ prompt: "CALIBRATE" }] });
  h.base.appendSystemPrompt = "";
  const { text } = await h.run();
  assert.ok(text.includes("<addendum>\n<model_calibration>\nCALIBRATE"));
  assert.ok(!text.includes("<project_context>"));
});

test("Pi runner sees fresh file contents, fail-closed removal and recovery", async (t) => {
  const h = await harness(t, { rules: [{ prompt: "INLINE" }, { promptFile: "model.md" }] });
  const path = join(h.agentDir, "model.md");
  await writeFile(path, "FIRST");
  assert.match((await h.run()).text, /INLINE\n\nFIRST/);
  await writeFile(path, "OTHER");
  assert.match((await h.run()).text, /INLINE\n\nOTHER/);
  await rm(path);
  const failed = await h.run();
  assert.ok(!failed.text.includes("model_calibration"));
  assert.ok(!failed.text.includes("ENOENT"));
  await h.run();
  assert.equal(h.notices.length, 1);
  await writeFile(path, "RECOVERED");
  assert.match((await h.run()).text, /INLINE\n\nRECOVERED/);
});

test("Pi flag paths resolve against ctx.cwd, command reports statuses and project config is not auto-loaded", async (t) => {
  const h = await harness(t, { rules: [{ prompt: "DEFAULT" }] });
  await mkdir(join(h.cwd, ".pi"));
  await writeFile(join(h.cwd, ".pi/model-calibration.json"), JSON.stringify({ rules: [{ prompt: "UNTRUSTED" }] }));
  assert.ok(!(await h.run()).text.includes("UNTRUSTED"));
  await writeFile(join(h.cwd, "custom.json"), JSON.stringify({ rules: [
    { name: "selected", promptFile: "prompt.md" },
    { name: "other", model: "other-model", prompt: "OTHER" },
    { name: "off", enabled: false, promptFile: "missing.md" },
  ] }));
  await writeFile(join(h.cwd, "prompt.md"), "CUSTOM");
  h.runner.setFlagValue("model-calibration-config", "custom.json");
  const { text } = await h.run();
  assert.match(text, /CUSTOM/);
  assert.ok(!text.includes("DEFAULT"));
  await h.runner.getCommand("model-calibration")!.handler("", h.runner.createCommandContext());
  assert.match(h.notices.at(-1)!, /\[matched\] selected/);
  assert.match(h.notices.at(-1)!, /\[not matched\] other/);
  assert.match(h.notices.at(-1)!, /\[rule disabled\] off/);
  h.runner.setFlagValue("model-calibration-config", "missing.json");
  assert.ok(!(await h.run()).text.includes("model_calibration"));
  assert.match(h.notices.at(-1)!, /missing.json/);
});
