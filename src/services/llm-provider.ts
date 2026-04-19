type LlmProvider = (prompt: string) => Promise<string>;

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

function createOpenAiProvider(apiKey: string, model: string): LlmProvider {
  return async (prompt: string) => {
    const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
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
        max_tokens: 1024,
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

function createOllamaProvider(baseUrl: string, model: string, apiKey?: string): LlmProvider {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return async (prompt: string) => {
    // `/no_think` is Qwen3's inline switch to disable reasoning output —
    // harmless to models that don't recognize it, but critical for Qwen3:
    // reasoning tokens triple latency on structured extraction where we
    // don't need a chain-of-thought.
    // `chat_template_kwargs.enable_thinking: false` is the equivalent hint
    // for vLLM / llama.cpp servers that honor it at the template level.
    const response = await fetchWithTimeout(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '/no_think' },
          { role: 'user', content: prompt }
        ],
        stream: false,
        format: 'json',
        chat_template_kwargs: { enable_thinking: false }
      })
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
};

export function createLlmProvider(config: ProviderConfig): LlmProvider {
  const model = config.model ?? DEFAULT_MODELS[config.provider];

  switch (config.provider) {
    case 'openai': {
      if (!config.openaiApiKey) {
        throw new Error('OPENAI_API_KEY is required for openai extraction provider');
      }
      return createOpenAiProvider(config.openaiApiKey, model);
    }
    case 'anthropic': {
      if (!config.anthropicApiKey) {
        throw new Error('ANTHROPIC_API_KEY is required for anthropic extraction provider');
      }
      return createAnthropicProvider(config.anthropicApiKey, model);
    }
    case 'ollama': {
      const baseUrl = config.ollamaBaseUrl ?? 'http://localhost:11434';
      return createOllamaProvider(baseUrl, model, config.ollamaApiKey);
    }
  }
}
