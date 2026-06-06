import { describe, it, expect } from 'vitest';
import { MinimaxVideoModel } from './minimax-video-model';

const TEST_DATE = new Date('2026-06-02T00:00:00Z');

function makeModel(fetchImpl: typeof fetch, overrides?: Record<string, unknown>) {
  return new MinimaxVideoModel('MiniMax-Hailuo-2.3', {
    provider: 'minimax.video',
    url: ({ path }) => `https://api.minimax.io/v1${path}`,
    headers: () => ({ Authorization: 'Bearer test-key' }),
    fetch: fetchImpl,
    _internal: { currentDate: () => TEST_DATE },
    ...overrides,
  });
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

// Default provider options: tiny poll interval so tests run instantly.
const fastPoll = { minimax: { pollIntervalMs: 1, pollTimeoutMs: 5000 } };

describe('MinimaxVideoModel', () => {
  it('has v3 spec, provider, and maxVideosPerCall=1', () => {
    const model = makeModel(async () => jsonResponse({}));
    expect(model.specificationVersion).toBe('v3');
    expect(model.provider).toBe('minimax.video');
    expect(model.maxVideosPerCall).toBe(1);
  });

  it('creates a task, polls until Success, retrieves the download url', async () => {
    const calls: string[] = [];
    let queryCount = 0;
    const model = makeModel(async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/video_generation') && !u.includes('/query/')) {
        return jsonResponse({ task_id: 'task-1', base_resp: { status_code: 0 } });
      }
      if (u.includes('/query/video_generation')) {
        queryCount++;
        if (queryCount < 2) {
          return jsonResponse({ task_id: 'task-1', status: 'Processing', base_resp: { status_code: 0 } });
        }
        return jsonResponse({
          task_id: 'task-1',
          status: 'Success',
          file_id: 'file-9',
          video_width: 1280,
          video_height: 720,
          base_resp: { status_code: 0 },
        });
      }
      if (u.includes('/files/retrieve')) {
        return jsonResponse({
          file: { file_id: 'file-9', download_url: 'https://cdn/video.mp4' },
          base_resp: { status_code: 0 },
        });
      }
      throw new Error(`unexpected url ${u}`);
    });

    const result = await model.doGenerate({
      prompt: 'a dog running',
      n: 1,
      aspectRatio: undefined,
      resolution: undefined,
      duration: 6,
      fps: undefined,
      seed: undefined,
      image: undefined,
      providerOptions: fastPoll,
    });

    expect(result.videos).toEqual([
      { type: 'url', url: 'https://cdn/video.mp4', mediaType: 'video/mp4' },
    ]);
    expect(result.providerMetadata?.minimax).toMatchObject({
      taskId: 'task-1',
      fileId: 'file-9',
      width: 1280,
      height: 720,
    });
    expect(result.response.modelId).toBe('MiniMax-Hailuo-2.3');
    expect(calls.filter(c => c.includes('/query/')).length).toBe(2);
  });

  it('maps resolution size to a MiniMax label and i2v image to first_frame_image', async () => {
    let createBody: any;
    const model = makeModel(async (url, init) => {
      const u = String(url);
      if (u.includes('/video_generation') && !u.includes('/query/')) {
        createBody = JSON.parse((init as RequestInit).body as string);
        return jsonResponse({ task_id: 't', base_resp: { status_code: 0 } });
      }
      if (u.includes('/query/video_generation')) {
        return jsonResponse({ task_id: 't', status: 'Success', file_id: 'f', base_resp: { status_code: 0 } });
      }
      return jsonResponse({ file: { download_url: 'https://cdn/v.mp4' }, base_resp: { status_code: 0 } });
    });

    await model.doGenerate({
      prompt: 'x',
      n: 1,
      aspectRatio: undefined,
      resolution: '1920x1080',
      duration: undefined,
      fps: undefined,
      seed: undefined,
      image: { type: 'url', url: 'https://img/first.jpg' } as any,
      providerOptions: fastPoll,
    });

    expect(createBody.resolution).toBe('1080P');
    expect(createBody.first_frame_image).toBe('https://img/first.jpg');
  });

  it('coerces string-encoded video_width/video_height to numbers', async () => {
    const model = makeModel(async url => {
      const u = String(url);
      if (u.includes('/video_generation') && !u.includes('/query/')) {
        return jsonResponse({ task_id: 't', base_resp: { status_code: 0 } });
      }
      if (u.includes('/query/video_generation')) {
        return jsonResponse({
          task_id: 't',
          status: 'Success',
          file_id: 'f',
          video_width: '1280',
          video_height: '720',
          base_resp: { status_code: 0 },
        });
      }
      return jsonResponse({
        file: { download_url: 'https://cdn/v.mp4' },
        base_resp: { status_code: 0 },
      });
    });

    const result = await model.doGenerate({
      prompt: 'x',
      n: 1,
      aspectRatio: undefined,
      resolution: undefined,
      duration: undefined,
      fps: undefined,
      seed: undefined,
      image: undefined,
      providerOptions: fastPoll,
    });

    expect(result.providerMetadata?.minimax).toMatchObject({
      width: 1280,
      height: 720,
    });
  });

  it('warns and omits resolution for an unsupported size', async () => {
    let createBody: any;
    const model = makeModel(async (url, init) => {
      const u = String(url);
      if (u.includes('/video_generation') && !u.includes('/query/')) {
        createBody = JSON.parse((init as RequestInit).body as string);
        return jsonResponse({ task_id: 't', base_resp: { status_code: 0 } });
      }
      if (u.includes('/query/video_generation')) {
        return jsonResponse({
          task_id: 't',
          status: 'Success',
          file_id: 'f',
          base_resp: { status_code: 0 },
        });
      }
      return jsonResponse({
        file: { download_url: 'https://cdn/v.mp4' },
        base_resp: { status_code: 0 },
      });
    });

    const result = await model.doGenerate({
      prompt: 'x',
      n: 1,
      aspectRatio: undefined,
      resolution: '640x640',
      duration: undefined,
      fps: undefined,
      seed: undefined,
      image: undefined,
      providerOptions: fastPoll,
    });

    expect('resolution' in createBody).toBe(false);
    expect(
      result.warnings.some(
        w => w.type === 'unsupported' && w.feature === 'resolution',
      ),
    ).toBe(true);
  });

  it('sends an explicit providerOptions.resolution label verbatim (overrides WxH)', async () => {
    let createBody: any;
    const model = makeModel(async (url, init) => {
      const u = String(url);
      if (u.includes('/video_generation') && !u.includes('/query/')) {
        createBody = JSON.parse((init as RequestInit).body as string);
        return jsonResponse({ task_id: 't', base_resp: { status_code: 0 } });
      }
      if (u.includes('/query/video_generation')) {
        return jsonResponse({
          task_id: 't',
          status: 'Success',
          file_id: 'f',
          base_resp: { status_code: 0 },
        });
      }
      return jsonResponse({
        file: { download_url: 'https://cdn/v.mp4' },
        base_resp: { status_code: 0 },
      });
    });

    await model.doGenerate({
      prompt: 'x',
      n: 1,
      aspectRatio: undefined,
      resolution: '1920x1080', // would map to 1080P, but the option wins
      duration: undefined,
      fps: undefined,
      seed: undefined,
      image: undefined,
      providerOptions: { minimax: { ...fastPoll.minimax, resolution: '512P' } },
    });

    expect(createBody.resolution).toBe('512P');
  });

  it('accepts a numeric file_id from the query response', async () => {
    let retrieveUrl = '';
    const model = makeModel(async url => {
      const u = String(url);
      if (u.includes('/video_generation') && !u.includes('/query/')) {
        return jsonResponse({ task_id: 't', base_resp: { status_code: 0 } });
      }
      if (u.includes('/query/video_generation')) {
        return jsonResponse({
          task_id: 't',
          status: 'Success',
          file_id: 12345,
          base_resp: { status_code: 0 },
        });
      }
      retrieveUrl = u;
      return jsonResponse({
        file: { download_url: 'https://cdn/v.mp4' },
        base_resp: { status_code: 0 },
      });
    });

    const result = await model.doGenerate({
      prompt: 'x',
      n: 1,
      aspectRatio: undefined,
      resolution: undefined,
      duration: undefined,
      fps: undefined,
      seed: undefined,
      image: undefined,
      providerOptions: fastPoll,
    });

    expect(retrieveUrl).toContain('file_id=12345');
    expect(result.providerMetadata?.minimax).toMatchObject({ fileId: '12345' });
  });

  it('throws when the task status is Fail', async () => {
    const model = makeModel(async (url) => {
      const u = String(url);
      if (u.includes('/video_generation') && !u.includes('/query/')) {
        return jsonResponse({ task_id: 't', base_resp: { status_code: 0 } });
      }
      return jsonResponse({ task_id: 't', status: 'Fail', base_resp: { status_code: 0 } });
    });

    await expect(
      model.doGenerate({
        prompt: 'x',
        n: 1,
        aspectRatio: undefined,
        resolution: undefined,
        duration: undefined,
        fps: undefined,
        seed: undefined,
        image: undefined,
        providerOptions: fastPoll,
      }),
    ).rejects.toThrow(/failed/i);
  });

  it('times out when never reaching Success', async () => {
    const model = makeModel(async (url) => {
      const u = String(url);
      if (u.includes('/video_generation') && !u.includes('/query/')) {
        return jsonResponse({ task_id: 't', base_resp: { status_code: 0 } });
      }
      return jsonResponse({ task_id: 't', status: 'Processing', base_resp: { status_code: 0 } });
    });

    await expect(
      model.doGenerate({
        prompt: 'x',
        n: 1,
        aspectRatio: undefined,
        resolution: undefined,
        duration: undefined,
        fps: undefined,
        seed: undefined,
        image: undefined,
        providerOptions: { minimax: { pollIntervalMs: 1, pollTimeoutMs: 5 } },
      }),
    ).rejects.toThrow(/timed out/i);
  });

  it('warns on unsupported fps and n>1', async () => {
    const model = makeModel(async (url) => {
      const u = String(url);
      if (u.includes('/video_generation') && !u.includes('/query/')) {
        return jsonResponse({ task_id: 't', base_resp: { status_code: 0 } });
      }
      if (u.includes('/query/video_generation')) {
        return jsonResponse({ task_id: 't', status: 'Success', file_id: 'f', base_resp: { status_code: 0 } });
      }
      return jsonResponse({ file: { download_url: 'https://cdn/v.mp4' }, base_resp: { status_code: 0 } });
    });

    const result = await model.doGenerate({
      prompt: 'x',
      n: 2,
      aspectRatio: '16:9',
      resolution: undefined,
      duration: undefined,
      fps: 30,
      seed: 42,
      image: undefined,
      providerOptions: fastPoll,
    });

    expect(result.warnings.some(w => w.type === 'unsupported' && w.feature === 'fps')).toBe(true);
    expect(result.warnings.some(w => w.type === 'unsupported' && w.feature === 'n')).toBe(true);
    expect(result.warnings.some(w => w.type === 'unsupported' && w.feature === 'aspectRatio')).toBe(true);
    expect(result.warnings.some(w => w.type === 'unsupported' && w.feature === 'seed')).toBe(true);
  });

  it('does not send seed in the request body', async () => {
    let createBody: any;
    const model = makeModel(async (url, init) => {
      const u = String(url);
      if (u.includes('/video_generation') && !u.includes('/query/')) {
        createBody = JSON.parse((init as RequestInit).body as string);
        return jsonResponse({ task_id: 't', base_resp: { status_code: 0 } });
      }
      if (u.includes('/query/video_generation')) {
        return jsonResponse({ task_id: 't', status: 'Success', file_id: 'f', base_resp: { status_code: 0 } });
      }
      return jsonResponse({ file: { download_url: 'https://cdn/v.mp4' }, base_resp: { status_code: 0 } });
    });

    await model.doGenerate({
      prompt: 'x',
      n: 1,
      aspectRatio: undefined,
      resolution: undefined,
      duration: undefined,
      fps: undefined,
      seed: 42,
      image: undefined,
      providerOptions: fastPoll,
    });

    expect('seed' in createBody).toBe(false);
  });

  it('warns when a -Fast (image-to-video only) model is used without an image', async () => {
    const model = new MinimaxVideoModel('MiniMax-Hailuo-2.3-Fast', {
      provider: 'minimax.video',
      url: ({ path }) => `https://api.minimax.io/v1${path}`,
      headers: () => ({ Authorization: 'Bearer test-key' }),
      fetch: (async (url: string) => {
        const u = String(url);
        if (u.includes('/video_generation') && !u.includes('/query/')) {
          return jsonResponse({ task_id: 't', base_resp: { status_code: 0 } });
        }
        if (u.includes('/query/video_generation')) {
          return jsonResponse({ task_id: 't', status: 'Success', file_id: 'f', base_resp: { status_code: 0 } });
        }
        return jsonResponse({ file: { download_url: 'https://cdn/v.mp4' }, base_resp: { status_code: 0 } });
      }) as unknown as typeof fetch,
      _internal: { currentDate: () => TEST_DATE },
    });

    const result = await model.doGenerate({
      prompt: 'x',
      n: 1,
      aspectRatio: undefined,
      resolution: undefined,
      duration: undefined,
      fps: undefined,
      seed: undefined,
      image: undefined,
      providerOptions: fastPoll,
    });

    expect(
      result.warnings.some(
        w => w.type === 'other' && /image-to-video only/.test(w.message),
      ),
    ).toBe(true);
  });
});
