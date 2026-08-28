import { z } from 'zod';

const required = (name: string) => z.string({ error: `${name} is required` }).min(1, { error: `${name} is required` });

/**
 * What the server cannot serve a single request without: somewhere to store
 * things, something to sign tokens with, and the account it seeds itself with.
 * Everything else stays optional, as it was - a deployment that has never set
 * SMTP still starts, and only mailing fails.
 *
 * `PORT` is checked because a non-numeric one used to bind to a random port
 * instead of failing.
 */
const environmentSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    PORT: z
      .string()
      .optional()
      .refine(value => value === undefined || value === '' || Number.isInteger(Number(value)), { error: 'PORT must be a number' }),

    DB_HOST: required('DB_HOST'),
    DB_PORT: required('DB_PORT'),
    DB_DATABASE: required('DB_DATABASE'),

    SECRET_KEY: required('SECRET_KEY'),

    // The logger creates this directory as it is built, which happens before
    // anything here runs - so without it the process dies on a path of
    // `undefined` rather than on a sentence naming the setting.
    LOG_DIR: required('LOG_DIR'),

    ADMINUSER_USERNAME: required('ADMINUSER_USERNAME'),
    ADMINUSER_PASSWORD: required('ADMINUSER_PASSWORD'),
  })
  .loose();

/**
 * Handed to `ConfigModule.forRoot`, which calls it before anything is
 * constructed - so a missing setting is a refusal to start with a list of what
 * is missing, rather than a failure on the first request that needs it.
 */
export const validateEnvironment = (environment: Record<string, unknown>): Record<string, unknown> => {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    const reasons = [...new Set(result.error.issues.map(issue => issue.message))];
    throw new Error(`Cannot start: ${reasons.join(', ')}`);
  }

  return environment;
};
