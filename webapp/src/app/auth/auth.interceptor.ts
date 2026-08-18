import { Injectable } from '@angular/core';
import {
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpInterceptor
} from '@angular/common/http';
import {from, lastValueFrom, Observable} from 'rxjs';
import {AuthService} from "./auth.service";
import {currentShareToken} from "../services/share.service";

@Injectable()
export class AuthInterceptor implements HttpInterceptor {

  constructor(private authService: AuthService) {}

  intercept(req: HttpRequest<any>,
    next: HttpHandler): Observable<HttpEvent<any>> {
    return from(this.handle(req, next))
  }

  async handle(req: HttpRequest<any>, next: HttpHandler): Promise<HttpEvent<any>> {
      // While viewing a shared page, every API call carries the share token so the
      // server can authorize visitors (and non-owner users) without an account.
      const shareToken = currentShareToken();
      if (shareToken) {
        req = req.clone({ headers: req.headers.set('X-Share-Token', shareToken) });
      }

      if (!req.headers.has('Authorization')) {
        try {
          const idToken = await this.authService.getToken();
          if (idToken) {
            return await this.sendAuthenticated(req, next, idToken, !shareToken);
          }
        } catch (error) {
          // Ignore errors and proceed without token
        }
      }

    return lastValueFrom(next.handle(req));
  }

  // A 401 on a request we authenticated ourselves means the server rejected the
  // session, which the locally cached expiry cannot detect. Re-check it against the
  // server once and replay; if it fails again the session is really gone.
  // Visitors on a share link have no session to salvage, so they never get here.
  private async sendAuthenticated(
    req: HttpRequest<any>,
    next: HttpHandler,
    idToken: string,
    mayRetry: boolean
  ): Promise<HttpEvent<any>> {
    const withToken = (token: string) => req.clone({ headers: req.headers.set('Authorization', 'Bearer ' + token) });

    let rejected: any;
    try {
      return await lastValueFrom(next.handle(withToken(idToken)));
    } catch (error: any) {
      if (!mayRetry || error?.status !== 401) {
        throw error;
      }
      rejected = error;
    }

    const sessionState = await this.authService.revalidateSession();
    const refreshedToken = sessionState === 'authenticated' ? await this.authService.getToken() : null;

    if (!refreshedToken) {
      // A dead connection is not a dead session — leave the user logged in.
      if (sessionState !== 'unreachable') {
        await this.authService.logout('session-expired');
      }
      throw rejected;
    }

    try {
      return await lastValueFrom(next.handle(withToken(refreshedToken)));
    } catch (error: any) {
      if (error?.status === 401) {
        await this.authService.logout('session-expired');
      }
      throw error;
    }
  }
}
