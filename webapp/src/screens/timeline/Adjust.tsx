import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartView, ChartViewDefinition } from '@fg2/shared-types/v1';
import { useChartViews, useDeleteChartView, useSaveChartView } from '@/api/chart-views';
import { useLog } from '@/log/log-context';
import { durationLabel } from '@/ui/age';
import { Asking } from '@/ui/Asking';
import { Refused } from '@/ui/PageState';
import { Row, Rows } from '@/ui/Rows';
import { Sheet } from '@/ui/Sheet';
import ui from '@/ui/ui.module.css';
import { DEFAULT_SHOW, keysOf, type Offered, type Shown } from './model';
import { STEPS, VPD_HALVES, type View } from './view';
import styles from './Timeline.module.css';

/** Something a curve can be laid over: an earlier grow of the place, or another place. */
export interface Comparable {
  kind: 'grow' | 'space';
  id: string;
  name: string;
}

interface AdjustProps {
  view: View;
  offered: Offered;
  shown: Shown;
  change: (over: Partial<View>) => void;
  /** The step the curves are drawn at, which one asked for may have been widened to. */
  stepDrawn: number;
  comparable: Comparable[];
  /** Keeping the view in the account, where the session has one: the definition to keep, and what applying one does. */
  views: { definition: ChartViewDefinition; apply: (view: ChartView) => void } | null;
  /** The day the window begins on and the last day there is, as a date field speaks them, and the jump to one. */
  day: { shown: string; last: string; jump: (day: string) => void };
  onShare: (() => void) | null;
  onCsv: (() => void) | null;
  onClose: () => void;
}

/**
 * "Anpassen": what is drawn and how, and what can be done with the picture -
 * everything the page itself has no room for, in one sheet. Each tick is in
 * the address at once, so the curves behind the sheet follow it.
 */
export function Adjust({ view, offered, shown, change, stepDrawn, comparable, views, day, onShare, onCsv, onClose }: AdjustProps) {
  const { t } = useTranslation();
  const [pane, setPane] = useState<'main' | 'compare' | 'views'>('main');
  // Asked only where a view can be kept: a reader through a link has no account to keep one in.
  const saved = useChartViews(views !== null).data?.items ?? [];
  const compared = comparable.find(one => one.kind === view.compare?.kind && one.id === view.compare.id) ?? null;
  // A place that measures nothing - no device, or one that never sent a value - is offered only what applies to it:
  // the lines to tick, a day to jump to, a view, a link. Nothing about curves it has not got.
  const curves = offered.metrics.length + offered.measurements.length > 0;

  // The sheet's own copy of what is ticked: the address follows a moment later, and a tick shows at once.
  const [keys, setKeys] = useState(() => view.show ?? [...new Set([...keysOf(shown), ...DEFAULT_SHOW])]);
  const [one, setOne] = useState(view.one);
  const tick = (key: string) => {
    const next = keys.includes(key) ? keys.filter(other => other !== key) : [...keys, key];
    setKeys(next);
    change({ show: next });
  };
  const ticks = [
    ...offered.metrics.map(metric => ({ key: metric as string, name: t(`timeline.metric.${metric}`) })),
    ...offered.measurements.map(measured => ({ key: `m.${measured.key}`, name: measured.name })),
    ...(offered.light ? [{ key: 'light', name: t('timeline.output.light') }] : []),
    ...(offered.outputs ? [{ key: 'outputs', name: t('timeline.adjust.outputs') }] : []),
    { key: 'diary', name: t('timeline.adjust.diary') },
    ...(offered.machine ? [{ key: 'machine', name: t('timeline.adjust.machine') }] : []),
  ];

  if (pane === 'compare') {
    return (
      <Sheet title={t('timeline.adjust.compare')} onBack={() => setPane('main')} onClose={onClose}>
        <Rows>
          {[null, ...comparable].map(one => (
            <Row
              key={one ? `${one.kind}:${one.id}` : 'none'}
              acts
              title={one ? one.name : t('timeline.adjust.compareNone')}
              line={one ? t(`timeline.adjust.compare_${one.kind}`) : null}
              onOpen={() => {
                change({ compare: one ? { kind: one.kind, id: one.id } : null });
                setPane('main');
              }}
            />
          ))}
        </Rows>
      </Sheet>
    );
  }

  if (pane === 'views' && views) {
    return (
      <Sheet title={t('timeline.adjust.views')} onBack={() => setPane('main')} onClose={onClose}>
        <Views saved={saved} definition={views.definition} onApply={one => (views.apply(one), onClose())} />
      </Sheet>
    );
  }

  return (
    <Sheet
      title={t('timeline.adjust.title')}
      onClose={onClose}
      actions={
        <button type="button" className={`${ui.button} ${ui.primary}`} onClick={onClose}>
          {t('timeline.adjust.done')}
        </button>
      }
    >
      <div className={styles.adjust}>
        <fieldset className={styles.ticks}>
          <legend>{t('timeline.adjust.curves')}</legend>
          {ticks.map(each => (
            <label key={each.key}>
              <input type="checkbox" checked={keys.includes(each.key)} onChange={() => tick(each.key)} />
              {each.name}
            </label>
          ))}
        </fieldset>

        {curves ? (
          <label className={styles.oneRow}>
            <span>{t('timeline.adjust.one')}</span>
            <input
              type="checkbox"
              checked={one}
              onChange={() => {
                setOne(!one);
                change({ one: !one });
              }}
            />
          </label>
        ) : null}

        <Rows>
          {curves && comparable.length > 0 ? (
            <Row
              title={t('timeline.adjust.compare')}
              line={compared ? compared.name : t('timeline.adjust.compareLine')}
              onOpen={() => setPane('compare')}
            />
          ) : null}
          {views ? (
            <Row
              title={t('timeline.adjust.views')}
              line={saved.length > 0 ? t('timeline.adjust.viewsLine', { count: saved.length }) : t('timeline.adjust.viewsNone')}
              onOpen={() => setPane('views')}
            />
          ) : null}
          <label className={styles.pickRow}>
            <span>{t('timeline.adjust.day')}</span>
            <input type="date" value={day.shown} max={day.last} onChange={event => event.target.value && day.jump(event.target.value)} />
          </label>
          {curves ? (
            <label className={styles.pickRow}>
              <span>
                {t('timeline.adjust.step')}
                {/* A step too fine for the window is widened by the server, which is said where it was asked for. */}
                {view.stepSeconds !== null && stepDrawn > view.stepSeconds ? (
                  <small>{t('timeline.adjust.stepWidened', { step: durationLabel(stepDrawn) })}</small>
                ) : null}
              </span>
              <select
                value={view.stepSeconds ?? ''}
                onChange={event => change({ stepSeconds: event.target.value === '' ? null : Number(event.target.value) })}
              >
                <option value="">{t('timeline.adjust.stepAuto')}</option>
                {[...new Set([...STEPS, ...(view.stepSeconds ? [view.stepSeconds] : [])])]
                  .sort((one, other) => one - other)
                  .map(step => (
                    <option key={step} value={step}>
                      {durationLabel(step)}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}
          {shown.metrics.includes('vpd') ? (
            <label className={styles.pickRow}>
              <span>{t('timeline.adjust.vpdHalf')}</span>
              <select value={view.vpdHalf} onChange={event => change({ vpdHalf: VPD_HALVES.find(half => half === event.target.value) ?? 'all' })}>
                {VPD_HALVES.map(half => (
                  <option key={half} value={half}>
                    {t(`timeline.adjust.half.${half}`)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {onShare ? <Row title={t('timeline.adjust.share')} onOpen={onShare} /> : null}
          {onCsv ? <Row title={t('timeline.adjust.csv')} acts onOpen={onCsv} /> : null}
        </Rows>
      </div>
    </Sheet>
  );
}

/** The views kept in the account - a question, never its readings - and keeping the one on screen. */
function Views({ saved, definition, onApply }: { saved: ChartView[]; definition: ChartViewDefinition; onApply: (view: ChartView) => void }) {
  const { t } = useTranslation();
  const { tell } = useLog();
  const save = useSaveChartView();
  const remove = useDeleteChartView();
  const [name, setName] = useState('');
  const [leaving, setLeaving] = useState<ChartView | null>(null);
  // Each answers with what was done and the way to take it back: a view is a question, and keeping it again costs nothing.
  const keep = () =>
    save.mutate(
      { name: name.trim(), definition },
      {
        onSuccess: kept => {
          setName('');
          tell({ label: t('timeline.adjust.viewSaved', { name: kept.name }), undo: () => remove.mutateAsync(kept.id) });
        },
      },
    );
  const drop = (view: ChartView) =>
    remove.mutate(view.id, {
      onSuccess: () => {
        setLeaving(null);
        tell({
          label: t('timeline.adjust.viewDeleted', { name: view.name }),
          undo: () => save.mutateAsync({ name: view.name, definition: view.definition }),
        });
      },
    });

  return (
    <div className={styles.adjust}>
      {saved.length > 0 ? (
        <ul className={styles.views}>
          {saved.map(one => (
            <li key={one.id}>
              <button type="button" className={styles.viewName} onClick={() => onApply(one)}>
                {one.name}
              </button>
              <button type="button" className={`${ui.button} ${ui.quiet}`} onClick={() => setLeaving(one)}>
                {t('timeline.adjust.viewDelete')}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {leaving ? (
        <Asking
          note={t('timeline.adjust.viewDeleteAsk', { name: leaving.name })}
          yes={t('timeline.adjust.viewDelete')}
          danger
          busy={remove.isPending}
          onYes={() => drop(leaving)}
          onCancel={() => setLeaving(null)}
        >
          <Refused error={remove.error} />
        </Asking>
      ) : null}
      <form
        className={styles.keep}
        onSubmit={event => {
          event.preventDefault();
          if (name.trim()) keep();
        }}
      >
        <label>
          <span className="label">{t('timeline.adjust.viewKeep')}</span>
          <input
            className={ui.input}
            value={name}
            placeholder={t('timeline.adjust.viewName')}
            autoComplete="off"
            onChange={event => setName(event.target.value)}
          />
        </label>
        <button type="submit" className={`${ui.button} ${ui.primary}`} disabled={save.isPending || name.trim() === ''}>
          {t(save.isPending ? 'timeline.adjust.viewSaving' : 'timeline.adjust.viewSave')}
        </button>
        <Refused error={save.error} />
      </form>
    </div>
  );
}
