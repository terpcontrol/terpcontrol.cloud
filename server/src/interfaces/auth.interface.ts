import { Request } from 'express';
import { ShareLink } from '@fg2/shared-types';
import { Schluessel } from '@interfaces/schluessel.interface';

export interface DataStoredInToken {
  user_id: string;
  is_admin: boolean;
  stay_logged_in?: boolean;
  /** Session from the demo login: read-only access to devices flagged as demo devices. */
  is_demo?: boolean;
  token_type: 'user' | 'refresh' | 'image';
  secret: string;
}

export interface TokenData {
  token: string;
  expiresIn: number;
  secret: string;
}

export interface RequestWithUser extends Request {
  user_id: string;
  is_admin: boolean;
  /** Set when the request was authorized by a demo session instead of an account. */
  is_demo?: boolean;
  /** Set when the request was authorized through a share link instead of ownership. */
  share?: ShareLink;
  /** Set when a club write key authorized the request. Every Ding it writes is attributed to its `mensch_ding_id`. */
  schluessel?: Schluessel;
}

export interface RequestWithToken extends Request {
  token: string;
}
