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

### 重要：界面显示模型与实际调用模型可能不同

`/og-model` 通过 `cmd.setModel()` 修改的是 **Command Code 当前会话的实时模型**，不会改写 Command Code 官方 user 作用域的 `model` 配置。因此执行：

```text
/og-model qwen3.8-max
```

以后，以下位置仍可能显示 `deepseek/deepseek-v4-flash`：

- 智能体执行 `cmdc config get model --json` 后给出的回答；
- 导出会话顶部的 `Model` 字段；
- 其他读取官方 user 作用域 `/model` 设置的界面或元数据。

这种旧显示 **不代表切换失败**。自定义 transport 会收到当前会话的完整模型 ID，移除 `opencode-go/` 前缀，然后把 `qwen3.8-max` 发给 cc-switch。判断实际调用模型时，建议按以下优先级取证：

1. OpenCode Go 官方使用记录或计费流水中的模型；
2. `--output-format json` 输出中的 `model_request_start` 事件；
3. `/og-model` 命令返回的切换确认。

官方 user 作用域模型值与 Mod 管理的当前会话模型是两套独立状态。重新启动 `cmdc-d` 后，Mod 管理的模型会恢复默认值 `opencode-go/deepseek-v4-flash`。

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

验证会话内模型切换时，可先执行 `/og-model qwen3.8-max`，再发送一个新问题，并查看 OpenCode Go 使用流水。

### 2026-08-14 实际对比数据

下表时间均为中国标准时间（UTC+8）；上游数据来自所提供 OpenCode Go 使用流水截图中可见的记录。

| 证据来源 | 时间 | 显示/实际使用模型 | 输入 Token | 输出 Token | 费用 |
| --- | --- | --- | ---: | ---: | ---: |
| OpenCode Go 流水 | 03:10 | `deepseek-v4-flash` | 34,075 | 44 | Go ($0.0001) |
| OpenCode Go 流水 | 03:10 | `deepseek-v4-flash` | 33,951 | 81 | Go ($0.0002) |
| OpenCode Go 流水 | 03:10 | `deepseek-v4-flash` | 33,435 | 194 | Go ($0.0017) |
| OpenCode Go 流水 | 03:12 | `qwen3.8-max` | 33,622 | 126 | Go ($0.0680) |
| OpenCode Go 流水 | 03:12 | `qwen3.8-max` | 33,711 | 71 | Go ($0.0105) |
| OpenCode Go 流水 | 03:12 | `qwen3.8-max` | 33,800 | 63 | Go ($0.0106) |
| OpenCode Go 流水 | 03:12 | `qwen3.8-max` | 33,889 | 81 | Go ($0.0091) |
| OpenCode Go 流水 | 03:13 | `qwen3.8-max` | 34,022 | 135 | Go ($0.0097) |
| Command Code 会话导出 | 03:14:54 | `deepseek/deepseek-v4-flash` | — | — | — |
| 会话内执行 `cmdc config get model --json` | 导出前 | `deepseek/deepseek-v4-flash`，scope 为 `user` | — | — | — |

截图可见范围内，03:10 的 3 笔 DeepSeek 调用合计输入 101,461、输出 319 Token；执行 `/og-model qwen3.8-max` 后，03:12–03:13 的 5 笔 Qwen 调用合计输入 169,044、输出 476 Token。但是会话在 03:14:54 导出时（原始时间戳为 `2026-08-13T19:14:54.504Z`），顶部仍标记为 DeepSeek。这个先后顺序表明：实时上游路由已经切换，而官方 user 作用域配置及显示元数据仍停留在旧值。

## 常见问题

### 只显示 `Worked for ...`，没有回答

完全退出旧进程后重新执行 `cmdc-d`。如果仍然出现，检查 JSON 事件流中是否有 `text_delta`，不要只看退出码 0 或最终 `message_end`。

### `/model` 仍然显示官方模型

这是短名称解析冲突。自定义 Provider 请使用 `/og-model` 和 `/opencode-go-status`。

### 已用 `/og-model` 切换，但 Command Code 仍自称 DeepSeek

这是已知的显示层与会话状态分离，不能据此判断路由失败。`/og-model` 更新的是 Mod 持有的实时会话模型；`cmdc config get model --json` 和会话导出元数据仍可能读取未修改的官方 user 作用域配置。请以 OpenCode Go 官方流水或 JSON 事件中的 `model_request_start` 作为实际调用模型的依据。

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
