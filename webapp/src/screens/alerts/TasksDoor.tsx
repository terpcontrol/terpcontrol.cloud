import { ChevronRight, CircleCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useTasks } from '@/api/tasks';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { useZone } from '@/ui/zone';
import { daysUntil } from '../tasks/tasks';
import styles from './TasksDoor.module.css';

/**
 * The way to the tasks from behind the bell, for whoever keeps a diary. Tasks
 * have no tab of their own - the bar is the climate's - so they are found in
 * the grow block of a place and here, where everything else that is waiting on
 * somebody already is, with how many are due today.
 */
export function TasksDoor() {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const tasks = useTasks(false);
  const waiting = tasks.data?.items ?? [];
  const due = waiting.filter(task => daysUntil(task.dueAt, now, zone) <= 0).length;

  if (!tasks.data) return null;

  return (
    <ul className={ui.group}>
      <li>
        <Link to="/tasks" className={styles.door}>
          <CircleCheck size={18} strokeWidth={1.75} aria-hidden className={styles.icon} />
          <span className={styles.text}>
            <span className={styles.title}>{t('tasks.title')}</span>
            <span className={`mono ${styles.line}`}>
              {due > 0
                ? t('alerts.tasks.due', { count: due })
                : waiting.length > 0
                  ? t('alerts.tasks.later', { count: waiting.length })
                  : t('alerts.tasks.none')}
            </span>
          </span>
          <ChevronRight size={16} strokeWidth={1.75} aria-hidden className={styles.chevron} />
        </Link>
      </li>
    </ul>
  );
}
