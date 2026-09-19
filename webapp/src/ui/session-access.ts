import { useSession } from '@/api/session';

/**
 * Whether this session may change hardware: a socket's override, a camera's
 * settings, a film it is asked to render.
 *
 * It is the same answer `useMayLog` gives today, and deliberately its own
 * question: the demo is the one session that may only look, and the server
 * refuses every write it makes, so a switch it could tap is a switch that would
 * be refused. Memberships, which separate logging from managing, arrive with
 * round 13, and this is where that difference will be read off.
 */
export const useMayManage = (): boolean => {
  const { user } = useSession();

  return user !== null && !user.isDemo;
};
