import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { FastifyRequest } from 'fastify';
// A default import, not a named one: the package is CommonJS and exports its
// functions in a way a static ES module reader cannot see through, so a named
// import breaks wherever this file is loaded as an ES module.
import jwt from 'jsonwebtoken';
import { Model } from 'mongoose';
import { DataStoredInToken } from '@common/auth/auth.interface';
import { MODEL_V1 } from '@database/models';
import { StoredSession } from '@database/schemas/v1/sessions.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { authConfig } from '../../config/configuration';

export type TokenType = DataStoredInToken['token_type'];

export interface AuthContext {
  userId: string;
  isAdmin: boolean;
  isDemo: boolean;
  /**
   * Which session this request came in on, so that the two things an account
   * does to its own sessions - ending all the others, and changing the password
   * - can spare the browser doing them. The install's automation token names
   * none, because it is a script rather than somebody signed in.
   */
  sessionId: string | null;
}

/** Requests carrying an authenticated caller. */
export interface AuthenticatedRequest extends FastifyRequest {
  auth?: AuthContext;
}

// A picture is fetched by <img>, which cannot set headers, so those URLs may
// carry the token in the query string. Nothing else accepts one there - and the
// router matches whatever the case, so this compares the path in one.
const isMediaQueryTokenAllowed = (request: FastifyRequest): boolean =>
  request.method === 'GET' && (request.url ?? '').split('?')[0].toLowerCase().startsWith('/v1/media/');

// A full user session is at least as privileged as the URL-embeddable image token.
const matchesTokenType = (actual: TokenType, expected: TokenType): boolean => actual === expected || (expected === 'image' && actual === 'user');

/** What the one lookup answers about the row behind a token. */
interface CallerRow {
  isAdmin?: boolean;
  isActive?: boolean;
  deletionStartedAt?: Date | null;
}

@Injectable()
export class TokenService {
  constructor(
    @InjectModel(MODEL_V1.session) private readonly sessions: Model<StoredSession>,
    @InjectModel(MODEL_V1.user) private readonly users: Model<StoredUser>,
    @Inject(authConfig.KEY) private readonly auth: ConfigType<typeof authConfig>,
  ) {}

  /**
   * Every token a request may carry. The browser attaches the Authorization
   * cookie even to <img> requests whose URL carries an image token, so all
   * candidates are considered rather than just the first.
   */
  public candidates(request: FastifyRequest): string[] {
    const found: string[] = [];

    const fromCookie = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies?.['Authorization'];
    if (fromCookie) found.push(fromCookie);

    const header = request.headers.authorization;
    if (header) {
      const bearer = header.split('Bearer ')[1];
      if (bearer) found.push(bearer);
    }

    if (isMediaQueryTokenAllowed(request)) {
      const queryToken = (request.query as Record<string, unknown> | undefined)?.token;
      if (typeof queryToken === 'string') found.push(queryToken);
    }

    return found;
  }

  /** The first candidate that verifies and is of the expected type. */
  public async verifyFirst(request: FastifyRequest, tokenType: TokenType = 'user'): Promise<DataStoredInToken | null> {
    for (const candidate of this.candidates(request)) {
      try {
        const verified = (await jwt.verify(candidate, this.auth.secretKey)) as unknown as DataStoredInToken;
        if (verified.user_id && matchesTokenType(verified.token_type, tokenType)) {
          return verified;
        }
      } catch {
        // Invalid or expired: try the next one.
      }
    }

    return null;
  }

  /** Only the cookie and the Authorization header, as the admin routes accept. */
  public async verifySessionToken(request: FastifyRequest): Promise<DataStoredInToken | null> {
    const cookie = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies?.['Authorization'];
    const header = request.headers.authorization?.split('Bearer ')[1];
    const token = cookie || header;
    if (!token) return null;

    try {
      return (await jwt.verify(token, this.auth.secretKey)) as unknown as DataStoredInToken;
    } catch {
      return null;
    }
  }

  /**
   * Who is calling, decided against the rows rather than against the token
   * alone - and `null` for a token that no longer answers to anybody.
   *
   * A signed token states what was true when it was handed out, and a user
   * token states it for five more minutes afterwards. That window is long
   * enough for a deleted account to rebuild what the cascade has just taken
   * apart, for a revoked session to go on being a session, and for an
   * administrator who was demoted or deactivated to stay one. So every
   * authenticated request resolves its caller here, in the one place all three
   * guards go through, and reads the two rows that decide it:
   *
   * - the **session**, which the cascade deletes first and which
   *   `DELETE /v1/sessions/{id}` deletes on its own, so revoking means revoked;
   * - the **account**, whose `isAdmin` is what privilege the request really
   *   has, and which answers for nobody once it is inactive or marked for
   *   deletion.
   *
   * One round trip reads both: the session is matched on its unique id and the
   * account joined to it on its own. A caller that is not there is refused in
   * the same words as a token that was never signed here, so nothing in the
   * answer says whether an account once existed.
   */
  public async resolve(token: DataStoredInToken): Promise<AuthContext | null> {
    // The install's own automation token belongs to a script rather than to a
    // person: it names neither a session nor an account, so there is no row
    // that could have stopped answering for it.
    if (!token.session_id && !token.user_id) {
      return { userId: '', isAdmin: !!token.is_admin, isDemo: false, sessionId: null };
    }
    if (!token.session_id || !token.user_id) return null;

    const [caller] = await this.sessions.aggregate<CallerRow>([
      { $match: { id: token.session_id, userId: token.user_id } },
      { $limit: 1 },
      { $lookup: { from: this.users.collection.name, localField: 'userId', foreignField: 'id', as: 'account' } },
      {
        $project: {
          _id: 0,
          isAdmin: { $arrayElemAt: ['$account.isAdmin', 0] },
          isActive: { $arrayElemAt: ['$account.isActive', 0] },
          deletionStartedAt: { $arrayElemAt: ['$account.deletionStartedAt', 0] },
        },
      },
    ]);
    if (!caller) return null;

    // The demo is not an account: it has a session so that it can be listed and
    // ended, and no row of its own, and it is never privileged.
    if (token.is_demo) return { userId: token.user_id, isAdmin: false, isDemo: true, sessionId: token.session_id };

    if (caller.isActive !== true || caller.deletionStartedAt != null) return null;

    return { userId: token.user_id, isAdmin: caller.isAdmin === true, isDemo: false, sessionId: token.session_id };
  }
}
