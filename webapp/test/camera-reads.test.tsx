import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Media } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { useCameraFrames } from '@/api/cameras';

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
