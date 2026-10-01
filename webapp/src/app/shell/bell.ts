import { bellOf, useOpenAlertCount } from '@/api/alerts';
import { useDiaryLayer } from '@/api/layers';
import { useTasks } from '@/api/tasks';
import { daysUntil } from '@/screens/tasks/tasks';
import { useNow } from '@/ui/useNow';
import { useZone } from '@/ui/zone';

/** What the bell carries, and whether it is alarms (red) or only work that is due (the brand's blue). */
export interface Bell {
  text: string;
  key: string;
  count: number;
  kind: 'alerts' | 'tasks';
}

/**
 * The badge on the bell. An open alarm is what it is for and is counted
 * first. Where the diary is kept and no alarm is open, the tasks that are due
 * are counted instead, in a quieter colour: "Gießen" fell due at 19:30 and an
 * hour later neither the bell nor the rail said a word - the task was there
 * only for whoever opened Meldungen or scrolled to the grow block.
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
