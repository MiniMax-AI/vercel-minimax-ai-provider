import { z } from 'zod/v4';

// https://platform.minimaxi.com/docs/api-reference/video-generation-t2v
// Note: MiniMax-Hailuo-2.3-Fast is image-to-video ONLY (not valid for text-to-video).
export type MinimaxVideoModelId =
  | 'MiniMax-Hailuo-2.3'
  | 'MiniMax-Hailuo-2.3-Fast'
  | 'MiniMax-Hailuo-02'
  | (string & {});

export const DEFAULT_VIDEO_POLL_INTERVAL_MS = 5000;
export const DEFAULT_VIDEO_POLL_TIMEOUT_MS = 600000; // 10 minutes

export const minimaxVideoProviderOptions = z.object({
  /** Enable automatic prompt enhancement. MiniMax video default: true. */
  promptOptimizer: z.boolean().optional(),
  /** Faster pre-processing at some quality cost. */
  fastPretreatment: z.boolean().optional(),
  /** Add an AIGC watermark. */
  aigcWatermark: z.boolean().optional(),
  /** Async completion callback URL. */
  callbackUrl: z.string().optional(),
  /**
   * MiniMax resolution label, sent verbatim. Use this for exact control over the
   * documented labels ('512P' | '768P' | '1080P'; '512P' is MiniMax-Hailuo-02 only).
   * Takes precedence over the SDK `resolution` (WxH) call option.
   */
  resolution: z.string().optional(),
  /** Poll interval in ms while waiting for the video. Default 5000. */
  pollIntervalMs: z.number().positive().optional(),
  /** Poll timeout in ms before giving up. Default 600000. */
  pollTimeoutMs: z.number().positive().optional(),
});

export type MinimaxVideoProviderOptions = z.infer<
  typeof minimaxVideoProviderOptions
>;
