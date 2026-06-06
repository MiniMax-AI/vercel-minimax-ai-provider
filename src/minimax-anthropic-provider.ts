import { AnthropicMessagesLanguageModel } from '@ai-sdk/anthropic/internal';
import {
  Experimental_VideoModelV3,
  ImageModelV3,
  LanguageModelV3,
  NoSuchModelError,
  ProviderV3,
  SpeechModelV3,
} from '@ai-sdk/provider';
import {
  FetchFunction,
  generateId,
  loadApiKey,
  withoutTrailingSlash,
  withUserAgentSuffix,
} from '@ai-sdk/provider-utils';
import { MinimaxChatModelId } from './minimax-chat-options';
import { createMinimaxMediaModels } from './minimax-media';
import { MinimaxImageModelId } from './minimax-image-options';
import { MinimaxSpeechModelId } from './minimax-speech-options';
import { MinimaxVideoModelId } from './minimax-video-options';
import { deriveV1BaseURL, createBearerHeaders } from './minimax-shared';

export interface MinimaxAnthropicProviderSettings {
  /**
MiniMax API key.
*/
  apiKey?: string;
  /**
Base URL for the API calls.
Default: 'https://api.minimax.io/anthropic/v1'
*/
  baseURL?: string;
  /**
Custom headers to include in the requests.
*/
  headers?: Record<string, string>;
  /**
Custom fetch implementation. You can use it as a middleware to intercept requests,
or to provide a custom fetch implementation for e.g. testing.
*/
  fetch?: FetchFunction;
}

export interface MinimaxAnthropicProvider extends ProviderV3 {
  /**
Creates a MiniMax model for text generation using Anthropic-compatible API.
*/
  (modelId: MinimaxChatModelId): LanguageModelV3;

  /**
Creates a MiniMax model for text generation using Anthropic-compatible API.
*/
  languageModel(modelId: MinimaxChatModelId): LanguageModelV3;

  /**
Creates a MiniMax chat model for text generation using Anthropic-compatible API.
*/
  chat(modelId: MinimaxChatModelId): LanguageModelV3;

  /**
Creates a MiniMax image model (native MiniMax `/v1` endpoint).
*/
  image(modelId: MinimaxImageModelId): ImageModelV3;
  imageModel(modelId: MinimaxImageModelId): ImageModelV3;

  /**
Creates a MiniMax speech (text-to-speech) model (native MiniMax `/v1` endpoint).
*/
  speech(modelId: MinimaxSpeechModelId): SpeechModelV3;
  speechModel(modelId: MinimaxSpeechModelId): SpeechModelV3;

  /**
Creates a MiniMax video model (native MiniMax `/v1` endpoint, async polling).
*/
  video(modelId: MinimaxVideoModelId): Experimental_VideoModelV3;
  videoModel(modelId: MinimaxVideoModelId): Experimental_VideoModelV3;
}

export function createMinimaxAnthropic(
  options: MinimaxAnthropicProviderSettings = {},
): MinimaxAnthropicProvider {
  const baseURL = withoutTrailingSlash(
    options.baseURL ?? 'https://api.minimax.io/anthropic/v1',
  ) as string;

  const getHeaders = () =>
    withUserAgentSuffix(
      {
        'anthropic-version': '2023-06-01',
        'x-api-key': loadApiKey({
          apiKey: options.apiKey,
          environmentVariableName: 'MINIMAX_API_KEY',
          description: 'MiniMax API key',
        }),
        ...options.headers,
      },
      `minimax-ai-provider`,
    );

  const createLanguageModel = (modelId: MinimaxChatModelId) => {
    return new AnthropicMessagesLanguageModel(modelId, {
      provider: 'minimax.messages',
      baseURL,
      headers: getHeaders,
      fetch: options.fetch,
      generateId: generateId,
      supportedUrls: () => ({
        'image/*': [/^https?:\/\/.*$/],
      }),
    });
  };

  // MiniMax's image/speech/video are native `/v1` endpoints (not part of the
  // Anthropic-compatible surface) and authenticate with a Bearer token rather
  // than the `x-api-key` header used for chat. Derive the `/v1` base from the
  // anthropic base and build a Bearer header for these media models.
  const mediaModels = createMinimaxMediaModels({
    baseURL: deriveV1BaseURL(baseURL),
    headers: createBearerHeaders(options),
    fetch: options.fetch,
  });

  const provider = (modelId: MinimaxChatModelId) =>
    createLanguageModel(modelId);

  provider.languageModel = createLanguageModel;
  provider.chat = createLanguageModel;
  provider.specificationVersion = 'v3' as const;

  provider.image = mediaModels.image;
  provider.imageModel = mediaModels.image;
  provider.speech = mediaModels.speech;
  provider.speechModel = mediaModels.speech;
  provider.video = mediaModels.video;
  provider.videoModel = mediaModels.video;

  provider.embeddingModel = (modelId: string) => {
    throw new NoSuchModelError({ modelId, modelType: 'embeddingModel' });
  };

  return provider;
}

/**
Default MiniMax provider instance using Anthropic-compatible API.
*/
export const minimaxAnthropic = createMinimaxAnthropic();

