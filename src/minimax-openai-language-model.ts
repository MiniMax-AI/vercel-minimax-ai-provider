import {
  APICallError,
  InvalidResponseDataError,
  LanguageModelV3,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
  SharedV3ProviderMetadata,
  SharedV3Warning,
} from '@ai-sdk/provider';
import {
  combineHeaders,
  createEventSourceResponseHandler,
  createJsonErrorResponseHandler,
  createJsonResponseHandler,
  FetchFunction,
  generateId,
  isParsableJson,
  parseProviderOptions,
  ParseResult,
  postJsonToApi,
  ResponseHandler,
} from '@ai-sdk/provider-utils';
import { z } from 'zod/v4';
import { MetadataExtractor } from './minimax-metadata-extractor';
import { convertToMinimaxChatMessages } from './convert-to-minimax-chat-messages';
import {
  MinimaxChatModelId,
  minimaxChatProviderOptions,
  defaultMinimaxErrorStructure,
  ProviderErrorStructure,
} from './minimax-chat-options';
import { prepareTools } from './minimax-openai-prepare-tools';

function getResponseMetadata({
  id,
  model,
  created,
}: {
  id?: string | undefined | null;
  created?: number | undefined | null;
  model?: string | undefined | null;
}) {
  return {
    id: id ?? undefined,
    modelId: model ?? undefined,
    timestamp: created != null ? new Date(created * 1000) : undefined,
  };
}

function mapOpenAICompatibleFinishReason(
  finishReason: string | null | undefined,
): LanguageModelV3FinishReason {
  return {
    unified: mapOpenAICompatibleFinishReasonUnified(finishReason),
    raw: finishReason ?? undefined,
  };
}

function mapOpenAICompatibleFinishReasonUnified(
  finishReason: string | null | undefined,
): LanguageModelV3FinishReason['unified'] {
  switch (finishReason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content-filter';
    case 'function_call':
    case 'tool_calls':
      return 'tool-calls';
    default:
      return 'other';
  }
}

export type MinimaxChatConfig = {
  provider: string;
  headers: () => Record<string, string | undefined>;
  url: (options: { modelId: string; path: string }) => string;
  fetch?: FetchFunction;
  includeUsage?: boolean;
  errorStructure?: ProviderErrorStructure<any>;
  metadataExtractor?: MetadataExtractor;
  supportsStructuredOutputs?: boolean;
  supportedUrls?: () => LanguageModelV3['supportedUrls'];
};

export class MinimaxChatLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3';
  readonly supportsStructuredOutputs: boolean;
  readonly modelId: MinimaxChatModelId;

  private readonly config: MinimaxChatConfig;
  private readonly failedResponseHandler: ResponseHandler<APICallError>;
  private readonly chunkSchema;

  constructor(
    modelId: MinimaxChatModelId,
    config: MinimaxChatConfig,
  ) {
    this.modelId = modelId;
    this.config = config;

    const errorStructure =
      config.errorStructure ?? defaultMinimaxErrorStructure;
    this.chunkSchema = createOpenAICompatibleChatChunkSchema(
      errorStructure.errorSchema,
    );
    this.failedResponseHandler = createJsonErrorResponseHandler(errorStructure);
    this.supportsStructuredOutputs = config.supportsStructuredOutputs ?? false;
  }

  get provider(): string {
    return this.config.provider;
  }

  private get providerOptionsName(): string {
    return this.config.provider.split('.')[0].trim();
  }

  get supportedUrls() {
    return this.config.supportedUrls?.() ?? {};
  }

  private async getArgs({
    prompt,
    maxOutputTokens,
    temperature,
    topP,
    topK,
    frequencyPenalty,
    presencePenalty,
    providerOptions,
    stopSequences,
    responseFormat,
    seed,
    toolChoice,
    tools,
  }: Parameters<LanguageModelV3['doGenerate']>[0]) {
    const warnings: SharedV3Warning[] = [];

    const compatibleOptions = Object.assign(
      (await parseProviderOptions({
        provider: 'openai-compatible',
        providerOptions,
        schema: minimaxChatProviderOptions,
      })) ?? {},
      (await parseProviderOptions({
        provider: this.providerOptionsName,
        providerOptions,
        schema: minimaxChatProviderOptions,
      })) ?? {},
    );

    if (topK != null) {
      warnings.push({ type: 'unsupported', feature: 'topK' });
    }

    if (
      responseFormat?.type === 'json' &&
      responseFormat.schema != null &&
      !this.supportsStructuredOutputs
    ) {
      warnings.push({
        type: 'unsupported',
        feature: 'responseFormat',
        details:
          'JSON response format schema is only supported with structuredOutputs',
      });
    }

    const {
      tools: openaiTools,
      toolChoice: openaiToolChoice,
      toolWarnings,
    } = prepareTools({
      tools,
      toolChoice,
    });

    return {
      args: {
        model: this.modelId,
        user: compatibleOptions.user,
        max_tokens: maxOutputTokens,
        temperature,
        top_p: topP,
        frequency_penalty: frequencyPenalty,
        presence_penalty: presencePenalty,
        response_format:
          responseFormat?.type === 'json'
            ? this.supportsStructuredOutputs === true &&
              responseFormat.schema != null
              ? {
                type: 'json_schema',
                json_schema: {
                  schema: responseFormat.schema,
                  name: responseFormat.name ?? 'response',
                  description: responseFormat.description,
                },
              }
              : { type: 'json_object' }
            : undefined,
        stop: stopSequences,
        seed,
        ...Object.fromEntries(
          Object.entries(
            providerOptions?.[this.providerOptionsName] ?? {},
          ).filter(
            ([key]) =>
              !Object.keys(minimaxChatProviderOptions.shape).includes(key),
          ),
        ),
        reasoning_effort: compatibleOptions.reasoningEffort,
        verbosity: compatibleOptions.textVerbosity,

        // MiniMax specific: enable reasoning_split for M2 models
        reasoning_split: true,

        messages: convertToMinimaxChatMessages(prompt),
        tools: openaiTools,
        tool_choice: openaiToolChoice,
      },
      warnings: [...warnings, ...toolWarnings],
    };
  }

  async doGenerate(
    options: Parameters<LanguageModelV3['doGenerate']>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV3['doGenerate']>>> {
    const { args, warnings } = await this.getArgs({ ...options });
    const body = JSON.stringify(args);

    const {
      responseHeaders,
      value: responseBody,
      rawValue: rawResponse,
    } = await postJsonToApi({
      url: this.config.url({
        path: '/chat/completions',
        modelId: this.modelId,
      }),
      headers: combineHeaders(this.config.headers(), options.headers),
      body: args,
      failedResponseHandler: this.failedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(
        MinimaxChatResponseSchema,
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const choice = responseBody.choices[0];
    const content: Array<LanguageModelV3Content> = [];

    // text content
    const text = choice.message.content;
    if (text != null && text.length > 0) {
      content.push({ type: 'text', text });
    }

    // reasoning content. Models that return reasoning_details (e.g. MiniMax-M3)
    // also return the same text in reasoning_content, so reasoning_details wins
    // to avoid duplication; models that only return reasoning_content
    // (e.g. MiniMax-M3.1-Flash) fall back to it.
    const reasoningText = findReasoningText(choice.message.reasoning_details);
    if (reasoningText) {
      content.push({
        type: 'reasoning',
        text: reasoningText,
        // Store original reasoning_details in providerMetadata for round-trip
        providerMetadata: {
          minimax: {
            reasoningDetails: choice.message.reasoning_details,
          },
        },
      });
    } else if (choice.message.reasoning_content) {
      content.push({
        type: 'reasoning',
        text: choice.message.reasoning_content,
      });
    }

    // tool calls
    if (choice.message.tool_calls != null) {
      for (const toolCall of choice.message.tool_calls) {
        content.push({
          type: 'tool-call',
          toolCallId: toolCall.id ?? generateId(),
          toolName: toolCall.function.name,
          input: toolCall.function.arguments!,
        });
      }
    }

    const providerMetadata: SharedV3ProviderMetadata = {
      [this.providerOptionsName]: {},
      ...(await this.config.metadataExtractor?.extractMetadata?.({
        parsedBody: rawResponse,
      })),
    };

    const completionTokenDetails =
      responseBody.usage?.completion_tokens_details;
    if (completionTokenDetails?.accepted_prediction_tokens != null) {
      providerMetadata[this.providerOptionsName].acceptedPredictionTokens =
        completionTokenDetails?.accepted_prediction_tokens;
    }
    if (completionTokenDetails?.rejected_prediction_tokens != null) {
      providerMetadata[this.providerOptionsName].rejectedPredictionTokens =
        completionTokenDetails?.rejected_prediction_tokens;
    }

    return {
      content,
      finishReason: mapOpenAICompatibleFinishReason(choice.finish_reason),
      usage: convertMinimaxChatUsage(responseBody.usage),
      providerMetadata,
      request: { body },
      response: {
        ...getResponseMetadata(responseBody),
        headers: responseHeaders,
        body: rawResponse,
      },
      warnings,
    };
  }

  async doStream(
    options: Parameters<LanguageModelV3['doStream']>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV3['doStream']>>> {
    const { args, warnings } = await this.getArgs({ ...options });

    const body = {
      ...args,
      stream: true,
      stream_options: this.config.includeUsage
        ? { include_usage: true }
        : undefined,
    };

    const metadataExtractor =
      this.config.metadataExtractor?.createStreamExtractor();

    const { responseHeaders, value: response } = await postJsonToApi({
      url: this.config.url({
        path: '/chat/completions',
        modelId: this.modelId,
      }),
      headers: combineHeaders(this.config.headers(), options.headers),
      body,
      failedResponseHandler: this.failedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(
        this.chunkSchema,
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const toolCalls: Array<{
      id: string;
      type: 'function';
      function: {
        name: string;
        arguments: string;
      };
      hasFinished: boolean;
    }> = [];

    let finishReason: LanguageModelV3FinishReason = {
      unified: 'other',
      raw: undefined,
    };
    // Last usage reported in the stream (sent only with stream_options.include_usage).
    let rawUsage: z.infer<typeof openaiCompatibleTokenUsageSchema> = undefined;
    let isFirstChunk = true;
    const providerOptionsName = this.providerOptionsName;
    let isActiveReasoning = false;
    let isActiveText = false;
    let accumulatedReasoningDetails: any[] = []; // Accumulate reasoning_details for round-trip

    const emitReasoningDelta = (
      controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
      text: string,
    ) => {
      if (!isActiveReasoning) {
        controller.enqueue({ type: 'reasoning-start', id: 'reasoning-0' });
        isActiveReasoning = true;
      }
      controller.enqueue({
        type: 'reasoning-delta',
        id: 'reasoning-0',
        delta: text,
      });
    };

    return {
      stream: response.pipeThrough(
        new TransformStream<
          ParseResult<z.infer<typeof this.chunkSchema>>,
          LanguageModelV3StreamPart
        >({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings });
          },

          transform(chunk, controller) {
            if (options.includeRawChunks) {
              controller.enqueue({ type: 'raw', rawValue: chunk.rawValue });
            }

            if (!chunk.success) {
              finishReason = { unified: 'error', raw: undefined };
              controller.enqueue({ type: 'error', error: chunk.error });
              return;
            }
            const value = chunk.value;

            metadataExtractor?.processChunk(chunk.rawValue);

            if ('error' in value) {
              finishReason = { unified: 'error', raw: undefined };
              controller.enqueue({ type: 'error', error: value.error.message });
              return;
            }

            if (isFirstChunk) {
              isFirstChunk = false;
              controller.enqueue({
                type: 'response-metadata',
                ...getResponseMetadata(value),
              });
            }

            if (value.usage != null) {
              rawUsage = value.usage;
            }

            const choice = value.choices[0];

            if (choice?.finish_reason != null) {
              finishReason = mapOpenAICompatibleFinishReason(
                choice.finish_reason,
              );
            }

            if (choice?.delta == null) {
              return;
            }

            const delta = choice.delta;

            // Handle reasoning_details for streaming
            if (delta.reasoning_details?.length) {
              // Accumulate reasoning_details for round-trip
              // Replace or append based on whether we've seen this before
              if (accumulatedReasoningDetails.length === 0) {
                accumulatedReasoningDetails = delta.reasoning_details;
              } else {
                // Merge reasoning_details blocks
                for (const block of delta.reasoning_details) {
                  const existingIndex = accumulatedReasoningDetails.findIndex(
                    (b: any) => b.type === block.type && b.id === block.id
                  );
                  if (existingIndex >= 0) {
                    // Update existing block (merge text if needed)
                    const existing = accumulatedReasoningDetails[existingIndex];
                    if (block.text) {
                      existing.text = (existing.text || '') + block.text;
                    }
                  } else {
                    // Add new block
                    accumulatedReasoningDetails.push({ ...block });
                  }
                }
              }

              const reasoningText = findReasoningText(delta.reasoning_details);
              if (reasoningText) {
                emitReasoningDelta(controller, reasoningText);
              }
            } else if (delta.reasoning_content) {
              // Models that only stream reasoning_content (e.g. MiniMax-M3.1-Flash)
              emitReasoningDelta(controller, delta.reasoning_content);
            }

            if (delta.content) {
              if (!isActiveText) {
                controller.enqueue({ type: 'text-start', id: 'txt-0' });
                isActiveText = true;
              }

              controller.enqueue({
                type: 'text-delta',
                id: 'txt-0',
                delta: delta.content,
              });
            }

            if (delta.tool_calls != null) {
              for (const toolCallDelta of delta.tool_calls) {
                const index = toolCallDelta.index;

                if (toolCalls[index] == null) {
                  if (toolCallDelta.id == null) {
                    throw new InvalidResponseDataError({
                      data: toolCallDelta,
                      message: `Expected 'id' to be a string.`,
                    });
                  }

                  if (toolCallDelta.function?.name == null) {
                    throw new InvalidResponseDataError({
                      data: toolCallDelta,
                      message: `Expected 'function.name' to be a string.`,
                    });
                  }

                  controller.enqueue({
                    type: 'tool-input-start',
                    id: toolCallDelta.id,
                    toolName: toolCallDelta.function.name,
                  });

                  toolCalls[index] = {
                    id: toolCallDelta.id,
                    type: 'function',
                    function: {
                      name: toolCallDelta.function.name,
                      arguments: toolCallDelta.function.arguments ?? '',
                    },
                    hasFinished: false,
                  };

                  const toolCall = toolCalls[index];

                  if (
                    toolCall.function?.name != null &&
                    toolCall.function?.arguments != null
                  ) {
                    if (toolCall.function.arguments.length > 0) {
                      controller.enqueue({
                        type: 'tool-input-delta',
                        id: toolCall.id,
                        delta: toolCall.function.arguments,
                      });
                    }

                    if (isParsableJson(toolCall.function.arguments)) {
                      controller.enqueue({
                        type: 'tool-input-end',
                        id: toolCall.id,
                      });

                      controller.enqueue({
                        type: 'tool-call',
                        toolCallId: toolCall.id ?? generateId(),
                        toolName: toolCall.function.name,
                        input: toolCall.function.arguments,
                      });
                      toolCall.hasFinished = true;
                    }
                  }

                  continue;
                }

                const toolCall = toolCalls[index];

                if (toolCall.hasFinished) {
                  continue;
                }

                if (toolCallDelta.function?.arguments != null) {
                  toolCall.function!.arguments +=
                    toolCallDelta.function?.arguments ?? '';
                }

                controller.enqueue({
                  type: 'tool-input-delta',
                  id: toolCall.id,
                  delta: toolCallDelta.function.arguments ?? '',
                });

                if (
                  toolCall.function?.name != null &&
                  toolCall.function?.arguments != null &&
                  isParsableJson(toolCall.function.arguments)
                ) {
                  controller.enqueue({
                    type: 'tool-input-end',
                    id: toolCall.id,
                  });

                  controller.enqueue({
                    type: 'tool-call',
                    toolCallId: toolCall.id ?? generateId(),
                    toolName: toolCall.function.name,
                    input: toolCall.function.arguments,
                  });
                  toolCall.hasFinished = true;
                }
              }
            }
          },

          flush(controller) {
            if (isActiveReasoning) {
              controller.enqueue({
                type: 'reasoning-end',
                id: 'reasoning-0',
                // Attach reasoning_details for round-trip
                providerMetadata: accumulatedReasoningDetails.length > 0 ? {
                  minimax: {
                    reasoningDetails: accumulatedReasoningDetails,
                  },
                } : undefined,
              });
            }

            if (isActiveText) {
              controller.enqueue({ type: 'text-end', id: 'txt-0' });
            }

            for (const toolCall of toolCalls.filter(
              toolCall => !toolCall.hasFinished,
            )) {
              controller.enqueue({
                type: 'tool-input-end',
                id: toolCall.id,
              });

              controller.enqueue({
                type: 'tool-call',
                toolCallId: toolCall.id ?? generateId(),
                toolName: toolCall.function.name,
                input: toolCall.function.arguments,
              });
            }

            const providerMetadata: SharedV3ProviderMetadata = {
              [providerOptionsName]: {},
              ...metadataExtractor?.buildMetadata(),
            };
            const completionTokensDetails = rawUsage?.completion_tokens_details;
            if (completionTokensDetails?.accepted_prediction_tokens != null) {
              providerMetadata[providerOptionsName].acceptedPredictionTokens =
                completionTokensDetails.accepted_prediction_tokens;
            }
            if (completionTokensDetails?.rejected_prediction_tokens != null) {
              providerMetadata[providerOptionsName].rejectedPredictionTokens =
                completionTokensDetails.rejected_prediction_tokens;
            }

            controller.enqueue({
              type: 'finish',
              finishReason,
              usage: convertMinimaxChatUsage(rawUsage),
              providerMetadata,
            });
          },
        }),
      ),
      request: { body },
      response: { headers: responseHeaders },
    };
  }
}

// Schema definitions
const openaiCompatibleTokenUsageSchema = z
  .object({
    prompt_tokens: z.number().nullish(),
    completion_tokens: z.number().nullish(),
    total_tokens: z.number().nullish(),
    prompt_tokens_details: z
      .object({
        cached_tokens: z.number().nullish(),
      })
      .nullish(),
    completion_tokens_details: z
      .object({
        reasoning_tokens: z.number().nullish(),
        accepted_prediction_tokens: z.number().nullish(),
        rejected_prediction_tokens: z.number().nullish(),
      })
      .nullish(),
  })
  .nullish();

// Maps MiniMax usage to the AI SDK shape. The API reports totals plus the cached
// and reasoning parts, so the non-cached input and text output are derived.
function convertMinimaxChatUsage(
  usage: z.infer<typeof openaiCompatibleTokenUsageSchema>,
): LanguageModelV3Usage {
  if (usage == null) {
    return {
      inputTokens: {
        total: undefined,
        noCache: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: { total: undefined, text: undefined, reasoning: undefined },
      raw: undefined,
    };
  }
  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  const cacheReadTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const reasoningTokens =
    usage.completion_tokens_details?.reasoning_tokens ?? 0;
  return {
    inputTokens: {
      total: promptTokens,
      noCache: promptTokens - cacheReadTokens,
      cacheRead: cacheReadTokens,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: completionTokens,
      text: completionTokens - reasoningTokens,
      reasoning: reasoningTokens,
    },
    raw: usage,
  };
}

// MiniMax specific response schema with reasoning_details
const MinimaxChatResponseSchema = z.object({
  id: z.string().nullish(),
  created: z.number().nullish(),
  model: z.string().nullish(),
  choices: z.array(
    z.object({
      message: z.object({
        role: z.literal('assistant').nullish(),
        content: z.string().nullish(),
        reasoning_details: z.array(z.any()).nullish(), // MiniMax specific
        reasoning_content: z.string().nullish(), // MiniMax specific
        tool_calls: z
          .array(
            z.object({
              id: z.string().nullish(),
              function: z.object({
                name: z.string(),
                arguments: z.string(),
              }),
            }),
          )
          .nullish(),
      }),
      finish_reason: z.string().nullish(),
    }),
  ),
  usage: openaiCompatibleTokenUsageSchema,
});

// Chunk schema for streaming
const createOpenAICompatibleChatChunkSchema = <
  ERROR_SCHEMA extends z.core.$ZodType,
>(
  errorSchema: ERROR_SCHEMA,
) =>
  z.union([
    z.object({
      id: z.string().nullish(),
      created: z.number().nullish(),
      model: z.string().nullish(),
      choices: z.array(
        z.object({
          delta: z
            .object({
              role: z.enum(['assistant']).nullish(),
              content: z.string().nullish(),
              reasoning_details: z.array(z.any()).nullish(), // MiniMax specific
              reasoning_content: z.string().nullish(), // MiniMax specific
              tool_calls: z
                .array(
                  z.object({
                    index: z.number(),
                    id: z.string().nullish(),
                    function: z.object({
                      name: z.string().nullish(),
                      arguments: z.string().nullish(),
                    }),
                  }),
                )
                .nullish(),
            })
            .nullish(),
          finish_reason: z.string().nullish(),
        }),
      ),
      usage: openaiCompatibleTokenUsageSchema,
    }),
    errorSchema,
  ]);

// Returns the text of the first `reasoning.text` block in MiniMax reasoning_details.
function findReasoningText(
  details: unknown[] | null | undefined,
): string | undefined {
  for (const block of details ?? []) {
    if (
      block != null &&
      typeof block === 'object' &&
      'type' in block &&
      block.type === 'reasoning.text' &&
      'text' in block &&
      typeof block.text === 'string' &&
      block.text.length > 0
    ) {
      return block.text;
    }
  }
  return undefined;
}
