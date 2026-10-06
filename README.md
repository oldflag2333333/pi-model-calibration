# pi-model-calibration

为不同模型设置专属系统提示词的 [Pi](https://pi.dev) 插件。

如果你希望切换模型时，自动应用不同的行为要求——例如提醒某个模型避免无关重构、
要求另一个模型修改代码后运行测试——这个插件可以按规则自动添加提示词，无需每次手动输入。

- **按模型匹配**：支持 provider、模型 ID 和展示名称的精确或正则匹配。
- **动态占位符**：用 `{provider}`、`{model}` 填入当前模型信息。
- **灵活编写**：提示词可直接写在配置中，也可从 Markdown 文件读取。

提示词放在 **Project Context 之前**，保留 Pi 原有提示词和项目上下文。

## 安装

```bash
pi install npm:pi-model-calibration
```

安装后重新启动 Pi，无需克隆仓库或手动安装依赖。

## 快速开始

创建 `~/.pi/agent/model-calibration.json`，例如为 GLM 系列添加一条规则：

```json
{
  "rules": [
    {
      "model": { "regex": "^glm-", "flags": "i" },
      "prompt": "你是 {provider} 提供的 {model} 模型。只完成用户要求的范围，避免无关重构。"
    }
  ]
}
```

将匹配条件和提示词换成你需要的内容；省略 `model` 条件则适用于所有模型。
多条规则命中时按配置顺序合并。修改配置后，下次发送消息即可生效，无需重启。

在 Pi 中运行 **`/model-calibration`**，查看当前模型、命中的规则和最终提示词。

更多用法见 [配置指南](doc/configuration.md) · [完整示例](model-calibration.example.json)。

## 更新与卸载

```bash
pi update npm:pi-model-calibration
pi remove npm:pi-model-calibration
```

更新后重新启动 Pi。

## 许可证

[MIT](LICENSE)
