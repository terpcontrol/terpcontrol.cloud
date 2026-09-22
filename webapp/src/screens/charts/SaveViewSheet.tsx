import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartView, ChartViewDefinition } from '@fg2/shared-types/v1';
import { useDeleteChartView, useRenameChartView, useSaveChartView } from '@/api/chart-views';
import { Sheet } from '@/log/Sheet';
import { Refused } from '@/ui/PageState';
import { Block } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import styles from './Charts.module.css';

interface SaveViewSheetProps {
  /** The view being looked at, or null where the chart on screen has not been saved before. */
  view: ChartView | null;
  definition: ChartViewDefinition;
  onSaved: (view: ChartView | null) => void;
  onClose: () => void;
}

/**
 * Keeping a chart to come back to.
 *
 * A saved view holds the question and never the readings, which is why saving
 * over one is safe and why throwing one away costs no measurement - both are
 * said here rather than guarded against. The same sheet makes one and changes
 * one: somebody who has just opened a saved view and moved a chip is exactly
 * the person who wants it kept that way, and "save as new" is for the one who
 * wanted the old one left alone.
 */
export function SaveViewSheet({ view, definition, onSaved, onClose }: SaveViewSheetProps) {
  const { t } = useTranslation();
  const save = useSaveChartView();
  const rename = useRenameChartView(view?.id ?? '');
  const remove = useDeleteChartView(view?.id ?? '');
  const [name, setName] = useState(view?.name ?? '');
  const [asking, setAsking] = useState(false);

  const busy = save.isPending || rename.isPending || remove.isPending;
  const named = name.trim();

  const create = () => save.mutate({ name: named, definition }, { onSuccess: saved => onSaved(saved) });

  return (
    <Sheet title={t(view ? 'charts.views.editTitle' : 'charts.views.newTitle')} onClose={onClose}>
      <div className={styles.sheet}>
        <Block label={t('charts.views.name')}>
          <input
            className={ui.input}
            value={name}
            placeholder={t('charts.views.placeholder')}
            aria-label={t('charts.views.name')}
            autoComplete="off"
            onChange={event => setName(event.target.value)}
          />
        </Block>

        <p className={ui.note}>{t('charts.views.holdsTheQuestion')}</p>
        <Refused error={save.error ?? rename.error} />

        {view ? (
          <>
            <button
              type="button"
              className={`${ui.button} ${ui.primary} ${styles.sheetAction}`}
              disabled={busy || named === ''}
              onClick={() => rename.mutate({ name: named, definition }, { onSuccess: saved => onSaved(saved) })}
            >
              {rename.isPending ? t('charts.views.saving') : t('charts.views.save')}
            </button>
            <button type="button" className={`${ui.button} ${styles.sheetAction}`} disabled={busy || named === ''} onClick={create}>
              {t('charts.views.saveAsNew')}
            </button>
          </>
        ) : (
          <button type="button" className={`${ui.button} ${ui.primary} ${styles.sheetAction}`} disabled={busy || named === ''} onClick={create}>
            {save.isPending ? t('charts.views.saving') : t('charts.views.save')}
          </button>
        )}

        {view ? (
          <div className={styles.asking}>
            {asking ? (
              <>
                <p className={ui.note}>{t('charts.views.deleteAsk')}</p>
                <Refused error={remove.error} />
                <div className={styles.askingRow}>
                  <button
                    type="button"
                    className={`${ui.button} ${styles.danger}`}
                    disabled={busy}
                    onClick={() => remove.mutate(undefined, { onSuccess: () => onSaved(null) })}
                  >
                    {t('charts.views.deleteYes')}
                  </button>
                  <button type="button" className={ui.button} onClick={() => setAsking(false)}>
                    {t('charts.views.cancel')}
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className={`${ui.button} ${styles.danger}`} disabled={busy} onClick={() => setAsking(true)}>
                {t('charts.views.delete')}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
