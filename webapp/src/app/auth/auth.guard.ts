import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { AuthService, isConnectionError } from './auth.service';
import { ShareService } from '../services/share.service';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  constructor(public auth: AuthService, public router: Router, private shares: ShareService) {}

  async canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot): Promise<boolean | UrlTree>
  {
    // Wait for the stored session to resolve. Deciding on the initial `false` of
    // `authenticated` is what made a cold start bounce to the login page before the
    // session had a chance to come back.
    const sessionState = await this.auth.restoreSession();

    if (sessionState === 'authenticated') {
      return true;
    }

    // Nothing can be decided while the server is unreachable. Only send the user to
    // the connection screen when there is no established session to fall back on —
    // mid-session the page itself reports the failure and keeps the user where they are.
    if (sessionState === 'unreachable') {
      return this.auth.authenticated.value
        || this.router.createUrlTree(['connection-error'], { queryParams: { returnUrl: state.url } });
    }

    return this.canActivateSharedRoute(route, state);
  }

  private async canActivateSharedRoute(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Promise<boolean | UrlTree> {
    const routePath = route.routeConfig?.path;
    const page = routePath === 'device/:device_id/charts' ? 'charts'
      : routePath === 'device/:device_id/diary' ? 'diary'
      : null;
    const deviceId = route.paramMap.get('device_id');
    const shareToken = route.queryParamMap.get('share');

    if (page && deviceId && shareToken) {
      try {
        const result = await this.shares.resolve(shareToken);
        // A diary link may additionally open the charts page when the owner
        // enabled working chart links for the grow report.
        const pageAllowed = result.share?.page === page || (page === 'charts' && !!result.share?.charts);
        if (result.device_id === deviceId && pageAllowed) {
          return true;
        }
      } catch (error) {
        // A link that could not be checked is not a link that expired.
        if (isConnectionError(error)) {
          return this.router.createUrlTree(['connection-error'], { queryParams: { returnUrl: state.url } });
        }
      }

      // The visitor arrived with a share link that no longer works
      // (expired, revoked, or not matching this page).
      return this.router.createUrlTree(['link-expired']);
    }

    return this.router.createUrlTree(['login'], { queryParams: { returnUrl: state.url } });
  }

}
