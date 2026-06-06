import { describe, it, expect } from 'vitest';
import { MinimaxSpeechModel } from './minimax-speech-model';

const TEST_DATE = new Date('2026-06-02T00:00:00Z');

function makeModel(fetchImpl: typeof fetch) {
  return new MinimaxSpeechModel('speech-2.6-hd', {
    provider: 'minimax.speech',
    url: ({ path }) => `https://api.minimax.io/v1${path}`,
    headers: () => ({ Authorization: 'Bearer test-key' }),
    fetch: fetchImpl,
    _internal: { currentDate: () => TEST_DATE },
  });
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('MinimaxSpeechModel', () => {
  it('has v3 spec and provider', () => {
    const model = makeModel(async () => jsonResponse({}));
    expect(model.specificationVersion).toBe('v3');
    expect(model.provider).toBe('minimax.speech');
    expect(model.modelId).toBe('speech-2.6-hd');
  });

  it('maps text/voice/speed/format, forces hex, decodes audio to bytes', async () => {
    let captured: any;
    const model = makeModel(async (_url, init) => {
      captured = JSON.parse((init as RequestInit).body as string);
      return jsonResponse({
        data: { audio: '48656c6c6f', status: 2 },
        extra_info: { audio_length: 1000, audio_sample_rate: 32000 },
        base_resp: { status_code: 0, status_msg: 'success' },
      });
    });

    const result = await model.doGenerate({
      text: 'Hello',
      voice: 'female-1',
      outputFormat: 'wav',
      speed: 1.2,
      providerOptions: {},
    });

    expect(captured.model).toBe('speech-2.6-hd');
    expect(captured.text).toBe('Hello');
    expect(captured.voice_setting.voice_id).toBe('female-1');
    expect(captured.voice_setting.speed).toBe(1.2);
    expect(captured.audio_setting.format).toBe('wav');
    expect(captured.output_format).toBe('hex');
    expect(captured.stream).toBe(false);
    expect(result.audio).toBeInstanceOf(Uint8Array);
    expect(Array.from(result.audio as Uint8Array)).toEqual([
      0x48, 0x65, 0x6c, 0x6c, 0x6f,
    ]);
    expect(result.response.modelId).toBe('speech-2.6-hd');
    expect(result.response.timestamp).toEqual(TEST_DATE);
    expect(result.providerMetadata?.minimax).toMatchObject({
      audio_length: 1000,
      audio_sample_rate: 32000,
    });
  });

  it('uses the default voice_id when voice is omitted', async () => {
    let captured: any;
    const model = makeModel(async (_url, init) => {
      captured = JSON.parse((init as RequestInit).body as string);
      return jsonResponse({
        data: { audio: '00' },
        base_resp: { status_code: 0 },
      });
    });

    await model.doGenerate({ text: 'hi', providerOptions: {} });
    expect(captured.voice_setting.voice_id).toBe('male-qn-qingse');
  });

  it('maps provider options into voice_setting and audio_setting', async () => {
    let captured: any;
    const model = makeModel(async (_url, init) => {
      captured = JSON.parse((init as RequestInit).body as string);
      return jsonResponse({
        data: { audio: '00' },
        base_resp: { status_code: 0 },
      });
    });

    await model.doGenerate({
      text: 'hi',
      providerOptions: {
        minimax: { emotion: 'happy', vol: 5, sampleRate: 32000, channel: 2 },
      },
    });

    expect(captured.voice_setting.emotion).toBe('happy');
    expect(captured.voice_setting.vol).toBe(5);
    expect(captured.audio_setting.sample_rate).toBe(32000);
    expect(captured.audio_setting.channel).toBe(2);
  });

  it('throws on a non-zero base_resp', async () => {
    const model = makeModel(async () =>
      jsonResponse({ base_resp: { status_code: 2013, status_msg: 'invalid params' } }),
    );

    await expect(
      model.doGenerate({ text: 'hi', providerOptions: {} }),
    ).rejects.toThrow(/invalid params/);
  });

  it('maps an ISO language code to language_boost', async () => {
    let captured: any;
    const model = makeModel(async (_url, init) => {
      captured = JSON.parse((init as RequestInit).body as string);
      return jsonResponse({
        data: { audio: '00' },
        base_resp: { status_code: 0 },
      });
    });

    await model.doGenerate({ text: 'hi', language: 'en', providerOptions: {} });
    expect(captured.language_boost).toBe('English');
  });

  it('warns and omits language_boost for an unsupported language code', async () => {
    let captured: any;
    const model = makeModel(async (_url, init) => {
      captured = JSON.parse((init as RequestInit).body as string);
      return jsonResponse({
        data: { audio: '00' },
        base_resp: { status_code: 0 },
      });
    });

    const result = await model.doGenerate({
      text: 'hi',
      language: 'xx',
      providerOptions: {},
    });
    expect(captured.language_boost).toBeUndefined();
    expect(
      result.warnings.some(w => w.type === 'unsupported' && w.feature === 'language'),
    ).toBe(true);
  });

  it('warns when unsupported instructions are provided', async () => {
    const model = makeModel(async () =>
      jsonResponse({ data: { audio: '00' }, base_resp: { status_code: 0 } }),
    );

    const result = await model.doGenerate({
      text: 'hi',
      instructions: 'speak slowly',
      providerOptions: {},
    });
    expect(
      result.warnings.some(
        w => w.type === 'unsupported' && w.feature === 'instructions',
      ),
    ).toBe(true);
  });
});
