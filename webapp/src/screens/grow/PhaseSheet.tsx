import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowListItem, GrowthStage, Phase } from '@fg2/shared-types/v1';
import { useAddPhase, useCorrectPhase, useWithdrawPhase } from '@/api/lifecycle';
import { Sheet } from '@/log/Sheet';
import { nextStage } from '@/log/defaults';
import { instantOf } from '@/ui/age';
import { Refused } from '@/ui/PageState';
import { presetsOf, writesClimate } from '@/ui/presets';
import { Block, Choice, Choices, WhenField } from '@/ui/SheetParts';
import { STAGES, weekOfPhase } from '@/ui/stages';
import ui from '@/ui/ui.module.css';
import { correctionEffect, phasesInOrder, withdrawalEffect, type PhaseEffect } from './phase-effect';
import styles from './Lifecycle.module.css';

/**
 * The stage the grow is in: moving it on, and repairing a stage that was
 * entered wrongly.
 *
 * Entering a phase and correcting one are the same sheet because they are the
 * same fact seen twice, and a grower who has just picked the wrong stage is
 * exactly the person who needs the correction. What separates them is that
 * entering a phase is an addition and a correction moves a date the day counter
 * is drawn from - so a correction says what it will move before it moves it,
 * and a withdrawal says what the grow is left with.
 */
export function PhaseSheet({ grow, onClose }: { grow: GrowListItem; onClose: () => void }) {
  const { t } = useTranslation();
  const add = useAddPhase(grow.id);

  const [stage, setStage] = useState<GrowthStage>(() => nextStage(grow) ?? grow.summary.stage ?? STAGES[0]);
  const [preset, setPreset] = useState<string | null>(null);
  const [at, setAt] = useState(() => new Date());
  /** Which row of the history is open, and for what. One at a time: two open editors would be two answers. */
  const [open, setOpen] = useState<{ phaseId: string; as: 'correct' | 'withdraw' } | null>(null);

  const ordered = phasesInOrder(grow);
  // What the writer compares against: the latest phase written over the whole
  // grow, which is not always the headline - a split can leave a scoped phase
  // covering more plants than the one the grow as a whole last entered. The
  // date is not part of it, because the writer does not look at the date: the
  // same stage twice in a row is not a phase change on any day.
  const standing = ordered.filter(phase => phase.plantIds === null).at(-1) ?? null;
  const standsThere = standing !== null && standing.stage === stage && standing.preset === preset;

  const pickStage = (next: GrowthStage) => {
    setStage(next);
    // A preset belongs to the stage it refines, so it does not survive a change of stage.
    setPreset(current => (presetsOf(next).includes(current ?? '') ? current : null));
  };

  return (
    <Sheet title={t('grow.lifecycle.phase.title', { name: grow.name })} onClose={onClose}>
      <div className={styles.body}>
        <p className={`mono ${styles.now}`}>{nowLine(t, grow)}</p>

        <Block label={t('grow.lifecycle.phase.enter')}>
          <Choices label={t('grow.lifecycle.phase.stageLabel')}>
            {STAGES.map(one => (
              <Choice key={one} chosen={one === stage} onChoose={() => pickStage(one)}>
                {t(`home.stage.${one}`)}
                {one === grow.summary.stage ? ` · ${t('log.now')}` : ''}
              </Choice>
            ))}
          </Choices>

          <PresetRow stage={stage} preset={preset} onPick={setPreset} />
          <WhenField label={t('grow.lifecycle.when')} at={at} onChange={setAt} />

          <ul className={styles.effect}>
            <li className={ui.note}>{t('grow.lifecycle.phase.note')}</li>
            {preset === null ? null : <li className={ui.note}>{t('grow.lifecycle.phase.presetAlsoWrites')}</li>}
            {writesClimate(stage) ? null : <li className={ui.note}>{t('grow.lifecycle.phase.noClimateStage')}</li>}
          </ul>
          {standsThere ? <p className={ui.note}>{t('grow.lifecycle.phase.alreadyThere')}</p> : null}
          <Refused error={add.error} />

          <button
            type="button"
            className={`${ui.button} ${ui.primary} ${styles.submit}`}
            disabled={add.isPending}
            onClick={() => add.mutate({ stage, preset, startedAt: instantOf(DateTime.fromJSDate(at)) }, { onSuccess: () => onClose() })}
          >
            {add.isPending ? t('grow.lifecycle.saving') : t('grow.lifecycle.phase.submit', { stage: label(t, stage, preset) })}
          </button>
        </Block>

        <Block label={t('grow.lifecycle.phase.history')} aside={t('grow.lifecycle.phase.oldestFirst')}>
          {ordered.length === 0 ? (
            <p className={ui.note}>{t('grow.lifecycle.phase.noneYet')}</p>
          ) : (
            <ul className={styles.rows}>
              {ordered.map(phase => (
                <PhaseRow
                  key={phase.id}
                  grow={grow}
                  phase={phase}
                  open={open?.phaseId === phase.id ? open.as : null}
                  onOpen={as => setOpen(as === null ? null : { phaseId: phase.id, as })}
                />
              ))}
            </ul>
          )}
        </Block>
      </div>
    </Sheet>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** What the server last said the grow reads as. Nothing here counts a day; the summary rides on the grow. */
const nowLine = (t: Translate, grow: GrowListItem): string => {
  const { stage, preset, phaseDay, dayNumber } = grow.summary;
  if (!stage || dayNumber === null) return t('grow.lifecycle.phase.noPhaseYet');

  return t('grow.lifecycle.phase.nowLine', {
    stage: label(t, stage, preset),
    phaseDay: phaseDay ?? dayNumber,
    growDay: dayNumber,
    week: weekOfPhase(dayNumber),
  });
};

/** "Flower · late flower", the two halves of what a phase is. */
const label = (t: Translate, stage: GrowthStage, preset: string | null): string =>
  preset === null ? t(`home.stage.${stage}`) : `${t(`home.stage.${stage}`)} · ${t(`grow.presetName.${preset}`, { defaultValue: preset })}`;

/** The presets that refine a stage. A stage that has none says so rather than offering an empty row. */
function PresetRow({ stage, preset, onPick }: { stage: GrowthStage; preset: string | null; onPick: (preset: string | null) => void }) {
  const { t } = useTranslation();
  const offered = presetsOf(stage);
  if (offered.length === 0) return null;

  return (
    <Choices label={t('grow.lifecycle.phase.presetLabel')}>
      <Choice chosen={preset === null} onChoose={() => onPick(null)}>
        {t('grow.lifecycle.phase.noPreset')}
      </Choice>
      {offered.map(one => (
        <Choice key={one} chosen={preset === one} onChoose={() => onPick(one)}>
          {t(`grow.presetName.${one}`, { defaultValue: one })}
        </Choice>
      ))}
    </Choices>
  );
}

/** One phase of the story: what it was, when it began, who put the grow there, and the two ways to repair it. */
function PhaseRow({
  grow,
  phase,
  open,
  onOpen,
}: {
  grow: GrowListItem;
  phase: Phase;
  open: 'correct' | 'withdraw' | null;
  onOpen: (as: 'correct' | 'withdraw' | null) => void;
}) {
  const { t } = useTranslation();

  return (
    <li className={styles.row}>
      <div className={styles.rowHead}>
        <span className={styles.rowTitle}>{label(t, phase.stage, phase.preset)}</span>
        <span className={`mono ${styles.rowMeta}`}>
          {DateTime.fromISO(phase.startedAt).toFormat('d LLL yyyy')} · {t(`grow.lifecycle.phase.source.${phase.source}`)}
        </span>
      </div>

      {open === null ? (
        <div className={styles.rowActions}>
          <button type="button" className={ui.chip} onClick={() => onOpen('correct')}>
            {t('grow.lifecycle.phase.correct')}
          </button>
          <button type="button" className={`${ui.chip} ${styles.danger}`} onClick={() => onOpen('withdraw')}>
            {t('grow.lifecycle.phase.withdraw')}
          </button>
        </div>
      ) : open === 'correct' ? (
        <PhaseEditor grow={grow} phase={phase} onDone={() => onOpen(null)} />
      ) : (
        <PhaseWithdrawal grow={grow} phase={phase} onDone={() => onOpen(null)} />
      )}
    </li>
  );
}

/**
 * A phase entered with the wrong stage or on the wrong day. What it will move
 * is drawn under the fields and changes as they are typed in, so that the tap
 * that saves it is never the first time the day counter is mentioned.
 */
function PhaseEditor({ grow, phase, onDone }: { grow: GrowListItem; phase: Phase; onDone: () => void }) {
  const { t } = useTranslation();
  const correct = useCorrectPhase(grow.id);

  const [stage, setStage] = useState(phase.stage);
  const [preset, setPreset] = useState(phase.preset);
  const [at, setAt] = useState(() => new Date(phase.startedAt));

  const startedAt = instantOf(DateTime.fromJSDate(at));
  const effect = correctionEffect(grow, phase, { stage, preset, startedAt });
  const changed = stage !== phase.stage || preset !== phase.preset || startedAt !== phase.startedAt;

  return (
    <div className={styles.editor}>
      <Choices label={t('grow.lifecycle.phase.stageLabel')}>
        {STAGES.map(one => (
          <Choice
            key={one}
            chosen={one === stage}
            onChoose={() => {
              setStage(one);
              setPreset(current => (presetsOf(one).includes(current ?? '') ? current : null));
            }}
          >
            {t(`home.stage.${one}`)}
          </Choice>
        ))}
      </Choices>

      <PresetRow stage={stage} preset={preset} onPick={setPreset} />
      <WhenField label={t('grow.lifecycle.when')} at={at} onChange={setAt} />

      <Effect effect={effect} changed={changed} entry="grow.lifecycle.phase.effect.entry" />
      <Refused error={correct.error} />

      <div className={styles.rowActions}>
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={correct.isPending || !changed}
          onClick={() => correct.mutate({ phaseId: phase.id, body: { stage, preset, startedAt } }, { onSuccess: onDone })}
        >
          {correct.isPending ? t('grow.lifecycle.saving') : t('grow.lifecycle.phase.saveCorrection')}
        </button>
        <button type="button" className={ui.button} onClick={onDone}>
          {t('grow.lifecycle.cancel')}
        </button>
      </div>
    </div>
  );
}

/** A phase the grow never entered. What it is left with is said first, and the tap after that is the whole confirmation. */
function PhaseWithdrawal({ grow, phase, onDone }: { grow: GrowListItem; phase: Phase; onDone: () => void }) {
  const { t } = useTranslation();
  const withdraw = useWithdrawPhase(grow.id);
  const effect = withdrawalEffect(grow, phase);

  return (
    <div className={styles.editor}>
      <Effect effect={effect} changed entry="grow.lifecycle.phase.effect.entryGone" />
      <Refused error={withdraw.error} />

      <div className={styles.rowActions}>
        <button
          type="button"
          className={`${ui.button} ${styles.dangerButton}`}
          disabled={withdraw.isPending}
          onClick={() => withdraw.mutate(phase.id, { onSuccess: onDone })}
        >
          {withdraw.isPending ? t('grow.lifecycle.saving') : t('grow.lifecycle.phase.confirmWithdraw')}
        </button>
        <button type="button" className={ui.button} onClick={onDone}>
          {t('grow.lifecycle.cancel')}
        </button>
      </div>
    </div>
  );
}

/** What a correction or a withdrawal comes to, in the sentences it comes to. */
function Effect({ effect, changed, entry }: { effect: PhaseEffect; changed: boolean; entry: string }) {
  const { t } = useTranslation();
  if (!changed) return <p className={ui.note}>{t('grow.lifecycle.phase.effect.nothingYet')}</p>;

  const lines: string[] = [];
  if (effect.growDay) {
    lines.push(
      t('grow.lifecycle.phase.effect.growDay', {
        from: effect.growDay.from,
        to: effect.growDay.to,
        weekFrom: weekOfPhase(effect.growDay.from),
        weekTo: weekOfPhase(effect.growDay.to),
      }),
    );
  }
  if (effect.phaseDay) lines.push(t('grow.lifecycle.phase.effect.phaseDay', { from: effect.phaseDay.from, to: effect.phaseDay.to }));
  if (effect.stage) {
    lines.push(t('grow.lifecycle.phase.effect.stage', { from: t(`home.stage.${effect.stage.from}`), to: t(`home.stage.${effect.stage.to}`) }));
  }
  if (effect.noPhaseLeft) lines.push(t('grow.lifecycle.phase.effect.noPhaseLeft'));
  if (effect.timelineOnly) lines.push(t('grow.lifecycle.phase.effect.timelineOnly'));
  lines.push(t(entry));

  return (
    <ul className={styles.effect}>
      {lines.map(line => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}
