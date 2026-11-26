import { CalendarRange } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import styles from './Climate.module.css';

/** The mark on a figure a running plan writes back every hour; in the legend that explains it, a picture only. */
export function PlanMark({ legend = false }: { legend?: boolean }) {
  const { t } = useTranslation();
  return legend ? (
    <CalendarRange size={13} strokeWidth={2} className={styles.planMark} aria-hidden />
  ) : (
    <CalendarRange size={13} strokeWidth={2} className={styles.planMark} role="img" aria-label={t('targets.table.planMark')} />
  );
}
