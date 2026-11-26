import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { queryClient } from '@/api/query-client';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { provideFeedbackContext } from './feedback-context';
import { router } from './routes';

// What a feedback report says about where it was sent from: the address and the ids every matched route read.
provideFeedbackContext(() => ({
  pathname: router.state.location.pathname,
  search: router.state.location.search,
  params: Object.assign({}, ...router.state.matches.map(match => match.params)) as Record<string, string | undefined>,
}));

export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
