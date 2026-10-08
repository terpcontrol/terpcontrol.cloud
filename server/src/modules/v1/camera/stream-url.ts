import { withoutCredentials } from '@common/log-path';

/**
 * The address an RTSP stream is opened at, and the login written into it.
 *
 * The login lives inside the URL, because that is what ffmpeg opens, and it is
 * never answered back - not even to the owner. So a person correcting the
 * address of a camera whose router handed it a new IP cannot send the whole URL
 * again: they never see the password in it. A URL that carries no login of its
 * own is therefore read as the same camera somewhere else and keeps the login
 * stored, and the login is changed on its own through `username` and
 * `password`. Writing those into the URL here, rather than having the client
 * splice them in, is also what keeps a password with an `@` or a `:` in it
 * from breaking the address: the URL encodes both, and ffmpeg decodes them.
 */
interface StreamChange {
  url?: string;
  /** Replaces the login name; empty takes it away. */
  username?: string;
  /** Replaces the password; empty takes it away. */
  password?: string;
}

/** Whether a change touches the stored URL at all. */
export const changesTheStream = (change: StreamChange): boolean =>
  change.url !== undefined || change.username !== undefined || change.password !== undefined;

/**
 * The URL a stream is opened at once `change` is applied to `stored`. An
 * address that is not a URL is kept exactly as it was sent: there is nothing
 * to write a login into, and the first capture is what says it is wrong.
 */
export const streamUrl = (stored: string | null, change: StreamChange): string | null => {
  const named = change.url ?? stored;
  if (named === null) return null;

  const next = parsed(named);
  if (!next) return named;

  const before = stored === null ? null : parsed(stored);
  if (change.url !== undefined && !hasLogin(next) && before) {
    // Copied as it is stored, which is already encoded: the setters leave `%` alone.
    next.username = before.username;
    next.password = before.password;
  }
  if (change.username !== undefined) next.username = change.username;
  if (change.password !== undefined) next.password = change.password;

  return next.toString();
};

/**
 * The stream URL as it is answered: the credentials it is opened with are the
 * server's to keep, and the owner is no more entitled to read them back than
 * anybody else. A value that is not a URL at all is redacted by pattern, so a
 * malformed one cannot carry a password out.
 */
export const withoutUserInfo = (url: string | null): string | null => {
  if (url === null) return null;

  const read = parsed(url);
  if (!read) return withoutCredentials(url);

  read.username = '';
  read.password = '';
  return read.toString();
};

const hasLogin = (url: URL): boolean => url.username !== '' || url.password !== '';

const parsed = (url: string): URL | null => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};
