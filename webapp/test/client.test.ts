import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';

/**
 * The query a route is called with. A list goes out as its name repeated, which
 * is how the series routes read one: written once with commas, or as its last
 * value only, every chart would ask for one line or none.
 */

const refresh = vi.fn(async () => ({ userToken: 'fresh' }));

vi.mock('@/api/session', async importOriginal => ({
  ...(await importOriginal<object>()),
  session: { validToken: async () => 'token', refresh: () => refresh(), snapshot: () => ({ tokens: { refreshToken: 'refresh' } }) },
}));

const fetchStub = vi.fn(async (_input: RequestInfo | URL) => new Response('{}', { status: 200 }));

beforeEach(() => vi.stubGlobal('fetch', fetchStub));

afterEach(() => {
  vi.unstubAllGlobals();
  fetchStub.mockReset();
  fetchStub.mockImplementation(async () => new Response('{}', { status: 200 }));
  refresh.mockClear();
});

const asked = (): string => String(fetchStub.mock.calls.at(-1)![0]);

describe('the query a route is called with', () => {
  it('writes a list as its name repeated, and leaves out what is not set', async () => {
    await api.get('/x', { metrics: ['temperature', 'humidity'], from: 'a', skip: null, until: undefined });

    expect(asked()).toMatch(/\/v1\/x\?metrics=temperature&metrics=humidity&from=a$/);
  });

  it('adds nothing for an empty list', async () => {
    await api.get('/x', { metrics: [] });

    expect(asked()).toMatch(/\/v1\/x$/);
  });
});

/**
 * A 401 says the token died, and the call is made again behind a fresh one -
 * unless it answers what was typed. A wrong current password asked twice is
 * two failed attempts for one keystroke, and a refresh spent on nothing.
 */
describe('a call the server answers with 401', () => {
  const refused = (code: string) =>
    new Response(JSON.stringify({ status: 401, code, title: 'Unauthorized', detail: '', errors: [] }), { status: 401 });

  it('is made again behind a fresh token when the token was the reason', async () => {
    fetchStub.mockImplementationOnce(async () => refused('token_invalid'));

    await expect(api.put('/me/password', {})).resolves.toEqual({});
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it('is not made again when the password typed was wrong', async () => {
    fetchStub.mockImplementation(async () => refused('current_password_wrong'));

    await expect(api.put('/me/password', {})).rejects.toMatchObject({ problem: { code: 'current_password_wrong' } });
    expect(refresh).not.toHaveBeenCalled();
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});
