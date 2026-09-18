import { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import type { GrowListItem, GrowthStage } from '@fg2/shared-types/v1';
import { STAGES } from '@/ui/stages';
import styles from './GrowPage.module.css';

const DAY_MS = 86_400_000;

/**
 * How long the grow spent in each stage, from its own phases: a phase lasts
 * until the next one begins, and the one it is in lasts until now. A phase
 * scoped to some of the plants is a split and is not counted here - the bar
 * is the grow's spine, and a split is told in the timeline.
 */
const daysInStage = (grow: GrowListItem, now: DateTime): Partial<Record<GrowthStage, number>> => {
  const spine = grow.phases.filter(phase => phase.plantIds === null).sort((one, other) => one.startedAt.localeCompare(other.startedAt));
  const days: Partial<Record<GrowthStage, number>> = {};

  spine.forEach((phase, index) => {
    const from = DateTime.fromISO(phase.startedAt);
    const until = spine[index + 1] ? DateTime.fromISO(spine[index + 1].startedAt) : grow.endedAt ? DateTime.fromISO(grow.endedAt) : now;
    days[phase.stage] = (days[phase.stage] ?? 0) + Math.max(0, Math.round((until.toMillis() - from.toMillis()) / DAY_MS));
  });

  return days;
};

/**
 * The six stages as segments, each named under its segment: a past one with
 * how long it took, the current one with the day it is on. Only a stage the
 * grow has actually been through is filled - a grow that began in veg did not
 * germinate here, and a bar filled up to its stage would say it had. No
 * durations are planned here - the plan is what would give the segments their
 * length - so the segments are equal and the words carry the time.
 */
export function PhaseBar({ grow, now }: { grow: GrowListItem; now: DateTime }) {
  const { t } = useTranslation();
  const stage = grow.summary.stage;
  const current = stage ? STAGES.indexOf(stage) : -1;
  const days = daysInStage(grow, now);

  return (
    <div
      className={styles.phaseBar}
      role="img"
      aria-label={stage ? t('grow.phaseBarLabel', { stage: t(`home.stage.${stage}`) }) : t('home.card.noPhase')}
    >
      {STAGES.map((name, index) => {
        const isCurrent = index === current;
        const reached = isCurrent || days[name] !== undefined;
        const detail = isCurrent
          ? grow.summary.phaseDay !== null
            ? t('grow.dayN', { day: grow.summary.phaseDay })
            : ''
          : reached && days[name] !== undefined
            ? t('grow.days', { count: days[name] })
            : '';

        return (
          <div key={name} className={styles.phaseSegment} data-reached={reached} data-current={isCurrent}>
            <span className={styles.phaseFill} />
            <span className={`mono ${styles.phaseName}`}>
              {isCurrent && grow.summary.preset === 'late_flowering' ? t('grow.lateFlower') : t(`grow.stageShort.${name}`)}
            </span>
            <span className={`mono ${styles.phaseDetail}`}>{detail}</span>
          </div>
        );
      })}
    </div>
  );
}
