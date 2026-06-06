import { APICallError } from '@ai-sdk/provider';
import { loadApiKey, withUserAgentSuffix } from '@ai-sdk/provider-utils';

/**
 * Builds the `Authorization: Bearer <key>` headers used by MiniMax's OpenAI-compatible
 * chat endpoint and all native media (`/v1`) endpoints. (The Anthropic-compatible chat
 * endpoint uses `x-api-key` instead and does not go through this.)
 */
export function createBearerHeaders(options: {
  apiKey?: string;
  headers?: Record<string, string>;
}): () => Record<string, string | undefined> {
  return () =>
    withUserAgentSuffix(
      {
        Authorization: `Bearer ${loadApiKey({
          apiKey: options.apiKey,
          environmentVariableName: 'MINIMAX_API_KEY',
          description: 'MiniMax API key',
        })}`,
        ...options.headers,
      },
      `minimax-ai-provider`,
    );
}

/**
 * MiniMax base_resp envelope. status_code === 0 means success; any other value is a
 * business-layer error returned with HTTP 200.
 */
export interface MinimaxBaseResp {
  status_code?: number | string | null;
  status_msg?: string | null;
}

/**
 * Decodes a hex-encoded string into bytes. Edge-runtime safe (no Node Buffer):
 * the speech API returns audio as hex, and tests run under edge-runtime too.
 */
export function hexToUint8Array(hex: string): Uint8Array {
  const length = hex.length >> 1;
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Speech/image/video endpoints all live under `…/v1`. The anthropic-compatible
 * provider uses `…/anthropic/v1` for chat; strip the `/anthropic` segment so the
 * non-LLM models hit the right host.
 */
export function deriveV1BaseURL(baseURL: string): string {
  return baseURL.replace(/\/anthropic(\/v1)?$/, '$1');
}

/**
 * MiniMax video resolution is a label ("768P"/"1080P"), not WxH. Map a
 * `${w}x${h}` size to the nearest supported label. Returns `undefined` for an
 * unrecognized size so the caller can warn and omit it (the API only accepts
 * the documented labels, so forwarding a raw `WxH` string would be rejected).
 *
 * Note: the Hailuo models support 768P and 1080P; 720p inputs map to 768P.
 */
const RESOLUTION_MAP: Record<string, string> = {
  '1920x1080': '1080P',
  '1080x1920': '1080P',
  '1366x768': '768P',
  '768x1366': '768P',
  '1280x720': '768P',
  '720x1280': '768P',
};

export function mapVideoResolution(size: string): string | undefined {
  return RESOLUTION_MAP[size];
}

/**
 * MiniMax's `language_boost` expects full English language names (e.g. "English",
 * "Chinese") or "auto", whereas the AI SDK `language` field is an ISO 639-1 code
 * (e.g. "en", "zh") or "auto". Map common ISO codes to MiniMax names. Returns
 * `undefined` for an unknown code so the caller can warn and omit the field.
 */
const LANGUAGE_BOOST_MAP: Record<string, string> = {
  auto: 'auto',
  zh: 'Chinese',
  yue: 'Chinese,Yue',
  en: 'English',
  ar: 'Arabic',
  ru: 'Russian',
  es: 'Spanish',
  fr: 'French',
  pt: 'Portuguese',
  de: 'German',
  tr: 'Turkish',
  nl: 'Dutch',
  uk: 'Ukrainian',
  vi: 'Vietnamese',
  id: 'Indonesian',
  ja: 'Japanese',
  it: 'Italian',
  ko: 'Korean',
  th: 'Thai',
  pl: 'Polish',
  ro: 'Romanian',
  el: 'Greek',
  cs: 'Czech',
  fi: 'Finnish',
  hi: 'Hindi',
  bg: 'Bulgarian',
  da: 'Danish',
  he: 'Hebrew',
  ms: 'Malay',
  fa: 'Persian',
  sk: 'Slovak',
  sv: 'Swedish',
  hr: 'Croatian',
  fil: 'Filipino',
  tl: 'Filipino',
  hu: 'Hungarian',
  no: 'Norwegian',
  nb: 'Norwegian',
  sl: 'Slovenian',
  ca: 'Catalan',
  nn: 'Nynorsk',
  ta: 'Tamil',
  af: 'Afrikaans',
};

export function mapLanguageBoost(language: string): string | undefined {
  if (language === 'auto') return 'auto';
  return LANGUAGE_BOOST_MAP[language.toLowerCase()];
}

/**
 * Throws an APICallError if the MiniMax base_resp reports a non-zero status_code.
 * MiniMax returns business errors with HTTP 200, so the standard failed-response
 * handler never sees them.
 */
export function checkMinimaxBaseResp(
  baseResp: MinimaxBaseResp | undefined | null,
  context: { url: string; requestBodyValues: unknown; responseBody?: string },
): void {
  if (baseResp == null) return;
  // MiniMax may serialize status_code as a number or a string; coerce so "0"
  // is treated as success, not a spurious error.
  if (baseResp.status_code != null && Number(baseResp.status_code) !== 0) {
    throw new APICallError({
      message: baseResp.status_msg ?? `MiniMax error ${baseResp.status_code}`,
      url: context.url,
      requestBodyValues: context.requestBodyValues,
      responseBody: context.responseBody,
      data: baseResp,
      isRetryable: false,
    });
  }
}
