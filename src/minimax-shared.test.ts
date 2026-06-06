import { describe, it, expect } from 'vitest';
import {
  hexToUint8Array,
  deriveV1BaseURL,
  mapVideoResolution,
  mapLanguageBoost,
  checkMinimaxBaseResp,
} from './minimax-shared';
import { APICallError } from '@ai-sdk/provider';

describe('hexToUint8Array', () => {
  it('decodes a hex string to bytes', () => {
    const bytes = hexToUint8Array('48656c6c6f');
    expect(Array.from(bytes)).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
  });

  it('handles an uppercase hex string', () => {
    const bytes = hexToUint8Array('FF00A1');
    expect(Array.from(bytes)).toEqual([0xff, 0x00, 0xa1]);
  });

  it('returns empty for empty input', () => {
    expect(hexToUint8Array('').length).toBe(0);
  });
});

describe('deriveV1BaseURL', () => {
  it('strips a trailing /anthropic/v1 down to /v1', () => {
    expect(deriveV1BaseURL('https://api.minimax.io/anthropic/v1')).toBe(
      'https://api.minimax.io/v1',
    );
  });

  it('leaves a plain /v1 base unchanged', () => {
    expect(deriveV1BaseURL('https://api.minimax.io/v1')).toBe(
      'https://api.minimax.io/v1',
    );
  });
});

describe('mapVideoResolution', () => {
  it('maps 1080p sizes to "1080P"', () => {
    expect(mapVideoResolution('1920x1080')).toBe('1080P');
    expect(mapVideoResolution('1080x1920')).toBe('1080P');
  });

  it('maps 768p sizes to "768P"', () => {
    expect(mapVideoResolution('1366x768')).toBe('768P');
    expect(mapVideoResolution('768x1366')).toBe('768P');
  });

  it('maps 720p sizes to "768P" (MiniMax has no 720P label for Hailuo models)', () => {
    expect(mapVideoResolution('1280x720')).toBe('768P');
    expect(mapVideoResolution('720x1280')).toBe('768P');
  });

  it('returns undefined for an unrecognized size', () => {
    expect(mapVideoResolution('640x640')).toBeUndefined();
  });
});

describe('mapLanguageBoost', () => {
  it('maps ISO 639-1 codes to MiniMax language names', () => {
    expect(mapLanguageBoost('en')).toBe('English');
    expect(mapLanguageBoost('zh')).toBe('Chinese');
    expect(mapLanguageBoost('ja')).toBe('Japanese');
  });

  it('maps the full documented language set, including aliases', () => {
    expect(mapLanguageBoost('yue')).toBe('Chinese,Yue');
    expect(mapLanguageBoost('sv')).toBe('Swedish');
    expect(mapLanguageBoost('fa')).toBe('Persian');
    expect(mapLanguageBoost('fil')).toBe('Filipino');
    expect(mapLanguageBoost('tl')).toBe('Filipino');
    expect(mapLanguageBoost('nb')).toBe('Norwegian');
    expect(mapLanguageBoost('af')).toBe('Afrikaans');
  });

  it('is case-insensitive', () => {
    expect(mapLanguageBoost('EN')).toBe('English');
  });

  it('passes through "auto"', () => {
    expect(mapLanguageBoost('auto')).toBe('auto');
  });

  it('returns undefined for an unknown code', () => {
    expect(mapLanguageBoost('xx')).toBeUndefined();
  });
});

describe('checkMinimaxBaseResp', () => {
  it('does not throw when status_code is 0', () => {
    expect(() =>
      checkMinimaxBaseResp(
        { status_code: 0, status_msg: 'success' },
        { url: 'https://x', requestBodyValues: {} },
      ),
    ).not.toThrow();
  });

  it('throws APICallError when status_code is non-zero', () => {
    expect(() =>
      checkMinimaxBaseResp(
        { status_code: 1004, status_msg: 'auth failed' },
        { url: 'https://x', requestBodyValues: {} },
      ),
    ).toThrow(APICallError);
  });

  it('does not throw when status_code is the string "0"', () => {
    expect(() =>
      checkMinimaxBaseResp(
        { status_code: '0', status_msg: 'success' },
        { url: 'https://x', requestBodyValues: {} },
      ),
    ).not.toThrow();
  });

  it('throws when status_code is a non-zero string', () => {
    expect(() =>
      checkMinimaxBaseResp(
        { status_code: '1004', status_msg: 'auth failed' },
        { url: 'https://x', requestBodyValues: {} },
      ),
    ).toThrow(APICallError);
  });

  it('does not throw when base_resp is missing', () => {
    expect(() =>
      checkMinimaxBaseResp(undefined, { url: 'https://x', requestBodyValues: {} }),
    ).not.toThrow();
  });
});
