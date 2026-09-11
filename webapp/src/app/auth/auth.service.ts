import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, firstValueFrom, Observable, timeout } from 'rxjs';
import type { SessionTokens, SessionUser } from '@fg2/shared-types';
import { DateTime } from "luxon";
import { Router } from '@angular/router';
import { MenuController, NavController } from '@ionic/angular';
import { ApiClient } from '../api/api.client';
import { api } from '../api/api.routes';

const EXPIRE_SAFETY_SECONDS = 10;

// The route guard waits for the session to resolve before it decides where to send
// the user, so a half-open connection must not stall the app on a blank screen.
const REFRESH_TIMEOUT_MS = 8000;

export type SessionState = 'unknown' | 'authenticated' | 'anonymous' | 'unreachable';

export type LogoutReason = 'session-expired';

/**
 * What a session route answers with. Signing in reports the account as well;
 * trading in a refresh token sends the tokens alone, because the token said who
 * the caller is.
 */
type SessionData = SessionTokens & { user?: SessionUser };

// A request that never reached the server: the browser reports status 0 for DNS,
// TLS, CORS and offline failures, and a stalled connection surfaces as a timeout.
export function isConnectionError(err: any): boolean {
  return !!err && (err.status === 0 || err.name === 'TimeoutError');
}
@Injectable({
  providedIn: 'root'
})
export class AuthService implements OnDestroy {

  public authenticated: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  public current_user: BehaviorSubject<SessionUser|null> = new BehaviorSubject<SessionUser|null>(null);
  // `authenticated` cannot express "we don't know yet" or "the server is down", which
  // is what tells a genuine logout apart from an unreachable backend.
  public sessionState: BehaviorSubject<SessionState> = new BehaviorSubject<SessionState>('unknown');
  private waitForToken: Promise<void> | null = null;
  private revalidation: Promise<void> | null = null;

  constructor(private client: ApiClient, public router: Router, private navCtrl: NavController, private menuCtrl: MenuController) {
  }

  public ngOnDestroy(): void {
    this.setSessionState('anonymous');
    this.authenticated.complete();
    this.sessionState.complete();
    this.current_user.next(null);
    this.current_user.complete();
  }

  // Resolves the stored session and reports what came of it. Concurrent callers
  // (route guards, the retry button) share one in-flight attempt.
  public async restoreSession(): Promise<SessionState> {
    if (this.sessionState.getValue() === 'authenticated') {
      return 'authenticated';
    }

    await this.getToken();
    return this.sessionState.getValue();
  }

  // Throws away the cached access token and asks the server for a new one, for when
  // the server rejected a token the local expiry still considered valid. Concurrent
  // callers share one attempt, so a page full of parallel 401s triggers one refresh.
  public async revalidateSession(): Promise<SessionState> {
    if (this.revalidation === null) {
      localStorage.removeItem('id_token');
      localStorage.removeItem('expires_at');
      this.waitForToken = null;
      this.revalidation = this.getToken()
        .then(() => undefined)
        .finally(() => this.revalidation = null);
    }

    await this.revalidation;
    return this.sessionState.getValue();
  }

  private setSessionState(state: SessionState) {
    if (this.sessionState.getValue() !== state) {
      this.sessionState.next(state);
    }

    // 'unreachable' means we could not check, not that the session is gone. Tearing
    // down the logged-in chrome over a dropped connection would log the user out of a
    // session that is very likely still valid, so only a definite answer moves the flag.
    if (state !== 'authenticated' && state !== 'anonymous') {
      return;
    }

    const authenticated = state === 'authenticated';
    if (this.authenticated.getValue() !== authenticated) {
      this.authenticated.next(authenticated);
    }
  }

  public async login(username: string, password: string, stayLoggedIn: boolean) {
    await this.startSession(this.client.observe(api.session.logIn(username, password, stayLoggedIn)));
  }

  // Read-only session without an account, showing the devices flagged as demo devices.
  public async loginAsDemo() {
    await this.startSession(this.client.observe(api.session.logInAsDemo()));
  }

  public get isDemo(): boolean {
    return !!this.current_user.getValue()?.is_demo;
  }

  private async startSession(request: Observable<SessionData>) {
    const loginPromise = firstValueFrom(request)
      .then(login => {
        this.setLogin(login);
      })
      .finally(() => this.waitForToken = null);
    this.waitForToken = loginPromise as unknown as Promise<void>;
    await loginPromise;
  }

  public async activate(activation_code: string) {
    return await this.client.fetch(api.session.activate(activation_code));
  }

  public async register(username: string, password: string) {
    return await this.client.fetch(api.session.signUp(username, password));
  }

  public async getToken(): Promise<string | null> {
    if (this.waitForToken === null) {
      this.waitForToken = this.refresh()
          .finally(() => this.waitForToken = null);
    }

    try {
      await this.waitForToken;
    } catch (err) {}

    return localStorage.getItem('id_token');
  }

  public async getImageToken(): Promise<string | null> {
    try {
      await this.getToken();
    } catch (err) {}

    return localStorage.getItem('image_token');
  }

  private async refresh() {
    const user = localStorage.getItem('user');
    const idToken = localStorage.getItem('id_token');
    const refreshToken = localStorage.getItem('refresh_token');
    const expiresAt = localStorage.getItem('expires_at');
    const refreshExpiresAt = localStorage.getItem('refresh_expires_at');
    const nowUnixtime = DateTime.now().toUnixInteger();

    try {
      if (idToken && expiresAt && nowUnixtime < DateTime.fromISO(expiresAt).toUnixInteger() && user) {
        this.setSessionState('authenticated');

        const parsedUser = JSON.parse(user);
        if (parsedUser && this.current_user.getValue()?.user_id !== parsedUser.user_id) {
          this.current_user.next(parsedUser);
        }
        return;
      }

      if (refreshToken && refreshExpiresAt && nowUnixtime < DateTime.fromISO(refreshExpiresAt).toUnixInteger()) {
          const login = await firstValueFrom(this.client.observe(api.session.refresh(refreshToken)).pipe(timeout(REFRESH_TIMEOUT_MS)));
          this.setLogin(login);
          return;
      }

      this.setSessionState('anonymous');
    } catch (err: any) {
      console.log("auth error", err)

      if (err && 'status' in err && err.status === 401) {
        // Drop the session synchronously so callers waiting on this refresh see the
        // cleared state, then navigate without awaiting: the route guard waits on
        // this very promise, so awaiting the navigation here would deadlock.
        this.endSession();
        void this.logout('session-expired');
      } else if (isConnectionError(err)) {
        this.setSessionState('unreachable');
      }
    }
  }

  public async logout(reason?: LogoutReason) {
    // The side menu sets `pointer-events: none` on the main content while it is
    // open. Logout is usually triggered from that open menu, and flipping
    // `authenticated` to false immediately removes the menu (it is rendered with
    // *ngIf="authenticated"), so the menu never runs its close lifecycle that
    // restores pointer-events. The result is an unclickable app until a full
    // page reload. Close the menu first and wait for it before tearing it down.
    try {
      await this.menuCtrl.close();
    } catch (err) {}

    this.endSession();
    // Reset the Ionic navigation stack instead of pushing/popping. Navigating
    // with the plain Router pops back to the cached (and now detached) login
    // page that is still sitting in the ion-router-outlet stack, leaving it
    // unresponsive until a full page reload. navigateRoot rebuilds it fresh.
    await this.navCtrl.navigateRoot(['login'], reason ? { queryParams: { reason } } : {});
  }

  private endSession() {
    this.setSessionState('anonymous');
    if (this.current_user.getValue() !== null) {
      this.current_user.next(null);
    }
    localStorage.removeItem('id_token');
    localStorage.removeItem('user');
    localStorage.removeItem('expires_at');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('refresh_expires_at');
    // The image token is a 30-day JWT handed out next to the session tokens; leaving
    // it behind keeps a usable credential in storage after the user logs out.
    localStorage.removeItem('image_token');
  }

  public async changePassword(new_password:string) {
    await this.client.fetch(api.session.changePassword(new_password));
  }

  public async getPwToken(email:string) {
    await this.client.fetch(api.session.requestPasswordReset(email));
  }

  public async recoverPassword(new_password:string, token:string) {
    await this.client.fetch(api.session.resetPassword(new_password, token));
  }

  private setLogin(login: SessionData) {
    localStorage.setItem('id_token', login.userToken.token);
    localStorage.setItem('refresh_token', login.refreshToken.token);
    localStorage.setItem('image_token', login.imageToken.token);
    localStorage.setItem("expires_at", DateTime.now().plus({seconds: login.userToken.expiresIn - EXPIRE_SAFETY_SECONDS}).toString());
    localStorage.setItem("refresh_expires_at", DateTime.now().plus({seconds: login.refreshToken.expiresIn - EXPIRE_SAFETY_SECONDS}).toString());

    this.setSessionState('authenticated');

    if (login.user) {
      localStorage.setItem('user', JSON.stringify(login.user));

      if (this.current_user.getValue()?.user_id !== login.user?.user_id) {
        this.current_user.next(login.user);
      }
    } else {
      try {
        const parsedUser = JSON.parse(localStorage.getItem('user') || '');

        if (parsedUser && this.current_user.getValue()?.user_id !== parsedUser?.user_id) {
          this.current_user.next(parsedUser);
        }
      } catch (err) {}
    }

  }
}
