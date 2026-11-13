import { useOpenAlerts } from '@/api/alerts';
import { itemsOf } from '@/api/pages';
import { useOfferedUpdates } from '@/screens/devices/firmware-builds';
import { useDue } from '@/screens/start/due';
import { useNow } from '@/ui/useNow';

/** What the bell carries, and whether it is something open (amber) or only work that is due (the brand's blue). */
interface Bell {
  text: string;
  key: string;
  count: number;
  kind: 'alerts' | 'tasks';
}

/** The largest number the bell draws. Beyond it the badge says so rather than counting a page that is not the whole of it. */
const MANY_OPEN = 99;

/**
 * The badge on the bell, counted from what the inbox lists, so the two agree.
 * What is open is what it is for and is counted first: the alerts still
 * standing, and an update that waits for somebody's word. A count taken from
 * one page of alerts would understate an account with more than fits on it,
 * so that one says "99+" and means it. Where nothing is open, what is due for
 * the reader is counted instead, in a quieter colour.
 * Nothing at all while there is nothing, so a quiet account reads as quiet
 * rather than as a zero.
 */
export const useBell = (): Bell | null => {
  const alerts = useOpenAlerts();
  const updates = useOfferedUpdates().length;
  const waiting = useDue(useNow()).rows.length;

  const open = itemsOf(alerts.data).length + updates;
  if (alerts.hasNextPage) return { text: `${MANY_OPEN}+`, key: 'alerts.bellMore', count: MANY_OPEN, kind: 'alerts' };
  if (open > 0) return { text: String(open), key: 'alerts.bell', count: open, kind: 'alerts' };

  return waiting > 0 ? { text: String(waiting), key: 'alerts.bellTasks', count: waiting, kind: 'tasks' } : null;
};
