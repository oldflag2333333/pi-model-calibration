# 配置指南

[返回 README](../README.md) · [English](configuration.en.md)

## 快速开始

创建 `~/.pi/agent/model-calibration.json`，写入：

```json
{
  "rules": [
    {
      "prompt": "你是 {provider} 提供的 {model} 模型。不确定时明确说明，不要编造结果。"
    }
  ]
}
```

这条规则对所有模型生效。例如，provider 为 `xxx`、模型 ID 为 `glm-5.3-flash` 时，
实际提示词为：

> 你是 xxx 提供的 glm-5.3-flash 模型。不确定时明确说明，不要编造结果。

在 Pi 中运行 `/model-calibration`，可以查看当前模型、配置路径、命中的规则和最终提示词。

修改配置或提示词文件后，**下一次发送消息时生效，无需重启或 `/reload`**。
切换模型后也会自动使用新模型对应的规则。

## 为不同模型设置提示词

例如，给所有模型添加通用要求，再为 GLM 系列和某个 provider 下的 GPT 模型添加专属要求：

```json
{
  "rules": [
    {
      "name": "通用要求",
      "prompt": "不确定时明确说明，不要编造结果。"
    },
    {
      "name": "GLM 系列",
      "model": { "regex": "^glm-", "flags": "i" },
      "prompt": "你是 {provider} 提供的 {model} 模型。只完成用户要求的范围，避免无关重构。"
    },
    {
      "name": "指定 provider 和模型",
      "provider": "openai",
      "model": "gpt-5",
      "prompt": "修改代码后运行相关测试，并如实说明测试结果。"
    }
  ]
}
```

请将示例中的 provider 和模型 ID 换成你实际使用的值；可通过 `/model-calibration` 查看。
更多配置示例见 [model-calibration.example.json](../model-calibration.example.json)。

### 规则字段

| 字段 | 用途 |
| --- | --- |
| `name` | 可选，便于识别规则的名称，不会发给模型 |
| `provider` | 匹配 provider |
| `model` | 匹配模型 ID，**不是展示名称** |
| `modelName` | 匹配模型展示名称 |
| `prompt` | 直接填写提示词，多行使用 `\n` |
| `promptFile` | 从文件读取提示词，与 `prompt` 二选一 |
| `enabled` | 可选，设为 `false` 禁用这条规则，默认启用 |

匹配规则：

- 省略匹配条件表示不限制；全部省略则适用于所有模型。
- 同一条规则的多个条件必须同时满足。
- 字符串是区分大小写的完整匹配，例如 `"gpt-5"`，也可写成 `{ "exact": "gpt-5" }`。
- 正则写成 `{ "regex": "^glm-", "flags": "i" }`，不带 `/…/` 分隔符；`i` 表示忽略大小写。
  JSON 中的反斜杠需要转义，例如 `"^gpt-\\d"`。
- **所有命中规则按配置顺序合并**，以空行分隔，不是只选一条。精确匹配也不会自动覆盖通用规则。

### 提示词占位符

`prompt` 和提示词文件正文都支持：

| 占位符 | 替换内容 |
| --- | --- |
| `{provider}` | 当前模型的 provider |
| `{model}` | 当前模型 ID |

占位符区分大小写，所有出现位置都会替换。未知占位符保持原样，替换值不会再次展开。
占位符只用于提示词正文，不用于匹配条件或文件路径。

## 使用提示词文件

较长的提示词建议放在独立的 Markdown 文件中：

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

然后创建 `~/.pi/agent/calibration-prompts/glm.md`，例如：

```markdown
你是 {provider} 提供的 {model} 模型。

- 优先完成用户明确要求的范围。
- 修改代码后运行相关测试。
- 不要把计划或猜测当成已经完成的操作。
```

注意：

- `prompt` 和 `promptFile` 必须且只能填写一个，提示词内容不能为空。
- 文件路径相对**配置文件所在目录**，而不是当前工作目录。
- 文件必须位于配置目录内，不支持绝对路径、`~/`、越界的 `../` 或指向目录外的软链接。
- 建议使用 `calibration-prompts/`，不要放进 Pi 的 `prompts/` 目录，避免被识别为斜杠命令模板。
- 只读取当前模型命中且启用的提示词文件。请仅使用你信任的配置和提示词。

## 常见问题

### 安装后没有生效？

插件不会自动创建配置。确认已创建 `~/.pi/agent/model-calibration.json`，
然后运行 `/model-calibration`，检查配置路径、当前模型、规则是否启用以及是否匹配。
如果命令不存在，先用 `pi list` 确认插件已安装，再重新启动 Pi。

默认配置不存在或没有规则命中时，插件不会添加任何提示词。
配置有误，或命中的提示词文件无法读取、内容为空时，会提示错误，**本轮不应用任何校准规则**。
修复后下次发送消息即可生效。

### 如何暂时禁用？

在配置顶层添加 `"enabled": false` 禁用全部规则；也可以在某条规则中添加它，只禁用该条。

### 能否使用其他配置路径？

可以在启动 Pi 时指定：

```bash
pi --model-calibration-config ./my-calibration.json
```

支持绝对路径、相对当前工作目录的路径及 `~/`。指定后不再读取默认配置。
如果设置了 `PI_CODING_AGENT_DIR`，默认配置则是该目录下的 `model-calibration.json`。
插件不会自动读取项目目录中的同名配置。

### 提示词会应用到哪些模型请求？

规则根据 Pi 当前选中的模型匹配。运行中的临时模型路由和插件内部的嵌套模型请求不在覆盖范围内。
修改规则只影响后续运行，不会删除会话历史中的旧提示词。

