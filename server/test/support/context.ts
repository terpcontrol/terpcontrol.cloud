import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Where globalSetup hands the running stack over to the worker processes. */
export const CONTEXT_FILE = join(__dirname, '..', '.tmp', 'context.json');

export type Target = 'legacy' | 'nest';

export interface HarnessContext {
  /** Base URL of the API under test, e.g. http://127.0.0.1:34567 */
  baseUrl: string;
  /** Control plane of the fake InfluxDB and SMTP servers. */
  controlUrl: string;
  mongoUri: string;
  mqttPort: number;
  target: Target;
  /** Credentials the bootstrapped admin account is created with. */
  admin: { username: string; password: string };
  /** Shared secret the RabbitMQ auth endpoints expect. */
  mqttAuthSecret: string;
  /** Token that authorises the automation-only endpoints. */
  automationToken: string;
  selfRegistrationPassword: string;
}

export const writeContext = (context: HarnessContext): void => {
  mkdirSync(dirname(CONTEXT_FILE), { recursive: true });
  writeFileSync(CONTEXT_FILE, JSON.stringify(context, null, 2));
};

export const readContext = (): HarnessContext => {
  try {
    return JSON.parse(readFileSync(CONTEXT_FILE, 'utf8'));
  } catch {
    throw new Error(`No harness context at ${CONTEXT_FILE}. Run the suite through jest so globalSetup starts the stack.`);
  }
};
