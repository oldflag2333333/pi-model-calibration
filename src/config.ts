import { readFile } from "node:fs/promises";

export interface ModelIdentity {
  provider: string;
  id: string;
  name?: string;
}

export type CompiledRule = {
  name: string;
  enabled: boolean;
  matches(model: ModelIdentity): boolean;
} & (
  | { prompt: string; promptFile?: never }
  | { prompt?: never; promptFile: string }
);

export interface CalibrationConfig {
  enabled: boolean;
  rules: CompiledRule[];
}

type Predicate = (value: string) => boolean;

function object(value: unknown, location: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${location} must be an object`);
  }
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: string[], location: string) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${location}: unknown field "${key}"`);
  }
}

function optionalBoolean(value: unknown, location: string): boolean {
  if (value === undefined) return true;
  if (typeof value !== "boolean") throw new Error(`${location} must be a boolean`);
  return value;
}

function matcher(value: unknown, location: string): Predicate {
  if (value === undefined) return () => true;
  if (typeof value === "string") return (text) => text === value;
  const spec = object(value, location);
  keys(spec, ["exact", "regex", "flags"], location);
  if ("exact" in spec && !("regex" in spec) && !("flags" in spec) && typeof spec.exact === "string") {
    return (text) => text === spec.exact;
  }
  if (!("exact" in spec) && typeof spec.regex === "string" &&
      (spec.flags === undefined || typeof spec.flags === "string")) {
    let expression: RegExp;
    try {
      expression = new RegExp(spec.regex, spec.flags as string | undefined);
    } catch (error) {
      throw new Error(`${location}: ${String(error)}`);
    }
    return (text) => {
      // g/y regexes must not retain state between matching different turns.
      expression.lastIndex = 0;
      return expression.test(text);
    };
  }
  throw new Error(`${location} must be a string, { exact: string }, or { regex: string, flags?: string }`);
}

export function parseConfig(value: unknown): CalibrationConfig {
  const config = object(value, "config");
  keys(config, ["$schema", "enabled", "rules"], "config");
  const enabled = optionalBoolean(config.enabled, "config.enabled");
  if (!Array.isArray(config.rules)) throw new Error("config.rules must be an array");

  const rules = config.rules.map((value, index): CompiledRule => {
    const location = `rules[${index}]`;
    const rule = object(value, location);
    keys(rule, ["name", "enabled", "provider", "model", "modelName", "prompt", "promptFile"], location);
    const active = optionalBoolean(rule.enabled, `${location}.enabled`);
    if (rule.name !== undefined && (typeof rule.name !== "string" || !rule.name.trim())) {
      throw new Error(`${location}.name must be a non-empty string`);
    }
    if (("prompt" in rule) === ("promptFile" in rule)) {
      throw new Error(`${location} must specify exactly one of prompt or promptFile`);
    }
    const source = "promptFile" in rule ? "promptFile" : "prompt";
    if (typeof rule[source] !== "string" || !rule[source].trim()) {
      throw new Error(`${location}.${source} must be a non-empty string`);
    }
    const provider = matcher(rule.provider, `${location}.provider`);
    const model = matcher(rule.model, `${location}.model`);
    const modelName = matcher(rule.modelName, `${location}.modelName`);
    return {
      name: (rule.name as string | undefined) ?? `rule #${index + 1}`,
      enabled: active,
      ...(source === "prompt"
        ? { prompt: (rule.prompt as string).trim() }
        : { promptFile: rule.promptFile as string }),
      matches: (identity) => provider(identity.provider) && model(identity.id) && modelName(identity.name ?? ""),
    };
  });
  return { enabled, rules };
}

export async function loadConfig(path: string, allowMissing = true): Promise<CalibrationConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return { enabled: true, rules: [] };
    }
    throw error;
  }
  return parseConfig(JSON.parse(raw));
}

export function ruleStatus(config: CalibrationConfig, rule: CompiledRule, model?: ModelIdentity) {
  if (!config.enabled) return "config disabled";
  if (!rule.enabled) return "rule disabled";
  if (!model) return "no model";
  return rule.matches(model) ? "matched" : "not matched";
}

export function selectRules(config: CalibrationConfig, model?: ModelIdentity): CompiledRule[] {
  return config.rules.filter((rule) => ruleStatus(config, rule, model) === "matched");
}
