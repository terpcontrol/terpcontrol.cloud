import { z } from 'zod';

export const loginSchema = z
  .object({
    username: z.string({ error: 'must be a string' }),
    password: z.string({ error: 'must be a string' }),
    stayLoggedIn: z.boolean().optional(),
  })
  .strict();

export const signupSchema = z
  .object({
    username: z.string({ error: 'must be a string' }),
    password: z.string({ error: 'must be a string' }),
  })
  .strict();

export const activationSchema = z.object({ activation_code: z.string({ error: 'must be a string' }) }).strict();

export const passwordResetSchema = z
  .object({
    password: z.string({ error: 'must be a string' }),
    token: z.string({ error: 'must be a string' }),
  })
  .strict();

export type Login = z.infer<typeof loginSchema>;
export type Signup = z.infer<typeof signupSchema>;
export type Activation = z.infer<typeof activationSchema>;
export type PasswordReset = z.infer<typeof passwordResetSchema>;
