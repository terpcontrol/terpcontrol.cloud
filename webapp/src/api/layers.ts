import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DiaryChoice, LayoutSeen, Me } from '@fg2/shared-types/v1';
import { useAccountMe } from '@/ui/session-access';
import { meKey } from './account';
import { api } from './client';
import { useHomeShape } from './home';
import { useSession } from './session';
import { useWrite } from './write';

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
  const me = useAccountMe();
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
 * question back to it. Only the one preference is sent - the server keeps the
 * rest as stored - and the home is read again afterwards, because its cards are
 * what the answer changes.
 */
export const useChooseDiary = () => {
  const client = useQueryClient();

  return useMutation({
    mutationKey: meKey,
    mutationFn: (diary: DiaryChoice | null) => api.patch<Me>('/me', { preferences: { diary } }),
    onSuccess: async me => {
      client.setQueryData(meKey, me);
      await client.invalidateQueries({ queryKey: ['home'] });
    },
  });
};

/**
 * Records the shape of the app this person has now been shown, so the change
 * it explains is explained once - on this phone and on every other. Like the
 * diary answer it names its one preference and nothing else, so a zone adopted
 * in the same second is not written back over.
 */
export const useSeeLayout = () =>
  useWrite(
    (layoutSeen: LayoutSeen) => api.patch<Me>('/me', { preferences: { layoutSeen } }),
    (client, me) => client.setQueryData(meKey, me),
  );
