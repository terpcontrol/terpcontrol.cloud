import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { context } from '../support/api';

const SERVER_ROOT = join(__dirname, '..', '..');

const entryPoint = () =>
  process.env.HARNESS_BUILT === '1'
    ? { script: 'dist/main.js', nodeArgs: [] as string[] }
    : { script: 'src/main.ts', nodeArgs: ['-r', 'ts-node/register/transpile-only', '-r', 'tsconfig-paths/register'] };

interface Outcome {
  code: number | null;
  output: string;
}

/** Boots the server, then throws from a timer the way a background loop would. */
const THROW_AFTER_BOOT = (script: string) =>
  `require(${JSON.stringify(`./${script}`)}); setTimeout(() => { throw new Error('a throw nothing is going to catch'); }, 3000);`;

/**
 * Starts a second server with a deliberately broken environment and waits for
 * it to give up. The one the specs talk to is untouched - this only ever gets
 * as far as building the modules, because that is where the environment is read.
 */
const startWith = (overrides: Record<string, string | undefined>): Promise<Outcome> => {
  const entry = entryPoint();
  const environment: NodeJS.ProcessEnv = { ...process.env, ...context.appEnv, ...overrides };

  // Never the port the running server holds - unless the spec is about the port
  // itself, in which case its override stands.
  if (!('PORT' in overrides)) environment.PORT = '0';

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete environment[key];
  }

  const child = spawn('node', [...entry.nodeArgs, entry.script], { cwd: SERVER_ROOT, env: environment });

  return new Promise<Outcome>((resolve, reject) => {
    let output = '';
    const collect = (chunk: Buffer) => (output += chunk.toString());
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`The server neither started nor stopped within 60s. Output:\n${output}`));
    }, 60_000);

    child.on('exit', code => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
};

describe('a throw that reaches nobody', () => {
  jest.setTimeout(90_000);

  it('ends the process, so the supervisor restarts it', async () => {
    // Registering an uncaughtException handler is what stops node ending the
    // process itself, so this checks the handler does it instead - a server
    // left running after one is serving from a state nothing has reasoned about.
    const entry = entryPoint();
    const outcome = await new Promise<Outcome>((resolve, reject) => {
      const child = spawn('node', [...entry.nodeArgs, '-e', THROW_AFTER_BOOT(entry.script)], {
        cwd: SERVER_ROOT,
        env: { ...process.env, ...context.appEnv, PORT: '0' },
      });

      let output = '';
      const collect = (chunk: Buffer) => (output += chunk.toString());
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`The server was still running 60s after the throw. Output:\n${output}`));
      }, 60_000);

      child.on('exit', code => {
        clearTimeout(timer);
        resolve({ code, output });
      });
    });

    expect(outcome.code).toBe(1);
    expect(outcome.output).toContain('a throw nothing is going to catch');
  });
});

describe('starting without the settings the server needs', () => {
  jest.setTimeout(90_000);

  it('refuses to start without a signing key, and says which setting is missing', async () => {
    const outcome = await startWith({ SECRET_KEY: undefined });

    expect(outcome.code).not.toBe(0);
    expect(outcome.output).toContain('SECRET_KEY is required');
  });

  it('names every missing setting at once, rather than the first', async () => {
    const outcome = await startWith({ DB_DATABASE: undefined, ADMINUSER_PASSWORD: undefined });

    expect(outcome.code).not.toBe(0);
    expect(outcome.output).toContain('DB_DATABASE is required');
    expect(outcome.output).toContain('ADMINUSER_PASSWORD is required');
  });

  it('names the log directory, which is read before anything else', async () => {
    const outcome = await startWith({ LOG_DIR: undefined });

    expect(outcome.code).not.toBe(0);
    expect(outcome.output).toContain('LOG_DIR is required');
  });

  it('refuses a port that is not a number', async () => {
    for (const port of ['http', ' ', '80 80', '-1']) {
      const outcome = await startWith({ PORT: port });

      expect(outcome.code).not.toBe(0);
      expect(outcome.output).toContain('PORT must be a number');
    }
  });
});
