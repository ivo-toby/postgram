import { describe, expect, it } from 'vitest';
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