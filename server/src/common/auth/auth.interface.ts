export interface DataStoredInToken {
  user_id: string;
  is_admin: boolean;
  stay_logged_in?: boolean;
  /** Session from the demo login: read-only access to devices flagged as demo devices. */
  is_demo?: boolean;
  token_type: 'user' | 'refresh' | 'image';
  secret: string;
  /**
   * The session the token was handed out with, which is the row the caller is
   * resolved against on every request. Empty on the install's own automation
   * token, which belongs to a script and has no session and no account.
   */
  session_id?: string;
}
