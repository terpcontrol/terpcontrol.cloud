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
