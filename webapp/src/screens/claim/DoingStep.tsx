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
 */
export function DoingStep({ spaceId, doing, onDoing }: { spaceId: string | null; doing: Doing; onDoing: (doing: Doing) => void }) {
  const { t } = useTranslation();
  const apply = useApplyPreset(spaceId ?? '');
  const [answered, setAnswered] = useState(false);

  const { chosen, applied } = doing;
  const stage = chosen === MEASURE ? null : chosen;
  const pick = (next: GrowthStage | typeof MEASURE) => onDoing({ chosen: next, applied: null });

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
          className={`${ui.button} ${ui.primary} ${styles.wide}`}
          disabled={apply.isPending || spaceId === null}
          onClick={() =>
            apply.mutate(
              { stage },
              {
                onSuccess: result => {
                  onDoing({ chosen: stage, applied: result });
                  setAnswered(false);
                },
              },
            )
          }
        >
          {apply.isPending ? t('claim.doing.applying') : t('claim.doing.apply', { stage: t(`home.stage.${stage}`) })}
        </button>
      ) : null}

      {applied ? (
        <ul className={styles.effect}>
          <li>{applied.deviceIds.length === 0 ? t('claim.doing.wroteNothing') : t('claim.doing.wroteTo', { count: applied.deviceIds.length })}</li>
          <li>{applied.phaseId ? t('claim.doing.phaseWritten', { stage: t(`home.stage.${applied.stage}`) }) : t('claim.doing.noPhaseWritten')}</li>
        </ul>
      ) : null}

      {applied?.growDecisionNeeded && !answered && spaceId ? (
        <GrowQuestion spaceId={spaceId} stage={applied.stage} decisions={applied.decisions} onAnswered={() => setAnswered(true)} />
      ) : null}
    </>
  );
}

/**
 * What to do about the grow, once the climate has been written to a tent with
 * none in it.
 *
 * "Only the climate" is answered here and not sent: the server does nothing
 * with that answer but stop asking, and sending it would write the same targets
 * to the same controller a second time for no reason.
 */
function GrowQuestion({
  spaceId,
  stage,
  decisions,
  onAnswered,
}: {
  spaceId: string;
  stage: GrowthStage;
  decisions: PresetApplication['decisions'];
  onAnswered: () => void;
}) {
  const { t } = useTranslation();
  const apply = useApplyPreset(spaceId);
  const grows = useGrows();
  const [picking, setPicking] = useState(false);

  const movable = (grows.data?.items ?? []).filter(grow => grow.endedAt === null && !grow.summary.locations.some(one => one.spaceId === spaceId));

  return (
    <div className={styles.question}>
      <p className={ui.note}>{t('claim.doing.question')}</p>

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
            <Link className={ui.button} to={`/grows/new?space=${spaceId}`}>
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
