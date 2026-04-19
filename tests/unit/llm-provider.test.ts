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