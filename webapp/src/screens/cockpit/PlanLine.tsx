import { CalendarRange, ChevronRight } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { controlPath } from '@/app/places';
import type { Device } from '@fg2/shared-types/v1';
import { useDevicePlan } from '@/api/plans';
import { planLineOf } from './plan-line';
import styles from './Cockpit.module.css';

/**
 * "Plan: Flower, 12 more days, then late flower": where a running plan stands
 * and when it changes the targets next, under the targets it is setting. It is
 * drawn only while a plan runs - one that is paused or put away sets nothing -
 * and it leads to Steuerung, which opens on the plan while one runs.
 */

export function PlanLine({ spaceId, device, now }: { spaceId: string; device: Device; now: DateTime }) {
  const { t } = useTranslation();
  const plan = useDevicePlan(device.id).data;
  const line = plan ? planLineOf(t, plan, now) : null;
  if (!line) return null;

  return (
    <Link to={controlPath(spaceId)} className={styles.planLine}>
      <CalendarRange size={14} strokeWidth={1.75} aria-hidden />
      <span>
        <span className={styles.planWord}>{t('planLine.plan')}</span> {line}
      </span>
      <ChevronRight size={14} strokeWidth={2} aria-hidden />
    </Link>
  );
}
