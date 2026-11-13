import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { GrowCard } from '@fg2/shared-types/v1';
import { GrowBar } from '@/screens/grow/GrowBar';
import { growDay, useProgress } from '@/screens/grow/progress';
import styles from './Start.module.css';

/** "Blüte · Woche 3 … Ernte in etwa 6 Wochen" over the bar. */
function PhaseWords({ grow }: { grow: GrowCard }) {
  const { t } = useTranslation();
  const { weeksLeft } = useProgress(grow);
  const phase = grow.stage
    ? [t(`home.stage.${grow.stage}`), grow.stageWeek !== null ? t('start.week', { week: grow.stageWeek }) : null].filter(Boolean).join(' · ')
    : t('home.card.noPhase');

  return (
    <>
      <span className={styles.phaseWords}>
        <span>{phase}</span>
        {weeksLeft ? <span>{t('start.harvestIn', { count: weeksLeft })}</span> : null}
      </span>
      <GrowBar grow={grow} />
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
        <span>{[grow.name, growDay(t, grow)].filter(Boolean).join(' · ')}</span>
        <ChevronRight size={20} strokeWidth={2} className={styles.chevron} aria-hidden />
      </span>
      <PhaseWords grow={grow} />
    </Link>
  );
}
