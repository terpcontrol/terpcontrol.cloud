import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Alert } from '@fg2/shared-types/v1';
import { clockOffsetMs, fetchedAt, forgetServerClock, noteServerDate, serverNow } from '@/api/clock';
import { Alerts } from '@/screens/Alerts';
import { spaceWhere } from './session';

/**
 * Whose clock the app draws its ages against.
 *
 * Every age on a screen is an instant the server stamped subtracted from
 * "now", so a browser whose own clock is an hour out would add that hour to
 * every one of them: a controller that answered a second ago is called an hour
 * dead, a tent that has been quiet for three days is said to have been quiet
 * for four. The offset between the two clocks is learned from the `Date` header
 * every answer already carries, and what this checks is that it is learned
 * honestly and that the screens read it - a page drawn on a clock an hour fast
 * says what the same page says on a clock that is right.
 */

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return {
    ...(await importOriginal<object>()),
    useSession: () => SIGNED_IN,
    session: { validToken: async () => 'token', refresh: async () => null, snapshot: () => SIGNED_IN, mediaToken: () => null },
  };
});

/** The server's own clock, which every fixture below is dated from and every answer is stamped with. */
const SERVER_NOW = DateTime.fromISO('2026-09-23T00:35:00.000Z', { zone: 'utc' });

/** How far this browser's clock is out in the second half of each pair. */
const SKEW_MS = 3600_000;

const iso = (at: DateTime) => at.toISO()!;

/** An alert about a device that stopped speaking: an age on one line, the instant it began on the next. */
const quietTent: Alert = {
  id: 'alert-1',
  createdAt: iso(SERVER_NOW.minus({ minutes: 27 })),
  ruleId: null,
  deviceId: 'device-1',
  cameraId: null,
  spaceId: 'space-1',
  kind: 'offline',
  severity: 'critical',
  startedAt: iso(SERVER_NOW.minus({ minutes: 27 })),
  resolvedAt: null,
  value: null,
  extremeValue: null,
};

const device = {
  id: 'device-1',
  type: 'controller',
  name: 'Blue Dream tent',
  spaceId: 'space-1',
  // Three days and all but an hour: an hour added to it is a fourth day, which is what a browser an hour fast would draw.
  state: { lastSeenAt: iso(SERVER_NOW.minus({ days: 3, hours: 23 })) },
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    // What the server says its clock reads, to the second, as every HTTP answer does.
    headers: { 'Content-Type': 'application/json', Date: SERVER_NOW.toHTTP()! },
  });

const answer = (path: string): Response => {
  if (path.startsWith('/v1/alerts')) {
    const open = new URL(path, 'http://x').searchParams.get('open') === 'true';
    return json({ items: open ? [quietTent] : [], nextCursor: null });
  }
  if (path === '/v1/spaces') return json({ items: [spaceWhere('own', { id: 'space-1', name: 'Flower room B' })], nextCursor: null });
  if (path === '/v1/devices') return json({ items: [device], nextCursor: null });
  if (path === '/v1/cameras') return json({ items: [], nextCursor: null });
  if (path === '/v1/me') return json({ id: 'user-1', handle: 'you', notifications: { mutedUntil: null } });

  return json({ items: [], nextCursor: null });
};

const draw = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Alerts />
      </MemoryRouter>
    </QueryClientProvider>,
  );

/** The one card, once the reads behind it have landed: the whole of what a reader is told about the quiet tent. */
const inbox = async (): Promise<string> => {
  const card = await screen.findByText((_, node) => node?.tagName === 'LI' && /last heard/.test(node.textContent ?? ''));
  return card.textContent!.replace(/\u00a0/g, ' ');
};

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });

  // Only `Date`: waiting for a render still needs real timers.
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterAll(() => vi.useRealTimers());

beforeEach(() => {
  forgetServerClock();
  vi.setSystemTime(SERVER_NOW.toJSDate());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      return answer(url.pathname + url.search);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  forgetServerClock();
});

describe('the clock an age is measured against', () => {
  /** An answer, as the client reads one: what the server stamped it, and the two instants around the call. */
  const note = (stampedAt: DateTime, sentAt: number, answeredAt: number) => noteServerDate(stampedAt.toHTTP(), sentAt, answeredAt);

  it("is the browser's own until an answer has said otherwise", () => {
    expect(clockOffsetMs()).toBe(0);
    expect(serverNow().toMillis()).toBe(Date.now());
  });

  it('follows the server when this browser runs an hour fast', () => {
    vi.setSystemTime(SERVER_NOW.plus({ milliseconds: SKEW_MS }).toJSDate());
    const sentAt = Date.now();
    note(SERVER_NOW, sentAt, sentAt + 40);

    expect(Math.abs(serverNow().diff(SERVER_NOW).toMillis())).toBeLessThan(1000);
    expect(Math.abs(clockOffsetMs() + SKEW_MS)).toBeLessThan(1000);
  });

  it('restates an instant this browser noted for itself on the same clock', () => {
    vi.setSystemTime(SERVER_NOW.plus({ milliseconds: SKEW_MS }).toJSDate());
    const sentAt = Date.now();
    note(SERVER_NOW, sentAt, sentAt + 40);

    // A read that answered two minutes ago is two minutes old on either clock,
    // which is the whole point of restating it rather than drawing it raw.
    expect(
      serverNow()
        .diff(DateTime.fromISO(fetchedAt(Date.now() - 120_000)))
        .as('minutes'),
    ).toBeCloseTo(2, 3);
  });

  it('keeps the reading from the shortest round trip, because a long one brackets the answer loosely', () => {
    const sentAt = Date.now();
    note(SERVER_NOW.plus({ seconds: 3 }), sentAt, sentAt + 4000);
    expect(clockOffsetMs()).toBe(1500);

    note(SERVER_NOW.plus({ seconds: 1 }), sentAt, sentAt + 1000);
    expect(clockOffsetMs()).toBe(1000);

    note(SERVER_NOW.plus({ seconds: 3 }), sentAt, sentAt + 4000);
    expect(clockOffsetMs()).toBe(1000);
  });

  it('takes a reading that cannot be read as no reading at all', () => {
    noteServerDate(null, Date.now(), Date.now() + 10);
    noteServerDate('not a date', Date.now(), Date.now() + 10);

    expect(clockOffsetMs()).toBe(0);
  });
});

describe('the inbox on a browser whose clock is out', () => {
  it('draws the same ages as one whose clock is right', async () => {
    const onTime = draw();
    const right = await inbox();
    expect(right).toContain('last heard 3 d ago');
    expect(right).toContain('for 27 min');
    onTime.unmount();

    forgetServerClock();
    vi.setSystemTime(SERVER_NOW.plus({ milliseconds: SKEW_MS }).toJSDate());
    draw();

    expect(await inbox()).toBe(right);
  });
});
