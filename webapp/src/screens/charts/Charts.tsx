import { ChevronLeft } from 'lucide-react';
import { DateTime } from 'luxon';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { ChartView, ChartViewDefinition, ChartViewSpan, GrowListItem, GrowSeries, GrowSeriesRange } from '@fg2/shared-types/v1';
import { useChartViews } from '@/api/chart-views';
import { askable, useGrowSeries } from '@/api/charts';
import { useDevices } from '@/api/devices';
import { useGrow, useGrowPlants, useGrows, useGrowsEverIn, useSpaceGrows } from '@/api/grows';
import { noLongerThere } from '@/api/problem';
import { useSpaces } from '@/api/spaces';
import { useScrub } from '@/charts/scrub';
import { dayOfGrow, downloadCsv, readAt, type PlotLine } from '@/charts/series';
import { ageLabel } from '@/ui/age';
import { looseFigure } from '@/ui/figures';
import { Help } from '@/ui/Help';
import { LoadFailed, NoLongerHere, RefreshFailed, Waiting } from '@/ui/PageState';
import { stoodIn, useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { useZone, zoned, zonedAt } from '@/ui/zone';
import { figure } from '../home/units';
import { MoveHereSheet } from '../space/MoveHereSheet';
import { at, stampForEnds, stampOf, STAMPS } from '../timeline/window';
import {
  cardsOf,
  csvForCards,
  defaultPick,
  droppedBy,
  isEmpty,
  metricColour,
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

/** And how many earlier runs of the same tent, which an account that has grown in it for years has plenty of. */
const RUNS_SHOWN = 3;

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

  // Nothing named at all is a different absence from a tent with nothing in it:
  // the screen has not been told which grow rather than been told about a place
  // that has none, and the account's own grows are the answer to that.
  if (growId === null) {
    if (spaceId !== null && noLongerThere(here.error)) return <NoLongerHere what="space" />;
    return spaceId === null ? <PickGrow /> : <NoGrow spaceId={spaceId} />;
  }

  if (!grow.data) return noLongerThere(grow.error) ? <NoLongerHere what="grow" /> : <LoadFailed retry={() => void grow.refetch()} />;

  return <ChartsFor key={growId} grow={grow.data} spaceId={spaceId} />;
}

/**
 * A tent with nothing growing in it. The app draws no link here - the Overview
 * and the Timeline offer Charts only while a grow is shown - but an address
 * kept from when one stood here still arrives, and it is a sentence and not a
 * wall: the tent's Timeline, which draws its climate, and the two ways of
 * putting a grow in stand here.
 */
function NoGrow({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  // Both ways on put a grow into this place, which is managing it - so the
  // question is about the tent named in the query rather than about the session.
  const mayManage = useMayManage(spaceId);
  const spaces = useSpaces();
  const [moving, setMoving] = useState(false);
  const space = spaces.data?.items.find(one => one.id === spaceId) ?? null;

  return (
    <div className={styles.screen}>
      <Header spaceId={spaceId} growId={null} subject={space?.name ?? ''} />
      <p className={`${ui.cardDashed} ${ui.note}`}>{t('charts.noGrow')}</p>
      <div className={styles.chips}>
        {/* The place's climate without a grow is what its Timeline draws. */}
        <Link to={`/spaces/${spaceId}/timeline`} className={ui.chip}>
          {t('space.tabs.timeline')}
        </Link>
        {mayManage ? (
          <Link to={`/log?kind=phase&space=${spaceId}`} className={ui.chip}>
            + {t('space.newGrow')}
          </Link>
        ) : null}
        {mayManage && space ? (
          <button type="button" className={ui.chip} onClick={() => setMoving(true)}>
            {t('space.moveHere')}
          </button>
        ) : null}
      </div>
      {moving && space ? <MoveHereSheet spaceId={space.id} spaceName={space.name} onClose={() => setMoving(false)} /> : null}
    </div>
  );
}

/**
 * The bare address, which is where a bookmark on this screen and a link that
 * lost its query both land. It knows nothing about a tent, so the sentence the
 * tent's own empty state carries would be about a place nobody named - and it
 * would stand there alone, since both ways on need an id this screen has not
 * got. What it does have is the account's grows, and a chart is drawn about
 * one, so they are the way on: whichever is picked, the screen is the same
 * screen the link would have opened.
 */
function PickGrow() {
  const { t } = useTranslation();
  const grows = useGrows();
  const items = grows.data?.items ?? [];

  return (
    <div className={styles.screen}>
      <Header spaceId={null} growId={null} subject="" />
      {grows.isPending ? (
        <Waiting lines={2} />
      ) : !grows.data ? (
        <LoadFailed retry={() => void grows.refetch()} />
      ) : (
        <>
          <p className={`${ui.cardDashed} ${ui.note}`}>{t(items.length > 0 ? 'charts.whichGrow' : 'charts.noGrow')}</p>
          <div className={styles.chips}>
            {items.map(one => (
              <Link key={one.id} to={`/charts?grow=${one.id}`} className={ui.chip}>
                {one.name}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ChartsFor({ grow, spaceId }: { grow: GrowListItem; spaceId: string | null }) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const mayManage = useMayManage();
  const [params, setParams] = useSearchParams();

  const range = RANGES.find(one => one === params.get('range')) ?? '24h';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';

  const definitions = useMemo(() => grow.measurements.filter(definition => definition.chart), [grow.measurements]);
  const keys = useMemo(() => definitions.map(definition => definition.key), [definitions]);
  // The zone is in the list because it arrives after the first draw - the
  // account is a read of its own - and the two ends of a custom range are cut
  // at midnight where the account is. Left out, the window would stay frozen at
  // the midnight the browser happened to be on when the screen first drew.
  const bounds = useMemo(() => dayBounds(range, from, to, zone), [range, from, to, zone]);
  const window = useMemo(() => ({ range, ...bounds, measurements: keys }), [range, bounds, keys]);
  // Whether the question has been finished is decided on the window that came
  // out of the two fields and not on the two strings that went in. A range
  // typed into the address rather than picked in the fields can name a day
  // nothing can read, and that leaves a truthy string in front of an empty
  // window: judged by the string the question looked asked, while the read
  // stayed disabled behind it and the screen waited on nothing for ever. Two
  // ends given and still no window is the way that shows itself, and it is a
  // different sentence from an end nobody has picked yet.
  const incomplete = range === 'custom' && !(bounds.from && bounds.to);
  const unreadable = incomplete && !!from && !!to;
  // Two ends that read perfectly well and still name no stretch of time,
  // because the later of the two was put in the earlier field. The route
  // refuses that pair for good - a custom range names both of its ends, and
  // ends after it begins - so asking it turns a sentence this screen could
  // write itself into a read that failed, reported as a window that could not
  // be refreshed and offered with a Try again there is nothing to try. The
  // `max` and `min` on the two fields do not prevent it: on a date field those
  // raise a validity flag and refuse no input at all.
  const backwards = range === 'custom' && !incomplete && !askable(window);
  /** Either way, a question nobody has finished asking: no read goes out, and the fields say which of the three it is. */
  const unasked = incomplete || backwards;
  const series = useGrowSeries(grow.id, window);

  const spaces = useSpaces();
  const devices = useDevices();
  const views = useChartViews();
  const plants = useGrowPlants(grow.id);

  const [picked, setPicked] = useState<Picked | null>(null);
  const [asked, setAsked] = useState<Layout>('stacked');
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const [moreOutputs, setMoreOutputs] = useState(false);
  const [moreRuns, setMoreRuns] = useState(false);
  const [sheet, setSheet] = useState(false);
  /** Where the one cursor of the screen stands across the window, so every card is read at the same instant. */
  const [scrubbed, setScrubbed] = useState<number | null>(null);
  const scrub = useScrub(setScrubbed);

  // The day counter is the axis of a stretch a grow can name, so the layout is
  // out of reach under a rolling window rather than repainting the same picture.
  const dayAxis = DAY_RANGES.includes(range);
  const layout = asked === 'day_of_grow' && !dayAxis ? 'stacked' : asked;

  // The place the grow last stood in and not only the one it stands in today:
  // a finished run has no open placement at all, and it is exactly the run
  // somebody wants to lay under this one.
  const place = stoodIn(grow);
  const siblings = useGrowsEverIn(layout === 'day_of_grow' ? place : null);
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
    span: spanOf(range, from, to, zone),
    layout,
    intervalSeconds: data?.stepSeconds ?? 0,
  };

  const apply = (view: ChartView) => {
    const span = rangeOf(view.definition.span, zone);
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
          <button key={one} type="button" className={ui.chip} aria-pressed={one === range} onClick={() => setRange(one)}>
            {one === 'custom' ? t('charts.range.custom') : t(`timeline.range.${one}`)}
          </button>
        ))}
        {/* Which days the chart covers, and it covers none while the question
            is unfinished: the answer still in hand is of the window before the
            fields were touched, and naming its days beside two fields that no
            longer describe it is the last thing on the screen still claiming
            the old range is what is being looked at. */}
        {!unasked && data ? <span className={`mono ${styles.days}`}>{dayLabel(t, data)}</span> : null}
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
          {unasked ? (
            <p className={`${ui.note} ${styles.customNote}`}>
              {t(backwards ? 'charts.custom.backwards' : unreadable ? 'charts.custom.unreadable' : 'charts.custom.need')}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className={styles.chips} role="group" aria-label={t('charts.seriesLabel')}>
        {offered.metrics.map(metric => (
          <Pick
            key={metric}
            on={chosen.metrics.includes(metric)}
            colour={metricColour(metric)}
            onPick={() => change({ metrics: toggle(chosen.metrics, metric) })}
          >
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
          <Pick key={output} on={chosen.outputs.includes(output)} colour="output" onPick={() => change({ outputs: toggle(chosen.outputs, output) })}>
            {t(`timeline.output.${output}`, { defaultValue: output })}
          </Pick>
        ))}
        {offered.outputs.length > OUTPUTS_SHOWN ? (
          <button type="button" className={`${ui.chip} ${styles.more}`} aria-expanded={moreOutputs} onClick={() => setMoreOutputs(!moreOutputs)}>
            {t(moreOutputs ? 'charts.less' : 'charts.more')}
          </button>
        ) : null}
      </div>

      {/* Two runs of one tent lie over each other only where the axis counts days
          rather than dates. A tent with eight seasons behind it would otherwise
          draw seven chips, so the older ones fold away the way the outputs do. */}
      {layout === 'day_of_grow' && others.length > 0 ? (
        <div className={styles.chips} role="group" aria-label={t('charts.compareLabel')}>
          <span className="label">{t('charts.compareLabel')}</span>
          {(moreRuns ? others : others.slice(0, RUNS_SHOWN)).map(one => (
            <button
              key={one.id}
              type="button"
              className={ui.chip}
              aria-pressed={one.id === comparedId}
              onClick={() => setQuery({ compare: one.id === comparedId ? null : one.id })}
            >
              {one.name}
            </button>
          ))}
          {others.length > RUNS_SHOWN ? (
            <button type="button" className={`${ui.chip} ${styles.more}`} aria-expanded={moreRuns} onClick={() => setMoreRuns(!moreRuns)}>
              {t(moreRuns ? 'charts.less' : 'charts.more')}
            </button>
          ) : null}
        </div>
      ) : null}

      {saved.length > 0 ? (
        <div className={styles.chips} role="group" aria-label={t('charts.savedLabel')}>
          <span className="label">{t('charts.savedLabel')}</span>
          {saved.map(view => (
            <button key={view.id} type="button" className={ui.chip} aria-pressed={view.id === appliedId} onClick={() => apply(view)}>
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

  // A custom range with an end still to be picked, or with its two ends the
  // wrong way round, is not a read that is on its way: it is a question nobody
  // has finished asking, and the fields say so. The chart drawn before it goes
  // with it, because it is of a window the two fields no longer show - left up
  // under a sentence about the network, it was the strongest thing on the
  // screen saying the old range was still what was being looked at.
  if (unasked) {
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
  const ends: [string, string] = day ? [dayOf(left), dayOf(right)] : edgesOf(at(data.startsAt), at(data.endsAt), zone);

  return (
    // Busy while a chip's window is still on its way, or while the one that was
    // asked for failed: what is drawn is the window before it, dimmed and dated
    // rather than taken off the screen.
    <div className={styles.screen} aria-busy={series.isPlaceholderData || (series.isError && !series.data)}>
      {head}
      {chips}
      <RefreshFailed failedAt={series.isError ? series.dataUpdatedAt || (series.held?.at ?? null) : null} now={now} />

      {/* Two silences, told apart by the one fact the window cannot hold. A
          grow whose places hold only a plug, a light or a fan has never
          measured anything, and telling its grower the hardware went quiet
          would be a fault invented out of nothing; a tent that measured until
          Saturday and has said nothing since is dated, the way the tent's own
          Timeline dates it one tap away. The advice stays in both: on the very
          tent this was found on the next chip along does draw. */}
      {nothingOffered ? (
        <p className={`${ui.cardDashed} ${ui.note} ${styles.empty}`}>
          {data.lastReadingAt === null ? t('charts.noData') : t('charts.quietWindow', { age: ageLabel(data.lastReadingAt, now) })}
        </p>
      ) : null}
      {!nothingOffered && isEmpty(chosen) ? <p className={`${ui.cardDashed} ${ui.note} ${styles.empty}`}>{t('charts.nothingPicked')}</p> : null}

      {cards.length > 0 ? <ScrubHeader cards={cards} cursor={cursor} stamp={day ? dayOf : x => stampOf(x, span, zone)} /> : null}
      {cards.map(card => (
        <ChartCard key={card.key} card={card} cursor={cursor} scrub={scrub} ends={ends} />
      ))}

      <div className={styles.footer}>
        <div className={ui.segments} role="group" aria-label={t('charts.layoutLabel')}>
          {LAYOUTS.map(one => (
            <button
              key={one}
              type="button"
              className={ui.segment}
              aria-pressed={one === layout}
              disabled={one === 'day_of_grow' && !dayAxis}
              onClick={() => setAsked(one)}
            >
              {t(`charts.layout.${one}`)}
            </button>
          ))}
        </div>
        <Help topic="chartLayout" />
        <div className={styles.footerActions}>
          {/* The demo may look at every chart and keep none: a view is written to an account, and it has not got one. */}
          {mayManage ? (
            <button type="button" className={ui.chip} onClick={() => setSheet(true)}>
              {t('charts.saveView')}
            </button>
          ) : null}
          <button
            type="button"
            className={ui.chip}
            disabled={cards.length === 0}
            onClick={() =>
              downloadCsv(csvName(grow.name, range), csvForCards(t, data, { picked: chosen, layout, offered, leaf, plants: named }, zone))
            }
          >
            {t('charts.csv')}
          </button>
        </div>
      </div>

      {/* The table is the answer already in hand, so it is written at the step
          the window decided and not at the rate the devices reported at. That
          step is on the wire, so the note says it rather than leaving somebody
          to work out why their million readings came back as four hundred.

          The sentence belongs to the table and goes wherever the table goes, so
          it is drawn on exactly the condition the CSV button is enabled on.
          Naming a rate under a screen that drew nothing, beside a button that
          refuses to be pressed, describes a file nobody can have: the step is
          answered as zero only where no device was read at all, and a tent that
          was read and had nothing to say is the commoner of the two empty
          screens by far. The way on to the whole grow stays where it was. */}
      <p className={`${ui.note} ${styles.csvNote}`}>
        {cards.length > 0 && data.stepSeconds > 0 ? `${t('charts.csvNote', { step: stepLabel(data.stepSeconds) })} ` : null}
        {t('charts.exportOn')} <Link to={`/grows/${grow.id}`}>{grow.name}</Link>
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
              <span className={styles.scrubName}>{line.label}</span> {readingOf(t, line, cursor, card.plot.to - card.plot.from)}
            </span>
          )),
      )}
    </p>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * What one line says at the cursor: a figure and its unit, on or off for an
 * output, and a dash where it says nothing.
 *
 * The figure is written the way the rest of the app writes that same reading,
 * which is the claim the header above makes about itself. It used to be written
 * the way a corner of a scale is - rounded to two decimals and stripped of the
 * noughts a round number does not need - and a corner is the one place that is
 * right, because a corner is a round number and reads as one. A reading is not:
 * the same line said "Temp 23 °C" at one position of the cursor and "Temp
 * 23.1 °C" at the next, so the figure changed width as the thumb moved and the
 * column under it could not be read down at all. A metric is written to the
 * decimals that metric is written to everywhere else instead - a temperature
 * always carries its tenth, a humidity never carries one - which is also how
 * the Timeline's own pinned reading is written, one tap away.
 *
 * That writer knows what language it is being read in and the old one knew
 * nothing about it, so the German screen wrote "VPD 0.75 kPa" beside a date it
 * had just written "29 Aug." - the app's own tent read back in somebody else's
 * numbers.
 *
 * A line a grower measured by hand is none of the contract's metrics and has no
 * such rule to follow: it is written as exactly as it was taken, which is how
 * the diary writes the very same reading.
 */
const readingOf = (t: Translate, line: PlotLine, cursor: number, span: number): string => {
  const value = readAt(line, cursor, span);
  if (value === null) return '—';
  if (line.shape === 'step') return t(value > 0 ? 'charts.on' : 'charts.off');

  return [line.metric ? figure(value, line.metric) : looseFigure(value), line.unit].filter(Boolean).join(' ');
};

/** The title, and in the corner the place and the grow it is about. */
function Header({ spaceId, growId, subject }: { spaceId: string | null; growId: string | null; subject: string }) {
  const { t } = useTranslation();
  const back = spaceId ? `/spaces/${spaceId}/timeline` : growId ? `/grows/${growId}` : '/';

  return (
    <header className={styles.header}>
      <Link to={back} className={`${ui.back} ${styles.back}`} aria-label={t('charts.back')}>
        <ChevronLeft size={22} strokeWidth={1.75} aria-hidden />
      </Link>
      <h1 className={styles.title}>{t('charts.title')}</h1>
      {subject ? <span className={`mono ${styles.subject}`}>{subject}</span> : null}
    </header>
  );
}

/**
 * A series chip. A measurement carries the board's dot, which is what says it
 * was written down rather than measured. The colour is the line's, which the
 * chip carries as a mark and, in light mode, is filled with while it is on:
 * the chip row is the chart's legend.
 */
function Pick({ on, dot, colour, onPick, children }: { on: boolean; dot?: boolean; colour?: string; onPick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={ui.chip} aria-pressed={on} data-colour={colour} onClick={onPick}>
      {dot ? <span className={styles.dot} aria-hidden /> : null}
      {children}
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
 * Both ends of the window as the axis writes them, in the account's zone.
 *
 * Two things have to be true of them and only one used to be. They have to
 * differ - a rolling window begins and ends at the same time of day, and a week
 * of one on the same weekday as well, so a clock at either end would label the
 * chart identically and say nothing about how wide it is. But they also have to
 * say which moment they are, and widening from the clock until the strings
 * happened to differ stopped at the first rung on every window that does not
 * begin and end at the same minute: a 218-day grow was labelled "14:39" and
 * "17:31", and five days of September as "00:00" and "23:59".
 *
 * So the ladder is climbed from the rung the width itself asks for - the same
 * ladder the pinned reading above the cards is written from, so the axis and
 * the header cannot drift apart - and only then widened until the two differ.
 */
const edgesOf = (from: number, to: number, zone: string | null): [string, string] => {
  const written = STAMPS.slice(stampForEnds(to - from)).map(
    format => [zonedAt(from, zone).toFormat(format), zonedAt(to, zone).toFormat(format)] as [string, string],
  );

  return written.find(([one, other]) => one !== other) ?? written[written.length - 1];
};

/**
 * The two date fields are days and the route takes instants, so a custom range
 * runs from the first moment of one day to the last of the other, in the zone
 * the account names: a day chosen at either end is a day a grower means whole,
 * and whole where their tent stands rather than where they happen to be
 * reading. A browser two hours ahead of the account cut 20 August from 19 Aug
 * 22:00Z and fetched a different twenty-four hours from the one the axis
 * underneath went on labelling 00:00 to 23:59.
 *
 * Those two instants are then written the one way the contract spells an
 * instant, which is UTC. The moment is not changed by that and the fields read
 * back the same, since `rangeOf` reads a Z instant back where the account is -
 * but the local offset Luxon writes by default is a string `instant()` refuses,
 * and it is the same pair of instants that goes into a saved view. So a window
 * somebody picked by hand was the one window the server would not keep, and it
 * is the only one that cannot be asked for again by tapping a chip.
 */
const dayBounds = (range: GrowSeriesRange, from: string, to: string, zone: string | null): { from?: string; to?: string } => {
  if (range !== 'custom' || !from || !to) return {};

  return {
    from:
      DateTime.fromISO(from, { zone: zone ?? undefined })
        .startOf('day')
        .toUTC()
        .toISO() ?? undefined,
    to:
      DateTime.fromISO(to, { zone: zone ?? undefined })
        .endOf('day')
        .toUTC()
        .toISO() ?? undefined,
  };
};

/** What a saved view keeps instead of the chip: a rolling width, two instants, or a stretch read off the grow. */
const spanOf = (range: GrowSeriesRange, from: string, to: string, zone: string | null): ChartViewSpan => {
  if (range === 'phase' || range === 'grow') return { kind: range };
  if (range === 'custom') {
    const bounds = dayBounds(range, from, to, zone);

    return { kind: 'fixed', range: { startsAt: bounds.from ?? null, endsAt: bounds.to ?? null } };
  }

  return { kind: 'last', forSeconds: range === '24h' ? DAY_SECONDS : 7 * DAY_SECONDS };
};

/**
 * The chip a saved span comes back as. A width the chips cannot name is read as
 * the nearest one that can, and the two instants of a fixed one are read back
 * into date fields where the account is, because they were cut there: read in
 * the browser's zone instead, a view saved on the 20th reopens on the 19th for
 * anybody sitting behind their own account.
 */
const rangeOf = (span: ChartViewSpan, zone: string | null): { range: GrowSeriesRange; from?: string; to?: string } => {
  if (span.kind === 'phase' || span.kind === 'grow') return { range: span.kind };
  if (span.kind === 'last') return { range: span.forSeconds <= DAY_SECONDS ? '24h' : '7d' };

  return {
    range: 'custom',
    from: span.range.startsAt ? (zoned(span.range.startsAt, zone).toISODate() ?? undefined) : undefined,
    to: span.range.endsAt ? (zoned(span.range.endsAt, zone).toISODate() ?? undefined) : undefined,
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

/** The units a step is written in, widest first. They are not translated, because neither is any other span the app prints. */
const STEP_UNITS = [
  { unit: 'd', seconds: 24 * 60 * 60 },
  { unit: 'h', seconds: 60 * 60 },
  { unit: 'min', seconds: 60 },
  { unit: 's', seconds: 1 },
];

/**
 * How far apart the rows of the table are, in words.
 *
 * Not `spanLabel`, which floors to a single unit. That is right for an age - a
 * value an hour and a half old is "1 h ago", and saying "1 h 30 min ago" of it
 * would be precision nobody asked for - and wrong for a figure somebody is
 * about to count rows by: the step of a whole grow is whatever the window
 * divided by the number of panels comes to, 1 h 29 min on one of the restored
 * seasons, and floored to "1 h" the note was a third short of the truth.
 *
 * So the next unit down is named where there is one worth naming, and left off
 * where the step lands on a whole one of the first - which is every rolling
 * window, the two the chips offer included.
 */
const stepLabel = (seconds: number): string => {
  const whole = Math.max(0, Math.round(seconds));
  const index = Math.max(
    0,
    STEP_UNITS.findIndex(one => whole >= one.seconds),
  );
  const big = STEP_UNITS[index];
  const small = STEP_UNITS[index + 1];
  const count = Math.floor(whole / big.seconds);
  const rest = small ? Math.round((whole - count * big.seconds) / small.seconds) : 0;
  // A remainder that rounds up to a whole one of the unit above is that unit.
  if (small && rest * small.seconds >= big.seconds) return `${count + 1} ${big.unit}`;

  return rest > 0 ? `${count} ${big.unit} ${rest} ${small.unit}` : `${count} ${big.unit}`;
};

/** A file a grower can find again: what it is of, and over what. */
const csvName = (growName: string, range: GrowSeriesRange): string => {
  const slug = growName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return `${slug || 'grow'}-${range}.csv`;
};
