import {
  ImageModelV3,
  SharedV3Warning,
} from '@ai-sdk/provider';
import {
  combineHeaders,
  convertImageModelFileToDataUri,
  createJsonResponseHandler,
  createJsonErrorResponseHandler,
  FetchFunction,
  parseProviderOptions,
  postJsonToApi,
} from '@ai-sdk/provider-utils';
import { z } from 'zod/v4';
import {
  MinimaxImageModelId,
  minimaxImageProviderOptions,
} from './minimax-image-options';
import { defaultMinimaxErrorStructure } from './minimax-chat-options';
import { checkMinimaxBaseResp } from './minimax-shared';

export interface MinimaxImageModelConfig {
  provider: string;
  url: (options: { path: string; modelId: string }) => string;
  headers: () => Record<string, string | undefined>;
  fetch?: FetchFunction;
  _internal?: { currentDate?: () => Date };
}

const minimaxImageResponseSchema = z.object({
  data: z
    .object({
      image_base64: z.array(z.string()).nullish(),
      image_urls: z.array(z.string()).nullish(),
    })
    .nullish(),
  // MiniMax returns these counts as quoted strings (e.g. "3"); accept either,
  // and stay lenient since this metadata is not consumed.
  metadata: z
    .object({
      success_count: z.union([z.number(), z.string()]).nullish(),
      failed_count: z.union([z.number(), z.string()]).nullish(),
    })
    .nullish(),
  base_resp: z
    .object({
      status_code: z.union([z.number(), z.string()]).nullish(),
      status_msg: z.string().nullish(),
    })
    .nullish(),
});

export class MinimaxImageModel implements ImageModelV3 {
  readonly specificationVersion = 'v3';
  readonly maxImagesPerCall = 9;

  constructor(
    readonly modelId: MinimaxImageModelId,
    private readonly config: MinimaxImageModelConfig,
  ) {}

  get provider(): string {
    return this.config.provider;
  }

  async doGenerate({
    prompt,
    n,
    size,
    aspectRatio,
    seed,
    files,
    mask,
    providerOptions,
    headers,
    abortSignal,
  }: Parameters<ImageModelV3['doGenerate']>[0]): Promise<
    Awaited<ReturnType<ImageModelV3['doGenerate']>>
  > {
    const warnings: Array<SharedV3Warning> = [];

    // MiniMax has no inpainting/mask support.
    if (mask != null) {
      warnings.push({ type: 'unsupported', feature: 'mask' });
    }

    const options =
      (await parseProviderOptions({
        provider: 'minimax',
        providerOptions,
        schema: minimaxImageProviderOptions,
      })) ?? {};

    // Image-to-image: the SDK delivers input images via `files` (from
    // `generateImage({ prompt: { images: [...] } })`). MiniMax expects them as
    // `subject_reference` entries (a `character` subject array; the API does not
    // document a maximum, so all input images are forwarded). An explicit
    // `providerOptions.subjectReference` takes precedence when provided.
    const subjectReference =
      options.subjectReference ??
      (files != null && files.length > 0
        ? files.map(file => ({
            type: 'character' as const,
            image_file: convertImageModelFileToDataUri(file),
          }))
        : undefined);

    const body: Record<string, unknown> = {
      model: this.modelId,
      prompt,
      n,
      response_format: 'base64',
      seed,
      prompt_optimizer: options.promptOptimizer,
      aigc_watermark: options.aigcWatermark,
      style: options.style,
      subject_reference: subjectReference,
    };

    // size and aspect_ratio are mutually exclusive server-side; size wins.
    if (size != null) {
      const [width, height] = size.split('x').map(s => parseInt(s, 10));
      body.width = width;
      body.height = height;
      if (aspectRatio != null) {
        warnings.push({
          type: 'unsupported',
          feature: 'aspectRatio',
          details: 'size takes precedence; aspectRatio ignored.',
        });
      }
    } else if (aspectRatio != null) {
      body.aspect_ratio = aspectRatio;
    }

    const url = this.config.url({
      path: '/image_generation',
      modelId: this.modelId,
    });

    const { value: response, responseHeaders } = await postJsonToApi({
      url,
      headers: combineHeaders(this.config.headers(), headers),
      body,
      failedResponseHandler: createJsonErrorResponseHandler(
        defaultMinimaxErrorStructure,
      ),
      successfulResponseHandler: createJsonResponseHandler(
        minimaxImageResponseSchema,
      ),
      abortSignal,
      fetch: this.config.fetch,
    });

    checkMinimaxBaseResp(response.base_resp, { url, requestBodyValues: body });

    const images = response.data?.image_base64 ?? [];
    const currentDate = this.config._internal?.currentDate?.() ?? new Date();

    return {
      images,
      warnings,
      response: {
        timestamp: currentDate,
        modelId: this.modelId,
        headers: responseHeaders,
      },
    };
  }
}
