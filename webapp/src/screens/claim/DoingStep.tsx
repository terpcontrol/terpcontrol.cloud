import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { GrowthStage, PresetApplication } from '@fg2/shared-types/v1';
import { STAGES_WITH_CLIMATE } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { useGrows } from '@/api/grows';
import { useApplyPreset } from '@/api/lifecycle';
import { Refused } from '@/ui/PageState';
import { Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { MEASURE, type Doing } from './steps';
import styles from './Claim.module.css';

/**
 * The third step: what the tent is doing right now.
 *
 * A stage is not a label on this screen - it is the climate the controller is
 * put on, and the phase whatever is growing here enters - so picking one is a
 * write and is drawn as one, with what it did reported afterwards in the
 * server's own terms. `curing` is not offered because a jar is not steered; the
 * stages with a climate are the contract's list rather than a second copy of it.
 *
 * A tent with nothing growing in it is the ordinary case at this point in the
 * flow, so the server asks what to do about the grow and the same three answers
 * the tent page gives are given here. Starting one is a sheet of its own and is
 * linked to rather than imitated: it asks for a name and the plants, which is
 * more than this step knows.
 *
 * The write is the step's own action and not the screen's, so it is drawn as
 * the lesser of the two: the green on this screen belongs to the button on the
 * bottom edge, which carries the choice into the write if it has not been made
 * yet rather than stepping past it.
 */
export function DoingStep({
  spaceId,
  doing,
  onDoing,
  apply,
}: {
  spaceId: string | null;
  doing: Doing;
  onDoing: (doing: Doing) => void;
  apply: ReturnType<typeof useApplyPreset>;
}) {
  const { t } = useTranslation();
  // Which application's question has been answered, rather than a flag: a
  // second stage applied here asks again, and the answer to the first one is
  // not the answer to it.
  const [answeredFor, setAnsweredFor] = useState<PresetApplication | null>(null);

  const { chosen, applied } = doing;
  const stage = chosen === MEASURE ? null : chosen;
  const pick = (next: GrowthStage | typeof MEASURE) => onDoing({ chosen: next, applied: null });
  // Whether a controller actually took the targets. A place whose device has
  // never sent its settings takes nothing, and the lines below then have no
  // climate write to report.
  const wrote = (applied?.deviceIds.length ?? 0) > 0;

  return (
    <>
      <Choices label={t('claim.doing.pick')}>
        {STAGES_WITH_CLIMATE.map(one => (
          <Choice key={one} chosen={chosen === one} disabled={apply.isPending} onChoose={() => pick(one)}>
            {t(`home.stage.${one}`)}
          </Choice>
        ))}
        <Choice chosen={chosen === MEASURE} disabled={apply.isPending} onChoose={() => pick(MEASURE)}>
          {t('claim.doing.measure')}
        </Choice>
      </Choices>

      {chosen === MEASURE ? <p className={ui.note}>{t('claim.doing.measureNote')}</p> : null}

      <Refused error={apply.error} />

      {stage && !applied ? (
        <button
          type="button"
          className={`${ui.button} ${styles.aside}`}
          disabled={apply.isPending || spaceId === null}
          onClick={() => apply.mutate({ stage }, { onSuccess: result => onDoing({ chosen: stage, applied: result }) })}
        >
          {apply.isPending ? t('claim.doing.applying') : t('claim.doing.apply', { stage: t(`home.stage.${stage}`) })}
        </button>
      ) : null}

      {applied ? (
        <ul className={styles.effect}>
          <li>{wrote ? t('claim.doing.wroteTo', { count: applied.deviceIds.length }) : t('claim.doing.wroteNothing')}</li>
          <li>
            {applied.phaseId
              ? t('claim.doing.phaseWritten', { stage: t(`home.stage.${applied.stage}`) })
              : t(wrote ? 'claim.doing.noPhaseWritten' : 'claim.doing.noPhaseNoClimate')}
          </li>
        </ul>
      ) : null}

      {applied?.growDecisionNeeded && answeredFor !== applied && spaceId ? (
        <GrowQuestion
          spaceId={spaceId}
          stage={applied.stage}
          decisions={applied.decisions}
          wrote={wrote}
          onAnswered={() => setAnsweredFor(applied)}
        />
      ) : null}
    </>
  );
}

/**
 * What to do about the grow, once a stage has been applied to a tent with none
 * in it.
 *
 * "Only the climate" is answered here and not sent: the server does nothing
 * with that answer but stop asking, and sending it would write the same targets
 * to the same controller a second time for no reason.
 *
 * The question says what the application actually did rather than promising a
 * climate write: where no controller took the targets, claiming one had been
 * made would contradict the line directly above it.
 */
function GrowQuestion({
  spaceId,
  stage,
  decisions,
  wrote,
  onAnswered,
}: {
  spaceId: string;
  stage: GrowthStage;
  decisions: PresetApplication['decisions'];
  wrote: boolean;
  onAnswered: () => void;
}) {
  const { t } = useTranslation();
  const apply = useApplyPreset(spaceId);
  const grows = useGrows();
  const [picking, setPicking] = useState(false);

  const movable = (grows.data?.items ?? []).filter(grow => grow.endedAt === null && !grow.summary.locations.some(one => one.spaceId === spaceId));

  return (
    <div className={styles.question}>
      <p className={ui.note}>{t(wrote ? 'claim.doing.question' : 'claim.doing.questionNothingWritten')}</p>

      {picking ? (
        <>
          {movable.length === 0 ? (
            <p className={ui.note}>{t('claim.doing.noGrowToMove')}</p>
          ) : (
            <Choices label={t('claim.doing.whichGrow')}>
              {movable.map(grow => (
                <Choice
                  key={grow.id}
                  chosen={false}
                  disabled={apply.isPending}
                  onChoose={() => apply.mutate({ stage, decision: 'move_grow', growId: grow.id }, { onSuccess: onAnswered })}
                >
                  {grow.name}
                </Choice>
              ))}
            </Choices>
          )}
          <Refused error={apply.error} />
        </>
      ) : (
        <div className={styles.answers}>
          {decisions.includes('start_grow') ? (
            <Link className={ui.button} to={`/grows/new?space=${spaceId}&stage=${stage}`}>
              {t('claim.doing.startGrow')}
              <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
            </Link>
          ) : null}
          {decisions.includes('move_grow') ? (
            <button type="button" className={ui.button} onClick={() => setPicking(true)}>
              {t('claim.doing.moveGrowHere')}
            </button>
          ) : null}
          {decisions.includes('climate_only') ? (
            <button type="button" className={ui.button} onClick={onAnswered}>
              {t('claim.doing.climateOnly')}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
