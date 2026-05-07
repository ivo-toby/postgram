import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLlmProvider } from '../../src/services/llm-provider.js';

describe('createLlmProvider', () => {
  describe('ollama', () => {
    it('throws if openai provider is selected without an API key', () => {
      expect(() =>
        createLlmProvider({ provider: 'openai' })
      ).toThrow('OPENAI_API_KEY is required for openai extraction provider');
    });

    it('throws if anthropic provider is selected without an API key', () => {
      expect(() =>
        createLlmProvider({ provider: 'anthropic' })
      ).toThrow('ANTHROPIC_API_KEY is required for anthropic extraction provider');
    });

    it('returns a function for ollama without an API key', () => {
      const provider = createLlmProvider({ provider: 'ollama' });
      expect(typeof provider).toBe('function');
    });

    it('returns a function for ollama with an API key', () => {
      const provider = createLlmProvider({
        provider: 'ollama',
        ollamaApiKey: 'test-key'
      });
      expect(typeof provider).toBe('function');
    });

    it('returns a function for ollama with a custom base URL', () => {
      const provider = createLlmProvider({
        provider: 'ollama',
        ollamaBaseUrl: 'https://ollama.com'
      });
      expect(typeof provider).toBe('function');
    });

    it('returns a function for ollama with both API key and custom base URL', () => {
      const provider = createLlmProvider({
        provider: 'ollama',
        ollamaBaseUrl: 'https://ollama.com',
        ollamaApiKey: 'test-key'
      });
      expect(typeof provider).toBe('function');
    });

    describe('response shape handling', () => {
      const originalFetch = globalThis.fetch;
      beforeEach(() => {
        globalThis.fetch = vi.fn() as unknown as typeof fetch;
      });
      afterEach(() => {
        globalThis.fetch = originalFetch;
      });

      it('parses native Ollama response shape { message: { content } }', async () => {
        (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
          new Response(
            JSON.stringify({ message: { content: '[{"from":"A","to":"B","relation":"knows"}]' } }),
            { status: 200 }
          )
        );
        const provider = createLlmProvider({
          provider: 'ollama',
          ollamaBaseUrl: 'http://ollama.local'
        });
        const result = await provider('extract relations from: A knows B');
        expect(result).toBe('[{"from":"A","to":"B","relation":"knows"}]');
      });

      it('sends all three reasoning-off hints by default (think:false + /no_think + enable_thinking:false)', async () => {
        (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
          new Response(JSON.stringify({ message: { content: '[]' } }), { status: 200 })
        );
        const provider = createLlmProvider({
          provider: 'ollama',
          ollamaBaseUrl: 'http://ollama.local'
        });
        await provider('anything');

        const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
        const init = call?.[1] as RequestInit;
        const body = JSON.parse(init.body as string) as {
          think?: boolean;
          messages: Array<{ role: string; content: string }>;
          chat_template_kwargs?: { enable_thinking?: boolean };
        };
        expect(body.messages[0]).toEqual({ role: 'system', content: '/no_think' });
        expect(body.chat_template_kwargs?.enable_thinking).toBe(false);
        expect(body.think).toBe(false);
      });

      it('omits reasoning-off hints when disableThinking is false', async () => {
        (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
          new Response(JSON.stringify({ message: { content: '[]' } }), { status: 200 })
        );
        const provider = createLlmProvider({
          provider: 'ollama',
          ollamaBaseUrl: 'http://ollama.local',
          disableThinking: false
        });
        await provider('anything');

        const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
        const init = call?.[1] as RequestInit;
        const body = JSON.parse(init.body as string) as {
          think?: boolean;
          messages: Array<{ role: string; content: string }>;
          chat_template_kwargs?: unknown;
        };
        expect(body.messages[0]).toEqual({ role: 'user', content: 'anything' });
        expect(body.think).toBeUndefined();
        expect(body.chat_template_kwargs).toBeUndefined();
      });

      it('parses OpenAI-shape response from llama.cpp Ollama emulation { choices: [{ message: { content } }] }', async () => {
        (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
          new Response(
            JSON.stringify({
              choices: [
                { message: { role: 'assistant', content: '[{"from":"X","to":"Y","relation":"owns"}]' } }
              ],
              object: 'chat.completion'
            }),
            { status: 200 }
          )
        );
        const provider = createLlmProvider({
          provider: 'ollama',
          ollamaBaseUrl: 'http://llamacpp.local'
        });
        const result = await provider('extract relations from: X owns Y');
        expect(result).toBe('[{"from":"X","to":"Y","relation":"owns"}]');
      });

      it('falls back to [] when neither shape is present', async () => {
        (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
          new Response(JSON.stringify({ weird: 'payload' }), { status: 200 })
        );
        const provider = createLlmProvider({
          provider: 'ollama',
          ollamaBaseUrl: 'http://ollama.local'
        });
        const result = await provider('anything');
        expect(result).toBe('[]');
      });

      it('sends format: "json" when no schema is passed (legacy fallback)', async () => {
        (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
          new Response(JSON.stringify({ message: { content: '[]' } }), { status: 200 })
        );
        const provider = createLlmProvider({
          provider: 'ollama',
          ollamaBaseUrl: 'http://ollama.local'
        });
        await provider('anything');

        const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
        const init = call?.[1] as RequestInit;
        const body = JSON.parse(init.body as string) as { format?: unknown };
        expect(body.format).toBe('json');
      });

      it('omits reasoning_effort when not configured', async () => {
        (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
          new Response(JSON.stringify({ message: { content: '[]' } }), { status: 200 })
        );
        const provider = createLlmProvider({
          provider: 'ollama',
          ollamaBaseUrl: 'http://ollama.local'
        });
        await provider('anything');

        const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
        const init = call?.[1] as RequestInit;
        const body = JSON.parse(init.body as string) as { reasoning_effort?: unknown };
        expect(body.reasoning_effort).toBeUndefined();
      });

      it('forwards reasoning_effort top-level when configured', async () => {
        (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
          new Response(JSON.stringify({ message: { content: '[]' } }), { status: 200 })
        );
        const provider = createLlmProvider({
          provider: 'ollama',
          ollamaBaseUrl: 'http://ollama.local',
          reasoningEffort: 'low'
        });
        await provider('anything');

        const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
        const init = call?.[1] as RequestInit;
        const body = JSON.parse(init.body as string) as { reasoning_effort?: unknown };
        expect(body.reasoning_effort).toBe('low');
      });

      it('forwards a JSON schema as the Ollama format when provided', async () => {
        (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
          new Response(JSON.stringify({ message: { content: '[]' } }), { status: 200 })
        );
        const provider = createLlmProvider({
          provider: 'ollama',
          ollamaBaseUrl: 'http://ollama.local'
        });
        const schema = {
          type: 'object',
          properties: { foo: { type: 'string' } },
          required: ['foo']
        };
        await provider('anything', schema);

        const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
        const init = call?.[1] as RequestInit;
        const body = JSON.parse(init.body as string) as { format?: unknown };
        expect(body.format).toEqual(schema);
      });
    });
  });

  describe('openai', () => {
    it('returns a function when API key is provided', () => {
      const provider = createLlmProvider({
        provider: 'openai',
        openaiApiKey: 'sk-test'
      });
      expect(typeof provider).toBe('function');
    });

    describe('reasoning_effort', () => {
      const originalFetch = globalThis.fetch;
      beforeEach(() => {
        globalThis.fetch = vi.fn() as unknown as typeof fetch;
      });
      afterEach(() => {
        globalThis.fetch = originalFetch;
      });

      it("defaults to 'minimal' when disableThinking is on with a reasoning model (back-compat)", async () => {
        (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
          new Response(
            JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
            { status: 200 }
          )
        );
        const provider = createLlmProvider({
          provider: 'openai',
          openaiApiKey: 'sk-test',
          model: 'o1-mini'
        });
        await provider('anything');

        const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
        const init = call?.[1] as RequestInit;
        const body = JSON.parse(init.body as string) as { reasoning_effort?: unknown };
        expect(body.reasoning_effort).toBe('minimal');
      });

      it('omits reasoning_effort for non-reasoning models (gpt-4o-mini default)', async () => {
        (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
          new Response(
            JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
            { status: 200 }
          )
        );
        const provider = createLlmProvider({
          provider: 'openai',
          openaiApiKey: 'sk-test'
        });
        await provider('anything');

        const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
        const init = call?.[1] as RequestInit;
        const body = JSON.parse(init.body as string) as { reasoning_effort?: unknown };
        expect(body.reasoning_effort).toBeUndefined();
      });

      it('omits reasoning_effort even when explicitly set, if the model does not support it', async () => {
        (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
          new Response(
            JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
            { status: 200 }
          )
        );
        const provider = createLlmProvider({
          provider: 'openai',
          openaiApiKey: 'sk-test',
          model: 'gpt-4o-mini',
          reasoningEffort: 'high'
        });
        await provider('anything');

        const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
        const init = call?.[1] as RequestInit;
        const body = JSON.parse(init.body as string) as { reasoning_effort?: unknown };
        expect(body.reasoning_effort).toBeUndefined();
      });

      it('explicit reasoningEffort is forwarded for reasoning-capable models (gpt-5)', async () => {
        (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
          new Response(
            JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
            { status: 200 }
          )
        );
        const provider = createLlmProvider({
          provider: 'openai',
          openaiApiKey: 'sk-test',
          model: 'gpt-5-mini',
          reasoningEffort: 'high'
        });
        await provider('anything');

        const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
        const init = call?.[1] as RequestInit;
        const body = JSON.parse(init.body as string) as { reasoning_effort?: unknown };
        expect(body.reasoning_effort).toBe('high');
      });

      it('omits reasoning_effort when disableThinking=false and no explicit effort', async () => {
        (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
          new Response(
            JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
            { status: 200 }
          )
        );
        const provider = createLlmProvider({
          provider: 'openai',
          openaiApiKey: 'sk-test',
          model: 'o1-mini',
          disableThinking: false
        });
        await provider('anything');

        const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
        const init = call?.[1] as RequestInit;
        const body = JSON.parse(init.body as string) as { reasoning_effort?: unknown };
        expect(body.reasoning_effort).toBeUndefined();
      });
    });

    describe('temperature', () => {
      const originalFetch = globalThis.fetch;
      beforeEach(() => {
        globalThis.fetch = vi.fn() as unknown as typeof fetch;
      });
      afterEach(() => {
        globalThis.fetch = originalFetch;
      });

      it('sends temperature: 0 for non-reasoning models', async () => {
        (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
          new Response(
            JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
            { status: 200 }
          )
        );
        const provider = createLlmProvider({
          provider: 'openai',
          openaiApiKey: 'sk-test',
          model: 'gpt-4o-mini'
        });
        await provider('anything');

        const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
        const init = call?.[1] as RequestInit;
        const body = JSON.parse(init.body as string) as { temperature?: unknown };
        expect(body.temperature).toBe(0);
      });

      it('omits temperature for reasoning models (only default 1 is supported)', async () => {
        (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
          new Response(
            JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
            { status: 200 }
          )
        );
        const provider = createLlmProvider({
          provider: 'openai',
          openaiApiKey: 'sk-test',
          model: 'o1-mini'
        });
        await provider('anything');

        const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
        const init = call?.[1] as RequestInit;
        const body = JSON.parse(init.body as string) as { temperature?: unknown };
        expect(body.temperature).toBeUndefined();
      });
    });

    describe('error handling', () => {
      const originalFetch = globalThis.fetch;
      beforeEach(() => {
        globalThis.fetch = vi.fn() as unknown as typeof fetch;
      });
      afterEach(() => {
        globalThis.fetch = originalFetch;
      });

      it('includes the OpenAI error body in the thrown error', async () => {
        (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
          new Response(
            JSON.stringify({
              error: {
                message: "Unknown parameter: 'reasoning_effort'.",
                type: 'invalid_request_error'
              }
            }),
            { status: 400 }
          )
        );
        const provider = createLlmProvider({
          provider: 'openai',
          openaiApiKey: 'sk-test'
        });
        await expect(provider('anything')).rejects.toThrow(
          /OpenAI API error: 400.*reasoning_effort/
        );
      });
    });
  });

  describe('anthropic', () => {
    it('returns a function when API key is provided', () => {
      const provider = createLlmProvider({
        provider: 'anthropic',
        anthropicApiKey: 'sk-ant-test'
      });
      expect(typeof provider).toBe('function');
    });
  });
});