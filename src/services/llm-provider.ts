/**
 * Optional JSON schema forwarded to providers that support structured
 * outputs (today: Ollama's `format` field). Callers that want to constrain
 * the model's response shape at decode time pass the schema here; providers
 * that don't support it may ignore it.
 */
type LlmProvider = (prompt: string, schema?: object) => Promise<string>;

// Hard ceiling on any single LLM call. Prevents a hung server from blocking
// the enrichment worker indefinitely. Overridable via env for operators who
// run very slow local models; default is generous but finite.
const DEFAULT_LLM_TIMEOUT_MS = (() => {
  const raw = process.env.LLM_REQUEST_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000;
})();

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number = DEFAULT_LLM_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`LLM request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

type OpenAiResponse = {
  choices: Array<{ message: { content: string } }>;
};

type AnthropicResponse = {
  content: Array<{ type: string; text: string }>;
};

// `/api/chat` responses come back in two shapes depending on the server:
// - Native Ollama: { message: { content } }
// - llama.cpp's Ollama-compatibility layer: { choices: [{ message: { content } }] }
// Accept both so EXTRACTION_PROVIDER=ollama works against either.
type OllamaResponse = {
  message?: { content?: string };
  choices?: Array<{ message?: { content?: string } }>;
};

// `reasoning_effort` is only accepted by OpenAI reasoning models (o-series,
// gpt-5). Forwarding it to gpt-4o / gpt-4o-mini returns 400 "Unknown
// parameter: 'reasoning_effort'" — the OpenAI API does not silently ignore
// unknown parameters.
function supportsReasoningEffort(model: string): boolean {
  return /^o\d/i.test(model) || /^gpt-5/i.test(model);
}

function createOpenAiProvider(
  apiKey: string,
  model: string,
  disableThinking: boolean,
  reasoningEffort: ReasoningEffort | undefined
): LlmProvider {
  return async (prompt: string) => {
    const payload: Record<string, unknown> = {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0
    };
    // Explicit EXTRACTION_REASONING_EFFORT wins; otherwise disableThinking
    // implies 'minimal'. Either way, only forward when the model actually
    // supports the field.
    const effort = reasoningEffort ?? (disableThinking ? 'minimal' : undefined);
    if (effort && supportsReasoningEffort(model)) {
      payload['reasoning_effort'] = effort;
    }

    const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      // Surface OpenAI's error body — bare status codes hid root causes
      // like "Unknown parameter: 'reasoning_effort'" behind a generic 400.
      const errorBody = await response.text().catch(() => '');
      const detail = errorBody ? ` - ${errorBody}` : '';
      throw new Error(`OpenAI API error: ${response.status}${detail}`);
    }

    const body = (await response.json()) as OpenAiResponse;
    return body.choices[0]?.message?.content ?? '[]';
  };
}

function createAnthropicProvider(apiKey: string, model: string): LlmProvider {
  return async (prompt: string) => {
    const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        system: 'You must respond with only valid JSON. No markdown, no explanation, just the JSON array.',
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const body = (await response.json()) as AnthropicResponse;
    const textBlock = body.content.find((block) => block.type === 'text');
    return textBlock?.text ?? '[]';
  };
}

function createOllamaProvider(
  baseUrl: string,
  model: string,
  disableThinking: boolean,
  reasoningEffort: ReasoningEffort | undefined,
  apiKey?: string
): LlmProvider {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return async (prompt: string, schema?: object) => {
    // Reasoning-mode output triples latency on structured extraction where
    // we don't need a chain-of-thought. Different servers/models honour
    // different switches, so when disableThinking is on we send all three:
    //   - `think: false`: Ollama's top-level switch (newer, canonical)
    //   - `/no_think` system: Qwen3's inline trigger
    //   - `chat_template_kwargs.enable_thinking: false`: vLLM / llama.cpp
    //     template-level hint honoured by GLM and some Qwen variants.
    // If a particular model reacts badly, set EXTRACTION_DISABLE_THINKING=false
    // to drop all three.
    const messages: Array<{ role: string; content: string }> = [];
    if (disableThinking) messages.push({ role: 'system', content: '/no_think' });
    messages.push({ role: 'user', content: prompt });

    // When the caller supplies a JSON schema, forward it as Ollama's
    // structured-output `format` (constrains the decoder to that shape).
    // Without a schema, fall back to plain `'json'` — guarantees valid JSON
    // but not a particular shape, which is enough for callers that parse
    // flexibly.
    const payload: Record<string, unknown> = {
      model,
      messages,
      stream: false,
      format: schema ?? 'json'
    };
    if (disableThinking) {
      payload['think'] = false;
      payload['chat_template_kwargs'] = { enable_thinking: false };
    }
    // gpt-oss and other OpenAI-style reasoning models on Ollama honour
    // `reasoning_effort` as a top-level chat field. Models that don't
    // recognise it ignore the unknown key.
    if (reasoningEffort) payload['reasoning_effort'] = reasoningEffort;

    const response = await fetchWithTimeout(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const body = (await response.json()) as OllamaResponse;
    return body.message?.content
      ?? body.choices?.[0]?.message?.content
      ?? '[]';
  };
}

export type ExtractionProvider = 'openai' | 'anthropic' | 'ollama';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

const DEFAULT_MODELS: Record<ExtractionProvider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  ollama: 'llama3.2'
};

type ProviderConfig = {
  provider: ExtractionProvider;
  model?: string | undefined;
  openaiApiKey?: string | undefined;
  anthropicApiKey?: string | undefined;
  ollamaBaseUrl?: string | undefined;
  ollamaApiKey?: string | undefined;
  /**
   * When true (default), send provider-specific hints to disable reasoning /
   * chain-of-thought output. Extraction is structured JSON — thinking tokens
   * just add latency. Set to false if a model misbehaves with the hints.
   */
  disableThinking?: boolean | undefined;
  /**
   * Explicit reasoning budget for OpenAI-style reasoning models (o-series,
   * gpt-5, gpt-oss). Forwarded as `reasoning_effort` to OpenAI and Ollama.
   * When set, takes precedence over the implicit 'minimal' that
   * disableThinking sends to OpenAI.
   */
  reasoningEffort?: ReasoningEffort | undefined;
};

export function createLlmProvider(config: ProviderConfig): LlmProvider {
  const model = config.model ?? DEFAULT_MODELS[config.provider];
  const disableThinking = config.disableThinking ?? true;

  switch (config.provider) {
    case 'openai': {
      if (!config.openaiApiKey) {
        throw new Error('OPENAI_API_KEY is required for openai extraction provider');
      }
      return createOpenAiProvider(
        config.openaiApiKey,
        model,
        disableThinking,
        config.reasoningEffort
      );
    }
    case 'anthropic': {
      if (!config.anthropicApiKey) {
        throw new Error('ANTHROPIC_API_KEY is required for anthropic extraction provider');
      }
      return createAnthropicProvider(config.anthropicApiKey, model);
    }
    case 'ollama': {
      const baseUrl = config.ollamaBaseUrl ?? 'http://localhost:11434';
      return createOllamaProvider(
        baseUrl,
        model,
        disableThinking,
        config.reasoningEffort,
        config.ollamaApiKey
      );
    }
  }
}
