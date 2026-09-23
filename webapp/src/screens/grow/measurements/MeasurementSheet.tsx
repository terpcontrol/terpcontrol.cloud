import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowListItem, MeasurementDefinition } from '@fg2/shared-types/v1';
import { useUpdateGrow } from '@/api/grows';
import { Sheet } from '@/log/Sheet';
import { Refused } from '@/ui/PageState';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { keyFor } from './definitions';
import styles from './Measurements.module.css';

interface MeasurementSheetProps {
  grow: GrowListItem;
  /** The definition being changed, or null for one being made. */
  definition: MeasurementDefinition | null;
  /**
   * How many readings stand under it, which is what settles its scope and keeps
   * it from being deleted - or null while that is not known yet, which is
   * treated as settled: offering to delete something and finding out afterwards
   * that it could not be is worse than waiting a moment for the answer.
   */
  readings: number | null;
  onClose: () => void;
}

interface Draft {
  name: string;
  unit: string;
  perPlant: boolean;
  from: string;
  to: string;
}

/**
 * Making a measurement, and changing one.
 *
 * It is one sheet for both because they are the same four questions, and
 * because what separates them is not a question at all: the key. A key is what
 * every reading already written points at, so it is made once from the name and
 * never touched again - renaming "Height" to "Stem height" leaves every reading
 * where it was.
 *
 * Two of the four are settled by what has already been measured. The scope is
 * held once a reading exists, because flipping it would make readings already
 * written say something they never said, and the delete is not offered at all,
 * because readings left without a name are worse than a list with one row too
 * many. Both say so where the control would have been, rather than letting the
 * server refuse a tap that looked possible.
 */
export function MeasurementSheet({ grow, definition, readings, onClose }: MeasurementSheetProps) {
  const { t } = useTranslation();
  const update = useUpdateGrow(grow.id);
  const [draft, setDraft] = useState<Draft>(() => draftOf(definition));
  const [askingDelete, setAskingDelete] = useState(false);

  const change = (over: Partial<Draft>) => setDraft(current => ({ ...current, ...over }));
  const settled = readings === null || readings > 0;
  const complete = draft.name.trim().length > 0;

  const save = () => {
    const written: MeasurementDefinition = {
      key: definition?.key ?? keyFor(draft.name),
      name: draft.name.trim(),
      unit: draft.unit.trim(),
      // The scope of a measurement that has been written under is the one it
      // already had, whatever the held control shows.
      perPlant: settled && definition ? definition.perPlant : draft.perPlant,
      targetMin: endOf(draft.from),
      targetMax: endOf(draft.to),
      chart: definition?.chart ?? true,
    };
    const measurements = definition ? grow.measurements.map(one => (one.key === definition.key ? written : one)) : [...grow.measurements, written];

    update.mutate({ measurements }, { onSuccess: onClose });
  };

  const remove = () => update.mutate({ measurements: grow.measurements.filter(one => one.key !== definition?.key) }, { onSuccess: onClose });

  return (
    <Sheet
      title={definition ? t('grow.measurements.sheet.editTitle', { name: definition.name }) : t('grow.measurements.sheet.newTitle')}
      onClose={onClose}
    >
      <div className={styles.sheetBody}>
        <Block label={t('grow.measurements.sheet.name')}>
          <input
            className={ui.input}
            value={draft.name}
            placeholder={t('grow.measurements.sheet.namePlaceholder')}
            aria-label={t('grow.measurements.sheet.name')}
            autoComplete="off"
            onChange={event => change({ name: event.target.value })}
          />
          <input
            className={`mono ${ui.input}`}
            value={draft.unit}
            placeholder={t('grow.measurements.sheet.unitPlaceholder')}
            aria-label={t('grow.measurements.sheet.unit')}
            autoComplete="off"
            onChange={event => change({ unit: event.target.value })}
          />
        </Block>

        <Block label={t('grow.measurements.sheet.scope')} aside={settled ? t('grow.measurements.sheet.scopeSettled') : undefined}>
          <Choices label={t('grow.measurements.sheet.scope')}>
            <Choice chosen={!draft.perPlant} disabled={settled} onChoose={() => change({ perPlant: false })}>
              {t('grow.measurements.perGrow')}
            </Choice>
            <Choice chosen={draft.perPlant} disabled={settled} onChoose={() => change({ perPlant: true })}>
              {t('grow.measurements.perPlant')}
            </Choice>
          </Choices>
        </Block>

        <Block label={t('grow.measurements.sheet.targetLabel')}>
          <div className={styles.band}>
            <label className={`${ui.card} ${styles.bandField}`}>
              <span className={styles.bandLabel}>{t('grow.measurements.sheet.from')}</span>
              <input
                className={`figure ${styles.bandInput}`}
                inputMode="decimal"
                value={draft.from}
                onChange={event => change({ from: event.target.value })}
              />
            </label>
            <label className={`${ui.card} ${styles.bandField}`}>
              <span className={styles.bandLabel}>{t('grow.measurements.sheet.to')}</span>
              <input
                className={`figure ${styles.bandInput}`}
                inputMode="decimal"
                value={draft.to}
                onChange={event => change({ to: event.target.value })}
              />
            </label>
          </div>
          <p className={ui.note}>{t('grow.measurements.sheet.targetNote')}</p>
        </Block>

        <Refused error={update.error} />

        <button type="button" className={`${ui.button} ${ui.primary} ${styles.submit}`} disabled={update.isPending || !complete} onClick={save}>
          {update.isPending ? t('grow.measurements.sheet.saving') : t('grow.measurements.sheet.save')}
        </button>

        {definition ? (
          <div className={styles.asking}>
            {readings === null ? null : readings > 0 ? (
              <p className={ui.note}>
                {/* Offering to take it off the chart is no offer at all where it is
                    already off it, so the sentence says the other half instead. */}
                {t(definition.chart ? 'grow.measurements.sheet.keptForReadings' : 'grow.measurements.sheet.keptForReadingsOffChart', {
                  count: readings,
                })}
              </p>
            ) : askingDelete ? (
              <>
                <p className={ui.note}>{t('grow.measurements.sheet.deleteAsk')}</p>
                <div className={styles.actions}>
                  <button type="button" className={`${ui.button} ${styles.dangerButton}`} disabled={update.isPending} onClick={remove}>
                    {t('grow.measurements.sheet.deleteYes')}
                  </button>
                  <button type="button" className={ui.button} onClick={() => setAskingDelete(false)}>
                    {t('grow.measurements.sheet.cancel')}
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className={`${ui.button} ${styles.danger}`} disabled={update.isPending} onClick={() => setAskingDelete(true)}>
                {t('grow.measurements.sheet.delete')}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

const draftOf = (definition: MeasurementDefinition | null): Draft => ({
  name: definition?.name ?? '',
  unit: definition?.unit ?? '',
  perPlant: definition?.perPlant ?? false,
  from: end(definition?.targetMin ?? null),
  to: end(definition?.targetMax ?? null),
});

const end = (value: number | null): string => (value === null ? '' : String(value));

/** An end nobody typed is an end nobody is aiming at, and so is one that is not a number. */
const endOf = (typed: string): number | null => {
  const value = Number(typed.replace(',', '.').trim());

  return typed.trim() === '' || !Number.isFinite(value) ? null : value;
};
