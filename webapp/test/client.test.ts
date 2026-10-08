import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';

/**
 * The query a route is called with. A list goes out as its name repeated, which
 * is how the series routes read one: written once with commas, or as its last
 * value only, every chart would ask for one line or none.
 */

vi.mock('@/api/session', async importOriginal => ({
  ...(await importOriginal<object>()),
  session: { validToken: async () => 'token', refresh: async () => null, snapshot: () => null },
}));

const fetchStub = vi.fn(async (_input: RequestInfo | URL) => new Response('{}', { status: 200 }));

beforeEach(() => vi.stubGlobal('fetch', fetchStub));

afterEach(() => {
  vi.unstubAllGlobals();
  fetchStub.mockClear();
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
