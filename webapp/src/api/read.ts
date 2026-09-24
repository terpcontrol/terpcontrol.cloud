import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * Every read of the API goes through here, so that no screen is ever told a
 * read is still on its way when it has already failed.
 *
 * React Query calls a query that has no data "pending", and beginning a fetch on
 * such a query clears the error and puts the status back to pending. That is
 * right for the first attempt and wrong for the tenth. A read that times out is
 * retried twice and then again on the screen's own refresh beat, so a server
 * that accepts the connection and never answers left a tab on its first-load
 * skeleton for about ninety seconds out of every two minutes, for as long as
 * somebody cared to watch: a screen that had not reached the server in four
 * minutes looked exactly like a screen that was still fetching.
 *
 * The choice is between a longer timeout and a stated waiting state, and it is
 * the second. A timeout is already there - thirty seconds in `client.ts`, which
 * is what turns a hung connection into a failure at all - and a second one on
 * top of it would only change how many minutes the screen tells a reader
 * nothing. What was missing is the rule that a read which has failed once has
 * stopped being a first load, whatever it does next. So a read that has failed
 * and still has nothing goes on saying so while it goes on trying: the screen
 * keeps the sentence and the "Try again" button it put up at the first failure,
 * and the automatic retries carry on behind them, which is what lets a screen
 * come back by itself when the server does.
 *
 * `errorUpdateCount` is what says a read has failed before - React Query keeps
 * it across the reset that clears the error itself. The error object does not
 * survive that reset, so it is remembered here and forgotten the moment an
 * answer arrives; a screen that tells a 404 apart from a dropped connection
 * needs the problem document and not merely the fact of a failure.
 */

/** As much of a read's result as the rule above is decided by. */
interface ReadState {
  status: 'pending' | 'error' | 'success';
  isPending: boolean;
  isError: boolean;
  errorUpdateCount: number;
  data: unknown;
  error: unknown;
}

/**
 * Whether a read has failed and has still never answered - the state React Query
 * reports as "pending" again the instant it starts trying once more.
 *
 * It is exported for the reads that ask for one row per device at once, where
 * several results are combined into the one pair of flags a screen branches on.
 */
export const hasFailed = (result: ReadState): boolean =>
  result.isError || (result.isPending && result.errorUpdateCount > 0 && result.data === undefined);

/** Still on its way, and not yet failed once: the only state a first-load skeleton belongs to. */
export const isFirstLoad = (result: ReadState): boolean => result.isPending && !hasFailed(result);

/**
 * The last failure of a read that has still never answered.
 *
 * It is kept beside the query rather than in it because React Query throws the
 * error away as soon as it starts trying again, and a screen that tells "this
 * grow is gone" apart from "the server did not answer" branches on the problem
 * document rather than on the bare fact of a failure. An answer forgets it, and
 * so does unmounting the screen, which is as long as it is worth anything.
 */
const useLastFailure = (result: ReadState): unknown => {
  const [remembered, remember] = useState<unknown>(null);
  const failure = result.error ?? (result.data === undefined ? remembered : null);

  // Adjusting state from what has just been rendered, which React re-runs the
  // render for before anything reaches the screen.
  if (failure !== remembered) remember(failure);

  return failure;
};

const stated = <T extends ReadState>(result: T, failure: unknown): T => {
  if (!hasFailed(result) || !result.isPending) return result;

  // `isFetching` and `fetchStatus` are left alone: the read really is on the
  // wire again, and a screen that wants to say "trying again" reads those.
  return {
    ...result,
    status: 'error',
    isPending: false,
    isLoading: false,
    isError: true,
    isLoadingError: true,
    isSuccess: false,
    error: failure,
  };
};

function useStatedQuery(options: never) {
  const result = useQuery(options) as unknown as ReadState;

  return stated(result, useLastFailure(result));
}

function useStatedInfiniteQuery(options: never) {
  const result = useInfiniteQuery(options) as unknown as ReadState;

  return stated(result, useLastFailure(result));
}

/** `useQuery`, with the rule above applied to its answer. Identical in every other respect, signature included. */
export const useRead = useStatedQuery as unknown as typeof useQuery;

/** The same for a read that is paged. */
export const useReadPages = useStatedInfiniteQuery as unknown as typeof useInfiniteQuery;
