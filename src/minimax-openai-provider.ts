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
  withoutTrailingSlash,
} from '@ai-sdk/provider-utils';
import { MinimaxChatModelId } from './minimax-chat-options';
import { MinimaxChatLanguageModel } from './minimax-openai-language-model';
import { createBearerHeaders } from './minimax-shared';
import { createMinimaxMediaModels } from './minimax-media';
import { MinimaxImageModelId } from './minimax-image-options';
import { MinimaxSpeechModelId } from './minimax-speech-options';
import { MinimaxVideoModelId } from './minimax-video-options';

export interface MinimaxProviderSettings {
  /**
MiniMax API key.
*/
  apiKey?: string;
  /**
Base URL for the API calls.
Default: 'https://api.minimax.io/v1'
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

export interface MinimaxProvider extends ProviderV3 {
  /**
Creates a MiniMax model for text generation.
*/
  (modelId: MinimaxChatModelId): LanguageModelV3;

  /**
Creates a MiniMax model for text generation.
*/
  languageModel(modelId: MinimaxChatModelId): LanguageModelV3;

  /**
Creates a MiniMax chat model for text generation.
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

export function createMinimax(
  options: MinimaxProviderSettings = {},
): MinimaxProvider {
  const baseURL = withoutTrailingSlash(
    options.baseURL ?? 'https://api.minimax.io/v1',
  ) as string;

  const getHeaders = createBearerHeaders(options);

  const createLanguageModel = (modelId: MinimaxChatModelId) => {
    return new MinimaxChatLanguageModel(modelId, {
      provider: `minimax.chat`,
      url: ({ path }) => `${baseURL}${path}`,
      headers: getHeaders,
      fetch: options.fetch,
    });
  };

  // MiniMax's image/speech/video are native `/v1` endpoints with Bearer auth —
  // the same transport this OpenAI-compatible instance already uses, so the
  // shared media factory plugs in directly.
  const mediaModels = createMinimaxMediaModels({
    baseURL,
    headers: getHeaders,
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
MiniMax provider instance using OpenAI-compatible API.
*/
export const minimax = createMinimax();

/**
MiniMax provider instance using OpenAI-compatible API.
Alias for `minimax` from this module.
*/
export const minimaxOpenAI = createMinimax();
