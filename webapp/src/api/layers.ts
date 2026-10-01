import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DiaryChoice, Me } from '@fg2/shared-types/v1';
import { meKey, useMe } from './account';
import { api } from './client';
import { useSession } from './session';

/**
 * Whether the grow diary is laid over the climate - grows, diary lines and the
 * invitations to either - as the server worked it out for this account. The
 * home answers it beside its cards and the account beside itself; a screen that
 * has neither to hand asks the account, which is read once rather than polled.
 *
 * Until an answer is there, and from a server too old to give one, the diary is
 * shown: that is the app as it has always been, and the demo tour is shown
 * everything anyway.
 */
export const useDiaryLayer = (): boolean => {
  const { user } = useSession();
  const me = useMe(false, user !== null && user.isDemo !== true);

  return me.data?.layers?.diary ?? true;
};

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
