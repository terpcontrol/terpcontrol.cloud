import { daysPerStageOf, stageSpansOf } from '@fg2/shared-types/v1-schemas/grow-days.js';
import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import type { GrowListItem } from '@fg2/shared-types/v1';
import { STAGES } from '@/ui/stages';
import styles from './GrowPage.module.css';

/**
 * The six stages as segments, each named under its segment: a past one with
 * how long it took, the current one with the day it is on. Only a stage the
 * grow has actually been through is filled - a grow that began in veg did not
 * germinate here, and a bar filled up to its stage would say it had. No
 * durations are planned here - the plan is what would give the segments their
 * length - so the segments are equal and the words carry the time.
 *
 * How long each stage took is the shared arithmetic the report's chapters are
 * counted with, rather than a rounding of the milliseconds between two phase
 * starts. The two sat a few centimetres apart on the Report tab and disagreed
 * about four phases of six, because a phase almost never begins on a grow-day
 * boundary and only one of them counted in whole days.
 *
 * A grow that has ended is in no stage. Its last segment is drawn as the stage
 * it finished in, with the days that stage lasted like every other one, and the
 * bar says so to a screen reader as well - "now in Curing" over a grow that came
 * down in August is the page asserting a present it does not have.
 */
export function PhaseBar({ grow, now }: { grow: GrowListItem; now: DateTime }) {
  const { t } = useTranslation();
  const ended = grow.endedAt !== null;
  const stage = grow.summary.stage;
  const current = ended || !stage ? -1 : STAGES.indexOf(stage);
  const days = daysPerStageOf(stageSpansOf(grow, grow.endedAt ? new Date(grow.endedAt) : now.toJSDate()));

  return (
    <div
      className={styles.phaseBar}
      role="img"
      aria-label={stage ? t(ended ? 'grow.phaseBarEndedLabel' : 'grow.phaseBarLabel', { stage: t(`home.stage.${stage}`) }) : t('home.card.noPhase')}
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
