import { v1 } from './config';
import { ApiError, readProblem } from './problem';
import { session } from './session';

/**
 * One way to call the API: the bearer token is attached here, a 401 is retried
 * once behind a fresh token, and a failure is always an `ApiError` carrying the
 * problem document. Callers name a route and a type from the contract; nothing
 * in this file knows a shape.
 */

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

const withQuery = (path: string, query: Query | undefined): string => {
  if (!query) return path;
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined) parameters.set(key, String(value));
  }
  const rendered = parameters.toString();
  return rendered ? `${path}?${rendered}` : path;
};

const send = async (path: string, options: RequestOptions, token: string | null): Promise<Response> => {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  return fetch(v1(withQuery(path, options.query)), {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await send(path, options, await session.validToken());

  // The token can die between the check and the call - the server's clock decides, not ours.
  if (response.status === 401) {
    const refreshed = await session.refresh(session.snapshot().tokens?.refreshToken);
    if (refreshed) response = await send(path, options, refreshed.userToken);
  }

  if (!response.ok) throw new ApiError(await readProblem(response));
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => apiRequest<T>(path, { query, signal }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  delete: (path: string) => apiRequest<void>(path, { method: 'DELETE' }),
};
