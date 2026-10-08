import { useOpenAlertCount, type OpenAlerts } from '@/api/alerts';
import { useDiaryLayer } from '@/api/layers';
import { useTasks } from '@/api/tasks';
import { daysUntil } from '@/screens/tasks/tasks';
import { useNow } from '@/ui/useNow';
import { useZone } from '@/ui/zone';

/** What the bell carries, and whether it is alarms (red) or only work that is due (the brand's blue). */
interface Bell {
  text: string;
  key: string;
  count: number;
  kind: 'alerts' | 'tasks';
}

/** The largest number the bell draws. Beyond it the badge says so rather than counting a page that is not the whole of it. */
const MANY_OPEN = 99;

/**
 * What the bell draws and what it says it is, or nothing at all while no alert
 * is open, so a quiet account reads as quiet rather than as a zero. A count
 * taken from one page would understate an account with more than fits on it,
 * so that one says "99+" and means it.
 */
const bellOf = (alerts: OpenAlerts | undefined): { text: string; key: string; count: number } | null => {
  if (!alerts || alerts.open === 0) return null;

  return alerts.more
    ? { text: `${MANY_OPEN}+`, key: 'alerts.bellMore', count: MANY_OPEN }
    : { text: String(alerts.open), key: 'alerts.bell', count: alerts.open };
};

/**
 * The badge on the bell. An open alarm is what it is for and is counted first;
 * where the diary is kept and no alarm is open, the tasks that are due are
 * counted instead, in a quieter colour, so a due task is not left to the inbox.
 */
export const useBell = (): Bell | null => {
  const alarms = bellOf(useOpenAlertCount());
  const diary = useDiaryLayer();
  const tasks = useTasks(false, diary);
  const now = useNow();
  const zone = useZone();

  if (alarms) return { ...alarms, kind: 'alerts' };
  if (!diary) return null;
  const due = (tasks.data?.items ?? []).filter(task => daysUntil(task.dueAt, now, zone) <= 0).length;

  return due > 0 ? { text: String(due), key: 'alerts.bellTasks', count: due, kind: 'tasks' } : null;
};
