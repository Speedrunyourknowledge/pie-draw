import type Anthropic from '@anthropic-ai/sdk';
import type { ToolSpec } from './tools';

// One step of the conversation with whichever model is configured: send the history and the tools,
// get back text and/or tool calls. The history is kept in a provider-neutral form and translated
// here, so the chat loop doesn't care which API is behind it.

export type Provider = 'anthropic' | 'openai';

export interface AiSettings {
  provider: Provider;
  apiKey: string;
  /** Model id, e.g. claude-opus-5-5. */
  model: string;
  /** The API's address. Empty means the provider's usual one (DEFAULT_URL). */
  baseUrl: string;
}

export const DEFAULT_MODEL: Record<Provider, string> = {
  anthropic: 'claude-opus-5-5',
  openai: '',
};
export const DEFAULT_URL: Record<Provider, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
};

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type Turn =
  | { role: 'user'; content: string }
  // `raw` is the provider's own content, replayed as-is to the same provider (Claude needs its
  // thinking blocks back unchanged).
  | { role: 'assistant'; text: string; calls: ToolCall[]; raw?: { provider: Provider; content: unknown } }
  | { role: 'tool'; results: { id: string; content: string; isError: boolean }[] };

export interface StepResult {
  text: string;
  calls: ToolCall[];
  raw?: { provider: Provider; content: unknown };
  /** done: answered; tools: wants the calls run; refused / truncated: stopped early. */
  stop: 'done' | 'tools' | 'refused' | 'truncated';
}

export function step(settings: AiSettings, system: string, tools: ToolSpec[], turns: Turn[], signal: AbortSignal) {
  return settings.provider === 'anthropic'
    ? anthropicStep(settings, system, tools, turns, signal)
    : openaiStep(settings, system, tools, turns, signal);
}

/** A readable message for a failed request. */
export function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Rewords the SDK's errors for the chat. */
function anthropicError(SDK: typeof Anthropic, e: unknown): unknown {
  if (e instanceof SDK.AuthenticationError) return new Error('The API key was rejected. Check it in settings.');
  if (e instanceof SDK.NotFoundError) return new Error('Model not found. Check the model name in settings.');
  if (e instanceof SDK.RateLimitError) return new Error('Rate limited. Wait a moment and try again.');
  if (e instanceof SDK.APIConnectionError) return new Error('Could not reach the API. Check your connection and the base URL.');
  if (e instanceof SDK.APIError) return new Error(`API error ${e.status ?? ''}: ${e.message}`);
  return e;
}

// ---- Anthropic (Claude) ----


async function anthropicStep(settings: AiSettings, system: string, tools: ToolSpec[], turns: Turn[], signal: AbortSignal): Promise<StepResult> {
  // Loaded on first use, so the app doesn't download the SDK until someone chats with Claude.
  const { default: SDK } = await import('@anthropic-ai/sdk');
  const client = new SDK({
    apiKey: settings.apiKey,
    baseURL: settings.baseUrl || DEFAULT_URL.anthropic,
    // The key is either the user's own, entered in this browser, or a placeholder the dev server swaps for AI_API_KEY.
    dangerouslyAllowBrowser: true,
  });

  const messages: Anthropic.Beta.BetaMessageParam[] = turns.map((t) => {
    if (t.role === 'user') return { role: 'user', content: t.content };
    if (t.role === 'tool') {
      return {
        role: 'user',
        content: t.results.map((r) => ({ type: 'tool_result' as const, tool_use_id: r.id, content: r.content, is_error: r.isError })),
      };
    }
    if (t.raw?.provider === 'anthropic') return { role: 'assistant', content: t.raw.content as Anthropic.Beta.BetaContentBlockParam[] };
    return {
      role: 'assistant',
      content: [
        ...(t.text ? [{ type: 'text' as const, text: t.text }] : []),
        ...t.calls.map((c) => ({ type: 'tool_use' as const, id: c.id, name: c.name, input: c.input })),
      ],
    };
  });

  const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
    model: settings.model,
    max_tokens: 16000,
    system,
    tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
    messages,
    cache_control: { type: 'ephemeral' }, // the history only grows, so each turn reuses the last one's cache
  };
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await client.beta.messages.create(params, { signal });
  } catch (e) {
    throw anthropicError(SDK, e);
  }

  const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
  const calls = response.content.flatMap((b) =>
    b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }] : [],
  );
  const raw = { provider: 'anthropic' as const, content: response.content };
  if (response.stop_reason === 'refusal') return { text, calls: [], raw, stop: 'refused' };
  if (response.stop_reason === 'max_tokens') return { text, calls: [], raw, stop: 'truncated' };
  return { text, calls, raw, stop: response.stop_reason === 'tool_use' && calls.length > 0 ? 'tools' : 'done' };
}

// ---- OpenAI-compatible (OpenAI, OpenRouter, Ollama, LM Studio, Groq, Gemini, ...) ----

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

async function openaiStep(settings: AiSettings, system: string, tools: ToolSpec[], turns: Turn[], signal: AbortSignal): Promise<StepResult> {
  const messages: unknown[] = [{ role: 'system', content: system }];
  for (const t of turns) {
    if (t.role === 'user') messages.push({ role: 'user', content: t.content });
    else if (t.role === 'tool') {
      for (const r of t.results) messages.push({ role: 'tool', tool_call_id: r.id, content: r.content });
    } else {
      messages.push({
        role: 'assistant',
        content: t.text || null,
        ...(t.calls.length > 0
          ? { tool_calls: t.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })) }
          : {}),
      });
    }
  }

  const base = (settings.baseUrl || DEFAULT_URL.openai).replace(/\/+$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}), // local servers need none
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      tools: tools.map((t) => ({ type: 'function', function: t })),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let detail = body;
    try {
      detail = JSON.parse(body)?.error?.message ?? body;
    } catch {
      // not JSON: show the text as is
    }
    if (res.status === 401) throw new Error('The API key was rejected. Check it in settings.');
    throw new Error(`API error ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  const msg = choice?.message ?? {};
  const calls: ToolCall[] = ((msg.tool_calls ?? []) as OpenAiToolCall[]).map((c, i) => {
    let input: Record<string, unknown> = {};
    try {
      input = c.function.arguments ? JSON.parse(c.function.arguments) : {};
    } catch {
      // Unparseable arguments: the tool reports the missing fields back to the model.
    }
    return { id: c.id || `call_${Date.now()}_${i}`, name: c.function.name, input };
  });
  const text = typeof msg.content === 'string' ? msg.content.trim() : '';
  if (choice?.finish_reason === 'length') return { text, calls: [], stop: 'truncated' };
  return { text, calls, stop: calls.length > 0 ? 'tools' : 'done' };
}
