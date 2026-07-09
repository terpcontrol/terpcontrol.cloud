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
            const cloned = req.clone({
              headers: req.headers.set("Authorization", "Bearer " + idToken)
            });

            return lastValueFrom(next.handle(cloned));
          }
        } catch (error) {
          // Ignore errors and proceed without token
        }
      }

    return lastValueFrom(next.handle(req));
  }
}
