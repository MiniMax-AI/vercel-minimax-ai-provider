import {
  SpeechModelV3,
  SharedV3Warning,
  JSONValue,
} from '@ai-sdk/provider';
import {
  combineHeaders,
  createJsonResponseHandler,
  createJsonErrorResponseHandler,
  FetchFunction,
  parseProviderOptions,
  postJsonToApi,
} from '@ai-sdk/provider-utils';
import { z } from 'zod/v4';
import {
  MinimaxSpeechModelId,
  minimaxSpeechProviderOptions,
  DEFAULT_MINIMAX_VOICE_ID,
} from './minimax-speech-options';
import { defaultMinimaxErrorStructure } from './minimax-chat-options';
import {
  checkMinimaxBaseResp,
  hexToUint8Array,
  mapLanguageBoost,
} from './minimax-shared';

export interface MinimaxSpeechModelConfig {
  provider: string;
  url: (options: { path: string; modelId: string }) => string;
  headers: () => Record<string, string | undefined>;
  fetch?: FetchFunction;
  _internal?: { currentDate?: () => Date };
}

const minimaxSpeechResponseSchema = z.object({
  data: z
    .object({
      audio: z.string().nullish(),
      status: z.union([z.number(), z.string()]).nullish(),
    })
    .nullish(),
  extra_info: z.record(z.string(), z.unknown()).nullish(),
  base_resp: z
    .object({
      status_code: z.union([z.number(), z.string()]).nullish(),
      status_msg: z.string().nullish(),
    })
    .nullish(),
});

export class MinimaxSpeechModel implements SpeechModelV3 {
  readonly specificationVersion = 'v3';

  constructor(
    readonly modelId: MinimaxSpeechModelId,
    private readonly config: MinimaxSpeechModelConfig,
  ) {}

  get provider(): string {
    return this.config.provider;
  }

  async doGenerate(
    options: Parameters<SpeechModelV3['doGenerate']>[0],
  ): Promise<Awaited<ReturnType<SpeechModelV3['doGenerate']>>> {
    const {
      text,
      voice,
      outputFormat,
      speed,
      instructions,
      language,
      providerOptions,
      headers,
      abortSignal,
    } = options;
    const warnings: Array<SharedV3Warning> = [];

    if (instructions != null) {
      warnings.push({ type: 'unsupported', feature: 'instructions' });
    }

    // MiniMax's language_boost wants full language names ("English"), not the
    // ISO 639-1 codes ("en") the SDK passes. Map known codes; warn + omit unknowns.
    let languageBoost: string | undefined;
    if (language != null) {
      languageBoost = mapLanguageBoost(language);
      if (languageBoost == null) {
        warnings.push({
          type: 'unsupported',
          feature: 'language',
          details: `Unsupported language code "${language}"; it was ignored.`,
        });
      }
    }

    const opts =
      (await parseProviderOptions({
        provider: 'minimax',
        providerOptions,
        schema: minimaxSpeechProviderOptions,
      })) ?? {};

    const voiceSetting: Record<string, unknown> = {
      voice_id: voice ?? DEFAULT_MINIMAX_VOICE_ID,
      speed,
      vol: opts.vol,
      pitch: opts.pitch,
      emotion: opts.emotion,
    };

    const audioSetting: Record<string, unknown> = {
      format: outputFormat,
      sample_rate: opts.sampleRate,
      bitrate: opts.bitrate,
      channel: opts.channel,
    };

    const body: Record<string, unknown> = {
      model: this.modelId,
      text,
      stream: false,
      output_format: 'hex',
      voice_setting: voiceSetting,
      audio_setting: audioSetting,
      language_boost: languageBoost,
      pronunciation_dict: opts.pronunciationDict,
    };

    const url = this.config.url({ path: '/t2a_v2', modelId: this.modelId });

    const {
      value: response,
      responseHeaders,
      rawValue,
    } = await postJsonToApi({
      url,
      headers: combineHeaders(this.config.headers(), headers),
      body,
      failedResponseHandler: createJsonErrorResponseHandler(
        defaultMinimaxErrorStructure,
      ),
      successfulResponseHandler: createJsonResponseHandler(
        minimaxSpeechResponseSchema,
      ),
      abortSignal,
      fetch: this.config.fetch,
    });

    checkMinimaxBaseResp(response.base_resp, { url, requestBodyValues: body });

    const audio = hexToUint8Array(response.data?.audio ?? '');
    const currentDate = this.config._internal?.currentDate?.() ?? new Date();

    return {
      audio,
      warnings,
      request: { body: JSON.stringify(body) },
      response: {
        timestamp: currentDate,
        modelId: this.modelId,
        headers: responseHeaders,
        body: rawValue,
      },
      providerMetadata: {
        minimax: {
          ...((response.extra_info as Record<string, JSONValue>) ?? {}),
        },
      },
    };
  }
}
