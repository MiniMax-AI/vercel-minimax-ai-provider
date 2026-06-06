import { describe, it, expect } from 'vitest';
import { createMinimaxMediaModels } from './minimax-media';

function makeFactory() {
  return createMinimaxMediaModels({
    baseURL: 'https://api.minimax.io/v1',
    headers: () => ({ Authorization: 'Bearer test-key' }),
  });
}

describe('createMinimaxMediaModels', () => {
  it('builds an image model on minimax.image', () => {
    const model = makeFactory().image('image-01');
    expect(model.provider).toBe('minimax.image');
    expect(model.modelId).toBe('image-01');
    expect(model.specificationVersion).toBe('v3');
  });

  it('builds a speech model on minimax.speech', () => {
    const model = makeFactory().speech('speech-2.6-hd');
    expect(model.provider).toBe('minimax.speech');
    expect(model.modelId).toBe('speech-2.6-hd');
    expect(model.specificationVersion).toBe('v3');
  });

  it('builds a video model on minimax.video', () => {
    const model = makeFactory().video('MiniMax-Hailuo-2.3');
    expect(model.provider).toBe('minimax.video');
    expect(model.modelId).toBe('MiniMax-Hailuo-2.3');
    expect(model.specificationVersion).toBe('v3');
  });

  it('routes media requests to the configured /v1 base URL', async () => {
    let capturedUrl = '';
    const factory = createMinimaxMediaModels({
      baseURL: 'https://api.minimax.io/v1',
      headers: () => ({ Authorization: 'Bearer k' }),
      fetch: (async (url: string) => {
        capturedUrl = String(url);
        return new Response(
          JSON.stringify({
            data: { image_base64: ['AA'] },
            base_resp: { status_code: 0 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as unknown as typeof fetch,
    });

    await factory.image('image-01').doGenerate({
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
  });
});
