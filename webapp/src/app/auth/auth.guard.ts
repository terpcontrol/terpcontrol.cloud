import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { ShareService } from '../services/share.service';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  constructor(public auth: AuthService, public router: Router, private shares: ShareService) {}

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree
  {
    if (this.auth.authenticated.value) {
      return true;
    }

    return this.canActivateSharedRoute(route);
  }

  private async canActivateSharedRoute(route: ActivatedRouteSnapshot): Promise<boolean> {
    const routePath = route.routeConfig?.path;
    const page = routePath === 'device/:device_id/charts' ? 'charts'
      : routePath === 'device/:device_id/diary' ? 'diary'
      : null;
    const deviceId = route.paramMap.get('device_id');
    const shareToken = route.queryParamMap.get('share');

    if (page && deviceId && shareToken) {
      try {
        const result = await this.shares.resolve(shareToken);
        if (result.device_id === deviceId && result.share?.page === page) {
          return true;
        }
      } catch (_error) {}

      // The visitor arrived with a share link that no longer works
      // (expired, revoked, or not matching this page).
      await this.router.navigate(['link-expired']);
      return false;
    }

    await this.router.navigate(['login']);
    return false;
  }

}
