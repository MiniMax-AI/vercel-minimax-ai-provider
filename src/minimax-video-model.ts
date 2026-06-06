import {
  AISDKError,
  Experimental_VideoModelV3,
  SharedV3Warning,
} from '@ai-sdk/provider';
import {
  combineHeaders,
  convertImageModelFileToDataUri,
  createJsonResponseHandler,
  createJsonErrorResponseHandler,
  delay,
  FetchFunction,
  getFromApi,
  parseProviderOptions,
  postJsonToApi,
} from '@ai-sdk/provider-utils';
import { z } from 'zod/v4';
import {
  MinimaxVideoModelId,
  minimaxVideoProviderOptions,
  DEFAULT_VIDEO_POLL_INTERVAL_MS,
  DEFAULT_VIDEO_POLL_TIMEOUT_MS,
} from './minimax-video-options';
import { defaultMinimaxErrorStructure } from './minimax-chat-options';
import { checkMinimaxBaseResp, mapVideoResolution } from './minimax-shared';

export interface MinimaxVideoModelConfig {
  provider: string;
  url: (options: { path: string; modelId: string }) => string;
  headers: () => Record<string, string | undefined>;
  fetch?: FetchFunction;
  _internal?: { currentDate?: () => Date };
}

const baseRespSchema = z
  .object({
    status_code: z.union([z.number(), z.string()]).nullish(),
    status_msg: z.string().nullish(),
  })
  .nullish();

const createTaskResponseSchema = z.object({
  task_id: z.string().nullish(),
  base_resp: baseRespSchema,
});

const queryTaskResponseSchema = z.object({
  task_id: z.string().nullish(),
  status: z.string().nullish(),
  file_id: z.union([z.string(), z.number()]).nullish(),
  video_width: z.union([z.number(), z.string()]).nullish(),
  video_height: z.union([z.number(), z.string()]).nullish(),
  base_resp: baseRespSchema,
});

const fileRetrieveResponseSchema = z.object({
  file: z
    .object({
      file_id: z.union([z.string(), z.number()]).nullish(),
      download_url: z.string().nullish(),
    })
    .nullish(),
  base_resp: baseRespSchema,
});

/**
 * Coerces a string|number dimension to a finite number, or undefined when it is
 * absent or not a valid number (avoids leaking NaN into providerMetadata, which
 * must be JSON-serializable).
 */
function toFiniteNumber(value: number | string | null | undefined): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export class MinimaxVideoModel implements Experimental_VideoModelV3 {
  readonly specificationVersion = 'v3';
  readonly maxVideosPerCall = 1;

  constructor(
    readonly modelId: MinimaxVideoModelId,
    private readonly config: MinimaxVideoModelConfig,
  ) {}

  get provider(): string {
    return this.config.provider;
  }

  async doGenerate(
    options: Parameters<Experimental_VideoModelV3['doGenerate']>[0],
  ): Promise<Awaited<ReturnType<Experimental_VideoModelV3['doGenerate']>>> {
    const {
      prompt,
      n,
      aspectRatio,
      resolution,
      duration,
      fps,
      seed,
      image,
      providerOptions,
      headers,
      abortSignal,
    } = options;
    const warnings: Array<SharedV3Warning> = [];

    if (fps != null) {
      warnings.push({ type: 'unsupported', feature: 'fps' });
    }
    if (seed != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'seed',
        details: 'MiniMax video generation does not support a seed parameter.',
      });
    }
    if (aspectRatio != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'aspectRatio',
        details: 'MiniMax video uses resolution; aspectRatio ignored.',
      });
    }
    if (n != null && n > 1) {
      warnings.push({
        type: 'unsupported',
        feature: 'n',
        details:
          'MiniMax generates one video per call; only 1 will be produced.',
      });
    }

    const opts =
      (await parseProviderOptions({
        provider: 'minimax',
        providerOptions,
        schema: minimaxVideoProviderOptions,
      })) ?? {};

    const body: Record<string, unknown> = {
      model: this.modelId,
      prompt,
      duration,
      prompt_optimizer: opts.promptOptimizer,
      fast_pretreatment: opts.fastPretreatment,
      aigc_watermark: opts.aigcWatermark,
      callback_url: opts.callbackUrl,
    };

    // Resolution: MiniMax expects a label (e.g. '768P'/'1080P'), not WxH. Prefer
    // an explicit provider-option label; otherwise best-effort map the SDK's WxH.
    if (opts.resolution != null) {
      body.resolution = opts.resolution;
    } else if (resolution != null) {
      const mapped = mapVideoResolution(resolution);
      if (mapped != null) {
        body.resolution = mapped;
      } else {
        warnings.push({
          type: 'unsupported',
          feature: 'resolution',
          details: `Could not map resolution "${resolution}" to a MiniMax label. Supported labels are 768P and 1080P (plus 512P on MiniMax-Hailuo-02); pass one via providerOptions.minimax.resolution. Using the model default.`,
        });
      }
    }

    if (image != null) {
      body.first_frame_image =
        image.type === 'url'
          ? image.url
          : convertImageModelFileToDataUri(image);
    } else if (/-Fast$/.test(this.modelId)) {
      // MiniMax's "-Fast" Hailuo models are image-to-video only; without a
      // first frame the text-to-video endpoint rejects them.
      warnings.push({
        type: 'other',
        message: `Model "${this.modelId}" is image-to-video only; provide an \`image\` (first frame) or use a text-to-video model such as "MiniMax-Hailuo-2.3".`,
      });
    }

    const reqHeaders = combineHeaders(this.config.headers(), headers);

    // 1) Create task
    const createUrl = this.config.url({
      path: '/video_generation',
      modelId: this.modelId,
    });
    const { value: createResponse } = await postJsonToApi({
      url: createUrl,
      headers: reqHeaders,
      body,
      failedResponseHandler: createJsonErrorResponseHandler(
        defaultMinimaxErrorStructure,
      ),
      successfulResponseHandler: createJsonResponseHandler(
        createTaskResponseSchema,
      ),
      abortSignal,
      fetch: this.config.fetch,
    });
    checkMinimaxBaseResp(createResponse.base_resp, {
      url: createUrl,
      requestBodyValues: body,
    });

    const taskId = createResponse.task_id;
    if (!taskId) {
      throw new AISDKError({
        name: 'MINIMAX_VIDEO_GENERATION_ERROR',
        message: 'No task_id returned from /video_generation',
      });
    }

    // 2) Poll until Success / Fail / timeout. The polling clock uses real
    // wall-time (Date.now) so it stays consistent with `delay`; the injectable
    // `_internal.currentDate` is reserved for the response timestamp only.
    const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_VIDEO_POLL_INTERVAL_MS;
    const pollTimeoutMs = opts.pollTimeoutMs ?? DEFAULT_VIDEO_POLL_TIMEOUT_MS;
    const startTime = Date.now();

    let fileId: string | undefined;
    let width: number | undefined;
    let height: number | undefined;

    while (true) {
      const queryUrl = this.config.url({
        path: `/query/video_generation?task_id=${encodeURIComponent(taskId)}`,
        modelId: this.modelId,
      });
      const { value: status } = await getFromApi({
        url: queryUrl,
        headers: reqHeaders,
        failedResponseHandler: createJsonErrorResponseHandler(
          defaultMinimaxErrorStructure,
        ),
        successfulResponseHandler: createJsonResponseHandler(
          queryTaskResponseSchema,
        ),
        abortSignal,
        fetch: this.config.fetch,
      });
      checkMinimaxBaseResp(status.base_resp, {
        url: queryUrl,
        requestBodyValues: {},
      });

      if (status.status === 'Success') {
        fileId = status.file_id != null ? String(status.file_id) : undefined;
        width = toFiniteNumber(status.video_width);
        height = toFiniteNumber(status.video_height);
        break;
      }
      if (status.status === 'Fail') {
        throw new AISDKError({
          name: 'MINIMAX_VIDEO_GENERATION_FAILED',
          message: `Video generation failed for task ${taskId}`,
        });
      }
      if (Date.now() - startTime > pollTimeoutMs) {
        throw new AISDKError({
          name: 'MINIMAX_VIDEO_GENERATION_TIMEOUT',
          message: `Video generation timed out after ${pollTimeoutMs}ms (task ${taskId})`,
        });
      }
      await delay(pollIntervalMs, { abortSignal });
    }

    if (!fileId) {
      throw new AISDKError({
        name: 'MINIMAX_VIDEO_GENERATION_ERROR',
        message: `Task ${taskId} succeeded but returned no file_id`,
      });
    }

    // 3) Retrieve the file download URL
    const retrieveUrl = this.config.url({
      path: `/files/retrieve?file_id=${encodeURIComponent(fileId)}`,
      modelId: this.modelId,
    });
    const { value: fileResponse, responseHeaders } = await getFromApi({
      url: retrieveUrl,
      headers: reqHeaders,
      failedResponseHandler: createJsonErrorResponseHandler(
        defaultMinimaxErrorStructure,
      ),
      successfulResponseHandler: createJsonResponseHandler(
        fileRetrieveResponseSchema,
      ),
      abortSignal,
      fetch: this.config.fetch,
    });
    checkMinimaxBaseResp(fileResponse.base_resp, {
      url: retrieveUrl,
      requestBodyValues: {},
    });

    const downloadUrl = fileResponse.file?.download_url;
    if (!downloadUrl) {
      throw new AISDKError({
        name: 'MINIMAX_VIDEO_GENERATION_ERROR',
        message: `No download_url for file ${fileId}`,
      });
    }

    const currentDate = this.config._internal?.currentDate?.() ?? new Date();

    return {
      videos: [{ type: 'url', url: downloadUrl, mediaType: 'video/mp4' }],
      warnings,
      response: {
        timestamp: currentDate,
        modelId: this.modelId,
        headers: responseHeaders,
      },
      providerMetadata: {
        minimax: { taskId, fileId, width: width ?? null, height: height ?? null },
      },
    };
  }
}
