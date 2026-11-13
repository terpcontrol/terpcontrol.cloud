import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { GrowListItem, GrowthStage, Phase } from '@fg2/shared-types/v1';
import { growWeekOfDay } from '@fg2/shared-types/v1-schemas/feeding.js';
import { serverNow } from '@/api/clock';
import { useAddPhase, useCorrectPhase, useWithdrawPhase } from '@/api/lifecycle';
import { controlPath } from '@/app/places';
import type { Translate } from '@/i18n/i18n';
import { Sheet } from '@/ui/Sheet';
import { nextStage } from '@/log/defaults';
import { useLog } from '@/log/log-context';
import { instantOf } from '@/ui/age';
import { Refused } from '@/ui/PageState';
import { keptPreset, presetsOf } from '@/ui/presets';
import { standsIn } from '@/ui/session-access';
import { Block, Choice, Choices, WhenField } from '@/ui/SheetParts';
import { STAGES } from '@/ui/stages';
import ui from '@/ui/ui.module.css';
import { calendarDay, useZone } from '@/ui/zone';
import { ClimatePick, StageClimates } from './ClimatePick';
import { RepairAnswer } from './RepairAnswer';
import { climateRequest, defaultPick, useHeldNow, usePlaceController, type PhaseClimate } from './phase-climate';
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
 *
 * Over a grow that has ended the whole sheet speaks in the past. The server
 * freezes such a grow's summary at the day it came down, so "now Curing" and a
 * stage chip marked "now" dress frozen figures as a present the grow does not
 * have - which is what the phase bar above already refuses to say. The actions
 * stay: this is the only route left to a finished grow's phase list, because
 * the Log sheet needs an open placement and an ended grow has none, so a stage
 * somebody forgot or one rebuilt after a withdrawal can be repaired nowhere
 * else. They are worded as what they then are, an addition to a record rather
 * than a move, and the date starts on the day the grow ended so that a tap
 * cannot quietly file a phase a month after the plants came down.
 */
export function PhaseSheet({ grow, onClose }: { grow: GrowListItem; onClose: () => void }) {
  const { t } = useTranslation();
  const zone = useZone();
  const add = useAddPhase();
  const withdraw = useWithdrawPhase(grow.id);
  const { tell } = useLog();

  const ended = grow.endedAt !== null;
  const [stage, setStage] = useState<GrowthStage>(() => nextStage(grow) ?? grow.summary.stage ?? STAGES[0]);
  // Null until somebody picks: what the sheet starts on depends on the device there (`defaultPick`).
  const [picked, setPick] = useState<PhaseClimate | null>(null);
  const controller = usePlaceController(ended ? null : standsIn(grow));
  const pick = picked ?? defaultPick(stage, controller);
  const preset = pick.preset;
  // A grow that is over opens on the day it ended; one still running opens on
  // now as the server reckons it, which is what the field's cap is measured
  // against as well.
  const [at, setAt] = useState(() => (grow.endedAt ? new Date(grow.endedAt) : serverNow().toJSDate()));
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

  // The climate belongs to the stage it is the climate of, so a change of stage asks again.
  const pickStage = (next: GrowthStage) => {
    setStage(next);
    setPick(null);
  };

  return (
    <Sheet title={t('grow.lifecycle.phase.title', { name: grow.name })} onClose={onClose}>
      <div className={ui.sheetBody}>
        <p className={styles.now}>{nowLine(t, grow, zone)}</p>

        <Block label={t(ended ? 'grow.lifecycle.phase.record' : 'grow.lifecycle.phase.enter')} help="stage">
          <Choices label={t('grow.lifecycle.phase.stageLabel')}>
            {STAGES.map(one => (
              <Choice key={one} chosen={one === stage} onChoose={() => pickStage(one)}>
                {t(`home.stage.${one}`)}
                {!ended && one === grow.summary.stage ? ` · ${t('log.now')}` : ''}
              </Choice>
            ))}
          </Choices>

          <WhenField label={t('grow.lifecycle.when')} at={at} onChange={setAt} until={grow.endedAt ? new Date(grow.endedAt) : null} />
          {/* A grow that is over is a record being repaired, and a record moves no tent. */}
          {ended ? null : <ClimatePick stage={stage} spaceId={standsIn(grow)} value={pick} onChange={setPick} />}

          {standsThere ? (
            <p className={ui.note}>{t(ended ? 'grow.lifecycle.phase.alreadyThereEnded' : 'grow.lifecycle.phase.alreadyThere')}</p>
          ) : null}
          <Refused error={add.error} />

          <button
            type="button"
            className={`${ui.button} ${ui.primary} ${styles.submit}`}
            disabled={add.isPending}
            onClick={() =>
              add.mutate(
                { growId: grow.id, body: { stage, ...climateRequest(pick, stage), startedAt: instantOf(DateTime.fromJSDate(at)) } },
                {
                  // As the entry sheet answers a phase: what holds now, and the way back where taking the phase back
                  // is all it did - a phase that also wrote the place's targets would leave them standing.
                  onSuccess: phase => {
                    onClose();
                    tell({
                      label: [t('home.card.enteredPhase', { stage: t(`home.stage.${stage}`) }), grow.name, pick.climate ? t('log.targetsSet') : null]
                        .filter(Boolean)
                        .join(' · '),
                      ...(pick.climate ? { undo: null } : { undo: () => withdraw.mutateAsync(phase.id), undone: t('log.phaseBefore') }),
                    });
                  },
                },
              )
            }
          >
            {add.isPending
              ? t('grow.lifecycle.saving')
              : t(ended ? 'grow.lifecycle.phase.submitEnded' : 'grow.lifecycle.phase.submit', { stage: label(t, stage, preset) })}
          </button>
        </Block>

        <Block label={t('grow.lifecycle.phase.history')} help="phaseCorrection" aside={t('grow.lifecycle.phase.oldestFirst')}>
          {ordered.length === 0 ? (
            <p className={ui.note}>{t('grow.lifecycle.phase.noneYet')}</p>
          ) : (
            <ul className={ui.list}>
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

/**
 * What the server last said the grow reads as. Nothing here counts a day; the
 * summary rides on the grow.
 *
 * A grow that has ended is stated as what it finished as. Its figures are
 * frozen at the day it came down, so the present tense would make them a claim
 * about today, and the day it ended is what says which day they stopped on.
 */
const nowLine = (t: Translate, grow: GrowListItem, zone: string | null): string => {
  const { stage, preset, phaseDay, dayNumber } = grow.summary;
  if (!stage || dayNumber === null) return t('grow.lifecycle.phase.noPhaseYet');

  if (grow.endedAt !== null) {
    return t('grow.lifecycle.phase.endedLine', {
      stage: label(t, stage, preset),
      growDay: dayNumber,
      date: calendarDay(grow.endedAt, zone),
    });
  }

  return t('grow.lifecycle.phase.nowLine', {
    stage: label(t, stage, preset),
    phaseDay: phaseDay ?? dayNumber,
    growDay: dayNumber,
    week: growWeekOfDay(dayNumber),
  });
};

/** "Flower · late flower", the two halves of what a phase is. */
const label = (t: Translate, stage: GrowthStage, preset: string | null): string =>
  preset === null ? t(`home.stage.${stage}`) : `${t(`home.stage.${stage}`)} · ${t(`grow.presetName.${preset}`, { defaultValue: preset })}`;

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
  const zone = useZone();

  return (
    <li className={styles.row}>
      <div className={ui.headRow}>
        <span className={styles.rowTitle}>{label(t, phase.stage, phase.preset)}</span>
        <span className={styles.rowMeta}>
          {calendarDay(phase.startedAt, zone)} · {t(`grow.lifecycle.phase.source.${phase.source}`)}
        </span>
      </div>

      {open === null ? (
        <div className={ui.wrap}>
          <button type="button" className={ui.chip} onClick={() => onOpen('correct')}>
            {t('grow.lifecycle.phase.correct')}
          </button>
          <button type="button" className={`${ui.chip} ${ui.danger}`} onClick={() => onOpen('withdraw')}>
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
  const zone = useZone();
  const correct = useCorrectPhase(grow.id);
  const { tell } = useLog();

  const [stage, setStage] = useState(phase.stage);
  const [preset, setPreset] = useState(phase.preset);
  const [at, setAt] = useState(() => new Date(phase.startedAt));

  const startedAt = instantOf(DateTime.fromJSDate(at));
  const effect = correctionEffect(grow, phase, { stage, preset, startedAt });
  const changed = stage !== phase.stage || preset !== phase.preset || startedAt !== phase.startedAt;

  return (
    <div className={styles.editor}>
      {/* Both rows are named: the stage and the climate it was entered on can carry the same word, "Blüte" twice. */}
      <span className="label">{t('grow.lifecycle.phase.stageLabel')}</span>
      <Choices label={t('grow.lifecycle.phase.stageLabel')}>
        {STAGES.map(one => (
          <Choice
            key={one}
            chosen={one === stage}
            onChoose={() => {
              setStage(one);
              setPreset(current => keptPreset(one, current));
            }}
          >
            {t(`home.stage.${one}`)}
          </Choice>
        ))}
      </Choices>

      {/* The record's label and nothing else: correcting a phase writes no climate. */}
      {presetsOf(stage).length > 0 ? <span className="label">{t('grow.lifecycle.phase.presetLabel')}</span> : null}
      <StageClimates label={t('grow.lifecycle.phase.presetLabel')} stage={stage} chosen={preset} onPick={setPreset} />
      <WhenField label={t('grow.lifecycle.when')} at={at} onChange={setAt} until={grow.endedAt ? new Date(grow.endedAt) : null} />

      <Effect effect={effect} changed={changed} entry="grow.lifecycle.phase.effect.entry" />
      <Refused error={correct.error} />

      <RepairAnswer
        yes={t('grow.lifecycle.saveCorrection')}
        busy={correct.isPending}
        disabled={!changed}
        onYes={() =>
          correct.mutate(
            { phaseId: phase.id, body: { stage, preset, startedAt } },
            {
              // A correction writes no climate, so one call puts the phase back as it stood.
              onSuccess: () => {
                onDone();
                tell({
                  label: t('grow.lifecycle.phase.told.corrected', { phase: label(t, stage, preset), day: calendarDay(startedAt, zone) }),
                  undo: () =>
                    correct.mutateAsync({ phaseId: phase.id, body: { stage: phase.stage, preset: phase.preset, startedAt: phase.startedAt } }),
                  undone: t('grow.lifecycle.phase.told.asWas', {
                    phase: label(t, phase.stage, phase.preset),
                    day: calendarDay(phase.startedAt, zone),
                  }),
                });
              },
            },
          )
        }
        onDone={onDone}
      />
    </div>
  );
}

/**
 * A phase the grow never entered. What it is left with is said first, and the tap after that is the whole
 * confirmation. Taking a phase back writes no device, so what the tent is set to now is said beside it - and where the
 * device dries or germinates under a grow that then reads another phase, that it goes on doing so until it is ended
 * under Steuerung, with the way there: a phase taken back once left a tent drying under "Blüte · Alles im Ziel".
 */
function PhaseWithdrawal({ grow, phase, onDone }: { grow: GrowListItem; phase: Phase; onDone: () => void }) {
  const { t } = useTranslation();
  const withdraw = useWithdrawPhase(grow.id);
  const { tell } = useLog();
  const effect = withdrawalEffect(grow, phase);
  const spaceId = grow.endedAt === null ? standsIn(grow) : null;
  const held = useHeldNow(spaceId);
  const left = effect.noPhaseLeft ? null : (effect.stage?.to ?? grow.summary.stage);
  const stays = held?.mode && held.mode !== left ? held.mode : null;

  return (
    <div className={styles.editor}>
      <Effect effect={effect} changed entry="grow.lifecycle.phase.effect.entryGone" />
      {held ? (
        <p className={ui.note}>
          {t('grow.lifecycle.phase.effect.device', { figures: held.figures })}
          {stays && spaceId ? (
            <>
              {' '}
              {t(`grow.lifecycle.phase.effect.stays.${stays}`)}{' '}
              <Link to={controlPath(spaceId)} className={ui.headLink}>
                {t(`control.preset.end.${stays}`)} ›
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      <Refused error={withdraw.error} />

      <RepairAnswer
        yes={t('grow.lifecycle.phase.confirmWithdraw')}
        danger
        busy={withdraw.isPending}
        onYes={() =>
          withdraw.mutate(phase.id, {
            // Entering it again would write its climate where it had one, so there is no one call back.
            onSuccess: () => {
              onDone();
              tell({ label: t('grow.lifecycle.phase.told.withdrawn', { phase: label(t, phase.stage, phase.preset) }), undo: null });
            },
          })
        }
        onDone={onDone}
      />
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
        weekFrom: growWeekOfDay(effect.growDay.from),
        weekTo: growWeekOfDay(effect.growDay.to),
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
    <ul className={`${ui.effects} ${styles.effect}`}>
      {lines.map(line => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}
