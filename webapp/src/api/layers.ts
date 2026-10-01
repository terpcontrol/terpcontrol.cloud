import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DiaryChoice, Me } from '@fg2/shared-types/v1';
import { meKey, useMe } from './account';
import { api } from './client';
import { useHomeShape } from './home';
import { useSession } from './session';

/**
 * Whether the grow diary is laid over the climate - grows, diary lines and the
 * invitations to either - as the server worked it out for this account. The
 * home answers it beside its cards and the account beside itself, and the two
 * can disagree for a moment: starting a grow reads the home again, and the
 * account only when somebody asks. The fresher of the two answers, so the bar,
 * Start and the cockpit change together.
 *
 * Undefined until either has answered. The demo is shown everything.
 */
export const useDiaryAnswer = (): boolean | undefined => {
  const { user } = useSession();
  const me = useMe(false, user !== null && user.isDemo !== true);
  const home = useHomeShape(user !== null);
  if (user?.isDemo === true) return true;

  const fromHome = home.data?.layers?.diary;
  const fromMe = me.data?.layers?.diary;
  if (fromHome === undefined) return fromMe;
  if (fromMe === undefined) return fromHome;
  return home.dataUpdatedAt >= me.dataUpdatedAt ? fromHome : fromMe;
};

/**
 * The same answer for a screen that draws now: until it is there, and from a
 * server too old to give one, the diary is shown, which is the app as it has
 * always been.
 */
export const useDiaryLayer = (): boolean => useDiaryAnswer() ?? true;

/**
 * An answer about the diary, kept with the account so that every device agrees:
 * `on` and `off` win over what the account has used, and null hands the
 * question back to it. The preferences travel whole, so the account is read
 * fresh first rather than sent back as some screen last saw it; the home is
 * read again afterwards, because its cards are what the answer changes.
 */
export const useChooseDiary = () => {
  const client = useQueryClient();

  return useMutation({
    mutationKey: meKey,
    mutationFn: async (diary: DiaryChoice | null) => {
      const me = await client.fetchQuery({ queryKey: meKey, queryFn: ({ signal }) => api.get<Me>('/me', undefined, signal) });
      return api.patch<Me>('/me', { preferences: { ...me.preferences, diary } });
    },
    onSuccess: async me => {
      client.setQueryData(meKey, me);
      await client.invalidateQueries({ queryKey: ['home'] });
    },
  });
};
