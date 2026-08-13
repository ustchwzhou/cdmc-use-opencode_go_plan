# Command Code × OpenCode Go

简体中文 | [English](./README.md)

通过一个小型自定义 Provider Mod 和本机 [cc-switch](https://github.com/farion1231/cc-switch) 代理，让 **Command Code 使用 OpenCode Go 订阅**，同时不修改 Command Code 本体。

> 已在 Windows + Command Code `1.22.0` 上验证。后续版本的模型目录和 Mod API 可能变化，升级后应重新执行本文的验收步骤。

## 仓库内容

| 文件 | 用途 |
| --- | --- |
| [`opencode-go.ts`](./opencode-go.ts) | 注册 `opencode-go` Provider；转换消息和工具协议；解析 SSE；把流式回调交给 Command Code。 |
| [`cmdc-d.cmd`](./cmdc-d.cmd) | 将 Command Code 用户数据放到 D 盘；默认启用 OpenCode Go；支持临时切回官方 Provider。 |
| [`Command-Code-OpenCode-Go-技术方案.html`](./Command-Code-OpenCode-Go-技术方案.html) | 自包含的离线技术手册，涵盖架构、实现、使用、排障、踩坑复盘和验收测试。 |
| [`README.md`](./README.md) | 英文 README。 |

仓库不包含 OpenCode Go Token 或其他密钥。鉴权信息仍由 cc-switch 管理。

## 技术架构

```text
cmdc-d.cmd
    → Command Code + Mod API
    → opencode-go.ts
    → cc-switch（http://127.0.0.1:15721/v1/messages）
    → OpenCode Go
```

Mod 使用 direct transport，将 Command Code 的消息、工具定义、工具结果和模型 ID 转换为 Anthropic Messages 请求，然后解析 Anthropic SSE，并触发交互界面所需的回调：

- `onTextDelta`
- `onThinkingStart` / `onThinkingDelta` / `onThinkingEnd`
- `onMessageUpdate`
- 完整的 `tool_use` block，包括流式 JSON 参数

这层回调不可省略：只返回最终结果可能让 `--print` 正常，但交互 TUI 会只显示 `Worked for ...`，看不到回答。

## 前置条件

- Windows，且已经安装 Command Code。
- cc-switch 正在 `127.0.0.1:15721` 运行。
- 在 cc-switch 中已将 OpenCode Go 配置为当前 Claude Provider，并且订阅可用。
- cc-switch 的 Claude Provider 中，**“默认兜底模型”必须留空**。否则 `deepseek-v4-flash` 等裸模型 ID 可能被 fallback 路由改写。

## 安装方法

仓库中的启动器目前按以下本机路径编写：

```text
Command Code 数据：D:\WSL2Backup\cache_mv\.commandcode
Command Code 程序：D:\WSL2Backup\cache_mv\node-v25.9.0
```

如果你的路径不同，请先修改 `cmdc-d.cmd`。

```powershell
# 安装 Provider Mod
Copy-Item ".\opencode-go.ts" `
  "D:\WSL2Backup\cache_mv\.commandcode\mods\opencode-go.ts" -Force

# 安装启动脚本
Copy-Item ".\cmdc-d.cmd" `
  "D:\WSL2Backup\cache_mv\node-v25.9.0\cmdc-d.cmd" -Force
```

Mod 只在进程启动时加载，所以更新后必须彻底退出旧的 Command Code 进程，再重新启动：

```powershell
cmdc-d
```

## 使用方法

| 操作 | 命令 |
| --- | --- |
| 默认使用 OpenCode Go 启动 | `cmdc-d` |
| 查看 Provider 状态 | `/opencode-go-status` |
| 查看 OpenCode Go 模型 | `/og-model` |
| 切换当前会话模型 | `/og-model qwen3.8-max` |
| 临时使用官方 Provider | `cmdc-d --command-code` |

该 Provider 应优先使用 `/og-model`，不要通过内置 `/model` 判断是否接入成功。内置模型目录可能把相同的短模型名解析到 Command Code 官方 canonical ID；`/og-model` 始终设置完整的 `opencode-go/<model>` ID。

默认模型为：

```text
opencode-go/deepseek-v4-flash
```

## 已登记模型

当前 Mod 共登记 19 个模型：

```text
deepseek-v4-flash   deepseek-v4-pro     gpt-5.6-luna
grok-4.5            glm-5.2             glm-5.1
kimi-k3             kimi-k2.7-code      kimi-k2.6
mimo-v2.5           mimo-v2.5-pro       hy3
minimax-m3          minimax-m2.7        minimax-m2.5
qwen3.8-max         qwen3.7-max         qwen3.7-plus
qwen3.6-plus
```

OpenCode Go 模型目录发生变化时，请更新 `opencode-go.ts` 中的 `MODELS` 表，然后重启 Command Code。

## 验证方法

```powershell
# 1. 检查本机代理
Invoke-WebRequest http://127.0.0.1:15721/health

# 2. 确认只加载目标 Mod
cmdc-d mods list

# 3. 检查流式输出
cmdc-d --print "请只回答：安装后流式正常。" `
  --no-session --max-turns 1 --skip-onboarding --output-format json
```

第三条命令应满足：

- `model_request_start` 显示 `opencode-go/deepseek-v4-flash`；
- 出现一个或多个 `text_delta`；
- 进程退出码为 `0`。

Command Code 或 Mod 升级后，还应强制执行一次真实工具调用。普通文字回答并不能验证完整 Agent 循环。

## 常见问题

### 只显示 `Worked for ...`，没有回答

完全退出旧进程后重新执行 `cmdc-d`。如果仍然出现，检查 JSON 事件流中是否有 `text_delta`，不要只看退出码 0 或最终 `message_end`。

### `/model` 仍然显示官方模型

这是短名称解析冲突。自定义 Provider 请使用 `/og-model` 和 `/opencode-go-status`。

### 选择的模型似乎被替换

清空 cc-switch 当前 Claude Provider 中的“默认兜底模型”。Sonnet、Opus、Haiku、Fable 的角色别名映射可以保留。

### 代理无法连接

检查 cc-switch 是否监听 `15721`。如果修改了端口，同时修改 `opencode-go.ts` 中的 `CC_SWITCH_URL`。

## 维护与回退

- 临时回退：运行 `cmdc-d --command-code`。
- 长期停用：将 `opencode-go.ts` 移出 `.commandcode\mods`。
- 不要修改 `node_modules\command-code`；所有适配应保留在 Mod 和自定义启动器中。
- Command Code 升级后，重新验证 Mod 加载、文字流、Thinking 事件和完整工具调用回合。

完整的实现记录、技术细节和排障复盘请查看[技术方案 HTML](./Command-Code-OpenCode-Go-技术方案.html)。
