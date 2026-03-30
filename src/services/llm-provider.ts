type LlmProvider = (prompt: string) => Promise<string>;

type OpenAiResponse = {
  choices: Array<{ message: { content: string } }>;
};

type AnthropicResponse = {
  content: Array<{ type: string; text: string }>;
};

type OllamaResponse = {
  message: { content: string };
};

function createOpenAiProvider(apiKey: string, model: string): LlmProvider {
  return async (prompt: string) => {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
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

function createOllamaProvider(baseUrl: string, model: string): LlmProvider {
  return async (prompt: string) => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const body = (await response.json()) as OllamaResponse;
    return body.message?.content ?? '[]';
  };
}

export type ExtractionProvider = 'openai' | 'anthropic' | 'ollama';

type ProviderConfig = {
  provider: ExtractionProvider;
  model: string;
  openaiApiKey?: string | undefined;
  anthropicApiKey?: string | undefined;
  ollamaBaseUrl?: string | undefined;
};

export function createLlmProvider(config: ProviderConfig): LlmProvider {
  switch (config.provider) {
    case 'openai': {
      if (!config.openaiApiKey) {
        throw new Error('OPENAI_API_KEY is required for openai extraction provider');
      }
      return createOpenAiProvider(config.openaiApiKey, config.model);
    }
    case 'anthropic': {
      if (!config.anthropicApiKey) {
        throw new Error('ANTHROPIC_API_KEY is required for anthropic extraction provider');
      }
      return createAnthropicProvider(config.anthropicApiKey, config.model);
    }
    case 'ollama': {
      const baseUrl = config.ollamaBaseUrl ?? 'http://localhost:11434';
      return createOllamaProvider(baseUrl, config.model);
    }
  }
}
