import { z } from 'zod';

const MAX_NAME_LENGTH = 60;
const MAX_QUERY_LENGTH = 2000;

export const createChartPresetSchema = z.object({
  name: z
    .string({ error: 'must be a string' })
    .refine(value => value.trim().length > 0 && value.trim().length <= MAX_NAME_LENGTH, {
      error: `is required, and at most ${MAX_NAME_LENGTH} characters`,
    }),
  query: z.string({ error: 'must be a string' }).refine(value => value.length > 0 && value.length <= MAX_QUERY_LENGTH, {
    error: `is required, and at most ${MAX_QUERY_LENGTH} characters`,
  }),
  device_type: z.string().optional(),
});

export type CreateChartPreset = z.infer<typeof createChartPresetSchema>;
