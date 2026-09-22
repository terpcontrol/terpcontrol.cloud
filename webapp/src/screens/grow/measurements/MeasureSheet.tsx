import { useQueryClient } from '@tanstack/react-query';
import { Delete } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { EntryCreate, EntryReading, MeasurementDefinition, Plant } from '@fg2/shared-types/v1';
import { diaryChanged, useRecentEntries, writeEntry } from '@/api/entries';
import { useGrow, useGrowPlants } from '@/api/grows';
import { about, lineLabel } from '@/log/lines';
import { useLog, type LogTarget } from '@/log/log-context';
import { Sheet } from '@/log/Sheet';
import { ageLabel } from '@/ui/age';
import { readingFigure } from '@/ui/entries';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { bandOf, lastReadings, slotOf, withUnit } from './definitions';
import styles from './Measure.module.css';

/** The keypad, in the order a hand expects it, with the rubout in the corner. */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'];

interface MeasureSheetProps {
  target: LogTarget;
  onClose: () => void;
}

/**
 * Taking a reading: which plant, which measurement, and the figure.
 *
 * It is a keypad rather than a field because of where it is used - one hand, in
 * a tent, with the other hand holding the tape or the pen. Everything above the
 * keys is there so that the figure can be checked without leaving: what was
 * measured last time and how long ago, how far this one has moved, the band
 * aimed at, and what another plant was.
 *
 * What is typed for the plants and the whole grow is one line: readings carry
 * their own plant, so the round of measuring that a person does in one go
 * stands in the diary as the one thing it was. "Save and next plant" writes
 * that line and stays open on the next plant, because a round of measuring is
 * one plant after another and closing between them would be the whole cost of
 * the round.
 */
export function MeasureSheet({ target, onClose }: MeasureSheetProps) {
  const { t } = useTranslation();
  const now = useNow();
  const client = useQueryClient();
  const { log } = useLog();
  const { data: grow } = useGrow(target.growId);
  const { data: plants } = useGrowPlants(target.growId);
  const { data: recent } = useRecentEntries(target.growId, target.spaceId);

  const definitions = grow?.measurements ?? [];
  const standing = (plants?.items ?? []).filter(plant => plant.status === 'active');
  const last = lastReadings(recent?.items ?? []);

  // Which plant the figures are about, and which measurement is being typed.
  // A sheet opened on one plant is already about that plant; one opened on the
  // grow starts at the first plant standing in it, because that is where a
  // round of measuring starts.
  const [chosenPlant, setChosenPlant] = useState<string | null | undefined>(target.plantIds[0]);
  const [key, setKey] = useState<string | null>(null);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const plantId = chosenPlant === undefined ? (standing[0]?.id ?? null) : chosenPlant;
  // Standing in front of the whole grow, only what is measured of the grow can
  // be written: a height belongs to a plant, and one typed against nothing
  // would be a number with nobody to read it back for.
  const offered = plantId === null ? definitions.filter(one => !one.perPlant) : definitions;
  const definition = offered.find(one => one.key === key) ?? offered[0] ?? null;
  // A per-grow measurement is about the grow even while a plant is chosen: it
  // is the same number whichever plant is being looked at.
  const slot = definition ? slotOf(definition.key, definition.perPlant ? plantId : null) : '';
  const draft = typed[slot] ?? '';

  const press = (pressed: string) =>
    setTyped(current => {
      const before = current[slot] ?? '';
      if (pressed === '.' && before.includes('.')) return current;

      return { ...current, [slot]: before + pressed };
    });

  const rub = () => setTyped(current => ({ ...current, [slot]: (current[slot] ?? '').slice(0, -1) }));

  const readings = readingsOf(typed, definitions);
  const body = (): EntryCreate => ({ kind: 'measurement', ...about(target), values: { kind: 'measurement', readings } });

  /** The line goes through the queue, so the sheet closes and the toast offers Undo, as every logged line does. */
  const save = () => log({ label: lineLabel(t, 'measurement', target), details: { kind: 'measurement', target }, send: () => writeEntry(body()) });

  /**
   * The same line, written while the sheet stays open. It waits for the server
   * rather than acknowledging: the next plant is typed over what was just
   * written, so a line that never landed has to be said here and now.
   */
  const saveAndNext = async () => {
    setSaving(true);
    setFailure(null);
    try {
      await writeEntry(body());
      diaryChanged(client);
      setTyped({});
      setChosenPlant(nextPlant(standing, plantId));
    } catch (error) {
      setFailure(error);
    } finally {
      setSaving(false);
    }
  };

  if (definitions.length === 0) {
    return (
      <Sheet title={t('grow.measurements.measure.title')} onClose={onClose}>
        <p className={ui.note}>{t('grow.measurements.measure.nothingYet')}</p>
        {target.growId ? (
          <Link className={`${ui.button} ${styles.away}`} to={`/grows/${target.growId}/measurements`} onClick={onClose}>
            {t('grow.measurements.measure.setUp')}
          </Link>
        ) : null}
      </Sheet>
    );
  }

  const roundOfPlants = plantId !== null && standing.length > 1;

  return (
    <Sheet title={t('grow.measurements.measure.title')} onClose={onClose}>
      {standing.length > 0 ? (
        <div className={styles.chips} role="group" aria-label={t('grow.measurements.measure.whichPlant')}>
          {standing.map(plant => (
            <Chip key={plant.id} chosen={plant.id === plantId} onChoose={() => setChosenPlant(plant.id)}>
              {plant.label}
            </Chip>
          ))}
          <Chip chosen={plantId === null} onChoose={() => setChosenPlant(null)}>
            {t('grow.measurements.measure.wholeGrow')}
          </Chip>
        </div>
      ) : null}

      <div className={styles.chips} role="group" aria-label={t('grow.measurements.measure.whatLabel')}>
        {offered.map(one => {
          const shown = typed[slotOf(one.key, one.perPlant ? plantId : null)] || figureOf(last.get(slotOf(one.key, one.perPlant ? plantId : null)));
          return (
            <Chip key={one.key} chosen={one.key === definition?.key} onChoose={() => setKey(one.key)}>
              {one.name}
              {shown ? <span className={styles.chipValue}> · {shown}</span> : null}
            </Chip>
          );
        })}
        {target.growId ? (
          <Link className={`${ui.chip} ${styles.newOne}`} to={`/grows/${target.growId}/measurements`} onClick={onClose}>
            {t('grow.measurements.measure.newOne')}
          </Link>
        ) : null}
      </div>

      {definition ? (
        <>
          <div className={`${ui.card} ${styles.field}`}>
            <span className={styles.fieldName}>
              {definition.name}
              {definition.unit ? <span className={`mono ${styles.fieldUnit}`}> · {definition.unit}</span> : null}
            </span>
            <span className={`figure ${styles.fieldValue}`} aria-label={definition.name} role="status">
              {draft || '—'}
            </span>
          </div>

          <p className={`mono ${styles.hint}`}>{hintOf(t, definition, last, plantId, standing, draft, now)}</p>

          <div className={styles.keypad} role="group" aria-label={t('grow.measurements.measure.keypad')}>
            {KEYS.map(digit => (
              <button key={digit} type="button" className={`${ui.button} ${styles.digit}`} onClick={() => press(digit)}>
                {digit}
              </button>
            ))}
            <button type="button" className={`${ui.button} ${styles.digit}`} aria-label={t('grow.measurements.measure.backspace')} onClick={rub}>
              <Delete size={18} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        </>
      ) : null}

      <Refused error={failure} />

      <div className={styles.actions}>
        {roundOfPlants ? (
          <button type="button" className={ui.button} disabled={saving || readings.length === 0} onClick={() => void saveAndNext()}>
            {saving ? t('grow.measurements.measure.saving') : t('grow.measurements.measure.saveAndNext')}
          </button>
        ) : null}
        <button type="button" className={`${ui.button} ${ui.primary} ${styles.save}`} disabled={saving || readings.length === 0} onClick={save}>
          {t('grow.measurements.measure.save')}
        </button>
      </div>
    </Sheet>
  );
}

function Chip({ chosen, onChoose, children }: { chosen: boolean; onChoose: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={`${ui.chip} ${styles.chip}`} data-chosen={chosen} aria-pressed={chosen} onClick={onChoose}>
      {children}
    </button>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * What everything typed comes to. A field left empty is not a reading of
 * nothing, so it is left out, and the plant a reading belongs to is the one its
 * slot was typed under - which is how one line carries a round of measuring
 * across several plants.
 */
const readingsOf = (typed: Record<string, string>, definitions: MeasurementDefinition[]): EntryReading[] =>
  Object.entries(typed).flatMap(([slot, text]) => {
    const [key, plantId] = slot.split('|');
    const value = Number(text.replace(',', '.').trim());
    if (!text.trim() || !Number.isFinite(value) || !definitions.some(one => one.key === key)) return [];

    return [{ key, value, plantId: plantId || null }];
  });

const figureOf = (reading: { value: number } | undefined): string => (reading ? readingFigure(reading.value) : '');

/** The plant after this one, wrapping round, so a round of measuring never ends in a dead end. */
const nextPlant = (plants: Plant[], plantId: string | null): string | null => {
  if (plants.length === 0) return null;
  const at = plants.findIndex(plant => plant.id === plantId);

  return plants[(at + 1) % plants.length]?.id ?? null;
};

/**
 * The line under the figure: what this measurement was last time, how long ago,
 * how far the figure being typed has moved from it, the band aimed at, and -
 * for something measured per plant - what another plant was, which is the
 * comparison a grower makes while standing in front of them.
 */
const hintOf = (
  t: Translate,
  definition: MeasurementDefinition,
  last: Map<string, { value: number; at: string }>,
  plantId: string | null,
  plants: Plant[],
  draft: string,
  now: ReturnType<typeof useNow>,
): string => {
  const mine = last.get(slotOf(definition.key, definition.perPlant ? plantId : null));
  const typed = Number(draft.replace(',', '.'));
  const moved = mine && draft.trim() !== '' && Number.isFinite(typed) ? typed - mine.value : null;
  const band = bandOf(t, definition);

  const other = definition.perPlant
    ? plants
        .filter(plant => plant.id !== plantId)
        .map(plant => ({ plant, reading: last.get(slotOf(definition.key, plant.id)) }))
        .find(one => one.reading !== undefined)
    : undefined;

  return [
    mine ? t('grow.measurements.measure.last', { value: withUnit(mine.value, definition.unit) }) : t('grow.measurements.measure.never'),
    mine ? t('grow.measurements.measure.ago', { age: ageLabel(mine.at, now) }) : '',
    moved === null || moved === 0 ? '' : `${moved > 0 ? '+' : ''}${readingFigure(moved)}`,
    t('grow.measurements.target', { band: band ?? t('grow.measurements.noTarget') }),
    other?.reading ? t('grow.measurements.measure.otherPlant', { plant: other.plant.label, value: readingFigure(other.reading.value) }) : '',
  ]
    .filter(Boolean)
    .join(' · ');
};
