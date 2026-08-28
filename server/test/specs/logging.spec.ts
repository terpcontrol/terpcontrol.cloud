import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAccount, Session, unique } from '../support/api';
import { registerDevice } from '../support/device';

const LOG_DIR = join(__dirname, '..', '.tmp', 'logs');

/** Everything the server has written this run, debug and error alike. */
const logContents = (): string => {
  const parts: string[] = [];

  for (const level of ['debug', 'error']) {
    const directory = join(LOG_DIR, level);
    for (const file of readdirSync(directory)) {
      if (file.endsWith('.log')) parts.push(readFileSync(join(directory, file), 'utf8'));
    }
  }

  return parts.join('\n');
};

const settle = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms));

let owner: Session;

beforeAll(async () => {
  owner = await createAccount('logging-owner');
});

describe('what the server writes down', () => {
  it('logs the device it registered, not just that it registered one', async () => {
    const device = await registerDevice();

    await settle();

    expect(logContents()).toContain(device.deviceId);
  });

  it('never writes a value it failed to render', async () => {
    // `logger.info('failed:', error)` reaches the file as the message alone,
    // and an object logged on its own as "[object Object]" - both of which lose
    // exactly what somebody reading the log came for.
    const contents = logContents();

    expect(contents).not.toContain('[object Object]');
    expect(contents).not.toMatch(/^\S+ \S+ \w+: \s*$/m);
  });

  it('keeps the detail of a message that carries one', async () => {
    // The access log is the highest-volume line the server writes, and the
    // path is the part of it that has to be there.
    const path = `/device/logs/${unique('never-a-device')}`;
    await owner.client.get(path).expect(403);

    await settle();

    expect(logContents()).toContain(path);
  });
});
