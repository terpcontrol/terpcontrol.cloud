import { useSyncExternalStore } from 'react';
import type { SessionCreate, SessionResult, SessionTokens, SessionUser } from '@fg2/shared-types/v1';
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
}

export interface SessionState {
  user: SessionUser | null;
  tokens: Tokens | null;
  /** How this session ends itself on the server. */
  sessionId: string | null;
  /** False until the stored refresh token has been tried, so nothing redirects too early. */
  restored: boolean;
}

const STORAGE_KEY = 'terp.session';

/** Refresh this long before the token actually dies, so a slow request does not race its own expiry. */
const REFRESH_MARGIN_MS = 30_000;

interface Stored {
  refreshToken: string;
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

const tokensOf = (result: SessionTokens): Tokens => ({
  userToken: result.userToken.token,
  userTokenUntil: Date.parse(result.userToken.validUntil),
  refreshToken: result.refreshToken.token,
  refreshTokenUntil: Date.parse(result.refreshToken.validUntil),
  mediaToken: result.mediaToken.token,
});

class SessionStore {
  private state: SessionState = { user: null, tokens: null, sessionId: null, restored: false };
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
    const tokens = tokensOf(result);
    this.publish({ user: result.user, tokens, sessionId: result.sessionId, restored: true });
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

  private forget() {
    writeStored(null);
    this.publish({ user: null, tokens: null, sessionId: null, restored: true });
  }

  /** Turns whatever was stored into a live session, once, at boot. */
  public async restore(): Promise<void> {
    if (this.state.restored) return;
    const stored = readStored();
    if (!stored || stored.refreshTokenUntil <= Date.now()) {
      this.publish({ restored: true });
      return;
    }
    this.stayLoggedIn = stored.stayLoggedIn;
    this.publish({ user: stored.user, tokens: null, sessionId: stored.sessionId });
    const tokens = await this.refresh(stored.refreshToken);
    this.publish({ user: tokens ? stored.user : null, restored: true });
  }

  /** A token good for the next call, refreshing first when the one in hand is about to die. */
  public async validToken(): Promise<string | null> {
    const tokens = this.state.tokens;
    if (tokens && tokens.userTokenUntil - REFRESH_MARGIN_MS > Date.now()) return tokens.userToken;
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

  private async doRefresh(refreshToken: string): Promise<Tokens | null> {
    const response = await fetch(v1('/sessions/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) {
      this.forget();
      return null;
    }

    const tokens = tokensOf((await response.json()) as SessionTokens);
    this.publish({ tokens });
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
export const THUMBNAIL_WIDTH = { cover: 96, dayTile: 200, still: 240, frame: 720 } as const;
