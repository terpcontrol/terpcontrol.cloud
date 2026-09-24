import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { hasFailed, isFirstLoad, useRead } from '@/api/read';
import { ApiError } from '@/api/problem';

/**
 * What a screen is told while a read it has never had an answer to is being
 * tried again.
 *
 * React Query calls such a query "pending" every time it starts trying, and a
 * screen that draws its first-load skeleton for "pending" therefore spent most
 * of a hung connection looking like a screen that was still fetching. The rule
 * lives in `api/read.ts` so that every screen inherits it; what is checked here
 * is the rule itself, against React Query's own state machine rather than
 * against a screen.
 */

const gone = () => new ApiError({ status: 404, code: 'grow_not_found', title: 'Not found', detail: 'There is no grow with that id.', errors: [] });

/** Fails once, then never answers at all - a server that accepts the connection and goes quiet. */
const failsThenHangs = () => {
  let attempts = 0;

  return () => {
    attempts += 1;
    return attempts === 1 ? Promise.reject(gone()) : new Promise<string>(() => undefined);
  };
};

const BEAT_MS = 40;

const clientFor = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

type Shown = { status: string; fetchStatus: string; error: unknown };

const Screen = ({ useTheRead }: { useTheRead: () => Shown }) => {
  const result = useTheRead();
  const problem = result.error instanceof ApiError ? result.error.status : null;

  return <p>{`${result.status}/${problem ?? 'no error'}/${result.fetchStatus}`}</p>;
};

const draw = (client: QueryClient, useTheRead: () => Shown) =>
  render(
    <QueryClientProvider client={client}>
      <Screen useTheRead={useTheRead} />
    </QueryClientProvider>,
  );

describe('a read that has never been answered', () => {
  it('goes on saying it failed while it is being tried again, and keeps the problem it failed with', async () => {
    const client = clientFor();
    const queryFn = failsThenHangs();
    const useTheRead = () => useRead({ queryKey: ['hangs'], queryFn, refetchInterval: BEAT_MS }) as unknown as Shown;

    draw(client, useTheRead);

    // The first attempt is a first load, and says so.
    expect(screen.getByText('pending/no error/fetching')).toBeInTheDocument();
    expect(await screen.findByText('error/404/idle')).toBeInTheDocument();

    // The screen's own refresh beat starts it again. It really is on the wire -
    // which is what `fetchStatus` says, and what a "refreshing" hint would read -
    // and nothing has changed about what the reader has been told.
    await act(async () => {
      await new Promise(done => setTimeout(done, BEAT_MS * 2));
    });

    expect(screen.getByText('error/404/fetching')).toBeInTheDocument();
  });

  it('is what React Query on its own calls a first load again, which is the defect', async () => {
    const client = clientFor();
    const queryFn = failsThenHangs();
    const useTheRead = () => useQuery({ queryKey: ['hangs'], queryFn, refetchInterval: BEAT_MS }) as unknown as Shown;

    draw(client, useTheRead);
    expect(await screen.findByText('error/404/idle')).toBeInTheDocument();

    await act(async () => {
      await new Promise(done => setTimeout(done, BEAT_MS * 2));
    });

    // Back to the state a first-load skeleton is drawn for, with the problem
    // document thrown away - four minutes after the screen was opened.
    expect(screen.getByText('pending/no error/fetching')).toBeInTheDocument();
  });
});

describe('the flags a read of several rows at once is combined from', () => {
  const settled = { status: 'success' as const, isPending: false, isError: false, errorUpdateCount: 0, data: [], error: null };
  const first = { status: 'pending' as const, isPending: true, isError: false, errorUpdateCount: 0, data: undefined, error: null };
  const trying = { status: 'pending' as const, isPending: true, isError: false, errorUpdateCount: 2, data: undefined, error: null };

  it('counts a read that is being tried again as failed rather than as loading', () => {
    expect(isFirstLoad(first)).toBe(true);
    expect(hasFailed(first)).toBe(false);

    expect(isFirstLoad(trying)).toBe(false);
    expect(hasFailed(trying)).toBe(true);

    expect(isFirstLoad(settled)).toBe(false);
    expect(hasFailed(settled)).toBe(false);
  });
});
