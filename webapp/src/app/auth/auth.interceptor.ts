import { Injectable } from '@angular/core';
import {
  HttpErrorResponse,
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpInterceptor
} from '@angular/common/http';
import {from, lastValueFrom, Observable} from 'rxjs';
import {ToastController} from "@ionic/angular";
import {TranslateService} from "@ngx-translate/core";
import {AuthService} from "./auth.service";
import {currentShareToken} from "../services/share.service";
import {environment} from "src/environments/environment";

export const DEMO_WRITE_MESSAGE = 'Saving is not supported in demo mode';

// Session endpoints keep working in a demo session; everything else that is not a
// plain read changes data and is refused before it leaves the browser.
const DEMO_ALLOWED_ENDPOINTS = ['/login', '/demologin', '/refresh', '/logout'];

function isWriteRequest(req: HttpRequest<any>): boolean {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return false;
  }

  const path = (req.url.startsWith(environment.API_URL) ? req.url.slice(environment.API_URL.length) : req.url).split('?')[0];
  return !DEMO_ALLOWED_ENDPOINTS.includes(path);
}

@Injectable()
export class AuthInterceptor implements HttpInterceptor {

  constructor(
    private authService: AuthService,
    private toastController: ToastController,
    private translate: TranslateService
  ) {}

  intercept(req: HttpRequest<any>,
    next: HttpHandler): Observable<HttpEvent<any>> {
    return from(this.handle(req, next))
  }

  async handle(req: HttpRequest<any>, next: HttpHandler): Promise<HttpEvent<any>> {
      if (this.authService.isDemo && isWriteRequest(req)) {
        await this.reportDemoWriteBlocked();
        throw new HttpErrorResponse({
          status: 403,
          statusText: 'Forbidden',
          url: req.url,
          error: { message: DEMO_WRITE_MESSAGE }
        });
      }

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

  private async reportDemoWriteBlocked() {
    const toast = await this.toastController.create({
      message: this.translate.instant('demo.saveNotSupported'),
      duration: 4000,
      color: 'warning'
    });
    await toast.present();
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
