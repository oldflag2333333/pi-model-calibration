# pi-model-calibration

[中文](README.md) · English

A [Pi](https://pi.dev) extension for model-specific system prompts.

Automatically apply different instructions when you switch models—for example, remind one model to avoid unrelated refactoring and another to run tests after code changes. Write the instructions once, and let matching rules handle the rest.

- **Model matching**: Match providers, model IDs, or display names using exact strings or regular expressions.
- **Dynamic placeholders**: Insert the current provider and model ID with `{provider}` and `{model}`.
- **Flexible prompts**: Write prompts inline or load them from Markdown files.

Prompts are inserted **before Project Context**, preserving Pi's existing system prompt and project context.

## Install

```bash
pi install npm:pi-model-calibration
```

Restart Pi after installation. No repository clone or manual dependency installation is needed.

## Quick start

Create `~/.pi/agent/model-calibration.json`. For example, add a rule for GLM models:

```json
{
  "rules": [
    {
      "model": { "regex": "^glm-", "flags": "i" },
      "prompt": "You are the {model} model provided by {provider}. Stay within the user's requested scope and avoid unrelated refactoring."
    }
  ]
}
```

Adjust the match condition and prompt to suit your needs. Omit the `model` condition to apply this rule to all models.
All matching rules are combined in configuration order. Configuration changes take effect the next time you send a message—no restart required.

Run **`/model-calibration`** in Pi to inspect the current model, matching rules, and resolved prompts.

See the [configuration guide](doc/configuration.en.md) for more options, or browse the [example configuration](model-calibration.example.json) (Chinese prompt text).

## Update or remove

```bash
pi update npm:pi-model-calibration
pi remove npm:pi-model-calibration
```

Restart Pi after updating.

## License

[MIT](LICENSE)
