import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowthStage, PresetApplication, SpaceOverview } from '@fg2/shared-types/v1';
import { useGrows } from '@/api/grows';
import { useApplyPreset } from '@/api/lifecycle';
import { NewGrowSheet } from '@/screens/grow/new/NewGrowSheet';
import { Sheet } from '@/log/Sheet';
import { Refused } from '@/ui/PageState';
import { presetsOf, writesClimate } from '@/ui/presets';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import { STAGES } from '@/ui/stages';
import ui from '@/ui/ui.module.css';
import styles from './PresetSheet.module.css';

/**
 * Putting a tent on a climate preset.
 *
 * Two things have to be said plainly here, because both of them are ways a
 * screen could pretend to have done more than it did. A preset is a target
 * climate and nothing else: the work mode, the heating and dehumidifying
 * behaviour, the fans and the dimming ramps are what the hardware is tuned to
 * and survive a phase change. And `curing` has no climate at all - jars are not
 * steered, so the server has no row for it and writes nothing to anything
 * standing here - which the sheet says before the tap rather than reporting an
 * application of nothing afterwards.
 *
 * What comes back is not a resource and is never read again, so it is kept here
 * and shown here: which controllers were written, which grow entered the stage,
 * what a plan running in the same tent had to do about it, and the question the
 * server asks when there is no grow here to put into the stage at all.
 */
export function PresetSheet({ overview, onClose }: { overview: SpaceOverview; onClose: () => void }) {
  const { t } = useTranslation();
  const apply = useApplyPreset(overview.spaceId);

  const here = overview.grows[0] ?? null;
  const [stage, setStage] = useState<GrowthStage>(() => here?.stage ?? 'vegetative');
  // The grow's own preset, but only where it is one this table still offers: a
  // chip that cannot be chosen would otherwise be the one that was.
  const [preset, setPreset] = useState<string | null>(() =>
    here && here.stage && presetsOf(here.stage).includes(here.preset ?? '') ? here.preset : null,
  );
  const [done, setDone] = useState<PresetApplication | null>(null);
  /** The new-grow sheet takes this one's place once it is opened, rather than standing over it. */
  const [starting, setStarting] = useState(false);
  /** The question the server asked, once somebody has answered it here. */
  const [answered, setAnswered] = useState(false);

  const noController = overview.deviceIds !== null && overview.deviceIds.length === 0;
  const offered = presetsOf(stage);

  const pickStage = (next: GrowthStage) => {
    setStage(next);
    setPreset(current => (presetsOf(next).includes(current ?? '') ? current : null));
  };

  if (starting) return <NewGrowSheet spaceId={overview.spaceId} stage={done?.stage ?? stage} onClose={onClose} />;

  return (
    <Sheet title={t('space.presets.title', { name: overview.name })} onClose={onClose}>
      <div className={styles.body}>
        <p className={`mono ${styles.now}`}>
          {here
            ? t('space.presets.growHere', { name: here.name, stage: t(`home.stage.${here.stage ?? 'vegetative'}`) })
            : t('space.presets.noGrowHere')}
        </p>

        <Block label={t('space.presets.stage')}>
          <Choices label={t('space.presets.stage')}>
            {STAGES.map(one => (
              <Choice key={one} chosen={one === stage} onChoose={() => pickStage(one)}>
                {t(`home.stage.${one}`)}
              </Choice>
            ))}
          </Choices>
        </Block>

        {offered.length > 0 ? (
          <Block label={t('space.presets.preset')}>
            <Choices label={t('space.presets.preset')}>
              <Choice chosen={preset === null} onChoose={() => setPreset(null)}>
                {t('grow.lifecycle.phase.noPreset')}
              </Choice>
              {offered.map(one => (
                <Choice key={one} chosen={preset === one} onChoose={() => setPreset(one)}>
                  {t(`grow.presetName.${one}`, { defaultValue: one })}
                </Choice>
              ))}
            </Choices>
          </Block>
        ) : null}

        <ul className={styles.says}>
          <li>{t(writesClimate(stage) ? 'space.presets.writesClimateOnly' : 'space.presets.noClimateRow')}</li>
          {writesClimate(stage) && noController ? <li>{t('space.presets.nothingToWriteTo')}</li> : null}
          <li>{here ? t('space.presets.phaseFollows', { name: here.name }) : t('space.presets.noPhaseFollows')}</li>
        </ul>

        <Refused error={apply.error} />

        <button
          type="button"
          className={`${ui.button} ${ui.primary} ${styles.submit}`}
          disabled={apply.isPending}
          onClick={() =>
            apply.mutate(
              { stage, preset },
              {
                onSuccess: result => {
                  setDone(result);
                  setAnswered(false);
                },
              },
            )
          }
        >
          {apply.isPending ? t('grow.lifecycle.saving') : t('space.presets.submit', { stage: t(`home.stage.${stage}`) })}
        </button>

        {done ? (
          <Block label={t('space.presets.whatHappened')}>
            <ul className={styles.effect}>
              <li>
                {done.deviceIds.length === 0
                  ? t(writesClimate(done.stage) ? 'space.presets.wroteNothing' : 'space.presets.wroteNothingCuring')
                  : t('space.presets.wroteTo', { count: done.deviceIds.length })}
              </li>
              <li>{done.phaseId ? t('space.presets.phaseWritten', { stage: t(`home.stage.${done.stage}`) }) : t('space.presets.noPhaseWritten')}</li>
              {done.planEffect === 'none' ? null : <li>{t(`space.presets.plan.${done.planEffect}`)}</li>}
            </ul>

            {done.growDecisionNeeded && !answered ? (
              <GrowQuestion
                spaceId={overview.spaceId}
                stage={done.stage}
                preset={done.preset}
                decisions={done.decisions}
                onAnswered={result => {
                  setAnswered(true);
                  if (result) setDone(result);
                }}
                onStartGrow={() => setStarting(true)}
              />
            ) : null}
          </Block>
        ) : null}
      </div>
    </Sheet>
  );
}

/**
 * What to do about the grow when a preset was applied to a tent with none in
 * it. The climate has already been written, so this is only about the phase.
 *
 * "Only the climate" is answered here rather than sent: the server does nothing
 * with that decision but stop asking, and asking it again would write the same
 * targets to the same controllers a second time for no reason. Starting a grow
 * opens the new-grow sheet in this one's place, with the tent and the stage it
 * was just put on already answered - one sheet at a time, because the question
 * behind this one has been answered by opening it.
 */
function GrowQuestion({
  spaceId,
  stage,
  preset,
  decisions,
  onAnswered,
  onStartGrow,
}: {
  spaceId: string;
  stage: GrowthStage;
  preset: string | null;
  decisions: PresetApplication['decisions'];
  onAnswered: (result: PresetApplication | null) => void;
  onStartGrow: () => void;
}) {
  const { t } = useTranslation();
  const apply = useApplyPreset(spaceId);
  const grows = useGrows();
  const [picking, setPicking] = useState(false);

  const movable = (grows.data?.items ?? []).filter(grow => grow.endedAt === null && !grow.summary.locations.some(one => one.spaceId === spaceId));

  return (
    <div className={styles.question}>
      <p className={ui.note}>{t('space.presets.question')}</p>

      {picking ? (
        <>
          {movable.length === 0 ? (
            <p className={ui.note}>{t('space.presets.noGrowToMove')}</p>
          ) : (
            <Choices label={t('space.presets.whichGrow')}>
              {movable.map(grow => (
                <Choice
                  key={grow.id}
                  chosen={false}
                  disabled={apply.isPending}
                  onChoose={() =>
                    apply.mutate({ stage, preset, decision: 'move_grow', growId: grow.id }, { onSuccess: result => onAnswered(result) })
                  }
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
            <button type="button" className={ui.button} onClick={onStartGrow}>
              {t('space.presets.startGrowHere')}
            </button>
          ) : null}
          {decisions.includes('move_grow') ? (
            <button type="button" className={ui.button} onClick={() => setPicking(true)}>
              {t('space.presets.moveGrowHere')}
            </button>
          ) : null}
          {decisions.includes('climate_only') ? (
            <button type="button" className={ui.button} onClick={() => onAnswered(null)}>
              {t('space.presets.climateOnly')}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
