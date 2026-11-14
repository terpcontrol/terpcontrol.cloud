import { useQueryClient } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react';
import { DateTime } from 'luxon';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  Entry,
  EntryCreate,
  EntryReading,
  EntryUpdate,
  EntryValuesDraft,
  GrowListItem,
  GrowthStage,
  MeasurementDefinition,
} from '@fg2/shared-types/v1';
import { MAX_LITRES } from '@fg2/shared-types/v1-schemas/feeding.js';
import { serverNow } from '@/api/clock';
import { correctEntry, diaryChanged, startPhase, takeEntryBack, useRecentEntries, writeEntry } from '@/api/entries';
import { api } from '@/api/client';
import { useGrow } from '@/api/grows';
import { useHome } from '@/api/home';
import { THUMBNAIL_WIDTH, mediaUrl } from '@/api/session';
import type { Translate } from '@/i18n/i18n';
import { MeasureSheet } from '@/screens/grow/measurements/MeasureSheet';
import { StartGrowSheet } from '@/screens/grow/new/WhatGrows';
import { ClimatePick } from '@/screens/grow/ClimatePick';
import { assetTitle } from '@/screens/grow/scheme';
import { climateRequest, defaultPick, KEEP_CLIMATE, usePlaceController, type PhaseClimate } from '@/screens/grow/phase-climate';
import { Facts } from '@/ui/Facts';
import { factsOf, unbroken } from '@/ui/fact-text';
import { Asking } from '@/ui/Asking';
import { looseFigure, typedFigure, unitShown } from '@/ui/figures';
import { Help } from '@/ui/Help';
import { PictureStrip, PictureViewer } from '@/ui/PictureViewer';
import { useMayManage } from '@/ui/session-access';
import { Choice, Choices } from '@/ui/SheetParts';
import { STAGES } from '@/ui/stages';
import ui from '@/ui/ui.module.css';
import { dayAt, dosesOf, lastCan, litresOf, nextStage, readingsOf, schemeStep, startsAfter, stoppedAfter, useGrowBegins } from './defaults';
import { about, lineLabel, occurredAt } from './lines';
import { useLog, type LogTarget, type TileKind } from './log-context';
import { Moment } from './Moment';
import { Sheet } from '@/ui/Sheet';
import styles from './Log.module.css';

/**
 * The details behind a tile: the water, the doses that follow from it, the
 * readings taken while pouring, and the words.
 *
 * It is the same view for every kind that has any, because they differ in which
 * of those four they show and in nothing else. The doses are worked out with
 * the contract's own function, so what is drawn here is what the server will
 * store; nothing is sent with them, and the server reads the grid again.
 *
 * A line written here goes through the queue like a tap does - sheet closed,
 * toast up, Undo for five seconds. Correcting a line that already exists does
 * not: it waits for the server, because there is nothing to undo afterwards.
 *
 * When it happened stands in the sheet's corner from the start (`Moment`): a
 * line written down after the fact - this morning's watering, yesterday's
 * reading - is dated there, and what the sheet then draws follows that moment
 * rather than this one, down to which week of the scheme the doses come from.
 */

/** The grow's own name for a can of water, which the water row already is: it is not asked for twice. */
const WATER_KEY = 'water_l';

/** How many readings a kind shows fields for before the rest become chips. */
const FIELDS_SHOWN = 3;

const LITRE_STEP = 0.5;

interface DetailsProps {
  kind: TileKind;
  target: LogTarget;
  entry: Entry | null;
  /** When the line was said to have happened before its kind was chosen; null is now. */
  at: Date | null;
  /** Back to the tiles the kind was chosen on, where it was chosen there. */
  onBack?: (() => void) | null;
  onClose: () => void;
}

export function EntryDetails({ kind, target, entry, at, onBack, onClose }: DetailsProps) {
  // Measuring has a sheet of its own: it is the one tile whose fields are the
  // grow's own definitions, and it is used with one hand in front of a plant.
  // Correcting a line that already exists stays here, where every kind is
  // corrected the same way - a keypad that rewrote a round of readings taken
  // across several plants would be a second way to say what the line already
  // says.
  if (kind === 'measurement' && !entry) return <MeasureSheet target={target} at={at} onBack={onBack} onClose={onClose} />;

  return <Details kind={kind} target={target} entry={entry} at={at} onBack={onBack} onClose={onClose} />;
}

function Details({ kind, target, entry, at: given, onBack, onClose }: DetailsProps) {
  const { t, i18n } = useTranslation();
  const { log, tell } = useLog();
  const client = useQueryClient();
  const { data: grow } = useGrow(target.growId);
  const { data: recent } = useRecentEntries(target.growId, target.spaceId);

  const definitions = (grow?.measurements ?? []).filter(measurement => measurement.key !== WATER_KEY);
  // The same can the tile offers, so opening the details never changes the line a tap would have written.
  const last = kind === 'water' || kind === 'feed' ? lastCan(recent?.items ?? [], kind) : null;
  const opensOn = last?.litres ?? null;

  // When the line says it happened, or null where nobody said: a new line left
  // alone is "now", which is the server's own default, and a correction that
  // did not touch its moment keeps the instant it already had.
  const [dated, setDated] = useState<Date | null>(given);
  const said = dated ?? (entry ? new Date(entry.occurredAt) : null);
  const at = said ?? serverNow().toJSDate();
  const [litres, setLitres] = useState<number | null>(entry ? litresOf(entry) : opensOn);
  // What stands in the field while it is typed in: "4," is not a figure yet and must not be put right under the finger.
  const [typedLitres, setTypedLitres] = useState<string | null>(null);
  // Refused with a word rather than dropped: what was typed is no number, no amount at all, or more water than a
  // tent takes at once. What is refused stays in the field as it was typed.
  const typedValue = typedLitres !== null && typedLitres.trim() !== '' ? typedFigure(typedLitres) : undefined;
  const refusedLitres =
    typedValue === null
      ? 'log.litresNoNumber'
      : typedValue !== undefined && typedValue <= 0
        ? 'log.litresBelow'
        : (litres ?? 0) > MAX_LITRES
          ? 'log.litresTooMuch'
          : null;
  const begins = useGrowBegins(grow, target);
  const [readings, setReadings] = useState<Record<string, string>>(() => typed(readingsOf(entry)));
  const [shown, setShown] = useState<string[]>(() => firstFields(definitions, readingsOf(entry)));
  const [text, setText] = useState(entry?.text ?? '');
  const [stage, setStage] = useState<GrowthStage | null>(nextStage(grow));
  /**
   * Whether the phase moves the tent's climate too: asked beside the stage, and
   * kept until the stage changes. Null until somebody picks, because what it
   * starts on depends on the device there (`defaultPick`).
   */
  const [picked, setClimate] = useState<PhaseClimate | null>(null);
  const placeController = usePlaceController(target.spaceId ?? target.standsIn);
  const climate = picked ?? (stage ? defaultPick(stage, placeController) : KEEP_CLIMATE);
  const [saving, setSaving] = useState(false);
  /** The corner's pop-up stands open on a moment it refuses: nothing is saved under a moment nobody chose. */
  const [refusedMoment, setRefusedMoment] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  /** Which of the two writes went wrong, so the line under the button says the right thing. */
  const [failed, setFailed] = useState<'save' | 'back' | null>(null);
  const [askingBack, setAskingBack] = useState(false);
  /** The new-grow sheet takes this one's place once it is opened, rather than standing over it. */
  const [startingGrow, setStartingGrow] = useState(false);

  const step = schemeStep(grow, at);
  // What the line will say it is: the day it is dated to, not the day it is being written on.
  const filed = said ? { ...target, dayNumber: dayAt(grow, target, said) } : target;
  const showsWater = kind === 'water' || kind === 'feed';
  const showsReadings = kind === 'water' || kind === 'feed' || kind === 'measurement';
  const showsText = kind === 'note' || kind === 'training' || kind === 'photo';
  // A note is its words: one without any says nothing and is not written.
  const nothingSaid = kind === 'note' && text.trim() === '';
  const doses = dosesOf(grow, litres, at);
  // A reading that was typed and is no number is said to be none, by its name: left out silently it was a figure lost.
  const unread = showsReadings ? shown.find(key => (readings[key] ?? '').trim() !== '' && typedFigure(readings[key]) === null) : undefined;
  const unreadName = unread === undefined ? null : (definitions.find(one => one.key === unread)?.name ?? unread);
  // The sentence that refuses a figure describes its field and the Save it holds back, so a screen reader hears why.
  const refusal = useId();
  const refused = (showsWater && refusedLitres !== null) || unread !== undefined;
  const pictures = (entry?.mediaIds ?? []).flatMap(mediaId => mediaUrl(mediaId, THUMBNAIL_WIDTH.frame) ?? []);

  const values = (): EntryValuesDraft => {
    const taken = readingsFrom(readings, shown, definitions, target);
    switch (kind) {
      case 'water':
        return { kind: 'water', litres, readings: taken };
      case 'feed':
        return { kind: 'feed', litres, readings: taken };
      case 'measurement':
        return { kind: 'measurement', readings: taken };
      case 'training':
        return { kind: 'training' };
      case 'visit':
        return { kind: 'visit' };
      case 'photo':
        return { kind: 'photo' };
      default:
        return { kind: 'note' };
    }
  };

  /** A phase is not an entry: it is written as the grow's phase, and the diary line follows from it. */
  const savePhase = async () => {
    if (!target.growId || !stage) return;
    setSaving(true);
    setFailed(null);
    try {
      const growId = target.growId;
      const phase = await startPhase(growId, {
        stage,
        ...climateRequest(climate, stage),
        ...(dated ? { startedAt: occurredAt(dated).occurredAt } : {}),
      });
      diaryChanged(client);
      void client.invalidateQueries({ queryKey: ['devices'] });
      onClose();
      // The sheet is gone and nothing on the page need have moved: the toast says what was set. A phase that
      // also wrote the place's targets is not taken back from here - the targets would stay.
      tell({
        label: [t('home.card.enteredPhase', { stage: t(`home.stage.${stage}`) }), target.label, climate.climate ? t('log.targetsSet') : null]
          .filter(Boolean)
          .join(' · '),
        ...(climate.climate
          ? { undo: null }
          : { undo: () => api.delete(`/grows/${growId}/phases/${phase.id}`).then(() => diaryChanged(client)), undone: t('log.phaseBefore') }),
      });
    } catch {
      setSaving(false);
      setFailed('save');
    }
  };

  const correct = async () => {
    if (!entry) return;
    setSaving(true);
    setFailed(null);
    try {
      const body: EntryUpdate = { ...about(target), ...occurredAt(dated), text: showsText ? text : entry.text, values: values() };
      await correctEntry(entry.id, body);
      diaryChanged(client);
      onClose();
      // The sheet is gone and the line may be days up the page: the toast says it was taken.
      tell({ label: t('log.corrected'), undo: null });
    } catch {
      setSaving(false);
      setFailed('save');
    }
  };

  /**
   * Taking the line out of the diary altogether, which is what a reading typed
   * against the wrong plant or a watering that never happened asks for. It is
   * asked about first: the toast's Undo is a slip caught in five seconds, this
   * is somebody deciding days later, and the two deserve different care.
   */
  const takeBack = async () => {
    if (!entry) return;
    setSaving(true);
    setFailed(null);
    try {
      await takeEntryBack(entry.id);
      diaryChanged(client);
      onClose();
      tell({ label: t('log.takenBack'), undo: null });
    } catch {
      setSaving(false);
      setFailed('back');
    }
  };

  const save = () => {
    if (kind === 'phase') return void savePhase();
    if (entry) return void correct();

    // Dated when it was written, whether or not somebody said when: a line sent later, once the connection is
    // back, is still of this moment.
    const body: EntryCreate = {
      kind,
      ...about(target),
      ...occurredAt(dated ?? serverNow().toJSDate()),
      text: showsText && text ? text : undefined,
      values: values(),
    };
    log({ label: lineLabel(t, kind, filed), details: { kind, target }, send: () => writeEntry(body) });
  };

  const add = (key: string) => setShown(current => [...current, key]);
  const stepBy = (by: number) => {
    setTypedLitres(null);
    setLitres(next(litres, by));
  };

  // Starting a grow answers the question this sheet could not: one sheet at a time, in place.
  if (startingGrow) return <StartGrowSheet spaceId={target.spaceId ?? target.standsIn} name={target.label} onClose={onClose} />;

  return (
    <Sheet
      // A line about stepping in is no longer written here, but one written before is still corrected here, under the name the diary gives it.
      title={kind === 'visit' ? t('home.entryKind.visit') : t(`log.tile.${kind}`)}
      corner={<Moment at={said} onChange={setDated} begins={begins} onRefused={setRefusedMoment} />}
      onBack={onBack}
      onClose={onClose}
      // Kept on the sheet's bottom edge, so it is in view with the keyboard up.
      actions={
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          onClick={save}
          disabled={saving || refusedMoment || nothingSaid || refused || (kind === 'phase' && !stage)}
          aria-describedby={refused ? refusal : undefined}
        >
          {saveLabel(t, kind, entry, filed, step !== null)}
        </button>
      }
    >
      {/* Which grid the doses come from, and which week of it, sits with what the line is about: the corner is the moment's. */}
      <p className={styles.subject}>
        <Facts
          facts={[
            ...factsOf(lineLabel(t, kind, filed)),
            ...(kind === 'feed' ? factsOf(schemeLine(grow)) : []),
            kind === 'feed' && step ? t('log.schemeWeek', { week: step.week }) : null,
          ]}
        />
        {kind === 'feed' && step ? <Help topic="mixing" /> : null}
      </p>

      {showsWater ? (
        <div className={`${ui.card} ${styles.waterRow}`}>
          <span className={styles.waterLabel}>{t('log.water')}</span>
          <button type="button" className={styles.step} onClick={() => stepBy(-LITRE_STEP)} aria-label={t('log.less')}>
            <Minus size={16} strokeWidth={2} aria-hidden />
          </button>
          <label className={`figure mono ${styles.waterFigure}`}>
            <input
              inputMode="decimal"
              aria-label={t('log.waterLitres')}
              aria-invalid={refusedLitres !== null || undefined}
              aria-describedby={refusedLitres ? refusal : undefined}
              value={typedLitres ?? (litres === null ? '' : looseFigure(litres))}
              placeholder="—"
              onChange={event => {
                setTypedLitres(event.target.value);
                const value = typedFigure(event.target.value);
                setLitres(value !== null && value > 0 ? value : null);
              }}
              onBlur={() => refusedLitres === null && setTypedLitres(null)}
            />
            {t('log.litres', { litres: '' }).trim()}
          </label>
          <button type="button" className={styles.step} onClick={() => stepBy(LITRE_STEP)} aria-label={t('log.more')}>
            <Plus size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
      ) : null}

      {showsWater && refusedLitres ? (
        <p id={refusal} className={ui.problem} role="alert">
          {unbroken(t(refusedLitres, { max: MAX_LITRES }))}
        </p>
      ) : null}

      {/* What the field opened on is the last can, and when that was says how far to trust it. */}
      {showsWater && !entry && last ? (
        <p className={styles.lastTime}>
          <Facts
            facts={factsOf(
              t('log.lastTime', {
                ago: DateTime.fromISO(last.at).toRelative({ base: serverNow(), locale: i18n.language }) ?? '',
                litres: looseFigure(last.litres),
              }),
            )}
          />
        </p>
      ) : null}

      {/* A grow fed by no scheme has no doses to list, and nothing is said in their place. */}
      {kind === 'feed' && step ? (
        <div className={`${ui.card} ${styles.doses}`}>
          {step.amounts.map(amount => {
            const dose = doses.find(one => one.productKey === amount.productKey);
            const from = amount.value === null ? startsAfter(grow, amount.productKey, step.week) : null;
            const until = amount.value === null && from === null ? stoppedAfter(grow, amount.productKey) : null;
            return (
              <div key={amount.productKey} className={styles.dose} data-off={amount.value === null}>
                <span className={styles.doseName}>{amount.name}</span>
                <span className={`mono ${styles.doseRate}`}>
                  {amount.value === null
                    ? from !== null
                      ? t('log.startsIn', { week: from })
                      : until === null || until >= step.week
                        ? ''
                        : t('log.stopsAfter', { week: until })
                    : `${looseFigure(amount.value)} ${unitShown(amount.unit)}`}
                </span>
                <span className={`figure mono ${styles.doseAmount}`}>{dose ? `${looseFigure(dose.amount)} ${dose.unit}` : '—'}</span>
              </div>
            );
          })}
        </div>
      ) : null}

      {showsReadings ? (
        <>
          <div className={styles.fields}>
            {shown.map(key => {
              const definition = definitions.find(one => one.key === key);
              return (
                <label key={key} className={`${ui.card} ${styles.field}`}>
                  <span className={styles.fieldName}>{definition?.name ?? key}</span>
                  <input
                    className={`figure ${styles.fieldInput}`}
                    inputMode="decimal"
                    aria-invalid={key === unread || undefined}
                    aria-describedby={key === unread && !refusedLitres ? refusal : undefined}
                    value={readings[key] ?? ''}
                    placeholder={definition?.unit || undefined}
                    onChange={event => setReadings(current => ({ ...current, [key]: event.target.value }))}
                  />
                </label>
              );
            })}
          </div>
          {/* Left out silently, a figure typed into the wrong field was a reading lost: the first one that is no number is named. */}
          {unreadName !== null && !refusedLitres ? (
            <p id={refusal} className={ui.problem} role="alert">
              {t('log.readingNoNumber', { name: unreadName })}
            </p>
          ) : null}
          {definitions.length > shown.length ? (
            <p className={styles.more}>
              <span className="label">{t('log.measurements')}</span>
              {definitions
                .filter(definition => !shown.includes(definition.key))
                .map(definition => (
                  <button key={definition.key} type="button" className={`${ui.chip} ${styles.addField}`} onClick={() => add(definition.key)}>
                    + {definition.name}
                  </button>
                ))}
            </p>
          ) : null}
        </>
      ) : null}

      {/* The pictures a line carries are corrected nowhere, but they are what the line is about: shown, and opened. */}
      {pictures.length > 0 ? (
        <div className={ui.stack1}>
          <span className="label">{t('log.pictures')}</span>
          <PictureStrip pictures={pictures} onOpen={setViewing} />
        </div>
      ) : null}

      {showsText ? (
        <textarea
          className={`${ui.input} ${styles.text}`}
          rows={3}
          value={text}
          placeholder={t(kind === 'note' ? 'log.notePlaceholder' : kind === 'photo' ? 'log.noteOptional' : 'log.trainingPlaceholder')}
          onChange={event => setText(event.target.value)}
        />
      ) : null}

      {kind === 'phase' ? (
        <Stages
          grow={grow}
          stage={stage}
          onPick={next => {
            setStage(next);
            setClimate(null);
          }}
          spaceId={target.spaceId ?? target.standsIn}
          onStartGrow={() => setStartingGrow(true)}
        />
      ) : null}
      {kind === 'phase' && grow && stage ? (
        <div className={styles.climate}>
          <ClimatePick stage={stage} spaceId={target.spaceId ?? target.standsIn} value={climate} onChange={setClimate} />
          {/* A phase dated back starts back then in the diary; the devices can only be told now. */}
          {dated && climate.climate ? <p className={ui.note}>{t('log.moment.climateNow')}</p> : null}
        </div>
      ) : null}

      {failed ? (
        <p className={ui.problem} role="alert">
          {t(failed === 'back' ? 'log.deleteFailed' : 'log.saveFailed')}
        </p>
      ) : null}

      {/* Only a line somebody wrote: what a device or the server recorded is
          not theirs to take back, and the server refuses it. */}
      {entry && entry.source === 'human' ? (
        <div className={styles.takingBack}>
          {askingBack ? (
            <Asking
              note={t('log.takeBackAsk')}
              yes={t('log.takeBackYes')}
              danger
              busy={saving}
              onYes={() => void takeBack()}
              onCancel={() => setAskingBack(false)}
            />
          ) : (
            <button type="button" className={`${ui.button} ${ui.dangerInk}`} disabled={saving} onClick={() => setAskingBack(true)}>
              {t('log.takeBack')}
            </button>
          )}
        </div>
      ) : null}
      {viewing !== null ? <PictureViewer pictures={pictures} from={viewing} onClose={() => setViewing(null)} /> : null}
    </Sheet>
  );
}

/**
 * The six stages, with the one the grow is in named and the next one already
 * picked - and, where there is no grow to give a phase to, the way to the one
 * thing that would make the question answerable.
 *
 * The screens that invite somebody here are the reason for that second half. A
 * place with nothing growing in it draws a "+ Grow" chip, and the chip opens
 * this tile: with only the sentence it is a door onto a wall, and the sentence
 * is true but useless, because what the person asked for was a grow and this
 * says they cannot have a phase. So the offer stands beside it whenever the
 * place really has nothing growing and the reader may start one - not for a
 * place that has a grow the line was simply not pointed at, where the way on is
 * the grow's own chip a thumb's width away.
 */
function Stages({
  grow,
  stage,
  onPick,
  spaceId,
  onStartGrow,
}: {
  grow: GrowListItem | undefined;
  stage: GrowthStage | null;
  onPick: (stage: GrowthStage) => void;
  spaceId: string | null;
  onStartGrow: () => void;
}) {
  const { t } = useTranslation();
  const home = useHome();
  const mayManage = useMayManage(spaceId);
  const current = grow?.summary.stage ?? null;
  const card = (home.data?.spaces ?? []).find(one => one.spaceId === spaceId) ?? null;
  const nothingGrowsThere = card !== null && card.grow === null;

  if (!grow)
    return (
      <div className={styles.noGrow}>
        <p className={ui.note}>{t('log.phaseNeedsGrow')}</p>
        {nothingGrowsThere && mayManage ? (
          <button type="button" className={ui.button} onClick={onStartGrow}>
            {t('log.startGrowHere', { name: card.name })}
          </button>
        ) : null}
      </div>
    );

  return (
    <Choices label={t('log.tile.phase')}>
      {STAGES.map(one => (
        <Choice key={one} chosen={one === stage} onChoose={() => onPick(one)}>
          {t(`home.stage.${one}`)}
          {one === current ? ` · ${t('log.now')}` : ''}
        </Choice>
      ))}
    </Choices>
  );
}

/** "Biobizz · Light·Mix": which grid the doses come from, in the words the grow stores it under. */
const schemeLine = (grow: GrowListItem | undefined): string => {
  const origin = grow?.scheme?.origin;
  if (!origin) return '';
  const name = origin.type === 'asset' ? assetTitle(origin.assetId) : origin.schemeId;

  // A medium the shipped grid names by its key ("light_mix") is already in the grid's title, and a key is never shown.
  const medium = grow?.scheme?.plantType;
  return [name, medium && !/^[a-z0-9_]+$/.test(medium) ? medium : null].filter(Boolean).join(' · ');
};

/** What the button says it will do. */
const saveLabel = (t: Translate, kind: TileKind, entry: Entry | null, target: LogTarget, planned: boolean): string => {
  if (entry) return t('grow.lifecycle.saveCorrection');
  if (kind === 'feed' && planned) return t('log.logAsPlanned');
  return target.dayNumber === null ? t('log.save') : t('log.saveDay', { day: target.dayNumber });
};

/** Never below one step: a watering of zero litres is not a watering, it is an unanswered question. */
const next = (litres: number | null, by: number): number => Math.max(LITRE_STEP, Math.round(((litres ?? 0) + by) / LITRE_STEP) * LITRE_STEP);

const typed = (readings: EntryReading[]): Record<string, string> =>
  Object.fromEntries(readings.map(reading => [reading.key, looseFigure(reading.value)]));

/** The fields a kind opens with: what the line already says, else the first few the grow measures. */
const firstFields = (definitions: MeasurementDefinition[], readings: EntryReading[]): string[] =>
  readings.length > 0 ? readings.map(reading => reading.key) : definitions.slice(0, FIELDS_SHOWN).map(definition => definition.key);

/**
 * What was typed, as readings. A field left empty is not a reading of nothing,
 * so it is left out; a per-plant definition on a line about one plant carries
 * that plant, and on a line about the whole grow carries none.
 */
const readingsFrom = (typedIn: Record<string, string>, shown: string[], definitions: MeasurementDefinition[], target: LogTarget): EntryReading[] =>
  shown.flatMap(key => {
    const value = typedFigure(typedIn[key] ?? '');
    if (value === null) return [];
    const perPlant = definitions.find(definition => definition.key === key)?.perPlant ?? false;

    return [{ key, value, plantId: perPlant ? (target.plantIds[0] ?? null) : null }];
  });
