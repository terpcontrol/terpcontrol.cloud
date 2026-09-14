import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { environment } from 'src/environments/environment';

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/**
 * One call to the API, as `api.routes.ts` describes it.
 *
 * `answers` is never assigned. It exists so the response type travels from the
 * route table to the call site: without it the type parameter appears nowhere in
 * the descriptor and every call would infer `unknown`.
 */
export interface ApiCall<Response> {
  readonly method: ApiMethod;
  /** Below the API root, query string included. */
  readonly path: string;
  readonly body?: unknown;
  /**
   * Sent with an empty Authorization header, which is how the interceptor is
   * asked to leave the request alone - these routes are reached without a
   * session, and attaching one would cost a refresh the caller cannot finish.
   */
  readonly anonymous?: boolean;
  /** Answers with bytes rather than JSON. */
  readonly binary?: boolean;
  readonly answers?: Response;
}

/**
 * Makes the calls the route table describes.
 *
 * Every call names its answer once, in the table, against the shapes
 * `@fg2/shared-types` generates from the schemas the server documents itself
 * with. A route whose shape changes therefore breaks the build here rather than
 * in the browser - which is the whole point of going through this instead of
 * spelling out a URL and a generic at each call site.
 */
@Injectable({
  providedIn: 'root',
})
export class ApiClient {
  constructor(private http: HttpClient) {}

  /** The call as an observable, for the callers that pipe or subscribe. */
  public observe<Response>(call: ApiCall<Response>): Observable<Response> {
    const url = this.url(call.path);
    const options = { body: call.body, headers: call.anonymous ? { Authorization: '' } : undefined };

    if (call.binary) {
      // The one place a cast is needed: `responseType: 'blob'` pins the answer to
      // `Blob` no matter what the route declares, and only the table knows that
      // these routes declare exactly that.
      return this.http.request(call.method, url, { ...options, responseType: 'blob' }) as unknown as Observable<Response>;
    }

    return this.http.request<Response>(call.method, url, { ...options, responseType: 'json' });
  }

  /** The call as a promise, which is how nearly every service uses it. */
  public fetch<Response>(call: ApiCall<Response>): Promise<Response> {
    return firstValueFrom(this.observe(call));
  }

  /** Where a path lives, for the URLs the browser fetches on its own (`<img>`, `<video>`). */
  public url(path: string): string {
    return environment.API_URL + path;
  }
}
