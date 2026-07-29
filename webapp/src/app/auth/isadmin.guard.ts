import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root'
})
export class IsAdminGuard implements CanActivate {
  constructor(public auth: AuthService, public router: Router) {}

  async canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot): Promise<boolean | UrlTree>
  {
    const sessionState = await this.auth.restoreSession();

    if (sessionState === 'unreachable' && !this.auth.authenticated.value) {
      return this.router.createUrlTree(['connection-error'], { queryParams: { returnUrl: state.url } });
    }
    if (!this.auth.authenticated.value) {
      return this.router.createUrlTree(['login'], { queryParams: { returnUrl: state.url } });
    }
    return !!this.auth.current_user.value?.is_admin;
  }

}
