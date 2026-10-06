import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { loadConfig, ruleStatus, selectRules } from "./config.ts";
import { resolvePrompts } from "./prompts.ts";

const sectionName = "model_calibration";

export function registerCalibration(pi: ExtensionAPI, defaultPath: string) {
  let lastError: string | undefined;
  // Pi normally supplies fresh options; also handle unchanged options reused by a host.
  const cleanups = new WeakMap<object, () => void>();

  pi.registerFlag("model-calibration-config", {
    description: "Path to model-calibration JSON rules (relative to cwd or absolute)",
    type: "string",
  });

  function configPath(ctx: ExtensionContext) {
    const override = pi.getFlag("model-calibration-config");
    const path = typeof override === "string" ? override : defaultPath;
    const expanded = path === "~" ? homedir() : path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : path;
    return { path: resolve(ctx.cwd, expanded), allowMissing: typeof override !== "string" };
  }

  async function currentRules(ctx: ExtensionContext, reportRepeatedError = false) {
    const { path, allowMissing } = configPath(ctx);
    try {
      const config = await loadConfig(path, allowMissing);
      const rules = await resolvePrompts(selectRules(config, ctx.model), path, ctx.model);
      lastError = undefined;
      return { path, config, rules };
    } catch (error) {
      const message = `model-calibration: ${path}: ${error instanceof Error ? error.message : String(error)}`;
      if (reportRepeatedError || message !== lastError) {
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.error(message);
        lastError = message;
      }
      // Invalid config must never apply partial or stale calibration rules.
      return undefined;
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    await currentRules(ctx);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const options = event.systemPromptOptions;
    cleanups.get(options)?.();
    cleanups.delete(options);
    const state = await currentRules(ctx);
    const prompt = state?.rules.map((rule) => rule.prompt).join("\n\n");
    // This section belongs to this extension; no match means no calibration.
    delete options.sections[sectionName];
    if (!state || !prompt) return;

    const block = `<${sectionName}>\n${prompt}\n</${sectionName}>`;
    // Pi renders addendum before project_context, unlike custom sections.
    const originalAppend = options.appendSystemPrompt;
    const appended = [originalAppend, block].filter(Boolean).join("\n\n");
    options.appendSystemPrompt = appended;
    cleanups.set(options, () => {
      if (options.appendSystemPrompt === appended) options.appendSystemPrompt = originalAppend;
    });
  });

  pi.registerCommand("model-calibration", {
    description: "Show configuration, all rule statuses and the current calibration prompts",
    handler: async (_args, ctx) => {
      // Explicit inspection should always explain a failure, even if a run already warned.
      const state = await currentRules(ctx, true);
      if (!state) return;
      const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "(no model)";
      const matches = state.rules.length
        ? state.rules.map((rule) => `[${rule.name}]\n${rule.prompt}`).join("\n\n")
        : "(no matching rules)";
      const statuses = state.config.rules.map((rule) => {
        const source = rule.promptFile === undefined ? "inline" : `file: ${rule.promptFile}`;
        return `[${ruleStatus(state.config, rule, ctx.model)}] ${rule.name} (${source})`;
      }).join("\n");
      const message = [
        `Config: ${state.path}`,
        `Enabled: ${state.config.enabled}`,
        `Model: ${model}`,
        `Model name: ${ctx.model?.name ?? "(none)"}`,
        `Rules: ${state.config.rules.length}; matched: ${state.rules.length}`,
        statuses,
        `\nMatched prompts:\n${matches}`,
      ].join("\n");
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.error(message);
    },
  });
}
