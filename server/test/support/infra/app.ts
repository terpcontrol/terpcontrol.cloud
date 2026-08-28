import { ChildProcess, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export const SERVER_ROOT = join(__dirname, '..', '..', '..');
const LOG_DIR = join(SERVER_ROOT, 'test', '.tmp', 'logs');

// The image endpoints shell out to ffmpeg, and what they run it with - and what
// they make of what it answers - is not visible through HTTP. The app finds a
// shim first on its PATH: it records every run and hands it to the real ffmpeg,
// unless a spec has armed one. See support/ffmpeg.ts.
const FFMPEG_BIN_DIR = join(SERVER_ROOT, 'test', 'support', 'infra', 'fake-bin');
const FFMPEG_STATE_DIR = join(SERVER_ROOT, 'test', '.tmp', 'ffmpeg');

export interface AppEnvironment {
  port: number;
  mongoUri: string;
  mqttHost: string;
  mqttPort: number;
  influxUrl: string;
  smtpPort: number;
  admin: { username: string; password: string };
  mqttAuthSecret: string;
  automationToken: string;
  selfRegistrationPassword: string;
}

/**
 * The suite normally runs the sources through ts-node. HARNESS_BUILT=1 runs the
 * compiled output instead, which is what the container ships - the swc build
 * has its own decorator and path handling, and a suite that never exercises it
 * would not notice it breaking.
 */
const entryPoint = () =>
  process.env.HARNESS_BUILT === '1'
    ? { script: 'dist/main.js', nodeArgs: [] as string[] }
    : { script: 'src/main.ts', nodeArgs: ['-r', 'ts-node/register/transpile-only', '-r', 'tsconfig-paths/register'] };

export const buildEnv = (environment: AppEnvironment): NodeJS.ProcessEnv => {
  const mongo = new URL(environment.mongoUri);

  return {
    ...process.env,
    PATH: `${FFMPEG_BIN_DIR}${delimiter}${process.env.PATH ?? ''}`,
    HARNESS_FFMPEG_STATE: FFMPEG_STATE_DIR,
    // Production keeps mongoose's query debug logging off; the suite is loud enough.
    NODE_ENV: 'production',
    PORT: String(environment.port),
    API_URL_EXTERNAL: `http://127.0.0.1:${environment.port}`,

    DB_HOST: mongo.hostname,
    DB_PORT: mongo.port,
    DB_DATABASE: 'terpcontrol_test',
    DB_USER: decodeURIComponent(mongo.username),
    DB_PASSWORD: decodeURIComponent(mongo.password),

    INFLUXDB_URL: environment.influxUrl,
    INFLUXDB_HOST: '127.0.0.1',
    INFLUXDB_TOKEN: 'test-influx-token',
    INFLUXDB_ORG: 'test-org',
    INFLUXDB_BUCKET: 'test-bucket',

    MQTT_URL: environment.mqttHost,
    MQTT_PORT: String(environment.mqttPort),

    SECRET_KEY: 'integration-test-secret-key',
    AUTOMATION_TOKEN: environment.automationToken,
    MQTTAUTH_SHARED_SECRET: environment.mqttAuthSecret,

    ENABLE_SELF_REGISTRATION: 'true',
    SELF_REGISTRATION_PASSWORD: environment.selfRegistrationPassword,
    REQUIRE_ACTIVATION: 'false',
    ADMINUSER_USERNAME: environment.admin.username,
    ADMINUSER_PASSWORD: environment.admin.password,

    SMTP_SENDER: 'noreply@test.invalid',
    SMTP_SERVER: '127.0.0.1',
    SMTP_PORT: String(environment.smtpPort),
    SMTP_SECURE: 'false',
    SMTP_USER: 'smtp-test-user',
    SMTP_PASSWORD: 'smtp-test-password',

    // Left on so the access log runs during the suite; the server's own output
    // is only printed with HARNESS_VERBOSE=1.
    LOG_FORMAT: 'combined',
    LOG_DIR,
  };
};

export interface RunningApp {
  process: ChildProcess;
  baseUrl: string;
  stop: () => Promise<void>;
}

const waitForHealthy = async (baseUrl: string, child: ChildProcess, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'never responded';

  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`App under test exited with code ${child.exitCode} before becoming healthy`);
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok) return;
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = String((error as Error).message ?? error);
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  throw new Error(`App under test never became healthy on ${baseUrl}: ${lastError}`);
};

export const startApp = async (environment: AppEnvironment): Promise<RunningApp> => {
  mkdirSync(LOG_DIR, { recursive: true });
  mkdirSync(FFMPEG_STATE_DIR, { recursive: true });

  const entry = entryPoint();
  const child = spawn('node', [...entry.nodeArgs, entry.script], {
    cwd: SERVER_ROOT,
    env: buildEnv(environment),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const verbose = process.env.HARNESS_VERBOSE === '1';
  const prefix = '[app]';
  child.stdout.on('data', chunk => verbose && process.stdout.write(`${prefix} ${chunk}`));
  child.stderr.on('data', chunk => process.stderr.write(`${prefix} ${chunk}`));

  const baseUrl = `http://127.0.0.1:${environment.port}`;
  await waitForHealthy(baseUrl, child, 120_000);

  return {
    process: child,
    baseUrl,
    // Asked to stop the way a container is, so the shutdown path runs at least
    // once per suite; killed outright only if it will not go.
    stop: () =>
      new Promise<void>(resolve => {
        if (child.exitCode !== null) return resolve();

        const forced = setTimeout(() => child.kill('SIGKILL'), 5_000);
        child.once('exit', () => {
          clearTimeout(forced);
          resolve();
        });
        child.kill('SIGTERM');
      }),
  };
};
