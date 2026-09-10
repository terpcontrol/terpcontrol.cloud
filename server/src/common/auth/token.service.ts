import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { FastifyRequest } from 'fastify';
import { verify } from 'jsonwebtoken';
import { DataStoredInToken } from '@common/auth/auth.interface';
import { authConfig } from '../../config/configuration';

export type TokenType = DataStoredInToken['token_type'];

export interface AuthContext {
  userId: string;
  isAdmin: boolean;
  isDemo: boolean;
}

/** Requests carrying an authenticated caller, and optionally a share link. */
export interface AuthenticatedRequest extends FastifyRequest {
  auth?: AuthContext;
  share?: import('@fg2/shared-types').ShareLink;
}

// A picture is fetched by <img>, which cannot set headers, so those URLs may
// carry the token in the query string. Nothing else accepts one there - and the
// router matches whatever the case, so this has to recognise `/Image/` too.
const isImageQueryTokenAllowed = (request: FastifyRequest): boolean =>
  request.method === 'GET' && (request.url ?? '').split('?')[0].toLowerCase().startsWith('/image/');

// A full user session is at least as privileged as the URL-embeddable image token.
const matchesTokenType = (actual: TokenType, expected: TokenType): boolean => actual === expected || (expected === 'image' && actual === 'user');

@Injectable()
export class TokenService {
  constructor(@Inject(authConfig.KEY) private readonly auth: ConfigType<typeof authConfig>) {}

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

    if (isImageQueryTokenAllowed(request)) {
      const queryToken = (request.query as Record<string, unknown> | undefined)?.token;
      if (typeof queryToken === 'string') found.push(queryToken);
    }

    return found;
  }

  /** The first candidate that verifies and is of the expected type. */
  public async verifyFirst(request: FastifyRequest, tokenType: TokenType = 'user'): Promise<DataStoredInToken | null> {
    for (const candidate of this.candidates(request)) {
      try {
        const verified = (await verify(candidate, this.auth.secretKey)) as DataStoredInToken;
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
      return (await verify(token, this.auth.secretKey)) as DataStoredInToken;
    } catch {
      return null;
    }
  }

  public toContext(token: DataStoredInToken): AuthContext {
    const isDemo = !!token.is_demo;
    return {
      userId: token.user_id,
      // A demo session is never an account, and never privileged.
      isDemo,
      isAdmin: !isDemo && !!token.is_admin,
    };
  }
}
