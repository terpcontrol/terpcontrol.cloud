import { noteServerDate } from './clock';
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

/**
 * A server that accepts the connection and never answers would otherwise hold
 * a screen in "refreshing" forever, and a screen that never hears back can
 * never say that its values are old. Long enough for the week cards, which
 * cost the server a time-series read per week.
 */
const REQUEST_TIMEOUT_MS = 30_000;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
  /** For the one call that is known to take longer than every other. */
  timeoutMs?: number;
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
  // A form names its own type, boundary and all, so saying it here would break it.
  const form = options.body instanceof FormData;
  if (options.body !== undefined && !form) headers['Content-Type'] = 'application/json';

  // Every answer says what the server's clock read as it was written, and the
  // ages the screens draw are measured against that rather than against this
  // browser's own clock. It costs a pair of local readings around a call that
  // is being made anyway.
  const sentAt = Date.now();
  const timeout = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const response = await fetch(v1(withQuery(path, options.query)), {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : form ? (options.body as FormData) : JSON.stringify(options.body),
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
  });
  noteServerDate(response.headers.get('date'), sentAt, Date.now());

  return response;
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

/**
 * A file the session is allowed to have, fetched as bytes rather than linked to.
 *
 * An export is the whole of somebody's account in one zip, so it is served to a
 * session and not to the long-lived token a picture's URL carries - which means
 * an `<a href>` cannot fetch it, because nothing sets a header on a navigation.
 * The bytes come back through the ordinary client, with its renewal, and the
 * caller hands the blob to a download and releases it afterwards.
 */
export async function apiBlob(path: string): Promise<Blob> {
  let response = await send(path, {}, await session.validToken());

  if (response.status === 401) {
    const refreshed = await session.refresh(session.snapshot().tokens?.refreshToken);
    if (refreshed) response = await send(path, {}, refreshed.userToken);
  }

  if (!response.ok) throw new ApiError(await readProblem(response));
  return response.blob();
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => apiRequest<T>(path, { query, signal }),
  post: <T>(path: string, body?: unknown, timeoutMs?: number) => apiRequest<T>(path, { method: 'POST', body, timeoutMs }),
  /** A picture on its way to the diary: multipart, and not JSON. */
  upload: <T>(path: string, form: FormData) => apiRequest<T>(path, { method: 'POST', body: form }),
  patch: <T>(path: string, body: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  /** A `PUT` that states a fact - a link is revoked, a grow is followed - carries nothing, so the body is optional. */
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  delete: (path: string) => apiRequest<void>(path, { method: 'DELETE' }),
};
