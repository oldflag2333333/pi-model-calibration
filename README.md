# model-calibration

一个 Pi 插件：根据当前模型的 **provider / model ID / 展示名称**，追加专属系统提示词。
支持精确匹配和 JavaScript 正则表达式；提示词可内联或从 Markdown 文件读取，
正常情况下作为独立 section 追加，不替换 Pi 原有提示词。

## 加载

在这个目录的上一级执行：

```bash
# 临时加载，不修改 Pi 设置
pi -e ./model-calibration

# 安装到个人 Pi 设置（仍引用本地目录，不复制）
pi install ./model-calibration
```

无需编译，也不需要安装运行时依赖。面向 Pi 1.0 的
`@earendil-works/pi-coding-agent` API；已在 Pi 1.0.2 和 1.0.4 上通过类型检查与全部测试。

## 配置

默认读取 `~/.pi/agent/model-calibration.json`；
设置了 `PI_CODING_AGENT_DIR` 时，读取该 agent 目录下的同名文件。

可以复制示例后修改为实际的 provider / model ID：

```bash
cp model-calibration/model-calibration.example.json ~/.pi/agent/model-calibration.json
```

或者明确指定文件（不再读取默认文件）：

```bash
pi -e ./model-calibration \
  --model-calibration-config ./model-calibration/model-calibration.example.json
```

参数支持绝对路径、相对当前工作目录的路径及 `~/`。
不会自动读取项目配置，避免未信任项目的文件悄悄改变全局插件的提示词。

```json
{
  "enabled": true,
  "rules": [
    {
      "name": "GPT 精确匹配",
      "provider": "openai",
      "model": { "exact": "gpt-5" },
      "prompt": "修改代码后运行相关测试；不确定时明确说明，不要编造结果。"
    },
    {
      "name": "Claude 系列",
      "provider": { "regex": "^anthropic", "flags": "i" },
      "model": { "regex": "^claude-" },
      "prompt": "只完成用户要求的范围，避免无关重构。"
    }
  ]
}
```

### 匹配语义

- 字符串（如 `"openai"`）是**区分大小写的完整精确匹配**，等价于 `{ "exact": "openai" }`。
- `{ "regex": "^gpt-", "flags": "i" }` 使用 JavaScript 正则；
  不带 `/…/` 分隔符。需要全串匹配时使用 `^` 和 `$`。
  JSON 中的反斜杠需要转义，例如 `"^gpt-\\d"`。
- `provider` 对应 `ctx.model.provider`；`model` 对应 `ctx.model.id`，
  **不是展示名称**。匹配展示名称请用可选的 `modelName`。
- 同一个规则内，所有指定的匹配条件都必须命中（AND）。
- 省略某个条件代表不限制该字段；省略所有条件则匹配所有模型。
- **所有命中的规则按配置顺序追加**，提示词之间用空行分隔；
  精确匹配不会自动优先于正则。
- 顶层 `enabled: false` 禁用整个配置；规则的 `enabled: false` 禁用该条。
- `name` 是可选的调试标签，不会发给模型。
- `prompt` 与 `promptFile` **必须且只能指定一个**，值必须是非空字符串。
  `prompt` 的多行内容可在 JSON 字符串中使用 `\n`；前后空白会被去除。
  禁用的规则仍校验字段和正则，但不会读取其提示词文件。
- 默认配置不存在时不追加任何内容；指定文件不存在、JSON 无效、
  正则无效或字段拼错时，会提示错误并停止应用该文件的全部规则，
  不会沿用旧规则或应用半份配置。

### 外部提示词文件

长提示词建议使用 `promptFile`，例如：

```json
{
  "rules": [
    {
      "name": "Claude 校准",
      "model": { "regex": "^claude-" },
      "promptFile": "calibration-prompts/claude.md"
    }
  ]
}
```

如果配置放在 `~/.pi/agent/model-calibration.json`，则先创建
`~/.pi/agent/calibration-prompts/claude.md`，在其中直接写提示词，无需 JSON 转义。
使用 `calibration-prompts/` 而非 Pi 的 `prompts/` 目录，避免校准文件被额外发现为斜杠命令模板。
独立示例配置也包含一个默认禁用的 `calibration-prompts/qwen.md` 规则；启用前请创建对应文件。

路径与错误处理：

- `promptFile` 相对**配置文件所在目录**解析，不相对 Pi 工作目录。
- 只允许配置目录内的相对路径；拒绝绝对路径、`~/`、越界的 `../`，
  以及指向目录外的软链接。配置目录内的软链接可以使用。
- 只读取当前模型**命中且启用**的文件规则；未命中、规则禁用、整体禁用或
  没有当前模型时，不要求对应文件存在。
- 文件必须是普通文件且内容非空。任意命中文件无法读取、路径违规或内容为空时，
  **本轮不应用任何校准规则**，包括本轮命中的内联规则；不会沿用旧内容，
  也不会把错误信息作为提示词发给模型。修复后下一次运行自动恢复。
- 配置与命中文件每次运行都重新读取，修改 JSON 或 Markdown 后无需 `/reload`。
- 只使用可信配置和提示词文件。路径检查用于防止误读和普通软链接越界，
  不是文件系统沙箱，无法替代权限隔离或防御有权限并发替换文件的进程。

原有的内联 `prompt` 配置无需迁移。不要直接复用 `model-calibration-glm`
的配置：它的 `match` 嵌套结构与本插件不兼容，本插件会明确拒绝而不是放宽匹配。

### 生效时机与诊断

每次 `before_agent_start` 都重新读取配置并匹配当前模型，修改配置无需重启；
切换模型后在**下一次 agent run** 生效。运行中的临时路由模型
（例如 virtual model）和插件内部嵌套的模型请求不在这个事件的覆盖范围内。

在 Pi 中运行 `/model-calibration` 查看：

- 配置路径、总开关、当前 provider/model ID 和展示名称；
- 规则总数、命中数量，以及每条规则的 `matched` / `not matched` /
  `rule disabled` / `config disabled` / `no model` 状态；
- 提示词来源（内联或文件路径），以及当前实际命中规则的提示词全文。

自动运行时，相同错误只警告一次；主动执行诊断命令总会重新报告当前错误。
无 UI 模式下诊断输出到 stderr，不污染 stdout。

## 实现方式

使用 `systemPromptOptions.sections.model_calibration` 追加独立 section，
保留其它 section，交由 Pi 记录提示词变化，不直接改写会话历史。
当前无规则命中时，不添加校准 section。

若更早执行的插件设置了完整 `forceSystemPrompt`，则保留它并在末尾追加校准文本；
更晚执行的插件若强行覆盖整段提示词，可能覆盖本插件内容。
历史轮次里的旧 section / delta 仍属于会话历史，并不会被删除。

## 开发

```bash
cd model-calibration
npm install
npm run check             # 类型检查 + 全部测试
npm run test:integration  # 仅运行真实 Pi 加载/事件链测试
```

入口是 `index.ts`，规则验证与匹配位于 `src/config.ts`，
文件提示词解析位于 `src/prompts.ts`，事件和命令注册位于 `src/extension.ts`。

测试位于 `test/`，覆盖配置校验、文件更新与恢复、路径限制、规则诊断，
以及真实 Pi package 发现、jiti 加载、ExtensionRunner 和提示词渲染。
集成测试使用临时 agent/workspace 目录，不修改个人配置、不需要 API key，
也不发起模型请求；它不等同于 provider 请求或持久会话恢复的端到端测试。

## CI 与 npm 发布

GitHub Actions 工作流：

- `.github/workflows/ci.yml`：分支推送和 PR 自动执行检查。使用 Node 22/24，
  分别检查锁文件中的 Pi 1.0.2 和 Pi 1.0.4，执行类型检查、全部测试及打包预览。
- `.github/workflows/publish.yml`：推送 `v*` 标签后先运行同一检查矩阵，
  通过后验证标签、`package.json` 和锁文件版本一致，再发布到 npm。
  正式版本使用 `latest`，含预发布标识的版本（如 `0.2.0-beta.0`）使用 `next`。
  发布仅在 `oldflag2333333/model-calibration` 仓库执行。

### 一次性配置

发布使用 [npm Trusted Publishing（OIDC）](https://docs.npmjs.com/trusted-publishers/)，
无需设置 `NPM_TOKEN` 或 `NODE_AUTH_TOKEN`，也不需要手动轮换凭证。

1. 将这些文件提交并推送到 GitHub，确认仓库已启用 Actions。
2. 若 npm 上尚无 `pi-model-calibration` 包，先确认包名可用，并在本地首次发布：

   ```bash
   npm login
   npm ci
   npm run check
   npm publish --access public
   ```

   首次发布需要你的 npm 账号拥有包名权限，并按提示完成双因素验证。
3. 在 npm 包的 **Settings → Trusted publishing** 中添加 GitHub Actions：

   | 字段 | 值 |
   |---|---|
   | Organization or user | `oldflag2333333` |
   | Repository | `model-calibration` |
   | Workflow filename | `publish.yml`（不要填写目录） |
   | Environment name | 留空（工作流未设置 environment） |
   | Allowed actions | 允许直接 `npm publish`，不能只允许 stage publish |

4. 建议在 GitHub Rulesets 中限制 `v*` 标签的创建、更新和删除权限。
   OIDC 发布确认成功后，可在 npm 中选择要求双因素验证并禁止传统 token 发布。

工作流使用 GitHub 托管的 runner、Node 24 和 npm 11，
仅发布 job 获得 `id-token: write`；PR 检查不具备发布权限。
公开仓库发布公开包时，npm Trusted Publishing 自动生成 provenance。

### 后续发布

先合并变更到 `main`，提交所有修改并保持工作区干净，然后执行：

```bash
npm version patch                   # 也可使用 minor / major
git push origin HEAD --follow-tags
```

`npm version` 会同步修改清单和锁文件，创建版本提交与 `v*` 标签。
首次手动发布 `0.1.0` 后，下一次应发布 `0.1.1` 或更高版本，
不要再用 `v0.1.0` 触发同一版本发布；npm 不允许覆盖已发布版本。
在 GitHub Actions 页面查看检查和发布结果；这些配置不会自动创建 GitHub Release。
若标签没有触发发布，或需要重试尚未成功的发布，可在 **Actions → Publish to npm →
Run workflow** 中选择 `main`，填写已有标签（如 `v0.1.1`）。
手动流程会检查和发布该标签指向的代码，不会创建或移动标签；已经发布成功的版本不能重复发布。

## 许可证

[MIT](LICENSE)，Copyright (c) 2026 oldflag2333333。
