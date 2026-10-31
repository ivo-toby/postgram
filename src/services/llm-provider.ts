/**
 * Optional JSON schema forwarded to providers that support structured
 * outputs. Callers that want to constrain the model's response shape pass the
 * schema here; providers that cannot enforce it natively receive it as an
 * explicit prompt instruction.
 */
type LlmProvider = (prompt: string, schema?: object) => Promise<string>;
type ProviderFetch = (input: string, init: RequestInit) => Promise<Response>;

function withSchemaInstruction(
  prompt: string,
  schema: object | undefined
): string {
  if (!schema) {
    return prompt;
  }

  return [
    prompt,
    '',
    'Return only valid JSON matching this JSON Schema. Do not include markdown, prose, or any keys outside the schema.',
    JSON.stringify(schema)
  ].join('\n');
}

// Hard ceiling on any single LLM call. Prevents a hung server from blocking
// the enrichment worker indefinitely. Overridable via env for operators who
// run very slow local models; default is generous but finite.
const DEFAULT_LLM_TIMEOUT_MS = (() => {
  const raw = process.env.LLM_REQUEST_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000;
})();

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_LLM_TIMEOUT_MS,
  fetchImpl: ProviderFetch = fetch
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`LLM request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

type MessageContent =
  | string
  | Array<{ type?: string; text?: string }>
  | null
  | undefined;

type OpenAiResponse = {
  choices: Array<{ message?: { content?: MessageContent } }>;
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

// OpenAI reasoning models (o-series, gpt-5) accept `reasoning_effort` but
// reject `temperature` values other than the default 1. Non-reasoning models
// (gpt-4o, gpt-4o-mini) are the inverse. The API does not silently ignore
// either mismatch — both surface as 400s.
function isReasoningModel(model: string): boolean {
  return /^o\d/i.test(model) || /^gpt-5/i.test(model);
}

type JsonSchemaNode = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonSchemaNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapSchemaRecord(
  record: JsonSchemaNode,
  fn: (value: unknown) => unknown
): JsonSchemaNode {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, fn(value)])
  );
}

function isObjectSchema(node: JsonSchemaNode): boolean {
  const type = node.type;
  return (
    type === 'object' ||
    (Array.isArray(type) && type.includes('object')) ||
    (type === undefined && isPlainObject(node.properties))
  );
}

function withNullEnum(node: JsonSchemaNode): JsonSchemaNode {
  return Array.isArray(node.enum) && !node.enum.includes(null)
    ? { ...node, enum: [...(node.enum as unknown[]), null] }
    : node;
}

// Strict mode has no optional fields: every property must be listed in
// `required`. Optional fields are expressed by allowing null instead.
function makeNullable(node: JsonSchemaNode): JsonSchemaNode {
  const type = node.type;
  if (typeof type === 'string') {
    return type === 'null'
      ? node
      : withNullEnum({ ...node, type: [type, 'null'] });
  }
  if (Array.isArray(type)) {
    return type.includes('null')
      ? node
      : withNullEnum({ ...node, type: [...(type as unknown[]), 'null'] });
  }
  if (Array.isArray(node.anyOf)) {
    const hasNull = node.anyOf.some(
      (option) => isPlainObject(option) && option.type === 'null'
    );
    return hasNull
      ? node
      : { ...node, anyOf: [...(node.anyOf as unknown[]), { type: 'null' }] };
  }
  return { anyOf: [node, { type: 'null' }] };
}

function normalizeStrictSchema(value: unknown): unknown {
  if (!isPlainObject(value)) return value;
  const result: JsonSchemaNode = { ...value };

  // Only recurse through schema positions, so a field that happens to be
  // named "properties" or "type" is never mistaken for a schema keyword.
  if (isPlainObject(value.properties)) {
    result.properties = mapSchemaRecord(
      value.properties,
      normalizeStrictSchema
    );
  }
  if (Array.isArray(value.items)) {
    result.items = value.items.map(normalizeStrictSchema);
  } else if (isPlainObject(value.items)) {
    result.items = normalizeStrictSchema(value.items);
  }
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    const options = value[key];
    if (Array.isArray(options))
      result[key] = options.map(normalizeStrictSchema);
  }
  for (const key of ['$defs', 'definitions']) {
    const defs = value[key];
    if (isPlainObject(defs))
      result[key] = mapSchemaRecord(defs, normalizeStrictSchema);
  }

  if (isObjectSchema(value)) {
    const properties = isPlainObject(result.properties)
      ? result.properties
      : {};
    const required = new Set(
      Array.isArray(value.required)
        ? value.required.filter((key): key is string => typeof key === 'string')
        : []
    );
    if (isPlainObject(result.properties)) {
      result.properties = Object.fromEntries(
        Object.entries(properties).map(([key, child]) => [
          key,
          required.has(key) || !isPlainObject(child)
            ? child
            : makeNullable(child)
        ])
      );
    }
    result.required = Object.keys(properties);
    result.additionalProperties = false;
  }

  return result;
}

/**
 * Rewrite a JSON schema into the subset OpenAI accepts with `strict: true`:
 * every object is closed (`additionalProperties: false`) and lists all of its
 * properties as required, with originally optional properties made nullable.
 * Returns a copy; the input schema is not mutated.
 */
export function toOpenAiStrictSchema(schema: object): object {
  return normalizeStrictSchema(schema) as object;
}

// Some servers (Mistral with reasoning models) return content as a list of
// parts: thinking parts followed by text parts. Only the text is the answer.
function messageText(content: MessageContent): string | undefined {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  return content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

function createOpenAiProvider(
  apiKey: string,
  model: string,
  disableThinking: boolean,
  reasoningEffort: ReasoningEffort | undefined,
  baseUrl = 'https://api.openai.com/v1',
  errorLabel = 'OpenAI',
  nativeStructuredOutputs = true,
  fetchImpl?: ProviderFetch
): LlmProvider {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return async (prompt: string, schema?: object) => {
    const reasoning = isReasoningModel(model);
    const content = nativeStructuredOutputs
      ? prompt
      : withSchemaInstruction(prompt, schema);
    const payload: Record<string, unknown> = {
      model,
      messages: [{ role: 'user', content }]
    };
    if (schema && nativeStructuredOutputs) {
      payload['response_format'] = {
        type: 'json_schema',
        json_schema: {
          name: 'postgram_structured_response',
          strict: true,
          schema: toOpenAiStrictSchema(schema)
        }
      };
    }
    // Reasoning models reject any temperature other than the default.
    if (!reasoning) {
      payload['temperature'] = 0;
    }
    // Explicit EXTRACTION_REASONING_EFFORT wins; otherwise disableThinking
    // implies 'minimal'. Either way, only forward when the model actually
    // supports the field.
    const effort = reasoningEffort ?? (disableThinking ? 'minimal' : undefined);
    if (effort && reasoning) {
      payload['reasoning_effort'] = effort;
    } else if (reasoningEffort && !nativeStructuredOutputs) {
      // OpenAI-compatible servers: we can't tell which models take the field,
      // so forward it only when the operator set it explicitly.
      payload['reasoning_effort'] = reasoningEffort;
    }

    const response = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify(payload)
      },
      DEFAULT_LLM_TIMEOUT_MS,
      fetchImpl
    );

    if (!response.ok) {
      // Surface OpenAI's error body — bare status codes hid root causes
      // like "Unknown parameter: 'reasoning_effort'" behind a generic 400.
      const errorBody = await response.text().catch(() => '');
      const detail = errorBody ? ` - ${errorBody}` : '';
      throw new Error(`${errorLabel} API error: ${response.status}${detail}`);
    }

    const body = (await response.json()) as OpenAiResponse;
    return messageText(body.choices[0]?.message?.content) ?? '[]';
  };
}

function createAnthropicProvider(apiKey: string, model: string): LlmProvider {
  return async (prompt: string, schema?: object) => {
    const response = await fetchWithTimeout(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: 8192,
          system:
            'You must respond with only valid JSON. No markdown, no explanation.',
          messages: [
            { role: 'user', content: withSchemaInstruction(prompt, schema) }
          ]
        })
      }
    );

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
  apiKey?: string,
  fetchImpl?: ProviderFetch
): LlmProvider {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
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
    if (disableThinking)
      messages.push({ role: 'system', content: '/no_think' });
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

    const response = await fetchWithTimeout(
      `${baseUrl}/api/chat`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      },
      DEFAULT_LLM_TIMEOUT_MS,
      fetchImpl
    );

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const body = (await response.json()) as OllamaResponse;
    return body.message?.content ?? body.choices?.[0]?.message?.content ?? '[]';
  };
}

export type ExtractionProvider =
  | 'openai'
  | 'anthropic'
  | 'ollama'
  | 'openai-compatible';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

const DEFAULT_MODELS: Record<ExtractionProvider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  ollama: 'llama3.2',
  'openai-compatible': 'gpt-4o-mini'
};

type ProviderConfig = {
  provider: ExtractionProvider;
  model?: string | undefined;
  openaiApiKey?: string | undefined;
  extractionBaseUrl?: string | undefined;
  extractionApiKey?: string | undefined;
  anthropicApiKey?: string | undefined;
  ollamaBaseUrl?: string | undefined;
  ollamaApiKey?: string | undefined;
  fetchImpl?: ProviderFetch | undefined;
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
        throw new Error(
          'OPENAI_API_KEY is required for openai extraction provider'
        );
      }
      return createOpenAiProvider(
        config.openaiApiKey,
        model,
        disableThinking,
        config.reasoningEffort
      );
    }
    case 'openai-compatible': {
      if (!config.extractionBaseUrl) {
        throw new Error(
          'EXTRACTION_BASE_URL is required for openai-compatible extraction provider'
        );
      }
      return createOpenAiProvider(
        config.extractionApiKey ?? '',
        model,
        disableThinking,
        config.reasoningEffort,
        config.extractionBaseUrl,
        'OpenAI-compatible',
        false,
        config.fetchImpl
      );
    }
    case 'anthropic': {
      if (!config.anthropicApiKey) {
        throw new Error(
          'ANTHROPIC_API_KEY is required for anthropic extraction provider'
        );
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
        config.ollamaApiKey,
        config.fetchImpl
      );
    }
  }
}
