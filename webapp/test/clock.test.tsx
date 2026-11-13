import { screen, within } from '@testing-library/react';
import { DateTime } from 'luxon';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Alert } from '@fg2/shared-types/v1';
import { clockOffsetMs, fetchedAt, forgetServerClock, noteServerDate, serverNow } from '@/api/clock';
import { Alerts } from '@/screens/Alerts';
import { deviceWith } from './fixtures';
import { drawAt } from './harness';
import { Toast } from './toast';
import { spaceWhere } from './session';
import { translate } from './translations';

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

/**
 * The server's own clock, which every fixture below is dated from and every
 * answer is stamped with: late in the account's evening, so a browser an hour
 * fast is already in tomorrow and would call this evening "yesterday".
 */
const SERVER_NOW = DateTime.fromISO('2026-09-23T23:35:00.000Z', { zone: 'utc' });

/** How far this browser's clock is out in the second half of each pair. */
const SKEW_MS = 3600_000;

const iso = (at: DateTime) => at.toISO()!;

/** An alert about a device that stopped speaking and was heard again: the inbox says when that was. */
const quietTent = (id: string, ended: DateTime): Alert => ({
  id,
  createdAt: iso(ended.minus({ hours: 2 })),
  ruleId: null,
  deviceId: 'device-1',
  cameraId: null,
  spaceId: 'space-1',
  kind: 'offline',
  severity: 'critical',
  startedAt: iso(ended.minus({ hours: 2 })),
  resolvedAt: iso(ended),
  rested: false,
  value: null,
  extremeValue: null,
  watched: null,
});

const over = [quietTent('alert-1', SERVER_NOW.minus({ minutes: 27 })), quietTent('alert-2', SERVER_NOW.minus({ days: 3, hours: 23 }))];

const device = deviceWith({ name: 'Blue Dream tent', state: { lastSeenAt: iso(SERVER_NOW.minus({ minutes: 1 })) } });

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    // What the server says its clock reads, to the second, as every HTTP answer does.
    headers: { 'Content-Type': 'application/json', Date: SERVER_NOW.toHTTP()! },
  });

const answer = (path: string): Response => {
  if (path.startsWith('/v1/alerts')) {
    const open = new URL(path, 'http://x').searchParams.get('open') === 'true';
    return json({ items: open ? [] : over, nextCursor: null });
  }
  if (path === '/v1/spaces') return json({ items: [spaceWhere('own', { id: 'space-1', name: 'Flower room B' })], nextCursor: null });
  if (path === '/v1/devices') return json({ items: [device], nextCursor: null });
  if (path === '/v1/cameras') return json({ items: [], nextCursor: null });
  // The whole notification object rather than the mute alone. The inbox reads
  // the routing grid to say whether an open alert reached anybody, and it asks
  // that of every open card now, so half an answer here is a shape the server
  // never sends and would take the page down on the way to the ages.
  if (path === '/v1/me')
    return json({
      id: 'user-1',
      handle: 'you',
      preferences: { timezone: 'UTC' },
      notifications: {
        mutedUntil: null,
        channels: { email: null, push: false, telegram: null, webhook: null },
        routing: { alerts: [], warnings: [], tasks: [], plan: [], weekly_timelapse: [] },
        quietHours: null,
      },
    });

  return json({ items: [], nextCursor: null });
};

const draw = () =>
  drawAt(
    <Toast>
      <Alerts />
    </Toast>,
  );

/** The rows of what is over, once the reads behind them have landed: the whole of what a reader is told about the quiet tent. */
const inbox = async (): Promise<string[]> => {
  await screen.findAllByText(/^Blue Dream tent offline for/);
  return within(screen.getByRole('region', { name: 'Resolved' }))
    .getAllByRole('button')
    .map(row => row.textContent.replace(/\u00a0/g, ' '));
};

beforeAll(async () => {
  await translate();

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
  it('dates what is over as one whose clock is right does', async () => {
    const onTime = draw();
    const right = await inbox();
    expect(right).toEqual([
      'Blue Dream tent offline for 2 h23:08',
      `Blue Dream tent offline for 2 h${SERVER_NOW.minus({ days: 3 }).toFormat('cccc')}`,
    ]);
    onTime.unmount();

    forgetServerClock();
    vi.setSystemTime(SERVER_NOW.plus({ milliseconds: SKEW_MS }).toJSDate());
    draw();

    expect(await inbox()).toEqual(right);
  });
});
