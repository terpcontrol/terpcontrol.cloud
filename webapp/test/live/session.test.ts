import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DevicePage } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { API_URL } from '@/api/config';
import { session } from '@/api/session';

/**
 * The scaffold's proof: the session the API expects and one read through it,
 * exercised by the app's own client rather than by a hand-written request.
 *
 * It needs the stack from this checkout to be up, which is why it is not part
 * of `npm test`. The credentials are the ones the rest of the tooling uses.
 */
const credential = (key: string): string => {
  const line = readFileSync(new URL('../../../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .find(entry => entry.startsWith(`${key}=`));
  if (!line) throw new Error(`${key} missing from ../.env`);
  return line.slice(key.length + 1).trim();
};

describe(`the live stack at ${API_URL}`, () => {
  beforeAll(async () => {
    const response = await fetch(`${API_URL}/healthz`).catch(() => null);
    if (!response?.ok) throw new Error(`no stack at ${API_URL} - bring it up with docker compose`);
  });

  it('signs in and reads the devices', async () => {
    const user = await session.logIn({ email: credential('AGENT_TESTING_USERNAME'), password: credential('AGENT_TESTING_PASSWORD') });
    expect(user.handle).toBeTruthy();

    const tokens = session.snapshot().tokens;
    expect(tokens?.userToken).toBeTruthy();
    // Pictures need their own token, which the sign-in answers with.
    expect(tokens?.mediaToken).toBeTruthy();

    const devices = await api.get<DevicePage>('/devices');
    expect(Array.isArray(devices.items)).toBe(true);
    expect(devices.items.length).toBeGreaterThan(0);
    for (const device of devices.items) {
      expect(typeof device.id).toBe('string');
      expect(typeof device.type).toBe('string');
    }
  });

  it('refreshes the bearer token without signing in again', async () => {
    const before = session.snapshot().tokens;
    const after = await session.refresh(before?.refreshToken);
    expect(after?.userToken).toBeTruthy();
    expect(after?.userToken).not.toBe(before?.userToken);

    await api.get<DevicePage>('/devices');
  });
});
