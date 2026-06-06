import {
  ImageModelV3,
  SpeechModelV3,
  Experimental_VideoModelV3,
} from '@ai-sdk/provider';
import { FetchFunction } from '@ai-sdk/provider-utils';
import { MinimaxImageModel } from './minimax-image-model';
import { MinimaxImageModelId } from './minimax-image-options';
import { MinimaxSpeechModel } from './minimax-speech-model';
import { MinimaxSpeechModelId } from './minimax-speech-options';
import { MinimaxVideoModel } from './minimax-video-model';
import { MinimaxVideoModelId } from './minimax-video-options';

/**
 * Configuration shared by all MiniMax media (image/speech/video) models.
 *
 * MiniMax's media endpoints are native to the `…/v1` host and authenticate with a
 * Bearer token — they are NOT part of the Anthropic- or OpenAI-compatible chat
 * surfaces. This factory is therefore flavour-agnostic: callers pass an already
 * resolved `/v1` base URL and a Bearer header builder.
 */
export interface MinimaxMediaConfig {
  /** Resolved base URL for MiniMax native endpoints, e.g. `https://api.minimax.io/v1`. */
  baseURL: string;
  /** Header builder; must include `Authorization: Bearer <key>`. */
  headers: () => Record<string, string | undefined>;
  /** Optional custom fetch. */
  fetch?: FetchFunction;
  /** Test seam for deterministic timestamps. */
  _internal?: { currentDate?: () => Date };
}

/**
 * The media model factories mounted onto a MiniMax provider instance.
 */
export interface MinimaxMediaModels {
  image(modelId: MinimaxImageModelId): ImageModelV3;
  speech(modelId: MinimaxSpeechModelId): SpeechModelV3;
  video(modelId: MinimaxVideoModelId): Experimental_VideoModelV3;
}

/**
 * Builds the image/speech/video model factories from a single shared config.
 * This is the one source of truth for how MiniMax media models are wired; the
 * provider instances simply expose its output.
 */
export function createMinimaxMediaModels(
  config: MinimaxMediaConfig,
): MinimaxMediaModels {
  const modelConfig = (kind: 'image' | 'speech' | 'video') => ({
    provider: `minimax.${kind}`,
    url: ({ path }: { path: string }) => `${config.baseURL}${path}`,
    headers: config.headers,
    fetch: config.fetch,
    _internal: config._internal,
  });

  return {
    image: modelId => new MinimaxImageModel(modelId, modelConfig('image')),
    speech: modelId => new MinimaxSpeechModel(modelId, modelConfig('speech')),
    video: modelId => new MinimaxVideoModel(modelId, modelConfig('video')),
  };
}
