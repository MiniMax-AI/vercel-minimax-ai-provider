import { z } from 'zod/v4';

// https://platform.minimaxi.com/docs/api-reference/speech-t2a-http
export type MinimaxSpeechModelId =
  | 'speech-2.8-hd'
  | 'speech-2.8-turbo'
  | 'speech-2.6-hd'
  | 'speech-2.6-turbo'
  | 'speech-02-hd'
  | 'speech-02-turbo'
  | (string & {});

/** API requires a voice_id; used when the caller does not pass `voice`. */
export const DEFAULT_MINIMAX_VOICE_ID = 'male-qn-qingse';

export const minimaxSpeechProviderOptions = z.object({
  /** Volume, range (0, 10]. */
  vol: z.number().optional(),
  /** Pitch, range [-12, 12]. */
  pitch: z.number().optional(),
  /**
   * Emotion. One of: "happy", "sad", "angry", "fearful", "disgusted",
   * "surprised", "calm" (neutral), "fluent", "whisper". Note: "fluent" and
   * "whisper" are only supported by some models.
   */
  emotion: z.string().optional(),
  /** Output sample rate in Hz, e.g. 32000. */
  sampleRate: z.number().optional(),
  /** Output bitrate, e.g. 128000. */
  bitrate: z.number().optional(),
  /** Channels: 1 (mono) or 2 (stereo). */
  channel: z.number().optional(),
  /** Custom pronunciation rules. */
  pronunciationDict: z.record(z.string(), z.unknown()).optional(),
});

export type MinimaxSpeechProviderOptions = z.infer<
  typeof minimaxSpeechProviderOptions
>;
