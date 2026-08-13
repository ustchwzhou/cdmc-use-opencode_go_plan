/**
 * OpenCode Go provider for Command Code, routed through the cc-switch local proxy.
 *
 * cc-switch runs an HTTP proxy at http://127.0.0.1:15721 whose `/v1/messages` route
 * is hardwired to the Claude handling chain. This mod pretends to be a Claude client:
 * it translates Command Code's internal message format to Anthropic Messages, posts to
 * that route, and cc-switch forwards to the real OpenCode Go endpoint using whatever
 * provider is currently active for "Claude" in cc-switch.
 *
 * Enable/disable via the cmdc-d.cmd launcher:
 *   cmdc-d                  -> OpenCode Go via the cc-switch local proxy
 *   cmdc-d --command-code   -> Command Code's official provider
 *
 * Model routing: this mod sends the bare upstream model id (e.g. "deepseek-v4-flash").
 * For cc-switch to forward those ids through unchanged, its Claude provider's
 * "默认兜底模型" (default fallback model) must be LEFT EMPTY. Otherwise any model id
 * that does not contain "sonnet"/"opus"/"haiku"/"fable" is swallowed by that fallback.
 * The role-alias mappings (Sonnet/Opus/Haiku/Fable) stay intact for real Claude Code.
 */
import type { ModApi } from '@commandcode/harness';

const CC_SWITCH_URL = 'http://127.0.0.1:15721/v1/messages';

const MODELS: Record<string, { contextWindow?: number; vision?: boolean }> = {
  'deepseek-v4-flash': { contextWindow: 1_000_000 },
  'deepseek-v4-pro': { contextWindow: 1_000_000 },
  'gpt-5.6-luna': { contextWindow: 1_050_000, vision: true },
  'grok-4.5': { contextWindow: 500_000 },
  'glm-5.2': { contextWindow: 1_000_000 },
  'glm-5.1': { contextWindow: 200_000 },
  'kimi-k3': { contextWindow: 1_000_000 },
  'kimi-k2.7-code': { contextWindow: 256_000, vision: true },
  'kimi-k2.6': { contextWindow: 256_000, vision: true },
  'mimo-v2.5': { contextWindow: 1_000_000 },
  'mimo-v2.5-pro': { contextWindow: 1_000_000 },
  'hy3': { contextWindow: 262_000 },
  'minimax-m3': { contextWindow: 1_000_000, vision: true },
  'minimax-m2.7': { contextWindow: 200_000, vision: true },
  'minimax-m2.5': { contextWindow: 200_000, vision: true },
  'qwen3.8-max': { contextWindow: 1_000_000, vision: true },
  'qwen3.7-max': { contextWindow: 1_000_000, vision: true },
  'qwen3.7-plus': { contextWindow: 256_000, vision: true },
  'qwen3.6-plus': { contextWindow: 256_000, vision: true },
};

function normalizeModelId(model: string): string {
  return model.replace(/^opencode-go\//, '');
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = (content as Array<{ type?: string; text?: unknown }>)
      .filter((x) => x?.type === 'text')
      .map((x) => String(x.text ?? ''))
      .join('\n');
    if (text) return text;
  }
  return JSON.stringify(content ?? '');
}

// Command Code internal message format -> Anthropic Messages.
function toAnthropicMessages(messages: any[], system?: string) {
  const systemBlocks: any[] = system ? [{ type: 'text', text: system }] : [];
  const out: any[] = [];
  for (const m of messages ?? []) {
    if (m.role === 'assistant') {
      const blocks: any[] = [];
      for (const c of m.content ?? []) {
        if (c.type === 'text') blocks.push({ type: 'text', text: String(c.text ?? '') });
        else if (c.type === 'tool_use')
          blocks.push({ type: 'tool_use', id: String(c.id ?? ''), name: String(c.name ?? ''), input: c.input ?? {} });
        else if (c.type === 'thinking')
          blocks.push({ type: 'thinking', thinking: String(c.thinking ?? '') });
      }
      if (blocks.length) out.push({ role: 'assistant', content: blocks });
    } else {
      const textImage: any[] = [];
      for (const c of m.content ?? []) {
        if (c.type === 'text') textImage.push({ type: 'text', text: String(c.text ?? '') });
        else if (c.type === 'image') {
          const data = String(c.source?.data ?? '').replace(/^data:[^,]+,/, '');
          textImage.push({
            type: 'image',
            source: { type: 'base64', media_type: String(c.source?.media_type ?? 'image/png'), data },
          });
        } else if (c.type === 'tool_result') {
          out.push({
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: String(c.tool_use_id ?? ''), content: stringifyToolResult(c.content) }],
          });
        }
      }
      if (textImage.length) out.push({ role: 'user', content: textImage });
    }
  }
  return { system: systemBlocks, messages: out };
}

function toAnthropicTools(tools?: any[]): any[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description ?? '',
    input_schema: t.input_schema ?? { type: 'object', properties: {} },
  }));
}

type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

function mergeUsage(current: Usage, u: any): Usage {
  return {
    inputTokens: u?.input_tokens ?? current.inputTokens,
    outputTokens: u?.output_tokens ?? current.outputTokens,
    cacheReadTokens: u?.cache_read_input_tokens ?? current.cacheReadTokens,
    cacheWriteTokens: u?.cache_creation_input_tokens ?? current.cacheWriteTokens,
  };
}

async function stream(params: any): Promise<any> {
  const model = normalizeModelId(params.model);
  const { system, messages } = toAnthropicMessages(params.messages, params.system);
  const body: any = {
    model,
    max_tokens: params.maxOutputTokens ?? 8192,
    messages,
    stream: true,
  };
  if (system.length) body.system = system;
  const tools = toAnthropicTools(params.tools);
  if (tools) body.tools = tools;
  if (params.temperature !== undefined) body.temperature = params.temperature;

  let res: Response;
  try {
    res = await fetch(CC_SWITCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer cc-switch-local-proxy',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });
  } catch (e) {
    throw new Error(
      `cc-switch local proxy unreachable at ${CC_SWITCH_URL}: ${e instanceof Error ? e.message : e}`,
    );
  }

  if (!res.ok || !res.body) {
    const err = await res.text().catch(() => '');
    throw new Error(`cc-switch (${model}): HTTP ${res.status} ${err.slice(0, 500)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const content: any[] = [];
  let currentText: { type: 'text'; text: string } | null = null;
  let currentThinking: { type: 'thinking'; thinking: string; signature: string } | null = null;
  let currentTool: {
    id: string;
    name: string;
    inputJson: string;
    initialInput: unknown;
  } | null = null;
  let stopReasonRaw: string | undefined;
  let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

  // Direct providers are responsible for both returning the final content and firing the
  // incremental callbacks used by Command Code's interactive TUI. Returning content alone
  // works in --print mode, but leaves the interactive feed blank.
  const emitUpdate = () => params.onMessageUpdate?.(content.map((block: any) => ({ ...block })));
  const finishThinking = () => {
    if (!currentThinking) return;
    if (currentThinking.thinking || currentThinking.signature) content.push(currentThinking);
    params.onThinkingEnd?.(currentThinking.thinking);
    currentThinking = null;
    emitUpdate();
  };
  const finishTool = () => {
    if (!currentTool) return;
    let input: unknown = currentTool.initialInput ?? {};
    if (currentTool.inputJson) {
      try {
        input = JSON.parse(currentTool.inputJson);
      } catch {
        input = currentTool.inputJson;
      }
    }
    content.push({ type: 'tool_use', id: currentTool.id, name: currentTool.name, input });
    currentTool = null;
    emitUpdate();
  };

  const handleEvent = (evt: any) => {
    const type = evt?.type;
    if (type === 'error') {
      throw new Error(`cc-switch (${model}): ${evt?.error?.message ?? JSON.stringify(evt?.error ?? evt)}`);
    }
    if (type === 'content_block_start') {
      const block = evt.content_block;
      if (block?.type === 'thinking') {
        finishTool();
        currentText = null;
        currentThinking = {
          type: 'thinking',
          thinking: String(block.thinking ?? ''),
          signature: String(block.signature ?? ''),
        };
        params.onThinkingStart?.();
        if (currentThinking.thinking) params.onThinkingDelta?.(currentThinking.thinking);
      } else if (block?.type === 'text') {
        finishThinking();
        finishTool();
        currentText = { type: 'text', text: String(block.text ?? '') };
        content.push(currentText);
        if (currentText.text) params.onTextDelta?.(currentText.text);
        emitUpdate();
      } else if (block?.type === 'tool_use') {
        finishThinking();
        currentText = null;
        currentTool = {
          id: String(block.id ?? ''),
          name: String(block.name ?? ''),
          inputJson: '',
          initialInput: block.input ?? {},
        };
      }
      return;
    }
    if (type === 'content_block_delta') {
      const delta = evt.delta;
      if (delta?.type === 'text_delta') {
        finishThinking();
        if (!currentText) {
          currentText = { type: 'text', text: '' };
          content.push(currentText);
        }
        const chunk = String(delta.text ?? '');
        currentText.text += chunk;
        params.onTextDelta?.(chunk);
        emitUpdate();
      } else if (delta?.type === 'thinking_delta') {
        if (!currentThinking) {
          currentThinking = { type: 'thinking', thinking: '', signature: '' };
          params.onThinkingStart?.();
        }
        const chunk = String(delta.thinking ?? '');
        currentThinking.thinking += chunk;
        if (chunk) params.onThinkingDelta?.(chunk);
      } else if (delta?.type === 'signature_delta' && currentThinking) {
        currentThinking.signature += String(delta.signature ?? '');
      } else if (delta?.type === 'input_json_delta' && currentTool) {
        currentTool.inputJson += String(delta.partial_json ?? '');
      }
      return;
    }
    if (type === 'content_block_stop') {
      if (currentThinking) finishThinking();
      else if (currentTool) finishTool();
      currentText = null;
      return;
    }
    if (type === 'message_start' && evt.message?.usage) {
      usage = mergeUsage(usage, evt.message.usage);
      return;
    }
    if (type === 'message_delta') {
      if (evt.delta?.stop_reason) stopReasonRaw = String(evt.delta.stop_reason);
      if (evt.usage) usage = mergeUsage(usage, evt.usage);
    }
  };

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let evt: any;
    try {
      evt = JSON.parse(data);
    } catch {
      return;
    }
    handleEvent(evt);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) handleLine(line);
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleLine(buffer);
  } finally {
    reader.releaseLock();
  }

  finishThinking();
  finishTool();

  if (!content.some((block) => block.type === 'text' || block.type === 'tool_use')) {
    throw new Error(
      `cc-switch (${model}): stream completed without an answer or tool call`,
    );
  }

  const raw = stopReasonRaw ?? 'end_turn';
  const stopReason = raw === 'tool_use' ? 'tool_use' : raw === 'max_tokens' ? 'max_tokens' : 'end_turn';
  return { content, usage, rawFinishReason: raw, stopReason };
}

const providerModule = {
  id: 'opencode-go',
  displayName: 'OpenCode Go (cc-switch)',
  models: Object.entries(MODELS).map(([id, info]) => ({
    id: `opencode-go/${id}`,
    provider: 'opencode-go',
    contextWindow: info.contextWindow,
    inputModalities: info.vision ? (['text', 'image'] as const) : (['text'] as const),
  })),
  matchesModelId: (model: string) => model.startsWith('opencode-go/'),
  transport: { kind: 'direct', stream } as const,
};

export default function (cmd: ModApi) {
  const enabled = process.env.CMDC_USE_OPENCODE_GO === '1';
  if (enabled) {
    cmd.addProvider(providerModule);
    // The built-in /model catalog resolves duplicate short names to Command Code's own
    // canonical IDs. Set the full custom ID through the live ModApi instead.
    cmd.setModel('opencode-go/deepseek-v4-flash');
  }
  cmd.addCommand({
    name: 'og-model',
    description: 'Switch this session to an OpenCode Go model (via cc-switch)',
    argumentHint: '<model>',
    handler: ({ args }) => {
      if (!enabled) {
        return { message: 'OpenCode Go is off. Start cmdc-d without --command-code (or add --opencode-go).' };
      }
      const requested = args.trim();
      if (!requested) {
        return { message: `Usage: /og-model <name>\nAvailable: ${Object.keys(MODELS).join(', ')}` };
      }
      const bare = normalizeModelId(requested);
      if (!MODELS[bare]) {
        return { message: `Unknown OpenCode Go model "${requested}".\nAvailable: ${Object.keys(MODELS).join(', ')}` };
      }
      const fullId = `opencode-go/${bare}`;
      cmd.setModel(fullId);
      return { message: `OpenCode Go model set for this session: ${fullId}` };
    },
  });
  cmd.addCommand({
    name: 'opencode-go-status',
    description: 'Show whether the OpenCode Go provider (via cc-switch) is active',
    handler: () => ({
      message: enabled
        ? `opencode-go is ACTIVE via cc-switch at ${CC_SWITCH_URL} (${providerModule.models.length} models).`
        : 'opencode-go is OFF. Start cmdc-d without --command-code (or add --opencode-go).',
    }),
  });
}

export { providerModule };
