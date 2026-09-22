import { ChevronLeft } from 'lucide-react';
import { DateTime } from 'luxon';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { ChartView, ChartViewDefinition, ChartViewSpan, GrowListItem, GrowSeries, GrowSeriesRange } from '@fg2/shared-types/v1';
import { useChartViews } from '@/api/chart-views';
import { useGrowSeries } from '@/api/charts';
import { useDevices } from '@/api/devices';
import { useGrow, useGrowPlants, useSpaceGrows } from '@/api/grows';
import { useSpaces } from '@/api/spaces';
import { useScrub } from '@/charts/scrub';
import { axisFigure, dayOfGrow, downloadCsv, valueAt, type PlotLine } from '@/charts/series';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { MoveHereSheet } from '../space/MoveHereSheet';
import { at, stampOf } from '../timeline/window';
import {
  cardsOf,
  csvForCards,
  defaultPick,
  droppedBy,
  isEmpty,
  offeredBy,
  prunedTo,
  type Card,
  type Layout,
  type LeafOffsets,
  type Picked,
} from './cards';
import { ChartCard } from './ChartCard';
import { SaveViewSheet } from './SaveViewSheet';
import styles from './Charts.module.css';

const RANGES: GrowSeriesRange[] = ['24h', '7d', 'phase', 'grow', 'custom'];
const LAYOUTS: Layout[] = ['stacked', 'overlay', 'day_of_grow'];

/** Counting in days says something only over a stretch a grow's own calendar can name; a rolling day of dates cannot. */
const DAY_RANGES: GrowSeriesRange[] = ['phase', 'grow'];

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
    return <NoGrow spaceId={spaceId} />;
  }

  if (!grow.data) return <LoadFailed retry={() => void grow.refetch()} />;

  return <ChartsFor key={growId} grow={grow.data} spaceId={spaceId} />;
}

/**
 * A tent with a controller and nothing growing in it. The climate is there and
 * the chart is about a grow, which is a sentence and not a wall: the two ways
 * on that the tent's own page offers stand here as well, so the link the app
 * drew itself does not end in a room with one door.
 */
function NoGrow({ spaceId }: { spaceId: string | null }) {
  const { t } = useTranslation();
  const mayManage = useMayManage();
  const spaces = useSpaces();
  const [moving, setMoving] = useState(false);
  const space = spaces.data?.items.find(one => one.id === spaceId) ?? null;

  return (
    <div className={styles.screen}>
      <Header spaceId={spaceId} growId={null} subject={space?.name ?? ''} />
      <p className={`${ui.cardDashed} ${ui.note}`}>{t('charts.noGrow')}</p>
      {spaceId === null ? null : (
        <div className={styles.chips}>
          <Link to={`/log?kind=phase&space=${spaceId}`} className={`${ui.chip} ${styles.chip}`}>
            + {t('space.newGrow')}
          </Link>
          {mayManage && space ? (
            <button type="button" className={`${ui.chip} ${styles.chip}`} onClick={() => setMoving(true)}>
              {t('space.moveHere')}
            </button>
          ) : null}
        </div>
      )}
      {moving && space ? <MoveHereSheet spaceId={space.id} spaceName={space.name} onClose={() => setMoving(false)} /> : null}
    </div>
  );
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
  const keys = useMemo(() => definitions.map(definition => definition.key), [definitions]);
  const window = useMemo(() => ({ range, ...dayBounds(range, from, to), measurements: keys }), [range, from, to, keys]);
  const series = useGrowSeries(grow.id, window);

  const spaces = useSpaces();
  const devices = useDevices();
  const views = useChartViews();
  const plants = useGrowPlants(grow.id);

  const [picked, setPicked] = useState<Picked | null>(null);
  const [asked, setAsked] = useState<Layout>('stacked');
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const [moreOutputs, setMoreOutputs] = useState(false);
  const [sheet, setSheet] = useState(false);
  /** Where the one cursor of the screen stands across the window, so every card is read at the same instant. */
  const [scrubbed, setScrubbed] = useState<number | null>(null);
  const scrub = useScrub(setScrubbed);

  // The day counter is the axis of a stretch a grow can name, so the layout is
  // out of reach under a rolling window rather than repainting the same picture.
  const dayAxis = DAY_RANGES.includes(range);
  const layout = asked === 'day_of_grow' && !dayAxis ? 'stacked' : asked;

  const place = placedIn(grow);
  const siblings = useSpaceGrows(layout === 'day_of_grow' ? place : null);
  const others = (siblings.data?.items ?? []).filter(one => one.id !== grow.id);
  const comparedId = params.get('compare');
  const comparedName = others.find(one => one.id === comparedId)?.name ?? null;
  const comparedWindow = useMemo(() => ({ range: 'grow' as const, measurements: keys }), [keys]);
  const comparedSeries = useGrowSeries(layout === 'day_of_grow' && comparedName ? comparedId : null, comparedWindow);

  // A window whose read failed leaves the one already drawn where it is, dimmed
  // and dated, rather than wiping the chart a chip was tapped from. Everything
  // below is read off that answer and not off the query, so a failed read never
  // empties the chip bar over a chart that is still on the screen.
  const data = series.data ?? series.held?.data;

  const offered = useMemo(() => offeredBy(data, definitions), [data, definitions]);
  const chosen = picked === null ? defaultPick(offered) : prunedTo(picked, offered);
  const leaf = leafOffsetsOf(devices.data?.items ?? [], data);
  const named = useMemo(() => (plants.data?.items ?? []).map(plant => ({ id: plant.id, label: plant.label })), [plants.data]);

  const compared = comparedSeries.data && comparedName ? { series: comparedSeries.data, name: comparedName } : undefined;
  const cards = data ? cardsOf(t, data, { picked: chosen, layout, offered, leaf, plants: named, compared }) : [];

  const spaceName = spaces.data?.items.find(space => space.id === place)?.name ?? null;
  const subject = [spaceName, grow.name].filter(Boolean).join(' · ');

  const setQuery = (over: Record<string, string | null>) => {
    const kept = new URLSearchParams(params);
    for (const [key, value] of Object.entries(over)) {
      if (value === null) kept.delete(key);
      else kept.set(key, value);
    }
    setParams(kept, { replace: true });
  };

  const setRange = (next: GrowSeriesRange) =>
    setQuery({ range: next, ...(next === 'custom' ? {} : { from: null, to: null }), ...(DAY_RANGES.includes(next) ? {} : { compare: null }) });

  const toggle = <T extends string>(list: T[], one: T): T[] => (list.includes(one) ? list.filter(other => other !== one) : [...list, one]);

  /** A chip moved by hand is no longer the saved view it came from, which is what lets Save offer to keep it. */
  const change = (over: Partial<Picked>) => {
    setPicked({ ...chosen, ...over });
    setAppliedId(null);
  };

  const definition: ChartViewDefinition = {
    deviceIds: data?.deviceIds ?? [],
    growId: grow.id,
    metrics: chosen.metrics,
    outputs: chosen.outputs,
    measurements: chosen.measurements,
    span: spanOf(range, from, to),
    layout,
    intervalSeconds: data?.stepSeconds ?? 0,
  };

  const apply = (view: ChartView) => {
    const span = rangeOf(view.definition.span);
    setQuery({ range: span.range, from: span.from ?? null, to: span.to ?? null });
    setPicked({ metrics: [...view.definition.metrics], outputs: [...view.definition.outputs], measurements: [...view.definition.measurements] });
    setAsked(view.definition.layout);
    setAppliedId(view.id);
  };

  const saved = views.data?.items ?? [];
  const applied = saved.find(view => view.id === appliedId) ?? null;
  // A view holds a question and not a grow's readings, so one saved over another
  // run is offered here too; what this grow cannot draw is named under the bar.
  const dropped = picked === null ? [] : droppedBy(t, picked, offered, definitions);

  const chips = (
    <>
      <div className={styles.chips} role="group" aria-label={t('charts.rangeLabel')}>
        {RANGES.map(one => (
          <button key={one} type="button" className={`${ui.chip} ${styles.chip}`} aria-pressed={one === range} onClick={() => setRange(one)}>
            {one === 'custom' ? t('charts.range.custom') : t(`timeline.range.${one}`)}
          </button>
        ))}
        {data ? <span className={`mono ${styles.days}`}>{dayLabel(t, data)}</span> : null}
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
              onChange={event => setQuery({ from: event.target.value })}
            />
          </label>
          <label className={styles.customField}>
            <span className="label">{t('charts.custom.to')}</span>
            <input
              className={`mono ${ui.input}`}
              type="date"
              value={to}
              min={from || undefined}
              onChange={event => setQuery({ to: event.target.value })}
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

      {/* Two runs of one tent lie over each other only where the axis counts days rather than dates. */}
      {layout === 'day_of_grow' && others.length > 0 ? (
        <div className={styles.chips} role="group" aria-label={t('charts.compareLabel')}>
          <span className="label">{t('charts.compareLabel')}</span>
          {others.map(one => (
            <button
              key={one.id}
              type="button"
              className={`${ui.chip} ${styles.chip}`}
              aria-pressed={one.id === comparedId}
              onClick={() => setQuery({ compare: one.id === comparedId ? null : one.id })}
            >
              {one.name}
            </button>
          ))}
        </div>
      ) : null}

      {saved.length > 0 ? (
        <div className={styles.chips} role="group" aria-label={t('charts.savedLabel')}>
          <span className="label">{t('charts.savedLabel')}</span>
          {saved.map(view => (
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

      {dropped.length > 0 ? (
        <p className={`${ui.note} ${styles.leftOut}`}>{t('charts.notHere', { count: dropped.length, names: dropped.join(', ') })}</p>
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

  if (!data) {
    return (
      <div className={styles.screen}>
        {head}
        {chips}
        {series.isPending ? (
          <>
            <Waiting lines={3} />
            <Waiting lines={3} />
          </>
        ) : (
          <LoadFailed retry={() => void series.refetch()} />
        )}
      </div>
    );
  }

  const nothingOffered = offered.metrics.length === 0 && offered.outputs.length === 0 && offered.measurements.length === 0;
  const origin = at(data.originAt);
  const day = layout === 'day_of_grow';
  const span = at(data.endsAt) - at(data.startsAt);
  const edge = (time: number) => (day ? dayOfGrow(time, origin) : time);
  const left = edge(at(data.startsAt));
  const right = edge(at(data.endsAt));
  const cursor = left + (scrubbed ?? 1) * (right - left);
  const dayOf = (x: number) => t('timeline.dayN', { day: Math.max(1, Math.floor(x)) });
  const ends: [string, string] = day ? [dayOf(left), dayOf(right)] : edgesOf(at(data.startsAt), at(data.endsAt));

  return (
    // Busy while a chip's window is still on its way, or while the one that was
    // asked for failed: what is drawn is the window before it, dimmed and dated
    // rather than taken off the screen.
    <div className={styles.screen} aria-busy={series.isPlaceholderData || (series.isError && !series.data)}>
      {head}
      {chips}
      <RefreshFailed failedAt={series.isError ? series.dataUpdatedAt || (series.held?.at ?? null) : null} now={now} />

      {nothingOffered ? <p className={`${ui.cardDashed} ${ui.note}`}>{t('charts.noData')}</p> : null}
      {!nothingOffered && isEmpty(chosen) ? <p className={`${ui.cardDashed} ${ui.note}`}>{t('charts.nothingPicked')}</p> : null}

      {cards.length > 0 ? <ScrubHeader cards={cards} cursor={cursor} stamp={day ? dayOf : x => stampOf(x, span)} /> : null}
      {cards.map(card => (
        <ChartCard key={card.key} card={card} cursor={cursor} scrub={scrub} ends={ends} />
      ))}

      <div className={styles.footer}>
        <div className={styles.segmented} role="group" aria-label={t('charts.layoutLabel')}>
          {LAYOUTS.map(one => (
            <button
              key={one}
              type="button"
              className={styles.segment}
              aria-pressed={one === layout}
              disabled={one === 'day_of_grow' && !dayAxis}
              onClick={() => setAsked(one)}
            >
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
            onClick={() => downloadCsv(csvName(grow.name, range), csvForCards(t, data, { picked: chosen, layout, offered, leaf, plants: named }))}
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

/**
 * What every line on the screen read at the cursor, written into a header that
 * stays where it is.
 *
 * A tooltip that follows the pointer cannot be read on a phone - the thumb is
 * over it - so the Timeline pins its reading above the panels and this screen
 * reads the same way rather than inventing a second idiom for the same
 * question. One cursor moves every card, which is what lets the VPD panel and
 * the Temp + RH panel be read against each other at all.
 */
function ScrubHeader({ cards, cursor, stamp }: { cards: Card[]; cursor: number; stamp: (x: number) => string }) {
  const { t } = useTranslation();

  return (
    <p className={`mono ${styles.scrubHead}`} role="status">
      <span className={styles.scrubTime}>{stamp(cursor)}</span>
      {cards.flatMap(card =>
        card.plot.lines
          .filter(line => line.label !== undefined)
          .map(line => (
            <span key={`${card.key}-${line.key}`} className={styles.scrubValue} data-colour={line.colour}>
              <span className={styles.scrubName}>{line.label}</span> {readingOf(t, line, cursor)}
            </span>
          )),
      )}
    </p>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** What one line says at the cursor: a figure and its unit, on or off for an output, and a dash where it says nothing. */
const readingOf = (t: Translate, line: PlotLine, cursor: number): string => {
  const value = valueAt(line.points, cursor);
  if (value === null) return '—';
  if (line.shape === 'step') return t(value > 0 ? 'charts.on' : 'charts.off');

  return [axisFigure(value), line.unit].filter(Boolean).join(' ');
};

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

/** "day 34" over one day of a grow, "day 33–34" where the window straddles the turn, nothing at all without one. */
const dayLabel = (t: Translate, series: GrowSeries): string => {
  if (series.dayFrom === null || series.dayTo === null) return '';

  return series.dayFrom === series.dayTo
    ? t('timeline.dayN', { day: series.dayTo })
    : t('timeline.dayRange', { from: series.dayFrom, to: series.dayTo });
};

/**
 * Both ends of the window as the axis writes them.
 *
 * A rolling window begins and ends at the same time of day, and a week of one
 * begins and ends on the same weekday as well, so a clock at either end would
 * label the two ends of the chart identically and say nothing about how wide it
 * is. The label widens until the two cannot be read as the same moment.
 */
const edgesOf = (from: number, to: number): [string, string] => {
  const formats = ['HH:mm', 'ccc HH:mm', 'd MMM HH:mm', 'd MMM yyyy HH:mm'];
  const written = formats.map(format => [DateTime.fromMillis(from).toFormat(format), DateTime.fromMillis(to).toFormat(format)] as [string, string]);

  return written.find(([one, other]) => one !== other) ?? written[written.length - 1];
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

/**
 * What the VPD panel takes the leaf to be, and what its band is worked out
 * from. A tent with two controllers set up differently draws a curve that is
 * the mean of two computations, and printing either one's offset as the panel's
 * would be a claim about the other's readings too - so where they disagree the
 * panel says nothing rather than something it cannot stand behind.
 */
const leafOffsetsOf = (
  devices: readonly { id: string; settings: { vpdLeafOffsetDay: number; vpdLeafOffsetNight: number } }[],
  series: GrowSeries | undefined,
): LeafOffsets | null => {
  const here = devices.filter(device => (series?.deviceIds ?? []).includes(device.id));
  const first = here[0];
  if (!first) return null;

  return here.every(
    device =>
      device.settings.vpdLeafOffsetDay === first.settings.vpdLeafOffsetDay &&
      device.settings.vpdLeafOffsetNight === first.settings.vpdLeafOffsetNight,
  )
    ? { day: first.settings.vpdLeafOffsetDay, night: first.settings.vpdLeafOffsetNight }
    : null;
};

/** A file a grower can find again: what it is of, and over what. */
const csvName = (growName: string, range: GrowSeriesRange): string => {
  const slug = growName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return `${slug || 'grow'}-${range}.csv`;
};
