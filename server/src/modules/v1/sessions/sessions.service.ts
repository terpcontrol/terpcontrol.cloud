import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
// A default import, not named ones: the package is CommonJS and exports its
// functions in a way a static ES module reader cannot see through, so named
// imports break wherever this file is loaded as an ES module.
import jwt from 'jsonwebtoken';
import { Model } from 'mongoose';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { AuthToken, AutomationSession, Session, SessionResult, SessionTokens, SessionUser } from '@fg2/shared-types/v1';
import { DataStoredInToken } from '@common/auth/auth.interface';
import { CursorPage, afterCursor, pageLimit, pageOf, readLimit } from '@common/v1/pages';
import { PageQuery } from '@common/v1/validation';
import { forbidden, notFound, unauthenticated } from '@common/v1/problem';
import { MODEL_V1 } from '@database/models';
import { StoredSession } from '@database/schemas/v1/sessions.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { authConfig } from '@config/configuration';
import { DEMO_USER_ID } from '@utils/demo';
import { AccountsService } from '../account/accounts.service';

/**
 * Signing in, renewing and signing out, and the record that makes a session a
 * thing a person can see on their account screen.
 *
 * A session is two halves. The signed tokens are what every request carries and
 * are verified without a lookup, which is what keeps a read cheap; the row in
 * `sessions` is what can be listed and revoked, and is what a renewal is checked
 * against. So revoking ends a session within the life of the user token it last
 * handed out - the renewal that would have replaced it finds no row.
 */

/**
 * The lifetimes, unchanged: a user token short enough that a leaked one is worth
 * little, a renewal that lasts the afternoon or the month depending on whether
 * the person asked to stay signed in, and a media token that outlives both
 * because it sits in the URL of a picture a page keeps showing.
 */
const USER_TOKEN_SECONDS = 5 * 60;
const REFRESH_SECONDS = 30 * 60;
const REFRESH_SECONDS_STAYING = 30 * 24 * 60 * 60;
const MEDIA_TOKEN_SECONDS = 30 * 24 * 60 * 60;

/** What the automation token buys: long enough to upload a firmware, and nothing to renew it with. */
const AUTOMATION_SECONDS = 5 * 60;

/**
 * What a `/v1` token carries. `session_id` is the addition: it is what a renewal
 * looks the row up by, and what lets a session revoke itself by the id it was
 * handed when it was opened.
 */
interface SessionClaims extends DataStoredInToken {
  session_id: string;
}

/** The three facts a token states about whoever it belongs to, and the only three. */
interface Principal {
  userId: string;
  isAdmin: boolean;
  isDemo: boolean;
}

/** The tour that needs no account: nobody's owner, nobody's member, and never privileged. */
const DEMO_USER: SessionUser = { id: DEMO_USER_ID, handle: 'demo', isAdmin: false, isDemo: true };

@Injectable()
export class SessionsService {
  constructor(
    @InjectModel(MODEL_V1.session) private readonly sessions: Model<StoredSession>,
    private readonly accounts: AccountsService,
    @Inject(authConfig.KEY) private readonly auth: ConfigType<typeof authConfig>,
  ) {}

  // ---------------------------------------------------------------------------
  // Opening one
  // ---------------------------------------------------------------------------

  /**
   * An unknown address and a wrong password are refused in the same words, so
   * that a stranger trying addresses learns nothing from what comes back. An
   * account that has not been activated is told so, because the person holding
   * it has the mail and needs to know that is what is missing.
   */
  public async logIn(email: string, password: string, stayLoggedIn: boolean, userAgent: string | null): Promise<SessionResult> {
    const user = await this.accounts.verify(email, password);
    if (!user) throw unauthenticated('credentials_wrong', 'That is not an address and password of an account here.');
    if (!user.isActive) throw forbidden('account_not_activated', 'This account still has to be activated with the code it was sent.');

    return this.open(user, stayLoggedIn, userAgent);
  }

  public async open(user: StoredUser, stayLoggedIn: boolean, userAgent: string | null): Promise<SessionResult> {
    return this.begin({ id: user.id, handle: user.handle, isAdmin: user.isAdmin, isDemo: false }, stayLoggedIn, userAgent);
  }

  /** Anyone may open the demo. It reads the objects marked as demo, redacted, and writes nothing. */
  public async openDemo(userAgent: string | null): Promise<SessionResult> {
    return this.begin(DEMO_USER, false, userAgent);
  }

  /**
   * The install's own token, traded for a short administrator session. It gets
   * no row and no renewal: it belongs to a script rather than to a person, so
   * there is no account screen to list it on, and a caller that needs longer
   * asks again.
   */
  public automation(token: string): AutomationSession {
    const expected = this.auth.automationToken;
    if (!expected || !sameSecret(token, expected)) {
      throw unauthenticated('automation_token_wrong', 'That is not this install´s automation token.');
    }

    return {
      userToken: this.tokenFor(
        { user_id: '', is_admin: true, is_demo: false, token_type: 'user', secret: randomUUID(), session_id: '' },
        AUTOMATION_SECONDS,
      ),
    };
  }

  // ---------------------------------------------------------------------------
  // Keeping one
  // ---------------------------------------------------------------------------

  /**
   * The refresh token is spent and a fresh triple comes back. The row is what
   * decides: it is gone when the session was revoked, and it expires on its own
   * when nobody came back for it, and either way there is nothing to renew.
   */
  public async refresh(refreshToken: string): Promise<SessionTokens> {
    const claims = this.claimsOf(refreshToken, 'refresh');

    const stayLoggedIn = claims.stay_logged_in === true;
    const session = await this.sessions.findOneAndUpdate(
      { id: claims.session_id, userId: claims.user_id },
      { $set: { lastSeenAt: new Date(), expiresAt: expiryOf(stayLoggedIn) } },
      { new: true },
    );
    if (!session) throw unauthenticated('session_gone', 'That session has been revoked or has run out.');

    // From the token rather than from the account: a renewal must not be the
    // moment at which somebody silently gains a flag they were given while
    // signed in.
    return this.tokensFor(claims.session_id, principalOf(claims), stayLoggedIn);
  }

  // ---------------------------------------------------------------------------
  // Listing and ending one
  // ---------------------------------------------------------------------------

  /** The caller's own sessions, most recently used first, which is the order the account screen shows. */
  public async list(userId: string, query: PageQuery): Promise<CursorPage<Session>> {
    const limit = pageLimit(query.limit);
    const rows = await this.sessions
      .find({ userId, ...afterCursor('lastSeenAt', query.cursor) })
      .sort({ lastSeenAt: -1, id: -1 })
      .limit(readLimit(limit))
      .lean();

    const page = pageOf(rows, limit, row => ({ at: row.lastSeenAt, id: row.id }));
    return { items: page.items.map(serialiseSession), nextCursor: page.nextCursor };
  }

  public async revoke(userId: string, id: string): Promise<void> {
    const ended = await this.sessions.deleteOne({ id, userId });
    if (ended.deletedCount === 0) throw notFound('session_not_found', 'You have no session with that id.');
  }

  /** Everything a deleted account was signed in with. */
  public async revokeAllOf(userId: string): Promise<void> {
    await this.sessions.deleteMany({ userId });
  }

  // ---------------------------------------------------------------------------
  // The shared half
  // ---------------------------------------------------------------------------

  private async begin(user: SessionUser, stayLoggedIn: boolean, userAgent: string | null): Promise<SessionResult> {
    const now = new Date();
    const id = randomUUID();

    await this.sessions.create({
      id,
      createdAt: now,
      userId: user.id,
      userAgent,
      lastSeenAt: now,
      expiresAt: expiryOf(stayLoggedIn),
    });

    return { ...this.tokensFor(id, { userId: user.id, isAdmin: user.isAdmin, isDemo: user.isDemo }, stayLoggedIn), sessionId: id, user };
  }

  /**
   * One session, three tokens. They differ in nothing but their type and their
   * lifetime, so that whichever of them a request carries says the same about
   * who is asking.
   */
  private tokensFor(sessionId: string, principal: Principal, stayLoggedIn: boolean): SessionTokens {
    const claims: Omit<SessionClaims, 'token_type'> = {
      user_id: principal.userId,
      is_admin: principal.isAdmin,
      is_demo: principal.isDemo,
      stay_logged_in: stayLoggedIn,
      // Part of the token shape the verifier expects, and read by nothing: which
      // session a token belongs to is `session_id`, in the open.
      secret: randomUUID(),
      session_id: sessionId,
    };

    return {
      userToken: this.tokenFor({ ...claims, token_type: 'user' }, USER_TOKEN_SECONDS),
      refreshToken: this.tokenFor({ ...claims, token_type: 'refresh' }, stayLoggedIn ? REFRESH_SECONDS_STAYING : REFRESH_SECONDS),
      mediaToken: this.tokenFor({ ...claims, token_type: 'image' }, MEDIA_TOKEN_SECONDS),
    };
  }

  private tokenFor(claims: SessionClaims, seconds: number): AuthToken {
    return {
      token: jwt.sign(claims, this.auth.secretKey, { expiresIn: seconds }),
      validUntil: new Date(Date.now() + seconds * 1000).toISOString(),
    };
  }

  /** A token handed in rather than sent as a bearer, which is what a renewal is. */
  private claimsOf(token: string, expected: DataStoredInToken['token_type']): SessionClaims {
    let claims: SessionClaims;
    try {
      claims = jwt.verify(token, this.auth.secretKey) as unknown as SessionClaims;
    } catch {
      throw unauthenticated('token_invalid', 'That token is not one this server signed, or it has run out.');
    }

    if (claims.token_type !== expected || !claims.session_id) {
      throw unauthenticated('token_invalid', `This route takes a ${expected} token.`);
    }

    return claims;
  }
}

const principalOf = (claims: SessionClaims): Principal => ({
  userId: claims.user_id,
  isAdmin: claims.is_admin === true,
  isDemo: claims.is_demo === true,
});

const expiryOf = (stayLoggedIn: boolean): Date => new Date(Date.now() + (stayLoggedIn ? REFRESH_SECONDS_STAYING : REFRESH_SECONDS) * 1000);

const serialiseSession = (session: StoredSession): Session => ({
  id: session.id,
  createdAt: session.createdAt.toISOString(),
  userId: session.userId,
  userAgent: session.userAgent,
  lastSeenAt: session.lastSeenAt.toISOString(),
  expiresAt: session.expiresAt.toISOString(),
});

/**
 * A comparison whose duration says nothing about how much of the secret was
 * right. Both sides are padded to one length first, because the comparison
 * itself refuses buffers of different sizes - and the lengths are compared
 * afterwards, so a prefix is not accepted.
 */
const sameSecret = (supplied: string, expected: string): boolean => {
  const width = Math.max(supplied.length, expected.length, 32);
  const a = Buffer.alloc(width);
  const b = Buffer.alloc(width);
  a.write(supplied, 0, 'utf8');
  b.write(expected, 0, 'utf8');

  return timingSafeEqual(a, b) && supplied.length === expected.length;
};
