import { describe, it, expect } from 'vitest';
import { MinimaxChatLanguageModel } from './minimax-openai-language-model';
import { convertToMinimaxChatMessages } from './convert-to-minimax-chat-messages';

// Regression tests for the @ai-sdk/provider beta -> stable migration:
// - LanguageModelV3Usage is now nested ({ inputTokens: {...}, outputTokens: {...} })
// - LanguageModelV3FinishReason is now an object ({ unified, raw })
// - tool message content is a union that includes tool-approval-response parts

function makeModel(fetchImpl: typeof fetch) {
  return new MinimaxChatLanguageModel('MiniMax-M2', {
    provider: 'minimax.chat',
    url: ({ path }) => `https://api.minimax.io/v1${path}`,
    headers: () => ({ Authorization: 'Bearer test-key' }),
    fetch: fetchImpl,
  });
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('MinimaxChatLanguageModel usage/finishReason migration', () => {
  it('maps usage into the nested v3 shape and finishReason into { unified, raw }', async () => {
    const model = makeModel(async () =>
      jsonResponse({
        id: 'cmpl-1',
        model: 'MiniMax-M2',
        choices: [
          {
            message: { role: 'assistant', content: 'hi' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          prompt_tokens_details: { cached_tokens: 4 },
          completion_tokens_details: { reasoning_tokens: 2 },
        },
      }),
    );

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    });

    expect(result.usage.inputTokens).toEqual({
      total: 10,
      noCache: undefined,
      cacheRead: 4,
      cacheWrite: undefined,
    });
    expect(result.usage.outputTokens).toEqual({
      total: 5,
      text: undefined,
      reasoning: 2,
    });
    expect(result.finishReason).toEqual({ unified: 'stop', raw: 'stop' });
  });

  it('maps an unknown finish_reason to unified "other" while preserving raw', async () => {
    const model = makeModel(async () =>
      jsonResponse({
        choices: [
          { message: { role: 'assistant', content: 'x' }, finish_reason: 'weird' },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });

    expect(result.finishReason).toEqual({ unified: 'other', raw: 'weird' });
  });

  it('emits the v3 finishReason and nested usage shape in the stream', async () => {
    const chunks = [
      {
        id: 'c1',
        model: 'MiniMax-M2',
        choices: [{ delta: { role: 'assistant', content: 'hi' } }],
      },
      {
        id: 'c1',
        model: 'MiniMax-M2',
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          prompt_tokens_details: { cached_tokens: 4 },
          completion_tokens_details: { reasoning_tokens: 2 },
        },
      },
    ];
    const sse =
      chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') +
      'data: [DONE]\n\n';

    const model = makeModel(async () =>
      new Response(sse, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );

    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      includeRawChunks: false,
    });

    const parts: any[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }

    const finish = parts.find(p => p.type === 'finish');
    expect(finish).toBeDefined();
    expect(finish.finishReason).toEqual({ unified: 'stop', raw: 'stop' });
    expect(finish.usage.inputTokens).toEqual({
      total: 10,
      noCache: undefined,
      cacheRead: 4,
      cacheWrite: undefined,
    });
    expect(finish.usage.outputTokens).toEqual({
      total: 5,
      text: undefined,
      reasoning: 2,
    });
  });
});

describe('convertToMinimaxChatMessages tool-message migration', () => {
  it('converts tool-result parts and skips tool-approval-response parts', () => {
    const messages = convertToMinimaxChatMessages([
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'getWeather',
            output: { type: 'text', value: 'sunny' },
          },
          {
            type: 'tool-approval-response',
            approvalId: 'appr-1',
            approved: true,
          },
        ],
      },
    ]);

    // Only the tool-result becomes a message; the approval response is dropped.
    expect(messages).toEqual([
      { role: 'tool', tool_call_id: 'call-1', content: 'sunny' },
    ]);
  });
});
