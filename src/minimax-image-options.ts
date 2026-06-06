import { z } from 'zod/v4';

// https://platform.minimaxi.com/docs/api-reference/image-generation-t2i
export type MinimaxImageModelId = 'image-01' | 'image-01-live' | (string & {});

/** A single subject reference entry for image-to-image (subject_reference). */
export const minimaxSubjectReference = z.object({
  type: z.literal('character'),
  image_file: z.string(),
});

export const minimaxImageProviderOptions = z.object({
  /** Enable automatic prompt enhancement. MiniMax default: false. */
  promptOptimizer: z.boolean().optional(),
  /** Add an AIGC watermark to generated images. */
  aigcWatermark: z.boolean().optional(),
  /** Style controls (image-01-live only). */
  style: z
    .object({
      style_type: z.string().optional(),
      style_weight: z.number().optional(),
    })
    .optional(),
  /** Subject reference for image-to-image. Array of {type:'character', image_file}. */
  subjectReference: z.array(minimaxSubjectReference).optional(),
});

export type MinimaxImageProviderOptions = z.infer<
  typeof minimaxImageProviderOptions
>;
