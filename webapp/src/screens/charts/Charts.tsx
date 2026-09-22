import { ChevronLeft } from 'lucide-react';
import { DateTime } from 'luxon';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { ChartView, ChartViewDefinition, ChartViewSpan, GrowListItem, GrowSeries, GrowSeriesRange } from '@fg2/shared-types/v1';
import { useChartViews } from '@/api/chart-views';
import { useGrowSeries } from '@/api/charts';
import { useDevices } from '@/api/devices';
import { useGrow, useSpaceGrows } from '@/api/grows';
import { useSpaces } from '@/api/spaces';
import { downloadCsv } from '@/charts/series';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { cardsOf, csvForCards, defaultPick, isEmpty, offeredBy, prunedTo, type Layout, type Picked } from './cards';
import { ChartCard } from './ChartCard';
import { SaveViewSheet } from './SaveViewSheet';
import styles from './Charts.module.css';

const RANGES: GrowSeriesRange[] = ['24h', '7d', 'phase', 'grow', 'custom'];
const LAYOUTS: Layout[] = ['stacked', 'overlay', 'day_of_grow'];

/** How many output chips stand in the bar before the rest go behind "+ more". */
const OUTPUTS_SHOWN = 2;

const DAY_SECONDS = 24 * 60 * 60;

/**
 * The Charts view: the nerd's room.
 *
 * Everything else in the app decides for the grower what is worth drawing - the
 * home its four tiles, the Timeline its three panels - and this is the one
 * screen that does not. Any series the account has, over any stretch, laid out
 * three ways, kept as a view to come back to and taken away as a table.
 *
 * It is about a grow rather than about a tent, because the day counter and the
 * band that moves with the phase belong to a grow; a tent named in the query is
 * answered by whatever is growing in it. One read answers the whole screen, so
 * the chips, the panels and the table cannot disagree about the window.
 */
export function Charts() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const spaceId = params.get('space');
  const named = params.get('grow');

  // A tent is answered by what grows in it; a grow names itself and needs no lookup.
  const here = useSpaceGrows(named ? null : spaceId);
  const growId = named ?? here.data?.items[0]?.id ?? null;
  const grow = useGrow(growId);

  if ((!named && spaceId !== null && here.isPending) || (growId !== null && grow.isPending)) {
    return (
      <div className={styles.screen}>
        <Header spaceId={spaceId} growId={growId} subject="" />
        <Waiting lines={3} />
        <Waiting lines={3} />
      </div>
    );
  }

  if (growId === null) {
    return (
      <div className={styles.screen}>
        <Header spaceId={spaceId} growId={null} subject="" />
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('charts.noGrow')}</p>
      </div>
    );
  }

  if (!grow.data) return <LoadFailed retry={() => void grow.refetch()} />;

  return <ChartsFor key={growId} grow={grow.data} spaceId={spaceId} />;
}

function ChartsFor({ grow, spaceId }: { grow: GrowListItem; spaceId: string | null }) {
  const { t } = useTranslation();
  const now = useNow();
  const mayManage = useMayManage();
  const [params, setParams] = useSearchParams();

  const range = RANGES.find(one => one === params.get('range')) ?? '24h';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const incomplete = range === 'custom' && !(from && to);

  const definitions = useMemo(() => grow.measurements.filter(definition => definition.chart), [grow.measurements]);
  const window = useMemo(
    () => ({ range, ...dayBounds(range, from, to), measurements: definitions.map(definition => definition.key) }),
    [range, from, to, definitions],
  );
  const series = useGrowSeries(grow.id, window);

  const spaces = useSpaces();
  const devices = useDevices();
  const views = useChartViews();

  const [picked, setPicked] = useState<Picked | null>(null);
  const [layout, setLayout] = useState<Layout>('stacked');
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const [moreOutputs, setMoreOutputs] = useState(false);
  const [sheet, setSheet] = useState(false);

  const offered = useMemo(() => offeredBy(series.data, definitions), [series.data, definitions]);
  const chosen = picked === null ? defaultPick(offered) : prunedTo(picked, offered);
  const leafOffset = leafOffsetOf(devices.data?.items ?? [], series.data);

  const cards = useMemo(
    () => (series.data ? cardsOf(t, series.data, chosen, layout, offered, leafOffset) : []),
    [t, series.data, chosen, layout, offered, leafOffset],
  );

  const place = spaces.data?.items.find(space => space.id === placedIn(grow))?.name ?? null;
  const subject = [place, grow.name].filter(Boolean).join(' · ');

  const setRange = (next: GrowSeriesRange) => {
    const kept = new URLSearchParams(params);
    kept.set('range', next);
    if (next !== 'custom') {
      kept.delete('from');
      kept.delete('to');
    }
    setParams(kept, { replace: true });
  };

  const setCustom = (edge: 'from' | 'to', day: string) => {
    const kept = new URLSearchParams(params);
    kept.set(edge, day);
    setParams(kept, { replace: true });
  };

  const toggle = <T extends string>(list: T[], one: T): T[] => (list.includes(one) ? list.filter(other => other !== one) : [...list, one]);

  /** A chip moved by hand is no longer the saved view it came from, which is what lets Save offer to keep it. */
  const change = (over: Partial<Picked>) => {
    setPicked({ ...chosen, ...over });
    setAppliedId(null);
  };

  const definition: ChartViewDefinition = {
    deviceIds: series.data?.deviceIds ?? [],
    growId: grow.id,
    metrics: chosen.metrics,
    outputs: chosen.outputs,
    measurements: chosen.measurements,
    span: spanOf(range, from, to),
    layout,
    intervalSeconds: series.data?.stepSeconds ?? 0,
  };

  const apply = (view: ChartView) => {
    const asked = rangeOf(view.definition.span);
    const kept = new URLSearchParams(params);
    kept.set('range', asked.range);
    if (asked.from && asked.to) {
      kept.set('from', asked.from);
      kept.set('to', asked.to);
    } else {
      kept.delete('from');
      kept.delete('to');
    }
    setParams(kept, { replace: true });
    setPicked({ metrics: [...view.definition.metrics], outputs: [...view.definition.outputs], measurements: [...view.definition.measurements] });
    setLayout(view.definition.layout);
    setAppliedId(view.id);
  };

  const saved = views.data?.items ?? [];
  const applied = saved.find(view => view.id === appliedId) ?? null;
  const mine = saved.filter(view => view.definition.growId === null || view.definition.growId === grow.id);

  const chips = (
    <>
      <div className={styles.chips} role="group" aria-label={t('charts.rangeLabel')}>
        {RANGES.map(one => (
          <button key={one} type="button" className={`${ui.chip} ${styles.chip}`} aria-pressed={one === range} onClick={() => setRange(one)}>
            {one === 'custom' ? t('charts.range.custom') : t(`timeline.range.${one}`)}
          </button>
        ))}
        {series.data ? <span className={`mono ${styles.days}`}>{dayLabel(t, series.data)}</span> : null}
      </div>

      {range === 'custom' ? (
        <div className={`${ui.card} ${styles.custom}`}>
          <label className={styles.customField}>
            <span className="label">{t('charts.custom.from')}</span>
            <input
              className={`mono ${ui.input}`}
              type="date"
              value={from}
              max={to || undefined}
              onChange={event => setCustom('from', event.target.value)}
            />
          </label>
          <label className={styles.customField}>
            <span className="label">{t('charts.custom.to')}</span>
            <input
              className={`mono ${ui.input}`}
              type="date"
              value={to}
              min={from || undefined}
              onChange={event => setCustom('to', event.target.value)}
            />
          </label>
          {incomplete ? <p className={`${ui.note} ${styles.customNote}`}>{t('charts.custom.need')}</p> : null}
        </div>
      ) : null}

      <div className={styles.chips} role="group" aria-label={t('charts.seriesLabel')}>
        {offered.metrics.map(metric => (
          <Pick key={metric} on={chosen.metrics.includes(metric)} onPick={() => change({ metrics: toggle(chosen.metrics, metric) })}>
            {t(`charts.metric.${metric}`, { defaultValue: metric })}
          </Pick>
        ))}
        {offered.measurements.map(measurement => (
          <Pick
            key={measurement.key}
            on={chosen.measurements.includes(measurement.key)}
            dot
            onPick={() => change({ measurements: toggle(chosen.measurements, measurement.key) })}
          >
            {measurement.name}
          </Pick>
        ))}
        {(moreOutputs ? offered.outputs : offered.outputs.slice(0, OUTPUTS_SHOWN)).map(output => (
          <Pick key={output} on={chosen.outputs.includes(output)} onPick={() => change({ outputs: toggle(chosen.outputs, output) })}>
            {t(`timeline.output.${output}`, { defaultValue: output })}
          </Pick>
        ))}
        {offered.outputs.length > OUTPUTS_SHOWN ? (
          <button
            type="button"
            className={`${ui.chip} ${styles.chip} ${styles.more}`}
            aria-expanded={moreOutputs}
            onClick={() => setMoreOutputs(!moreOutputs)}
          >
            {t(moreOutputs ? 'charts.less' : 'charts.more')}
          </button>
        ) : null}
      </div>

      {mine.length > 0 ? (
        <div className={styles.chips} role="group" aria-label={t('charts.savedLabel')}>
          <span className="label">{t('charts.savedLabel')}</span>
          {mine.map(view => (
            <button
              key={view.id}
              type="button"
              className={`${ui.chip} ${styles.chip}`}
              aria-pressed={view.id === appliedId}
              onClick={() => apply(view)}
            >
              {view.name}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );

  const head = <Header spaceId={spaceId} growId={grow.id} subject={subject} />;

  // A custom range with one end still to be picked is not a read that is on its
  // way: it is a question nobody has finished asking, and the fields say so.
  if (incomplete) {
    return (
      <div className={styles.screen}>
        {head}
        {chips}
      </div>
    );
  }

  if (series.isPending) {
    return (
      <div className={styles.screen}>
        {head}
        {chips}
        <Waiting lines={3} />
        <Waiting lines={3} />
      </div>
    );
  }

  const data = series.data;
  if (!data) {
    return (
      <div className={styles.screen}>
        {head}
        {chips}
        <LoadFailed retry={() => void series.refetch()} />
      </div>
    );
  }

  const nothingOffered = offered.metrics.length === 0 && offered.outputs.length === 0 && offered.measurements.length === 0;

  return (
    // Busy while a chip's window is still on its way: what is drawn is the
    // window before it, dimmed rather than taken off the screen.
    <div className={styles.screen} aria-busy={series.isPlaceholderData}>
      {head}
      {chips}
      <RefreshFailed failedAt={series.isError ? series.dataUpdatedAt : null} now={now} />

      {nothingOffered ? <p className={`${ui.cardDashed} ${ui.note}`}>{t('charts.noData')}</p> : null}
      {!nothingOffered && isEmpty(chosen) ? <p className={`${ui.cardDashed} ${ui.note}`}>{t('charts.nothingPicked')}</p> : null}
      {cards.map(card => (
        <ChartCard key={card.key} card={card} />
      ))}

      <div className={styles.footer}>
        <div className={styles.segmented} role="group" aria-label={t('charts.layoutLabel')}>
          {LAYOUTS.map(one => (
            <button key={one} type="button" className={styles.segment} aria-pressed={one === layout} onClick={() => setLayout(one)}>
              {t(`charts.layout.${one}`)}
            </button>
          ))}
        </div>
        <div className={styles.footerActions}>
          {/* The demo may look at every chart and keep none: a view is written to an account, and it has not got one. */}
          {mayManage ? (
            <button type="button" className={`${ui.chip} ${styles.chip}`} onClick={() => setSheet(true)}>
              {t('charts.saveView')}
            </button>
          ) : null}
          <button
            type="button"
            className={`${ui.chip} ${styles.chip}`}
            disabled={cards.length === 0}
            onClick={() => downloadCsv(csvName(grow.name, range), csvForCards(t, data, chosen, offered, leafOffset))}
          >
            {t('charts.csv')}
          </button>
        </div>
      </div>

      <p className={`${ui.note} ${styles.csvNote}`}>
        {t('charts.csvNote')} <Link to={`/grows/${grow.id}`}>{grow.name}</Link>
      </p>
      <p className={`${ui.note} ${styles.note}`}>{t('charts.note')}</p>

      {sheet ? (
        <SaveViewSheet
          view={applied}
          definition={definition}
          onSaved={kept => {
            setAppliedId(kept?.id ?? null);
            setSheet(false);
          }}
          onClose={() => setSheet(false)}
        />
      ) : null}
    </div>
  );
}

/** The title, and in the corner the place and the grow it is about. */
function Header({ spaceId, growId, subject }: { spaceId: string | null; growId: string | null; subject: string }) {
  const { t } = useTranslation();
  const back = spaceId ? `/spaces/${spaceId}/timeline` : growId ? `/grows/${growId}` : '/';

  return (
    <header className={styles.header}>
      <Link to={back} className={styles.back} aria-label={t('charts.back')}>
        <ChevronLeft size={22} strokeWidth={1.75} aria-hidden />
      </Link>
      <h1 className={styles.title}>{t('charts.title')}</h1>
      {subject ? <span className={`mono ${styles.subject}`}>{subject}</span> : null}
    </header>
  );
}

/** A series chip. A measurement carries the board's dot, which is what says it was written down rather than measured. */
function Pick({ on, dot, onPick, children }: { on: boolean; dot?: boolean; onPick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={`${ui.chip} ${styles.chip}`} aria-pressed={on} onClick={onPick}>
      {children}
      {dot ? <span className={styles.dot} aria-hidden /> : null}
    </button>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "day 34" over one day of a grow, "day 33–34" where the window straddles the turn, nothing at all without one. */
const dayLabel = (t: Translate, series: GrowSeries): string => {
  if (series.dayFrom === null || series.dayTo === null) return '';

  return series.dayFrom === series.dayTo
    ? t('timeline.dayN', { day: series.dayTo })
    : t('timeline.dayRange', { from: series.dayFrom, to: series.dayTo });
};

/** Where the grow stands now, which is the place the corner names. */
const placedIn = (grow: GrowListItem): string | null => grow.placements.find(placement => placement.endedAt === null)?.spaceId ?? null;

/**
 * The two date fields are days and the route takes instants, so a custom range
 * runs from the first moment of one day to the last of the other, in the
 * reader's own time: a day chosen at either end is a day a grower means whole.
 */
const dayBounds = (range: GrowSeriesRange, from: string, to: string): { from?: string; to?: string } => {
  if (range !== 'custom' || !from || !to) return {};

  return { from: DateTime.fromISO(from).startOf('day').toISO() ?? undefined, to: DateTime.fromISO(to).endOf('day').toISO() ?? undefined };
};

/** What a saved view keeps instead of the chip: a rolling width, two instants, or a stretch read off the grow. */
const spanOf = (range: GrowSeriesRange, from: string, to: string): ChartViewSpan => {
  if (range === 'phase' || range === 'grow') return { kind: range };
  if (range === 'custom') {
    const bounds = dayBounds(range, from, to);

    return { kind: 'fixed', range: { startsAt: bounds.from ?? null, endsAt: bounds.to ?? null } };
  }

  return { kind: 'last', forSeconds: range === '24h' ? DAY_SECONDS : 7 * DAY_SECONDS };
};

/** The chip a saved span comes back as. A width the chips cannot name is read as the nearest one that can. */
const rangeOf = (span: ChartViewSpan): { range: GrowSeriesRange; from?: string; to?: string } => {
  if (span.kind === 'phase' || span.kind === 'grow') return { range: span.kind };
  if (span.kind === 'last') return { range: span.forSeconds <= DAY_SECONDS ? '24h' : '7d' };

  return {
    range: 'custom',
    from: span.range.startsAt ? (DateTime.fromISO(span.range.startsAt).toISODate() ?? undefined) : undefined,
    to: span.range.endsAt ? (DateTime.fromISO(span.range.endsAt).toISODate() ?? undefined) : undefined,
  };
};

/** The VPD panel says what the leaf was taken to be, read off a controller that answered rather than assumed. */
const leafOffsetOf = (devices: readonly { id: string; settings: { vpdLeafOffsetDay: number } }[], series: GrowSeries | undefined): number | null => {
  const here = devices.find(device => (series?.deviceIds ?? []).includes(device.id));

  return here ? here.settings.vpdLeafOffsetDay : null;
};

/** A file a grower can find again: what it is of, and over what. */
const csvName = (growName: string, range: GrowSeriesRange): string => {
  const slug = growName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return `${slug || 'grow'}-${range}.csv`;
};
