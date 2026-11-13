import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import type { GrowSeriesPoint, MeasurementDefinition } from '@fg2/shared-types/v1';
import { usePageOfGrow } from '@/app/places';
import { useGrow, useMeasurementSeries, useUpdateGrow } from '@/api/grows';
import { noLongerThere } from '@/api/problem';
import { Chart } from '@/charts/Chart';
import { plotOption } from '@/charts/series';
import type { ChartPalette } from '@/charts/tokens';
import { measurementCurve } from '@/screens/timeline/model';
import { HOUR_MS } from '@/ui/days';
import { LoadFailed, NoLongerHere, NothingHere, RefreshFailed, Refused, Waiting } from '@/ui/PageState';
import { enough, growStanding, standsIn, useMayWith } from '@/ui/session-access';
import { Switch } from '@/ui/Switch';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { DAY_IN_YEAR, useZone, zonedAt } from '@/ui/zone';
import { BackLink } from '@/ui/BackLink';
import { bandOf, fromTemplate, readingCounts, ruleOf, TEMPLATES, toldOf } from './definitions';
import { useAnswered } from '../told';
import { MeasurementSheet } from './MeasurementSheet';
import styles from './Measurements.module.css';

/**
 * What this grow measures beyond the climate: the definitions it holds, and
 * the handful of templates that make a new one a single tap.
 *
 * A definition is not a setting. Every reading ever written points at its key,
 * so the list is edited under three rules the server states and this screen
 * keeps in plain sight: a key is a key only once, a measurement that has been
 * written under is not deleted here, and per plant or per grow is chosen once.
 * The screen learns which of them have been written under from the same series
 * read its curves are drawn from, so it can say why a delete is not on offer
 * rather than offering one and being refused.
 *
 * Each measurement switched on has its curve here, over the whole grow: what
 * was measured by hand belongs to the grow, whether or not it stands in a
 * place with a Verlauf of its own.
 */
export function Measurements() {
  const { growId = '' } = useParams();
  const { t } = useTranslation();
  const now = useNow();
  const grow = useGrow(growId);
  usePageOfGrow(grow.data);
  const definitions = grow.data?.measurements ?? [];
  const series = useMeasurementSeries(
    growId,
    'grow',
    definitions.map(definition => definition.key),
  );
  const update = useUpdateGrow(growId);
  const answer = useAnswered(update, `measurements-${growId}`);
  // What a grow measures is part of the grow, so changing it is `manage` where
  // the grow stands rather than anything about the session.
  const mayWith = useMayWith();
  const [editing, setEditing] = useState<MeasurementDefinition | null>(null);
  const [adding, setAdding] = useState(false);

  if (grow.isPending) {
    return (
      <section className={`${ui.stack4} ${ui.page} ${styles.page}`}>
        <Waiting lines={2} />
        <Waiting lines={3} />
      </section>
    );
  }
  if (!grow.data) return noLongerThere(grow.error) ? <NoLongerHere what="grow" /> : <LoadFailed retry={() => void grow.refetch()} />;

  const mayManage = enough(mayWith(growStanding(grow.data)), 'manage');

  // Null until the series has answered: what has been measured is what settles
  // a definition, and the screen says nothing about it before it knows.
  const counted = series.isSuccess ? readingCounts(series.data.measurements) : null;
  const readingsUnder = (key: string): number | null => (counted === null ? null : (counted.get(key) ?? 0));
  // The switch is its own answer; a measurement added by one tap says so, and the list as it stood is one write away.
  const flip = (definition: MeasurementDefinition) =>
    update.mutate({ measurements: definitions.map(one => (one.key === definition.key ? { ...one, chart: !one.chart } : one)) });
  const add = (definition: MeasurementDefinition) =>
    answer({ measurements: [...definitions, definition] }, toldOf(t, definition.name, true), {
      to: { measurements: definitions },
      undone: toldOf(t, definition.name, false),
    });
  // The grow from its first day to its last, or to the hour now.
  const stretch = {
    from: Date.parse(grow.data.startedAt),
    to: grow.data.endedAt ? Date.parse(grow.data.endedAt) : Math.ceil(now.toMillis() / HOUR_MS) * HOUR_MS,
    ended: grow.data.endedAt !== null,
  };

  return (
    <section className={`${ui.stack4} ${ui.page} ${styles.page}`}>
      <header className={ui.row2}>
        <BackLink to={`/grows/${growId}`} label={t('grow.measurements.back')} />
        <h1>{t('grow.measurements.title')}</h1>
        <span className={`mono ${styles.growName}`}>{grow.data.name}</span>
      </header>

      <RefreshFailed failedAt={grow.isError ? grow.dataUpdatedAt : null} now={now} />

      {/* Without the readings the screen cannot say which definitions are
          settled, so it says that rather than quietly dropping the delete and
          the sentence that would explain its absence. */}
      {series.isError ? (
        <p className={ui.problem} role="status">
          {t('grow.measurements.readingsUnread')}
        </p>
      ) : null}

      <header className={styles.sectionHead}>
        <span className="label">{t('grow.measurements.yours')}</span>
        <span className={`mono ${styles.aside}`}>{t('grow.measurements.chartHint')}</span>
      </header>

      {definitions.length === 0 ? (
        <NothingHere>{t('grow.measurements.none')}</NothingHere>
      ) : (
        <ul className={ui.group} aria-label={t('grow.measurements.yours')}>
          {definitions.map(definition => (
            <Card
              key={definition.key}
              definition={definition}
              mayManage={mayManage}
              onEdit={() => setEditing(definition)}
              onFlip={() => flip(definition)}
              points={definition.chart ? (series.data?.measurements.find(one => one.key === definition.key)?.points ?? []) : []}
              stretch={stretch}
            />
          ))}
        </ul>
      )}

      <Refused error={update.error} />

      {mayManage ? (
        <>
          <header className={styles.sectionHead}>
            <span className="label">{t('grow.measurements.templates')}</span>
            <span className={`mono ${styles.aside}`}>{t('grow.measurements.tapToAdd')}</span>
          </header>
          <div className={`${ui.wrap} ${styles.templates}`} role="group" aria-label={t('grow.measurements.templates')}>
            {TEMPLATES.map(template => {
              const here = definitions.some(definition => definition.key === template.key);
              return (
                <button
                  key={template.key}
                  type="button"
                  className={ui.chip}
                  disabled={here || update.isPending}
                  title={here ? t('grow.measurements.alreadyHere') : undefined}
                  onClick={() => add(fromTemplate(t, template))}
                >
                  {t(`grow.measurements.template.${template.key}`)}
                  {template.unit ? <span className={styles.chipUnit}>{template.unit}</span> : null}
                </button>
              );
            })}
            <button type="button" className={ui.chip} disabled={update.isPending} onClick={() => setAdding(true)}>
              + {t('grow.measurements.ownChip')}
            </button>
          </div>
        </>
      ) : null}

      {/* A curve on Verlauf is promised only to a grow that stands in a place, which is what Verlauf is of. */}
      <p className={ui.note}>{t(standsIn(grow.data) === null ? 'grow.measurements.noteNoPlace' : 'grow.measurements.note')}</p>

      {editing || adding ? (
        <MeasurementSheet
          grow={grow.data}
          definition={editing}
          readings={editing ? readingsUnder(editing.key) : 0}
          onClose={() => {
            setEditing(null);
            setAdding(false);
          }}
        />
      ) : null}
    </section>
  );
}

interface CardProps {
  definition: MeasurementDefinition;
  mayManage: boolean;
  onEdit: () => void;
  onFlip: () => void;
  /** What was written under it, where its curve is switched on, and the stretch of the grow it is drawn over. */
  points: readonly GrowSeriesPoint[];
  stretch: { from: number; to: number; ended: boolean };
}

/**
 * One measurement: what it is called and in what unit, what it is about, what
 * it is aimed at - and the switch that is its chart flag, which is the one
 * thing about a definition that is changed often enough to be worth a tap of
 * its own.
 */
function Card({ definition, mayManage, onEdit, onFlip, points, stretch }: CardProps) {
  const { t } = useTranslation();
  const band = bandOf(t, definition);
  const facts = [
    t(definition.perPlant ? 'grow.measurements.perPlant' : 'grow.measurements.perGrow'),
    band === null ? '' : t('grow.measurements.target', { band }),
    ruleOf(t, definition.key),
  ].filter(Boolean);

  return (
    <li className={`${ui.card} ${styles.card}`}>
      <button
        type="button"
        className={styles.cardMain}
        aria-label={t('grow.measurements.edit', { name: definition.name })}
        disabled={!mayManage}
        onClick={onEdit}
      >
        <span className={styles.name}>
          {definition.name}
          {definition.unit ? <span className={`mono ${styles.unit}`}> · {definition.unit}</span> : null}
        </span>
        <span className={`mono ${styles.facts}`}>{facts.join(' · ')}</span>
      </button>
      {/* Held rather than hidden for a session that may only look: which
          measurements a grow draws is part of reading it. */}
      <Switch label={t('grow.measurements.onTheChart', { name: definition.name })} on={definition.chart} disabled={!mayManage} onChange={onFlip} />
      {points.length > 0 ? <Curve definition={definition} points={points} stretch={stretch} /> : null}
    </li>
  );
}

/**
 * One measurement over the grow, small: the readings as the dots they are,
 * the band aimed at behind them - the drawing Verlauf makes of it - and under
 * it what it ran between and what was read last.
 */
function Curve({ definition, points, stretch }: Pick<CardProps, 'definition' | 'points' | 'stretch'>) {
  const { t } = useTranslation();
  const zone = useZone();
  const { curve, bands } = useMemo(
    () => measurementCurve(definition, points, stretch.from, stretch.to),
    [definition, points, stretch.from, stretch.to],
  );
  const option = useMemo(
    () => (palette: ChartPalette) => plotOption(palette, { ...stretch, nights: [], bands, alarms: [], lines: [curve.line] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the stretch is its two ends
    [curve, bands, stretch.from, stretch.to],
  );
  const last = curve.points.at(-1)?.[1];
  if (curve.low === null || curve.high === null || last == null) return null;
  const written = (value: number) => `${curve.written(value)}${curve.unit ? `\u00a0${curve.unit}` : ''}`;

  return (
    <figure className={styles.curve}>
      <div className={styles.plot}>
        <Chart
          option={option}
          height={64}
          ariaLabel={t('grow.measurements.curve.alt', {
            name: definition.name,
            count: curve.points.length,
            low: curve.written(curve.low),
            high: curve.written(curve.high),
            unit: curve.unit,
          })}
        />
        {/* The two ends of its scale beside it, and under it the days it runs between: a shape with no figure is not a chart. */}
        <span className={styles.scale} aria-hidden>
          <span>{curve.corner(curve.line.scale.high)}</span>
          <span>{curve.corner(curve.line.scale.low)}</span>
        </span>
      </div>
      <p className={styles.axis} aria-hidden>
        <span>{zonedAt(stretch.from, zone).toFormat(DAY_IN_YEAR)}</span>
        <span>{stretch.ended ? zonedAt(stretch.to, zone).toFormat(DAY_IN_YEAR) : t('grow.diary.today')}</span>
      </p>
      <figcaption className="mono">
        {curve.points.length === 1
          ? t('grow.measurements.curve.one', { last: written(last) })
          : t('grow.measurements.curve.span', { low: curve.written(curve.low), high: curve.written(curve.high), last: written(last) })}
      </figcaption>
    </figure>
  );
}
