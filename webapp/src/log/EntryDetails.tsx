import { useQueryClient } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
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
import { correctEntry, diaryChanged, startPhase, useRecentEntries, writeEntry } from '@/api/entries';
import { useGrow } from '@/api/grows';
import { dayOf, momentOn } from '@/ui/days';
import { readingFigure } from '@/ui/entries';
import { STAGES } from '@/ui/stages';
import ui from '@/ui/ui.module.css';
import { dayAt, dosesOf, lastCan, litresOf, nextStage, readingsOf, schemeStep, stoppedAfter } from './defaults';
import { about, lineLabel } from './lines';
import { useLog, type LogTarget, type TileKind } from './log-context';
import { Sheet } from './Sheet';
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
 * The day it happened is asked for here and nowhere else: one tap is always
 * now, and a line written down after the fact - this morning's watering,
 * yesterday's reading - is a detail like the can and the readings are. What the
 * sheet then draws follows that day rather than this one, down to which week of
 * the scheme the doses come from.
 */

/** The grow's own name for a can of water, which the water row already is: it is not asked for twice. */
const WATER_KEY = 'water_l';

/** How many readings a kind shows fields for before the rest become chips. */
const FIELDS_SHOWN = 3;

const LITRE_STEP = 0.5;

export function EntryDetails({ kind, target, entry, onClose }: { kind: TileKind; target: LogTarget; entry: Entry | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { log } = useLog();
  const client = useQueryClient();
  const { data: grow } = useGrow(target.growId);
  const { data: recent } = useRecentEntries(target.growId, target.spaceId);

  const definitions = (grow?.measurements ?? []).filter(measurement => measurement.key !== WATER_KEY);
  // The same can the tile offers, so opening the details never changes the line a tap would have written.
  const opensOn = kind === 'water' || kind === 'feed' ? lastCan(recent?.items ?? [], kind) : null;

  // When the line says it happened, and whether anybody said so: a new line
  // left alone is "now", which is the server's own default, and a correction
  // that did not touch the day keeps the instant it already had.
  const [at, setAt] = useState<Date>(() => (entry ? new Date(entry.occurredAt) : new Date()));
  const [dated, setDated] = useState(false);
  const [litres, setLitres] = useState<number | null>(entry ? litresOf(entry) : opensOn);
  const [readings, setReadings] = useState<Record<string, string>>(() => typed(readingsOf(entry)));
  const [shown, setShown] = useState<string[]>(() => firstFields(definitions, readingsOf(entry)));
  const [text, setText] = useState(entry?.text ?? '');
  const [stage, setStage] = useState<GrowthStage | null>(nextStage(grow));
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const today = dayOf(new Date());
  const step = schemeStep(grow, at);
  // What the line will say it is: the day it is dated to, not the day it is being written on.
  const filed = { ...target, dayNumber: dayAt(grow, target, at) };
  const showsWater = kind === 'water' || kind === 'feed';
  const showsReadings = kind === 'water' || kind === 'feed' || kind === 'measurement';
  const showsText = kind === 'note' || kind === 'training';
  const showsWhen = kind !== 'phase';
  const doses = dosesOf(grow, litres, at);

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
      default:
        return { kind: 'note' };
    }
  };

  /** A phase is not an entry: it is written as the grow's phase, and the diary line follows from it. */
  const savePhase = async () => {
    if (!target.growId || !stage) return;
    setSaving(true);
    setFailed(false);
    try {
      await startPhase(target.growId, { stage });
      diaryChanged(client);
      onClose();
    } catch {
      setSaving(false);
      setFailed(true);
    }
  };

  const correct = async () => {
    if (!entry) return;
    setSaving(true);
    setFailed(false);
    try {
      const body: EntryUpdate = { ...about(target), ...whenSaid(dated, at), text: showsText ? text : entry.text, values: values() };
      await correctEntry(entry.id, body);
      diaryChanged(client);
      onClose();
    } catch {
      setSaving(false);
      setFailed(true);
    }
  };

  const save = () => {
    if (kind === 'phase') return void savePhase();
    if (entry) return void correct();

    const body: EntryCreate = { kind, ...about(target), ...whenSaid(dated, at), text: showsText && text ? text : undefined, values: values() };
    log({ label: lineLabel(t, kind, filed), details: { kind, target }, send: () => writeEntry(body) });
  };

  const add = (key: string) => setShown(current => [...current, key]);

  return (
    <Sheet title={title(t, kind, step?.week ?? null)} aside={kind === 'feed' ? schemeLine(grow) : undefined} onClose={onClose}>
      <p className={`mono ${styles.subject}`}>{lineLabel(t, kind, filed)}</p>

      {showsWhen ? (
        <label className={`${ui.card} ${styles.whenRow}`}>
          <span className={styles.waterLabel}>{t('log.when')}</span>
          <input
            className={`mono ${styles.whenInput}`}
            type="date"
            /* An entry records something that has happened, so tomorrow is not on offer. */
            max={today}
            value={dayOf(at)}
            onChange={event => {
              if (!event.target.value) return;
              setAt(momentOn(event.target.value, at));
              setDated(true);
            }}
          />
        </label>
      ) : null}

      {showsWater ? (
        <div className={`${ui.card} ${styles.waterRow}`}>
          <span className={styles.waterLabel}>{t('log.water')}</span>
          <button type="button" className={styles.step} onClick={() => setLitres(next(litres, -LITRE_STEP))} aria-label={t('log.less')}>
            <Minus size={16} strokeWidth={2} aria-hidden />
          </button>
          <span className={`figure ${styles.waterFigure}`}>{litres === null ? '—' : t('log.litres', { litres: readingFigure(litres) })}</span>
          <button type="button" className={styles.step} onClick={() => setLitres(next(litres, LITRE_STEP))} aria-label={t('log.more')}>
            <Plus size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
      ) : null}

      {kind === 'feed' ? (
        <div className={`${ui.card} ${styles.doses}`}>
          {step ? (
            step.amounts.map(amount => {
              const dose = doses.find(one => one.productKey === amount.productKey);
              const until = amount.value === null ? stoppedAfter(grow, amount.productKey) : null;
              return (
                <div key={amount.productKey} className={styles.dose} data-off={amount.value === null}>
                  <span className={styles.doseName}>{amount.name}</span>
                  <span className={`mono ${styles.doseRate}`}>
                    {amount.value === null ? (until === null ? '' : t('log.stopsAfter', { week: until })) : `${amount.value} ${amount.unit}`}
                  </span>
                  <span className={`figure ${styles.doseAmount}`}>{dose ? `${readingFigure(dose.amount)} ${dose.unit}` : '—'}</span>
                </div>
              );
            })
          ) : (
            <p className={ui.note}>{t('log.noScheme')}</p>
          )}
          <p className={`${ui.note} ${styles.mixNote}`}>{t('log.mixOrder')}</p>
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
                    value={readings[key] ?? ''}
                    placeholder={definition?.unit || undefined}
                    onChange={event => setReadings(current => ({ ...current, [key]: event.target.value }))}
                  />
                </label>
              );
            })}
          </div>
          {definitions.length > shown.length ? (
            <p className={`mono ${styles.more}`}>
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

      {showsText ? (
        <textarea
          className={`${ui.input} ${styles.text}`}
          rows={3}
          value={text}
          placeholder={t(kind === 'note' ? 'log.notePlaceholder' : 'log.trainingPlaceholder')}
          onChange={event => setText(event.target.value)}
        />
      ) : null}

      {kind === 'phase' ? <Stages grow={grow} stage={stage} onPick={setStage} /> : null}

      {failed ? (
        <p className={ui.problem} role="alert">
          {t('log.saveFailed')}
        </p>
      ) : null}

      <button type="button" className={`${ui.button} ${ui.primary} ${styles.save}`} onClick={save} disabled={saving || (kind === 'phase' && !stage)}>
        {saveLabel(t, kind, entry, filed, step !== null)}
      </button>
    </Sheet>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The six stages, with the one the grow is in named and the next one already picked. */
function Stages({ grow, stage, onPick }: { grow: GrowListItem | undefined; stage: GrowthStage | null; onPick: (stage: GrowthStage) => void }) {
  const { t } = useTranslation();
  const current = grow?.summary.stage ?? null;

  if (!grow) return <p className={ui.note}>{t('log.phaseNeedsGrow')}</p>;

  return (
    <div className={styles.stages} role="group" aria-label={t('log.tile.phase')}>
      {STAGES.map(one => (
        <button
          key={one}
          type="button"
          className={`${ui.chip} ${styles.target}`}
          data-chosen={one === stage}
          aria-pressed={one === stage}
          onClick={() => onPick(one)}
        >
          {t(`home.stage.${one}`)}
          {one === current ? ` · ${t('log.now')}` : ''}
        </button>
      ))}
    </div>
  );
}

const title = (t: Translate, kind: TileKind, week: number | null): string =>
  kind === 'feed' && week !== null ? t('log.feedWeek', { week }) : t(`log.tile.${kind}`);

/** "Biobizz · Light·Mix": which grid the doses come from, in the words the grow stores it under. */
const schemeLine = (grow: GrowListItem | undefined): string => {
  const origin = grow?.scheme?.origin;
  if (!origin) return '';
  const name = origin.type === 'asset' ? origin.assetId.charAt(0).toUpperCase() + origin.assetId.slice(1) : origin.schemeId;

  return [name, grow?.scheme?.plantType].filter(Boolean).join(' · ');
};

const saveLabel = (t: Translate, kind: TileKind, entry: Entry | null, target: LogTarget, planned: boolean): string => {
  if (entry) return t('log.saveCorrection');
  if (kind === 'feed' && planned) return t('log.logAsPlanned');
  return target.dayNumber === null ? t('log.save') : t('log.saveDay', { day: target.dayNumber });
};

/** Nothing at all unless somebody dated the line, so a write means "now" and a correction means "as it was". */
const whenSaid = (dated: boolean, at: Date): { occurredAt?: string } => (dated ? { occurredAt: at.toISOString() } : {});

/** Never below one step: a watering of zero litres is not a watering, it is an unanswered question. */
const next = (litres: number | null, by: number): number => Math.max(LITRE_STEP, Math.round(((litres ?? 0) + by) / LITRE_STEP) * LITRE_STEP);

const typed = (readings: EntryReading[]): Record<string, string> =>
  Object.fromEntries(readings.map(reading => [reading.key, readingFigure(reading.value)]));

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
    const value = Number((typedIn[key] ?? '').replace(',', '.').trim());
    if (!(typedIn[key] ?? '').trim() || !Number.isFinite(value)) return [];
    const perPlant = definitions.find(definition => definition.key === key)?.perPlant ?? false;

    return [{ key, value, plantId: perPlant ? (target.plantIds[0] ?? null) : null }];
  });
