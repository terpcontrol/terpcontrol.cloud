import { AuthContext } from '@common/auth/token.service';
import { forbidden } from '@common/v1/problem';

/**
 * Whose account a route about an account is for.
 *
 * A demo session is a tour rather than an account: it has no row in `users`, so
 * there is nothing of its own for it to read or change, and it is told that
 * rather than being handed somebody else's or an empty answer.
 */
export const accountOf = (caller: AuthContext): string => {
  if (caller.isDemo || !caller.userId) throw forbidden('no_account', 'This route is about an account, and a demo session is not one.');

  return caller.userId;
};
