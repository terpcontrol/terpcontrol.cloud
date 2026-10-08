import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { type InitialEntry, MemoryRouter } from 'react-router';

/** A client that takes a failed read as the answer rather than asking again. */
export const testClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** Draws `node` inside a query client and a router standing at `at`; a rerender keeps both. */
export const drawAt = (node: ReactNode, { at = '/', client = testClient() }: { at?: InitialEntry; client?: QueryClient } = {}) => ({
  client,
  ...render(node, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[at]}>{children}</MemoryRouter>
      </QueryClientProvider>
    ),
  }),
});

/** An answer of the API's. */
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The API's answer for what is not there. */
export const NOT_FOUND = { status: 404, code: 'not_found', title: 'Not found', detail: '', errors: [] };
