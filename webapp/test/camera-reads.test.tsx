import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Media, TestCapture } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { CAPTURE_POLL_MS, CAPTURE_WAIT_MS, gaveUp, useCameraFrames, useTestCapture } from '@/api/cameras';
import { ApiError } from '@/api/problem';

/**
 * What the camera page reads while somebody stands in front of the tent with it
 * open.
 *
 * The day behind the scrubber was read once, at load, and never again: the
 * frame, its stamp and "N pictures today" stood still for as long as the page
 * was up, while the header pill went on counting the seconds since the camera's
 * last picture. The page said in one line that the camera had delivered ten
 * seconds ago and in the next that a picture from twenty minutes back was the
 * live one.
 *
 * Reading the day again is not re-walking it: a camera on the pipeline's own
 * interval fills fifteen pages by evening, and asking for all of them every
 * half minute is what made reading it once look reasonable. So a second read
 * asks for the tail and keeps what it already has.
 */

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
}));

const DAY = { startsAt: '2026-09-23T00:00:00.000Z', endsAt: '2026-09-23T23:59:59.999Z' };

const still = (id: string, capturedAt: string): Media => ({ id, capturedAt, kind: 'still' }) as Media;

/** The stills of one page, newest first, as the route answers them. */
const page = (items: Media[], nextCursor: string | null = null) => Promise.resolve({ items, nextCursor }) as never;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

const asked = () => vi.mocked(api.get).mock.calls.map(call => call[1] as { startsAt: string; cursor: string | null });

beforeEach(() => {
  vi.mocked(api.get).mockReset();
});

describe("the day the camera page's scrubber walks", () => {
  it('walks every page of the day the first time, so the morning is reachable and the count is the day´s', async () => {
    vi.mocked(api.get)
      .mockImplementationOnce(() => page([still('c', '2026-09-23T12:00:00.000Z')], 'cursor-1'))
      .mockImplementationOnce(() => page([still('b', '2026-09-23T08:00:00.000Z')]));

    const { result } = renderHook(() => useCameraFrames('camera-1', DAY), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.items.map(one => one.id)).toEqual(['c', 'b']);
    expect(result.current.data!.partial).toBe(false);
    expect(asked().map(one => one.startsAt)).toEqual([DAY.startsAt, DAY.startsAt]);
  });

  it('asks a second time only for what has been taken since the newest picture it holds, and keeps the rest', async () => {
    vi.mocked(api.get)
      .mockImplementationOnce(() => page([still('b', '2026-09-23T12:00:00.000Z'), still('a', '2026-09-23T08:00:00.000Z')]))
      // The route's ends are inclusive, so the picture the tail starts at comes
      // back with it: two rows of one id are one picture.
      .mockImplementationOnce(() => page([still('c', '2026-09-23T12:00:30.000Z'), still('b', '2026-09-23T12:00:00.000Z')]));

    const { result } = renderHook(() => useCameraFrames('camera-1', DAY), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    await result.current.refetch();

    expect(asked()[1].startsAt).toBe('2026-09-23T12:00:00.000Z');
    await waitFor(() => expect(result.current.data!.items.map(one => one.id)).toEqual(['c', 'b', 'a']));
  });

  it('keeps a day it never reached the end of a floor, because the tail says nothing about the morning', async () => {
    const full = Array.from({ length: 15 }, (_, index) => page([still(`p${index}`, '2026-09-23T12:00:00.000Z')], `cursor-${index}`));
    for (const answer of full) vi.mocked(api.get).mockImplementationOnce(() => answer);
    vi.mocked(api.get).mockImplementation(() => page([]));

    const { result } = renderHook(() => useCameraFrames('camera-1', DAY), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.partial).toBe(true);

    await result.current.refetch();
    expect(result.current.data!.partial).toBe(true);
  });
});

/**
 * The picture the test button stores. The press is answered at once and the
 * capture asked after until it is over - and once it is, the page reads the day
 * again: it went on drawing the day it had read before the press, so a capture
 * that worked and a button that did nothing at all looked the same from the
 * screen.
 */
describe('a test image', () => {
  const capture = (over: Partial<TestCapture>): TestCapture => ({
    id: 'capture-1',
    cameraId: 'camera-1',
    state: 'running',
    startedAt: '2026-09-23T12:00:00.000Z',
    finishedAt: null,
    still: null,
    reason: null,
    error: null,
    ...over,
  });
  const DONE = capture({ state: 'done', finishedAt: '2026-09-23T12:01:00.000Z', still: { mediaId: 'b', capturedAt: '2026-09-23T12:01:00.000Z' } });

  /** The capture's own route answers from `states`, one per ask, and every other read a day of one picture. */
  const answering = (...states: (TestCapture | Error)[]) =>
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (!path.includes('/test-captures/')) return page([still('a', '2026-09-23T12:00:00.000Z')]);
      const next = states.length > 1 ? states.shift()! : states[0];
      return (next instanceof Error ? Promise.reject(next) : Promise.resolve(next)) as never;
    });
  const asks = () => vi.mocked(api.get).mock.calls.filter(call => String(call[0]).includes('/test-captures/')).length;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    vi.mocked(api.post).mockReset();
    vi.mocked(api.post).mockImplementation(() => Promise.resolve(capture({})) as never);
  });
  afterEach(() => vi.useRealTimers());

  it('is asked after every two seconds until it is over, and then has the day read again', async () => {
    answering(capture({}), DONE);
    const { result } = renderHook(() => ({ frames: useCameraFrames('camera-1', DAY), test: useTestCapture('camera-1') }), { wrapper });
    await waitFor(() => expect(result.current.frames.data).toBeDefined());
    const dayReads = () => vi.mocked(api.get).mock.calls.length - asks();
    expect(dayReads()).toBe(1);

    act(() => result.current.test.mutate());
    await act(() => vi.advanceTimersByTimeAsync(1_900));
    expect(asks()).toBe(0);
    await act(() => vi.advanceTimersByTimeAsync(4_000));

    await waitFor(() => expect(result.current.test.data).toEqual(DONE));
    expect(asks()).toBe(2);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/cameras/camera-1/test-captures/capture-1', undefined, expect.any(AbortSignal));
    await waitFor(() => expect(dayReads()).toBeGreaterThan(1));
  });

  it('asks again after a poll that did not get through, and stops at a refusal', async () => {
    answering(
      new TypeError('Failed to fetch'),
      new ApiError({ status: 404, title: 'Not Found', detail: 'gone', code: 'test_capture_not_found', errors: [] }),
    );
    const { result } = renderHook(() => useTestCapture('camera-1'), { wrapper });

    act(() => result.current.mutate());
    await act(() => vi.advanceTimersByTimeAsync(4_100));

    await waitFor(() => expect(result.current.error).toBeInstanceOf(ApiError));
    expect(asks()).toBe(2);
  });

  it('stops asking once the read has had its budget and a margin, and says this side gave up', async () => {
    answering(capture({}));
    const { result } = renderHook(() => useTestCapture('camera-1'), { wrapper });

    act(() => result.current.mutate());
    await act(() => vi.advanceTimersByTimeAsync(CAPTURE_WAIT_MS + CAPTURE_POLL_MS));

    await waitFor(() => expect(gaveUp(result.current.error)).toBe(true));
    // Three minutes and the half minute after them, one ask every two seconds.
    expect(CAPTURE_WAIT_MS).toBe(210_000);
    expect(asks()).toBe(CAPTURE_WAIT_MS / CAPTURE_POLL_MS);
  });

  it('stops asking when the screen that pressed it goes away', async () => {
    answering(capture({}));
    const { result, unmount } = renderHook(() => useTestCapture('camera-1'), { wrapper });

    act(() => result.current.mutate());
    await act(() => vi.advanceTimersByTimeAsync(4_100));
    expect(asks()).toBe(2);
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(20_000));

    expect(asks()).toBe(2);
  });
});
