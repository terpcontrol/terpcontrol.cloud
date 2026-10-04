import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CameraPage, DevicePage, MediaPage } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { API_URL, v1 } from '@/api/config';
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

  it('refreshes the bearer token without signing in again, and leaves the media token alone', async () => {
    const before = session.snapshot().tokens;
    const after = await session.refresh(before?.refreshToken);
    expect(after?.userToken).toBeTruthy();
    expect(after?.userToken).not.toBe(before?.userToken);
    // The one a picture's URL carries, which is why it must not move: a new
    // one rewrites every <img> on screen and the browser fetches again what it
    // already has.
    expect(after?.mediaToken).toBe(before?.mediaToken);

    await api.get<DevicePage>('/devices');
  });

  /**
   * The half of that rule only a real server can settle. Keeping the token is
   * worth nothing if the server stops taking it, and nothing in the unit suite
   * can say whether it does - so this asks the running one, with the token the
   * session held before its last renewal and no other credential at all.
   */
  it('still serves a picture asked for with a media token from before the refresh', async ctx => {
    const mediaId = await someMediaId();
    // Said out loud rather than passing quietly: a stack whose cameras have
    // taken nothing cannot answer this, and a green tick would claim it did.
    if (!mediaId) return ctx.skip('no camera on this stack has taken a picture yet');

    const token = session.snapshot().tokens?.mediaToken;
    expect(token).toBeTruthy();
    await session.refresh(session.snapshot().tokens?.refreshToken);

    // No cookie and no Authorization header: the query token is the whole proof.
    const answer = await fetch(v1(`/media/${mediaId}/content?token=${encodeURIComponent(token!)}`));
    expect(answer.status).toBe(200);
  });
});

/** A picture this account may read, or null on a stack whose cameras have taken none. */
const someMediaId = async (): Promise<string | null> => {
  const cameras = await api.get<CameraPage>('/cameras');
  for (const camera of cameras.items) {
    const frames = await api.get<MediaPage>(`/cameras/${camera.id}/frames`, { limit: 1 });
    const frame = frames.items[0];
    if (frame) return frame.id;
  }
  return null;
};
