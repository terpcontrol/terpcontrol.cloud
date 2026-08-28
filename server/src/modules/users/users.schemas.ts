import { z } from 'zod';

/**
 * Unknown properties are refused rather than ignored, so a client that misnames
 * a field hears about it instead of silently not setting it.
 */
export const createUserSchema = z
  .object({
    username: z.string({ error: 'must be a string' }),
    password: z.string({ error: 'must be a string' }),
    is_admin: z.boolean({ error: 'must be a boolean' }),
  })
  .strict();

/** The same fields, all optional: an update may carry only what it changes. */
export const updateUserSchema = createUserSchema.partial();

export type CreateUser = z.infer<typeof createUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
