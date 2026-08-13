# Command Code × OpenCode Go

[简体中文](./README.zh-CN.md) | English

Use an **OpenCode Go subscription** inside **Command Code** through a small custom provider mod and the local [cc-switch](https://github.com/farion1231/cc-switch) proxy—without patching Command Code itself.

> Tested with Command Code `1.22.0` on Windows. The model catalog and Mod API may change in later releases; rerun the verification steps after upgrading.

## What this repository contains

| File | Purpose |
| --- | --- |
| [`opencode-go.ts`](./opencode-go.ts) | Registers the `opencode-go` provider, converts messages/tools to Anthropic Messages format, consumes SSE events, and forwards streaming callbacks to Command Code. |
| [`cmdc-d.cmd`](./cmdc-d.cmd) | Starts Command Code with its user data on drive D:, enables OpenCode Go by default, and provides an official-provider fallback switch. |
| [`Command-Code-OpenCode-Go-技术方案.html`](./Command-Code-OpenCode-Go-技术方案.html) | Offline, self-contained technical guide with architecture, implementation notes, usage, troubleshooting, lessons learned, and acceptance tests. |
| [`README.zh-CN.md`](./README.zh-CN.md) | Chinese README. |

No OpenCode Go token or other secret is stored in this repository. Credentials remain managed by cc-switch.

## Architecture

```text
cmdc-d.cmd
    → Command Code + Mod API
    → opencode-go.ts
    → cc-switch (http://127.0.0.1:15721/v1/messages)
    → OpenCode Go
```

The mod uses a direct transport and translates Command Code messages, tool schemas, tool results, and model IDs into Anthropic Messages requests. It parses the Anthropic SSE stream and emits the callbacks required by the interactive UI:

- `onTextDelta`
- `onThinkingStart` / `onThinkingDelta` / `onThinkingEnd`
- `onMessageUpdate`
- Complete `tool_use` blocks, including streamed JSON input

This callback layer is essential: returning only the final response may work with `--print`, but the interactive TUI can otherwise finish with `Worked for ...` and show no answer.

## Prerequisites

- Windows with Command Code installed.
- cc-switch running on `127.0.0.1:15721`.
- An active OpenCode Go subscription configured as the current Claude provider in cc-switch.
- The Claude provider's **default fallback model must be empty** in cc-switch. Otherwise, bare model IDs such as `deepseek-v4-flash` may be rewritten by fallback routing.

## Installation

The bundled launcher currently targets these local paths:

```text
Command Code data: D:\WSL2Backup\cache_mv\.commandcode
Command Code bin:  D:\WSL2Backup\cache_mv\node-v25.9.0
```

Adjust `cmdc-d.cmd` first if your paths differ.

```powershell
# Install the provider mod
Copy-Item ".\opencode-go.ts" `
  "D:\WSL2Backup\cache_mv\.commandcode\mods\opencode-go.ts" -Force

# Install the launcher
Copy-Item ".\cmdc-d.cmd" `
  "D:\WSL2Backup\cache_mv\node-v25.9.0\cmdc-d.cmd" -Force
```

Exit all existing Command Code processes before restarting because mods are loaded at process startup.

```powershell
cmdc-d
```

## Usage

| Action | Command |
| --- | --- |
| Start with OpenCode Go | `cmdc-d` |
| Show provider status | `/opencode-go-status` |
| List OpenCode Go models | `/og-model` |
| Switch the current session | `/og-model qwen3.8-max` |
| Start with Command Code's official provider | `cmdc-d --command-code` |

Use `/og-model` instead of the built-in `/model` command for this provider. The built-in catalog can resolve duplicate short names to Command Code's official canonical model IDs; `/og-model` always sets the complete `opencode-go/<model>` ID.

### Important: displayed model vs. model actually used

`/og-model` changes the **live model for the current Command Code session** through `cmd.setModel()`. It does not rewrite Command Code's official user-scoped `model` setting. Consequently, after running:

```text
/og-model qwen3.8-max
```

some Command Code surfaces may still say `deepseek/deepseek-v4-flash`, including:

- answers produced after the agent runs `cmdc config get model --json`;
- the `Model` field in an exported session;
- other UI or metadata backed by the official user-scoped `/model` setting.

That stale display does **not** mean the switch failed. The custom transport receives the live full ID, strips the `opencode-go/` prefix, and sends `qwen3.8-max` to cc-switch. To determine the model actually used, prefer these sources, in order:

1. the model recorded in the OpenCode Go usage/billing history;
2. the `model_request_start` event in `--output-format json` output;
3. the confirmation printed by `/og-model`.

The official user-scoped model value and the active mod-managed session model are separate state. Restarting `cmdc-d` resets the mod-managed model to its default, `opencode-go/deepseek-v4-flash`.

The default model is:

```text
opencode-go/deepseek-v4-flash
```

## Registered models

The current mod registers 19 models:

```text
deepseek-v4-flash   deepseek-v4-pro     gpt-5.6-luna
grok-4.5            glm-5.2             glm-5.1
kimi-k3             kimi-k2.7-code      kimi-k2.6
mimo-v2.5           mimo-v2.5-pro       hy3
minimax-m3          minimax-m2.7        minimax-m2.5
qwen3.8-max         qwen3.7-max         qwen3.7-plus
qwen3.6-plus
```

Update the `MODELS` table in `opencode-go.ts` if the OpenCode Go catalog changes, then restart Command Code.

## Verification

```powershell
# 1. Check the local proxy
Invoke-WebRequest http://127.0.0.1:15721/health

# 2. Confirm that only the intended mod is active
cmdc-d mods list

# 3. Verify streaming output
cmdc-d --print "Reply only with: streaming works." `
  --no-session --max-turns 1 --skip-onboarding --output-format json
```

The third command should show:

- `model_request_start` with `opencode-go/deepseek-v4-flash`;
- one or more `text_delta` events;
- exit code `0`.

Also test at least one real tool call after Command Code or the mod is upgraded. Plain text completion alone does not verify the full agent loop.

To verify a session-only model switch, run `/og-model qwen3.8-max`, send a new prompt, and check the OpenCode Go usage history. A test performed on 2026-08-14 showed new `qwen3.8-max` usage entries even though the exported Command Code session and `cmdc config get model --json` still reported `deepseek/deepseek-v4-flash`.

## Troubleshooting

### The UI shows `Worked for ...` but no answer

Fully exit the old process and restart with `cmdc-d`. If it persists, inspect the JSON event stream and confirm that `text_delta` events are present—not just a final `message_end`.

### `/model` shows official Command Code models

This is a short-name resolution conflict. Use `/og-model` and `/opencode-go-status` for the custom provider.

### I switched with `/og-model`, but Command Code still says DeepSeek

This is a known display/state separation, not sufficient evidence of a routing failure. `/og-model` updates the live session model owned by the mod, while `cmdc config get model --json` and session export metadata can continue to read the unchanged official user-scoped setting. Check the OpenCode Go usage history or JSON `model_request_start` event to identify the model actually called.

### The selected model appears to be replaced

Clear the **default fallback model** in cc-switch's active Claude provider. Role aliases for Sonnet, Opus, Haiku, and Fable can remain configured.

### The proxy is unreachable

Check that cc-switch is listening on port `15721`. If you change the port, update `CC_SWITCH_URL` in `opencode-go.ts`.

## Maintenance and rollback

- Temporary fallback: run `cmdc-d --command-code`.
- Long-term disable: move `opencode-go.ts` out of `.commandcode\mods`.
- Do not patch `node_modules\command-code`; keep all integration logic in the mod and launcher.
- After upgrading Command Code, verify mod loading, text streaming, thinking events, and a complete tool-call round.

For the full implementation record and detailed postmortem, open the [technical guide](./Command-Code-OpenCode-Go-技术方案.html).
