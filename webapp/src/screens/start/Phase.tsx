import { growWeekOfDay } from '@fg2/shared-types/v1-schemas/feeding.js';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { GrowCard } from '@fg2/shared-types/v1';
import { useGrow } from '@/api/grows';
import { STAGES } from '@/ui/stages';
import styles from './Start.module.css';

/** The stages a grow is harvested after: once it dries, nothing is left to wait for. */
const GROWING = STAGES.indexOf('drying');

/**
 * How far along a grow is. Where it is fed by a scheme, the scheme's weeks are
 * the length it was planned at: the bar fills by the days gone, and what is
 * left to the scheme's last week is said. Without one nothing states a length,
 * so the bar fills by the stages reached and no harvest is promised.
 */
const useProgress = (grow: GrowCard): { fill: number; weeksLeft: number | null } => {
  const weeks = useGrow(grow.growId).data?.scheme?.grid.length ?? null;
  const at = grow.stage ? STAGES.indexOf(grow.stage) : -1;
  if (weeks && grow.dayNumber !== null && at < GROWING) {
    return { fill: Math.min(1, grow.dayNumber / (weeks * 7)), weeksLeft: Math.max(0, weeks - growWeekOfDay(grow.dayNumber)) };
  }
  return { fill: (at + 1) / STAGES.length, weeksLeft: null };
};

/** "Blüte · Woche 3 … Ernte in etwa 6 Wochen" over the bar. */
function PhaseWords({ grow }: { grow: GrowCard }) {
  const { t } = useTranslation();
  const { fill, weeksLeft } = useProgress(grow);
  const phase = grow.stage
    ? [t(`home.stage.${grow.stage}`), grow.stageWeek !== null ? t('start.week', { week: grow.stageWeek }) : null].filter(Boolean).join(' · ')
    : t('home.card.noPhase');

  return (
    <>
      <span className={styles.phaseWords}>
        <span>{phase}</span>
        {weeksLeft ? <span>{t('start.harvestIn', { count: weeksLeft })}</span> : null}
      </span>
      <span className={styles.phaseBar} aria-hidden>
        <span className={styles.phaseFill} style={{ width: `${Math.round(fill * 100)}%` }} />
      </span>
    </>
  );
}

/** The phase and week of the grow under its picture, leading to the grow. */
export function PhaseLine({ grow, to }: { grow: GrowCard; to: string }) {
  return (
    <Link to={to} className={styles.phase}>
      <PhaseWords grow={grow} />
    </Link>
  );
}

/** The same as a card of its own, named by the grow and its day, where no picture carries them. */
export function GrowHead({ grow, to }: { grow: GrowCard; to: string }) {
  const { t } = useTranslation();

  return (
    <Link to={to} className={styles.growCard}>
      <span className={styles.growName}>
        <span>{[grow.name, grow.dayNumber !== null ? t('home.card.dayN', { day: grow.dayNumber }) : null].filter(Boolean).join(' · ')}</span>
        <ChevronRight size={20} strokeWidth={2} className={styles.chevron} aria-hidden />
      </span>
      <PhaseWords grow={grow} />
    </Link>
  );
}
