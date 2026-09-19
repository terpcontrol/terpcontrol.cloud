import { z } from 'zod';

const required = (name: string) => z.string({ error: `${name} is required` }).min(1, { error: `${name} is required` });

/**
 * What the server cannot serve a single request without: somewhere to store
 * things, something to sign tokens with, the account it seeds itself with, and
 * the address it publishes. Everything else stays optional, as it was - a
 * deployment that has never set SMTP still starts, and only mailing fails.
 *
 * `PORT` is checked because a non-numeric one used to bind to a random port
 * instead of failing.
 */
const environmentSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    // Digits, not "anything Number() will take": `Number(' ')` is 0, so a
    // stray space would have passed and bound an arbitrary free port.
    PORT: z
      .string()
      .optional()
      .refine(value => value === undefined || value === '' || /^\d+$/.test(value), { error: 'PORT must be a number' }),

    DB_HOST: required('DB_HOST'),
    DB_PORT: required('DB_PORT'),
    DB_DATABASE: required('DB_DATABASE'),

    SECRET_KEY: required('SECRET_KEY'),

    // The address this install publishes. It used to be optional, and the share
    // card fell back to the `Host` header of whatever request arrived - so on an
    // install that left it unset, a chosen `Host` put an attacker's address into
    // the `og:image`, `og:url` and `canonical` of every public diary. A link
    // that is handed out has to say where it leads, and only the install knows.
    API_URL_EXTERNAL: required('API_URL_EXTERNAL'),

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
