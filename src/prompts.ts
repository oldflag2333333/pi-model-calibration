import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep, win32 } from "node:path";
import type { CompiledRule, ModelIdentity } from "./config.ts";

export type ResolvedRule = Omit<CompiledRule, "prompt"> & { prompt: string };

function isWithin(directory: string, path: string) {
  const child = relative(directory, path);
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function renderPrompt(prompt: string, model?: ModelIdentity): string {
  if (!model) return prompt;
  // A single callback-based pass preserves literal $ characters and never
  // interprets placeholders inside the replacement values.
  return prompt.replace(/\{(provider|model)\}/g, (_match, key: string) =>
    key === "provider" ? model.provider : model.id);
}

/** Resolve only active, matching rules. Reject the entire batch if any file fails. */
export async function resolvePrompts(
  rules: CompiledRule[], configPath: string, model?: ModelIdentity,
): Promise<ResolvedRule[]> {
  const directory = dirname(resolve(configPath));
  // No file access is needed for inline prompts or inactive file rules.
  const canonicalDirectory = rules.some((rule) => rule.promptFile !== undefined)
    ? await realpath(directory)
    : directory;

  return Promise.all(rules.map(async (rule): Promise<ResolvedRule> => {
    if (rule.promptFile === undefined) return { ...rule, prompt: renderPrompt(rule.prompt, model) };

    try {
      const file = rule.promptFile;
      const path = resolve(directory, file);
      if (isAbsolute(file) || win32.isAbsolute(file) || file.startsWith("~") || !isWithin(directory, path)) {
        throw new Error("must be a relative path within the configuration directory");
      }
      // Resolve symlinks too: lexical path checks alone allow escapes.
      const canonicalPath = await realpath(path);
      if (!isWithin(canonicalDirectory, canonicalPath)) {
        throw new Error("symlink target must stay within the configuration directory");
      }
      if (!(await stat(canonicalPath)).isFile()) throw new Error("must point to a regular file");
      const prompt = (await readFile(canonicalPath, "utf8")).trim();
      if (!prompt) throw new Error("must contain a non-empty prompt");
      return { ...rule, prompt: renderPrompt(prompt, model) };
    } catch (error) {
      throw new Error(`rule "${rule.name}" promptFile "${rule.promptFile}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }));
}
