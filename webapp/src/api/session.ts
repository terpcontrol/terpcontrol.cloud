import { useSyncExternalStore } from 'react';
import type { SessionCreate, SessionResult, SessionTokens, SessionUser } from '@fg2/shared-types/v1';
import { serverNow } from './clock';
import { v1 } from './config';
import { ApiError, readProblem } from './problem';

/**
 * The session the API expects: a short-lived bearer token for every call, a
 * refresh token that buys new ones, and a media token that rides in the query
 * string of a picture's URL because an <img> cannot carry a header.
 *
 * It lives outside React so the fetch wrapper can reach it without a hook, and
 * so exactly one refresh is in flight however many requests are waiting.
 */

export interface Tokens {
  userToken: string;
  userTokenUntil: number;
  refreshToken: string;
  refreshTokenUntil: number;
  mediaToken: string;
  /** Kept so a refresh can tell a media token with weeks left from one about to die. */
  mediaTokenUntil: number;
}

export interface SessionState {
  user: SessionUser | null;
  tokens: Tokens | null;
  /** How this session ends itself on the server. */
  sessionId: string | null;
  /** False until the stored refresh token has been tried, so nothing redirects too early. */
  restored: boolean;
  /**
   * True when the stored session could not be tried rather than tried and
   * refused: the server answered with a fault of its own, or nothing answered
   * at all.
   *
   * It is not a signed-out state and must not be drawn as one. The refresh
   * token is still in local storage and is still good; what is missing is an
   * answer, and the honest thing to say is that the server cannot be reached
   * and that trying again is worth doing. Sending somebody to the sign-in form
   * instead asks them for a password to solve an outage.
   */
  unreachable: boolean;
  /**
   * True once the server refused the session this tab was using, rather than
   * somebody signing out or never having signed in. The sign-in form says so:
   * a page that turns into a bare form a second after a refusal otherwise
   * looks like the app broke.
   */
  ended: boolean;
}

const STORAGE_KEY = 'terp.session';

/**
 * The one answer to a refresh that means the session itself is gone, and so the
 * one that may take the stored token with it. The server answers it for every
 * token it refuses, and for nothing else.
 */
const SESSION_IS_GONE = 401;

/** Refresh this long before the token actually dies, so a slow request does not race its own expiry. */
const REFRESH_MARGIN_MS = 30_000;

/**
 * How near its end a media token has to be before a refresh swaps it.
 *
 * A generous margin, because a picture's URL is not renewed the way a request
 * is: it is whatever was put in an `src` when the element was drawn, and a card
 * that nothing has re-rendered goes on asking for the same address. A day is
 * far longer than any tab stays open on one page, and nothing against the
 * thirty days the token lasts.
 */
const MEDIA_MARGIN_MS = 24 * 60 * 60 * 1000;

interface Stored {
  refreshToken: string;
  /**
   * When the server said this token dies. Kept as the record of what it said,
   * and deliberately not what decides whether to try it: the instant would have
   * to be read against this browser's clock, and at boot nothing has answered
   * yet for `serverNow` to correct one that is wrong. A phone a day fast would
   * throw away a session that is perfectly good. The server is asked instead.
   */
  refreshTokenUntil: number;
  user: SessionUser;
  sessionId: string;
  stayLoggedIn: boolean;
}

const stores = (): Storage[] => {
  try {
    return [localStorage, sessionStorage];
  } catch {
    // A browser with site data blocked: the session then lasts as long as the tab.
    return [];
  }
};

/**
 * The session as it was left. A value that will not parse is removed, which is
 * the one thing thrown away here that no server answer decided - and it is not
 * a session being ended: nothing can be refreshed from a string that is not
 * JSON, and leaving it would make every later boot fail on it again.
 */
const readStored = (): Stored | null => {
  for (const store of stores()) {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) continue;
    try {
      return JSON.parse(raw) as Stored;
    } catch {
      store.removeItem(STORAGE_KEY);
    }
  }
  return null;
};

const writeStored = (value: Stored | null) => {
  for (const store of stores()) store.removeItem(STORAGE_KEY);
  if (!value) return;
  const [forever, forThisTab] = stores();
  const target = value.stayLoggedIn ? forever : forThisTab;
  target?.setItem(STORAGE_KEY, JSON.stringify(value));
};

/**
 * What the server just answered, except that a media token still good for
 * weeks is kept rather than replaced.
 *
 * The bearer token is renewed every few minutes, and the media token rides in
 * the query string of every picture's URL because an `<img>` cannot carry a
 * header. Taking the new one each time therefore rewrites the address of every
 * picture on screen, and the browser fetches again what it already has - most
 * visibly on the timeline, where playing the same day twice downloads the same
 * ninety frames twice.
 *
 * Keeping the old one is safe because the server does not care which refresh
 * issued it: a media token is verified by its signature and its type, and by
 * nothing else - not the session it came from, not the `secret` claim inside
 * it, which is read by nothing. So the one in hand is exactly as good as the
 * one just offered, and a month long.
 *
 * `held` is the session's own tokens, and is null when there is no session to
 * carry anything over from - at sign-in, where the token belongs to whoever
 * just signed in, and at boot, where nothing is held yet.
 */
const tokensOf = (result: SessionTokens, held: Tokens | null): Tokens => {
  // An unparsable date leaves `keep` false, so a token nobody can date is
  // replaced rather than trusted. Every `validUntil` here was written by the
  // server, and the server is what will refuse the token, so how long is left
  // is asked of its clock rather than of this browser's.
  const keep = held !== null && held.mediaTokenUntil - MEDIA_MARGIN_MS > serverNow().toMillis();

  return {
    userToken: result.userToken.token,
    userTokenUntil: Date.parse(result.userToken.validUntil),
    refreshToken: result.refreshToken.token,
    refreshTokenUntil: Date.parse(result.refreshToken.validUntil),
    mediaToken: keep ? held.mediaToken : result.mediaToken.token,
    mediaTokenUntil: keep ? held.mediaTokenUntil : Date.parse(result.mediaToken.validUntil),
  };
};

class SessionStore {
  private state: SessionState = { user: null, tokens: null, sessionId: null, restored: false, unreachable: false, ended: false };
  private listeners = new Set<() => void>();
  private stayLoggedIn = false;
  private inFlight: Promise<Tokens | null> | null = null;

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public snapshot = (): SessionState => this.state;

  private publish(next: Partial<SessionState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  /** Signs in and keeps the session. */
  public logIn(credentials: SessionCreate): Promise<SessionUser> {
    return this.open('/sessions', credentials, credentials.stayLoggedIn === true);
  }

  /** The demo needs no account and sends nothing; it lasts as long as the tab. */
  public openDemo(): Promise<SessionUser> {
    return this.open('/sessions/demo', undefined, false);
  }

  private async open(path: string, body: unknown, stayLoggedIn: boolean): Promise<SessionUser> {
    const response = await fetch(v1(path), {
      method: 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new ApiError(await readProblem(response));

    const result = (await response.json()) as SessionResult;
    this.stayLoggedIn = stayLoggedIn;
    // Nothing is carried over: whoever signs in here gets their own media
    // token, and never the one the last person to use this tab was given.
    const tokens = tokensOf(result, null);
    this.publish({ user: result.user, tokens, sessionId: result.sessionId, restored: true, unreachable: false, ended: false });
    writeStored({
      refreshToken: tokens.refreshToken,
      refreshTokenUntil: tokens.refreshTokenUntil,
      user: result.user,
      sessionId: result.sessionId,
      stayLoggedIn,
    });
    return result.user;
  }

  /** Ends the session on the server too, so a stolen refresh token buys nothing; forgetting it locally comes first. */
  public async logOut(): Promise<void> {
    const { sessionId, tokens } = this.state;
    this.forget();
    if (sessionId && tokens) {
      await fetch(v1(`/sessions/${sessionId}`), { method: 'DELETE', headers: { Authorization: `Bearer ${tokens.userToken}` } }).catch(
        () => undefined,
      );
    }
  }

  /**
   * Throws the session away, here and in storage. Only two things may call it:
   * signing out, and an answer that says the session is gone. Anything else -
   * a server fault, a proxy restarting, a phone in a lift - leaves the tokens
   * where they are, because a session nobody could ask about is not a session
   * that ended.
   */
  private forget(ended = false) {
    writeStored(null);
    this.publish({ user: null, tokens: null, sessionId: null, restored: true, unreachable: false, ended });
  }

  /**
   * Turns whatever was stored into a live session, at boot - and again after an
   * attempt that ended in no answer, which is what the "try again" on the
   * unreachable screen asks for. An attempt the server did answer is final:
   * there is nothing left in storage to try a second time.
   */
  public async restore(): Promise<void> {
    if (this.state.restored && !this.state.unreachable) return;
    const stored = readStored();
    if (!stored) {
      this.publish({ restored: true, unreachable: false });
      return;
    }

    // The stored token is spent whatever this browser thinks of the hour: how
    // long is left in it is the server's to say, and it says so with the one
    // answer that ends a session. A token that really has run out costs one
    // request and once only, because the 401 it comes back with clears it.
    this.stayLoggedIn = stored.stayLoggedIn;
    this.publish({ user: stored.user, tokens: null, sessionId: stored.sessionId });
    const tokens = await this.refresh(stored.refreshToken);
    this.publish({ user: tokens ? stored.user : null, restored: true });
  }

  /** A token good for the next call, refreshing first when the one in hand is about to die. */
  public async validToken(): Promise<string | null> {
    const tokens = this.state.tokens;
    if (tokens && tokens.userTokenUntil - REFRESH_MARGIN_MS > serverNow().toMillis()) return tokens.userToken;
    const refreshed = await this.refresh(tokens?.refreshToken ?? readStored()?.refreshToken);
    return refreshed?.userToken ?? null;
  }

  public mediaToken(): string | null {
    return this.state.tokens?.mediaToken ?? null;
  }

  /** One refresh at a time: everything that asked while it ran gets its result. */
  public refresh(refreshToken: string | null | undefined): Promise<Tokens | null> {
    if (!refreshToken) return Promise.resolve(null);
    this.inFlight ??= this.doRefresh(refreshToken).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /**
   * Spends the refresh token, and decides what a failure means.
   *
   * Only an answer that says the session is gone may end it. The server refuses
   * a refresh token with 401 and with nothing else - an unreadable or expired
   * signature, a token of the wrong type, a session row that was revoked or ran
   * out are all `unauthenticated` - so 401 is the one answer that carries "there
   * is nothing here to renew". A 500, a 502 from a proxy while the server
   * restarts, or a request that never arrived say only that this minute was a
   * bad one, and the difference is somebody signed out of their tent while the
   * alarm they are watching is still ringing. The tokens are kept in every one
   * of those cases: the screen says the server cannot be reached, and the next
   * attempt, on this page or the next load, signs them back in without a
   * password.
   */
  private async doRefresh(refreshToken: string): Promise<Tokens | null> {
    let response: Response;
    try {
      response = await fetch(v1('/sessions/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // Nothing reached the server: no connection, a name that would not
      // resolve, a request cut off. It is also the one failure that used to
      // reject out of the caller and leave the boot unfinished, so it is
      // answered as a refresh that did not happen rather than thrown on.
      this.publish({ unreachable: true });
      return null;
    }

    if (!response.ok) {
      if (response.status === SESSION_IS_GONE) this.forget(true);
      else this.publish({ unreachable: true });
      return null;
    }

    const tokens = tokensOf((await response.json()) as SessionTokens, this.state.tokens);
    this.publish({ tokens, unreachable: false });
    const { user, sessionId } = this.state;
    if (user && sessionId) {
      writeStored({
        refreshToken: tokens.refreshToken,
        refreshTokenUntil: tokens.refreshTokenUntil,
        user,
        sessionId,
        stayLoggedIn: this.stayLoggedIn,
      });
    }
    return tokens;
  }
}

export const session = new SessionStore();

export const useSession = (): SessionState => useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);

/**
 * Where a picture is. The media token is the only thing the API accepts in a
 * URL, and only on `/v1/media/...`, which is what an <img> or a <video> needs.
 *
 * `width` asks for a thumbnail: the server resizes on the way out and never
 * enlarges, so a strip of seven thumbnails costs seven small pictures rather
 * than seven whole stills. In device pixels, so a caller doubles what it draws.
 */
export const mediaUrl = (mediaId: string, width?: number): string | null => {
  const token = session.mediaToken();
  if (!token) return null;

  const query = new URLSearchParams({ token });
  if (width) query.set('width', String(width));

  return `${v1(`/media/${mediaId}/content`)}?${query.toString()}`;
};

/** The widths the small pictures are asked for at: twice what they are drawn at, for a phone's screen. */
export const THUMBNAIL_WIDTH = { cover: 96, dayTile: 200, still: 240, strip: 320, frame: 720 } as const;
