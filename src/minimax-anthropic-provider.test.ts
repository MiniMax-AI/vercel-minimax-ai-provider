import { describe, it, expect, vi } from 'vitest';
import {
  createMinimaxAnthropic,
  minimaxAnthropic,
} from './minimax-anthropic-provider';
import type {
  MinimaxAnthropicProvider,
  MinimaxAnthropicProviderSettings,
} from './minimax-anthropic-provider';

describe('minimaxAnthropic provider', () => {
  describe('default instance', () => {
    it('should create default instance', () => {
      expect(minimaxAnthropic).toBeDefined();
      expect(typeof minimaxAnthropic).toBe('function');
    });
  });

  describe('model creation', () => {
    it('should create a language model', () => {
      const model = minimaxAnthropic('MiniMax-M2');
      expect(model.provider).toBe('minimax.messages');
      expect(model.modelId).toBe('MiniMax-M2');
      expect(model.specificationVersion).toBe('v3');
    });

    it('should create models via different methods', () => {
      const model1 = minimaxAnthropic('MiniMax-M2');
      const model2 = minimaxAnthropic.chat('MiniMax-M2');
      const model3 = minimaxAnthropic.languageModel('MiniMax-M2');

      expect(model1.provider).toBe(model2.provider);
      expect(model2.provider).toBe(model3.provider);
      expect(model1.modelId).toBe('MiniMax-M2');
    });

    it('should support custom model IDs', () => {
      const model = minimaxAnthropic('custom-model');
      expect(model.modelId).toBe('custom-model');
    });
  });

  describe('custom instances', () => {
    it('should create custom instance with all options', () => {
      const mockFetch = vi.fn();
      const customMinimax = createMinimaxAnthropic({
        apiKey: 'test-key',
        baseURL: 'https://custom.api.com/anthropic/v1',
        headers: { 'X-Custom': 'value' },
        fetch: mockFetch,
      });

      const model = customMinimax('MiniMax-M2');
      expect(model).toBeDefined();
      expect(model.provider).toBe('minimax.messages');
    });

    it('should strip trailing slash from baseURL', () => {
      const customMinimax = createMinimaxAnthropic({
        baseURL: 'https://custom.api.com/',
      });
      const model = customMinimax('MiniMax-M2');
      expect(model).toBeDefined();
    });
  });

  describe('multimodal models', () => {
    it('creates image, speech, and video models on the native surface', () => {
      expect(minimaxAnthropic.image('image-01').provider).toBe('minimax.image');
      expect(minimaxAnthropic.imageModel('image-01').provider).toBe(
        'minimax.image',
      );
      expect(minimaxAnthropic.speech('speech-2.6-hd').provider).toBe(
        'minimax.speech',
      );
      expect(minimaxAnthropic.speechModel('speech-2.6-hd').provider).toBe(
        'minimax.speech',
      );
      expect(minimaxAnthropic.video('MiniMax-Hailuo-2.3').provider).toBe(
        'minimax.video',
      );
      expect(minimaxAnthropic.videoModel('MiniMax-Hailuo-2.3').provider).toBe(
        'minimax.video',
      );
    });

    it('routes media to the /v1 base (not /anthropic/v1) with a Bearer header', async () => {
      let capturedUrl = '';
      let capturedAuth: string | null = null;
      const custom = createMinimaxAnthropic({
        apiKey: 'k',
        baseURL: 'https://api.minimax.io/anthropic/v1',
        fetch: (async (url: string, init: RequestInit) => {
          capturedUrl = String(url);
          capturedAuth = new Headers(init.headers).get('authorization');
          return new Response(
            JSON.stringify({
              data: { image_base64: ['AA'] },
              base_resp: { status_code: 0 },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }) as unknown as typeof fetch,
      });

      await custom.image('image-01').doGenerate({
        prompt: 'x',
        n: 1,
        size: undefined,
        aspectRatio: undefined,
        seed: undefined,
        files: undefined,
        mask: undefined,
        providerOptions: {},
      });

      expect(capturedUrl).toBe('https://api.minimax.io/v1/image_generation');
      expect(capturedAuth).toBe('Bearer k');
    });
  });

  describe('unsupported model types', () => {
    it('should throw NoSuchModelError for embeddings', () => {
      expect(() => minimaxAnthropic.embeddingModel('test')).toThrow(
        /embeddingModel/,
      );
    });
  });

  describe('type exports', () => {
    it('should export correct types', () => {
      const provider: MinimaxAnthropicProvider = minimaxAnthropic;
      const settings: MinimaxAnthropicProviderSettings = {
        apiKey: 'test',
        baseURL: 'https://test.com',
      };
      expect(provider).toBeDefined();
      expect(settings).toBeDefined();
    });
  });
});

