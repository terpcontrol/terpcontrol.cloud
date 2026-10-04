import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './problem';

/**
 * Defaults the whole app lives with. Live values carry their own age from the
 * server, so a screen decides its own refetch interval; what is set here is
 * only what every query shares.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // A phone comes back from the lock screen more often than it is resized.
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // Nothing is gained by asking again after a refusal or a bad request.
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});
