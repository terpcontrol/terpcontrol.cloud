import { Request } from 'express';
import { ShareLink } from '@fg2/shared-types';

export interface DataStoredInToken {
  user_id: string;
  is_admin: boolean;
  stay_logged_in?: boolean;
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
  /** Set when the request was authorized through a share link instead of ownership. */
  share?: ShareLink;
}

export interface RequestWithToken extends Request {
  token: string;
}
