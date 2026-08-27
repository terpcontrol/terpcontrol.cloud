import { z } from 'zod';
import { SharePage } from '@fg2/shared-types';

const SHARE_PAGES = ['charts', 'diary'] as const satisfies readonly SharePage[];

export const createShareSchema = z.object({
  device_id: z.string({ error: 'is required' }).min(1, { error: 'is required' }),
  page: z.enum(SHARE_PAGES, { error: `must be one of ${SHARE_PAGES.join(', ')}` }),
  editable: z.boolean().optional(),
  webcam: z.boolean().optional(),
  charts: z.boolean().optional(),
  /** Epoch milliseconds; null or absent means the link never expires. */
  expires_at: z.union([z.number(), z.string(), z.null()]).optional(),
  /** Kept as sent, but stored truncated rather than refused. */
  query: z.string().optional(),
});

export type CreateShare = z.infer<typeof createShareSchema>;
