# Configuration guide

[Back to README](../README.en.md) · [中文](configuration.md)

## Quick start

Create `~/.pi/agent/model-calibration.json` with the following content:

```json
{
  "rules": [
    {
      "prompt": "You are the {model} model provided by {provider}. State uncertainty clearly and do not fabricate results."
    }
  ]
}
```

This rule applies to all models. For a provider named `xxx` and a model ID of `glm-5.3-flash`, the resolved prompt is:

> You are the glm-5.3-flash model provided by xxx. State uncertainty clearly and do not fabricate results.

Run `/model-calibration` in Pi to see the current model, configuration path, matching rules, and resolved prompts.

Changes to the configuration or prompt files **take effect the next time you send a message, without restarting or running `/reload`**.
Switching models automatically selects the rules for the new model on the next run.

## Set prompts for different models

You can combine general instructions for all models with specific instructions for GLM models and a GPT model from a particular provider:

```json
{
  "rules": [
    {
      "name": "General instructions",
      "prompt": "State uncertainty clearly and do not fabricate results."
    },
    {
      "name": "GLM models",
      "model": { "regex": "^glm-", "flags": "i" },
      "prompt": "You are the {model} model provided by {provider}. Stay within the user's requested scope and avoid unrelated refactoring."
    },
    {
      "name": "Specific provider and model",
      "provider": "openai",
      "model": "gpt-5",
      "prompt": "Run relevant tests after changing code and report the results accurately."
    }
  ]
}
```

Replace the example provider and model IDs with the ones you use. You can find them with `/model-calibration`.
See [model-calibration.example.json](../model-calibration.example.json) for more examples (Chinese prompt text).

### Rule fields

| Field | Purpose |
| --- | --- |
| `name` | Optional label to help identify the rule; not sent to the model |
| `provider` | Match the provider |
| `model` | Match the model ID, **not its display name** |
| `modelName` | Match the model's display name |
| `prompt` | Inline prompt text; use `\n` for line breaks |
| `promptFile` | Read prompt text from a file; use this instead of `prompt` |
| `enabled` | Optional; set to `false` to disable this rule; enabled by default |

Matching behavior:

- An omitted match condition imposes no restriction. Omit all conditions to match every model.
- All conditions within a rule must match.
- Strings are case-sensitive exact matches: `"gpt-5"` is equivalent to `{ "exact": "gpt-5" }`.
- Use `{ "regex": "^glm-", "flags": "i" }` for a regular expression, without `/…/` delimiters. The `i` flag makes it case-insensitive.
  Escape backslashes in JSON, for example `"^gpt-\\d"`.
- **All matching rules are combined in configuration order**, separated by blank lines. Matching does not select just one rule, and an exact match does not override a general rule.

### Prompt placeholders

Both inline `prompt` text and prompt file contents support:

| Placeholder | Replacement |
| --- | --- |
| `{provider}` | The current model's provider |
| `{model}` | The current model ID |

Placeholders are case-sensitive, and every occurrence is replaced. Unknown placeholders remain unchanged. Replacement values are not expanded again.
Placeholders apply only to prompt text, not match conditions or file paths.

## Use prompt files

For longer prompts, use a separate Markdown file:

```json
{
  "rules": [
    {
      "model": { "regex": "^glm-", "flags": "i" },
      "promptFile": "calibration-prompts/glm.md"
    }
  ]
}
```

Then create `~/.pi/agent/calibration-prompts/glm.md`, for example:

```markdown
You are the {model} model provided by {provider}.

- Focus on the user's explicitly requested scope.
- Run relevant tests after changing code.
- Do not present plans or guesses as completed actions.
```

Keep in mind:

- Specify exactly one of `prompt` and `promptFile`. Prompt contents must not be empty.
- File paths are relative to **the directory containing the configuration file**, not the current working directory.
- Files must stay inside the configuration directory. Absolute paths, `~/`, paths escaping the directory via `../`, and symlinks pointing outside it are not allowed.
- Use a directory such as `calibration-prompts/`, rather than Pi's `prompts/` directory, to avoid having these files discovered as slash-command templates.
- Only enabled prompt file rules matching the current model are read. Use only configuration and prompts you trust.

## FAQ

### Why is nothing happening after installation?

The extension does not create a configuration file automatically. Make sure you have created `~/.pi/agent/model-calibration.json`.
Run `/model-calibration` to check the configuration path, current model, and whether your rules are enabled and match.
If the command is unavailable, use `pi list` to confirm the extension is installed, then restart Pi.

If the default configuration is missing or no rules match, no prompts are added.
If the configuration is invalid, or a matching prompt file is unreadable or empty, the extension reports an error and **applies no calibration rules for that run**.
Fix the problem and send another message to apply the corrected configuration.

### How do I temporarily disable it?

Add `"enabled": false` at the top level of the configuration to disable all rules, or inside a rule to disable only that rule.

### Can I use a different configuration path?

Specify a path when starting Pi:

```bash
pi --model-calibration-config ./my-calibration.json
```

Absolute paths, paths relative to the current working directory, and `~/` are supported. An explicit path replaces the default configuration source.
If `PI_CODING_AGENT_DIR` is set, the default configuration is `model-calibration.json` in that directory.
The extension does not automatically load a configuration file from the project directory.

### Which model requests do these prompts apply to?

Rules match the model currently selected in Pi. Temporary model routing during a run and nested model requests made inside other extensions are outside this scope.
Rule changes affect subsequent runs; they do not remove old prompts from session history.
