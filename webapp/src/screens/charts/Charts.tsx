import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { DateTime } from 'luxon';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useSearchParams } from 'react-router';
import { timelinePath, useCurrentPlace } from '@/app/places';
import type { ChartView, ChartViewDefinition, GrowListItem, ShareLink } from '@fg2/shared-types/v1';
import { CHART_METRICS, CHART_OUTPUTS } from '@/api/charts';
import { useChartViews } from '@/api/chart-views';
import { serverNow } from '@/api/clock';
import { useDevices, useDevicesById } from '@/api/devices';
import { useWindowEntries } from '@/api/entries';
import { useGrow, useGrowPlants, useGrows, useGrowsEverIn, useSpaceGrows } from '@/api/grows';
import { noLongerThere } from '@/api/problem';
import { LIVE_BEAT_MS } from '@/api/read';
import { useSession } from '@/api/session';
import { useSpaceOverview, useSpaces } from '@/api/spaces';
import { useScrub, type Selection } from '@/charts/scrub';
import { dayOfGrow, readAt, type PlotLine } from '@/charts/series';
import { timeTicks } from '@/charts/ticks';
import { NewLinkSheet } from '@/screens/me/sharing/NewLinkSheet';
import { linkAddress } from '@/screens/me/sharing/links';
import { Sheet } from '@/ui/Sheet';
import { AdvancedSection } from '@/ui/advanced/Advanced';
import type { ChartSettings } from '@/ui/advanced/item';
import { ageLabel } from '@/ui/age';
import { CopyButton } from '@/ui/CopyButton';
import { saveFile } from '@/ui/download';
import { looseFigure } from '@/ui/figures';
import { Help } from '@/ui/Help';
import { LoadFailed, NoLongerHere, RefreshFailed, Waiting } from '@/ui/PageState';
import { stoodIn, useMayManage, useVisiting } from '@/ui/session-access';
import { Choice } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { DAY_IN_YEAR, useZone, zonedAt } from '@/ui/zone';
import { BackLink } from '@/ui/BackLink';
import { figure } from '@/ui/units';
import { CameraFrame } from '../timeline/CameraFrame';
import { at, stampFor, stampForEnds, stamps } from '../timeline/window';
import {
  cardsOf,
  csvForCards,
  defaultPick,
  droppedBy,
  isEmpty,
  metricColour,
  offeredBy,
  outputTitle,
  prunedTo,
  type Card,
  type Layout,
  type LeafOffsets,
  type Picked,
} from './cards';
import { ChartCard } from './ChartCard';
import { useChartData, type ChartData } from './data';
import { MESSAGE_CATEGORIES } from './message-columns';
import { Messages } from './Messages';
import { SaveViewSheet } from './SaveViewSheet';
import {
  dayBounds,
  EVERYDAY,
  instant,
  isStretch,
  isWidth,
  liveEnd,
  NARROWEST_ZOOM,
  RARE,
  rangeFrom,
  rangeOfSpan,
  spanOf,
  stepped,
  WIDTHS,
  windowOf,
  zoomedIn,
  type ChartRange,
  type Width,
  type Zoom,
} from './span';
import { stepLabel, STEPS } from './steps';
import styles from './Charts.module.css';

const LAYOUTS: Layout[] = ['stacked', 'overlay', 'day_of_grow'];

/** How many output chips stand in the bar before the rest go behind "+ more". */
const OUTPUTS_SHOWN = 2;

/** And how many earlier runs of the same tent, which an account that has grown in it for years has plenty of. */
const RUNS_SHOWN = 3;

const VPD_HALVES = ['all', 'day', 'night'] as const;

/**
 * The Charts view: the nerd's room.
 *
 * Everything else in the app decides for the grower what is worth drawing - the
 * home its four tiles, the Timeline its three panels - and this is the one
 * screen that does not. Any series the account has, over any stretch, laid out
 * three ways, kept as a view to come back to and taken away as a table - and,
 * beside the curves, what was written over the window and what the camera saw
 * at the cursor.
 *
 * It is about a place, and about the grow standing in it where there is one:
 * the stretches a grow names - its phase, the whole of it - are drawn from the
 * grow, every other window from the place, so a place with no grow is charted
 * like any other and a year back is a year of the place. A grow named in the
 * address is charted where it stood last. The bare address opens on the place
 * the tabs are showing.
 */
export function Charts() {
  const [params] = useSearchParams();
  const spaceId = params.get('space');
  const named = params.get('grow');
  const { home, here } = useCurrentPlace();

  // A place is answered by what grows in it; a grow names itself and needs no lookup.
  const growsHere = useSpaceGrows(named ? null : spaceId);
  const growId = named ?? growsHere.data?.items[0]?.id ?? null;
  const grow = useGrow(growId);

  if (!named && spaceId === null) {
    if (home.isPending) return <Pending />;
    if (!here) return <PickGrow />;
    // What else the address asked - a range, a step - goes along to the place it is about.
    const kept = new URLSearchParams(params);
    kept.set('space', here.spaceId);
    return <Navigate to={`/charts?${kept.toString()}`} replace />;
  }

  if ((!named && spaceId !== null && growsHere.isPending) || (growId !== null && grow.isPending))
    return <Pending spaceId={spaceId} growId={growId} />;
  if (!named && spaceId !== null && noLongerThere(growsHere.error)) return <NoLongerHere what="space" />;
  if (growId !== null && !grow.data)
    return noLongerThere(grow.error) ? <NoLongerHere what="grow" /> : <LoadFailed retry={() => void grow.refetch()} />;

  const place = spaceId ?? (grow.data ? stoodIn(grow.data) : null);

  return <ChartsFor key={`${growId ?? ''}:${place ?? ''}`} grow={grow.data ?? null} spaceId={place} />;
}

function Pending({ spaceId = null, growId = null }: { spaceId?: string | null; growId?: string | null }) {
  return (
    <div className={styles.screen}>
      <Header spaceId={spaceId} growId={growId} subject="" />
      <Waiting lines={3} />
      <Waiting lines={3} />
    </div>
  );
}

/**
 * The bare address on an account with no place at all: a diary kept without
 * hardware charts its grows' own measurements, so they are the way on; with
 * none either, there is nothing to draw yet and the sentence says so.
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
          <p className={`${ui.cardDashed} ${ui.note}`}>{t(items.length > 0 ? 'charts.whichGrow' : 'charts.nothingYet')}</p>
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

function ChartsFor({ grow, spaceId }: { grow: GrowListItem | null; spaceId: string | null }) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const { user } = useSession();
  const visiting = useVisiting(spaceId);
  // A view is kept in the account that saves it; support reading a customer's place keeps none.
  const mayManage = useMayManage() && !visiting;
  const mayShare = useMayManage(spaceId) && user?.isDemo !== true;
  const [params, setParams] = useSearchParams();

  const range = rangeFrom(params.get('range'), grow !== null);
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const atParam = momentOf(params.get('at'));
  const settings = settingsOf(params);

  const [liveNow, setLiveNow] = useState(() => serverNow().toMillis());
  const zoom = zoomOf(params.get('zoom'));
  const endedAt = grow?.endedAt ? at(grow.endedAt) : null;
  const rolling = isWidth(range) && atParam === null && zoom === null;
  const endsNow = endedAt === null && zoom === null && (rolling || isStretch(range));
  const following = settings.live && rolling && endedAt === null;

  // A rolling window that follows now is moved on by the clock; nothing else moves it.
  useEffect(() => {
    if (!following) return;
    const timer = setInterval(() => setLiveNow(serverNow().toMillis()), LIVE_BEAT_MS);
    return () => clearInterval(timer);
  }, [following]);

  const window = windowOf({ range, from, to, at: atParam, zoom, now: liveNow, endedAt, zone });
  // Whether the question has been finished is decided on the window that came
  // out of the two fields and not on the two strings that went in: a range
  // typed into the address can name a day nothing can read, and two ends given
  // and still no window is a different sentence from an end nobody has picked.
  const days = range === 'custom' && zoom === null ? dayBounds(from, to, zone) : null;
  const incomplete = range === 'custom' && zoom === null && days === null;
  const unreadable = incomplete && !!from && !!to;
  // Two ends that read perfectly well and still name no stretch of time,
  // because the later of the two was put in the earlier field. Asking the
  // route would turn a sentence this screen can write itself into a read that
  // failed, so it is not asked.
  const backwards = days !== null && days.from >= days.to;
  const unasked = incomplete || backwards;

  const definitions = useMemo(() => (grow?.measurements ?? []).filter(definition => definition.chart), [grow]);
  const keys = useMemo(() => definitions.map(definition => definition.key), [definitions]);
  const series = useChartData(
    { growId: grow?.id ?? null, spaceId, keys },
    unasked ? null : window,
    settings.stepSeconds ?? undefined,
    settings.live && window?.kind === 'grow' && endedAt === null ? LIVE_BEAT_MS : false,
  );

  const spaces = useSpaces();
  const devices = useDevices();
  const views = useChartViews();
  const plants = useGrowPlants(grow?.id ?? null);

  // What is drawn is kept in the address with the window, as the old charts kept it: a reload, a bookmark or
  // a link sent to somebody in the same place opens on the same curves, laid out the same way and zoomed
  // into the same stretch, the messages with the same kinds of line left out and the picture included.
  const picked = pickedOf(params.get('show'));
  const asked = LAYOUTS.find(one => one === params.get('layout')) ?? 'stacked';
  const hiddenMessages = MESSAGE_CATEGORIES.filter(category => (params.get('hide') ?? '').split(',').includes(category));
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const [moreOutputs, setMoreOutputs] = useState(false);
  const [moreWidths, setMoreWidths] = useState(RARE.includes(range as Width));
  const [moreRuns, setMoreRuns] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState<ShareLink | null>(null);
  const showMessages = params.get('msgs') === '1';
  const showCamera = params.get('cam') === '1';
  /** Where the one cursor of the screen stands across the window, so every card is read at the same instant. */
  const [scrubbed, setScrubbed] = useState<number | null>(null);

  // The day counter is the axis of a stretch a grow can name, so the layout is
  // out of reach under a rolling window rather than repainting the same picture.
  const dayAxis = isStretch(range) && zoom === null && window?.kind === 'grow';
  const layout = asked === 'day_of_grow' && !dayAxis ? 'stacked' : asked;
  const day = layout === 'day_of_grow';

  // The place the grow last stood in and not only the one it stands in today:
  // a finished run has no open placement at all, and it is exactly the run
  // somebody wants to lay under this one.
  const place = grow ? stoodIn(grow) : spaceId;
  const siblings = useGrowsEverIn(layout === 'day_of_grow' ? place : null);
  const others = (siblings.data?.items ?? []).filter(one => one.id !== grow?.id);
  const comparedId = params.get('compare');
  const comparedName = others.find(one => one.id === comparedId)?.name ?? null;
  const comparedSeries = useChartData(
    { growId: day && comparedName ? comparedId : null, spaceId: null, keys },
    day && comparedName ? { kind: 'grow', range: 'grow' } : null,
    undefined,
    false,
  );

  // A window whose read failed leaves the one already drawn where it is, dimmed
  // and dated, rather than wiping the chart a chip was tapped from.
  const data = series.data;
  const left = data ? at(data.startsAt) : 0;
  const right = data ? at(data.endsAt) : 0;
  const entries = useWindowEntries({ growId: grow?.id ?? null, spaceId }, showMessages && data ? { from: data.startsAt, to: data.endsAt } : null);

  const offered = useMemo(() => offeredBy(data, definitions), [data, definitions]);
  const chosen = picked === null ? defaultPick(offered) : prunedTo(picked, offered);
  // Support reading a customer's place has none of its devices in its own list, so they are read one by one.
  const visited = useDevicesById(data?.deviceIds ?? [], visiting);
  const leaf = leafOffsetsOf(visiting ? visited.flatMap(one => (one.data ? [one.data] : [])) : (devices.data?.items ?? []), data);
  const named = useMemo(() => (plants.data?.items ?? []).map(plant => ({ id: plant.id, label: plant.label })), [plants.data]);
  const vpdHalf = chosen.metrics.includes('vpd') ? settings.vpdHalf : 'all';

  const compared = comparedSeries.data && comparedName ? { series: comparedSeries.data, name: comparedName } : undefined;
  const input = { picked: chosen, layout, offered, leaf, plants: named, compared, vpdMode: vpdHalf };
  const cards = data ? cardsOf(t, data, input) : [];
  const cameras = (data?.cameras ?? []).filter(camera => camera.frames.length > 0);

  const spaceRow = spaces.data?.items.find(space => space.id === place) ?? null;
  const subject = [spaceRow?.name ?? null, grow?.name ?? null].filter(Boolean).join(' · ');
  // A customer's place is not in the administrator's own list, so its name is read from the place itself.
  const visitedName = useSpaceOverview(spaceId ?? '', visiting).data?.name ?? '…';

  const setQuery = (over: Record<string, string | null>) => {
    const kept = new URLSearchParams(params);
    for (const [key, value] of Object.entries(over)) {
      if (value === null) kept.delete(key);
      else kept.set(key, value);
    }
    setParams(kept, { replace: true });
  };

  /** A zoom is two instants on the chart, and goes into the address with the rest of the window. */
  const zoomParam = (next: Zoom | null): Record<string, string | null> => ({ zoom: next ? `${instant(next.from)}~${instant(next.to)}` : null });

  const setRange = (next: ChartRange) => {
    setScrubbed(null);
    setLiveNow(serverNow().toMillis());
    // A range of one's own starts on the days the chart was showing, so the curves stay while the days are changed.
    const shownDays: Record<string, string | null> =
      window?.kind === 'span' && !(from && to) ? { from: zonedAt(window.from, zone).toISODate(), to: zonedAt(window.to, zone).toISODate() } : {};
    setQuery({
      ...zoomParam(null),
      range: next,
      ...(next === 'custom' ? shownDays : { from: null, to: null }),
      // Where a width was stepped back to stays where it is for another width; a grow's stretch has no such end.
      ...(isWidth(next) ? {} : { at: null }),
      ...(isStretch(next) ? {} : { compare: null }),
    });
  };

  const change = (over: Partial<ChartSettings>) =>
    setQuery({
      ...('stepSeconds' in over ? { step: over.stepSeconds ? String(over.stepSeconds) : null } : {}),
      ...('vpdHalf' in over ? { vpd: over.vpdHalf && over.vpdHalf !== 'all' ? over.vpdHalf : null } : {}),
      ...('live' in over ? { live: over.live ? '1' : null } : {}),
    });

  const toggle = <T extends string>(list: T[], one: T): T[] => (list.includes(one) ? list.filter(other => other !== one) : [...list, one]);

  /** A chip moved by hand is no longer the saved view it came from, which is what lets Save offer to keep it. */
  const pick = (over: Partial<Picked>) => {
    setQuery({ show: showOf({ ...chosen, ...over }) });
    setAppliedId(null);
  };

  const zoomTo = (next: Zoom) => {
    if (next.to - next.from < NARROWEST_ZOOM) {
      const middle = (next.from + next.to) / 2;
      next = { from: middle - NARROWEST_ZOOM / 2, to: middle + NARROWEST_ZOOM / 2 };
    }
    setQuery(zoomParam(next));
    setScrubbed(null);
  };

  /** On or back by the zoom's own width, and never past now. */
  const panZoom = (direction: -1 | 1) => {
    if (zoom === null) return;
    const width = zoom.to - zoom.from;
    const to = Math.min(liveEnd(liveNow, endedAt), zoom.to + direction * width);
    setQuery(zoomParam({ from: to - width, to }));
    setScrubbed(null);
  };

  const scrub = useScrub(setScrubbed, day ? undefined : (selection: Selection) => zoomTo(spanOfSelection(selection, left, right)));

  const definition: ChartViewDefinition = {
    deviceIds: data?.deviceIds ?? [],
    growId: grow?.id ?? null,
    metrics: chosen.metrics,
    outputs: chosen.outputs,
    measurements: chosen.measurements,
    span: spanOf(range, from, to, zone),
    layout,
    intervalSeconds: data?.stepSeconds ?? 0,
  };

  const apply = (view: ChartView) => {
    const span = rangeOfSpan(view.definition.span, zone);
    const fits = !isStretch(span.range) || grow !== null;
    setQuery({
      ...zoomParam(null),
      layout: view.definition.layout === 'stacked' ? null : view.definition.layout,
      range: fits ? span.range : '24h',
      from: span.from ?? null,
      to: span.to ?? null,
      at: null,
      show: showOf({ metrics: [...view.definition.metrics], outputs: [...view.definition.outputs], measurements: [...view.definition.measurements] }),
    });
    setAppliedId(view.id);
  };

  const saved = views.data?.items ?? [];
  const applied = saved.find(view => view.id === appliedId) ?? null;
  // A view holds a question and not a grow's readings, so one saved over another
  // run is offered here too; what this window cannot draw is named under the bar.
  const dropped = picked === null ? [] : droppedBy(t, picked, offered, definitions);
  const shownWidths: Width[] = [...EVERYDAY, ...(moreWidths ? RARE : RARE.filter(one => one === range))].sort(
    (one, other) => WIDTHS[one] - WIDTHS[other],
  );
  const end = liveEnd(liveNow, endedAt);
  // The zoom is named the way the axis under it writes its ends.
  const zoomEdges = zoom ? edgesOf(zoom.from, zoom.to, zone, end) : ['', ''];
  // A window that does not end now is a stretch somebody went looking for, and is what a link made from here offers to show.
  const fixed = window?.kind === 'span' && (zoom !== null || range === 'custom' || atParam !== null) ? window : null;
  const shareWindow = fixed
    ? { startsAt: instant(fixed.from), endsAt: instant(fixed.to), label: edgesOf(fixed.from, fixed.to, zone, end).join(' – ') }
    : null;

  const chips = (
    <>
      <div className={styles.chips} role="group" aria-label={t('charts.rangeLabel')}>
        {shownWidths.map(one => (
          <Choice key={one} chosen={zoom === null && one === range} onChoose={() => setRange(one)}>
            {t(`charts.width.${one}`)}
          </Choice>
        ))}
        <button type="button" className={`${ui.chip} ${styles.more}`} aria-expanded={moreWidths} onClick={() => setMoreWidths(!moreWidths)}>
          {t(moreWidths ? 'charts.fewerWidths' : 'charts.moreWidths')}
        </button>
        {/* The stretches a grow names are offered where a grow is, and nowhere else. */}
        {grow
          ? (['phase', 'grow'] as const).map(one => (
              <Choice key={one} chosen={zoom === null && one === range} onChoose={() => setRange(one)}>
                {t(`timeline.range.${one}`)}
              </Choice>
            ))
          : null}
        <Choice chosen={zoom === null && range === 'custom'} onChoose={() => setRange('custom')}>
          {t('charts.range.custom')}
        </Choice>
        {/* Which days the chart covers, and it covers none while the question is unfinished. */}
        {!unasked && data ? <span className={`mono ${styles.days}`}>{dayLabel(t, data)}</span> : null}
      </div>

      {zoom !== null ? (
        // A zoom moves along the window by its own width, as the old charts' navigator dragged it.
        <div className={styles.navRow} role="group" aria-label={t('charts.offsetLabel')}>
          <button type="button" className={ui.chip} aria-label={t('charts.earlier')} onClick={() => panZoom(-1)}>
            <ChevronLeft size={16} strokeWidth={1.75} aria-hidden />
          </button>
          <span className={`mono ${styles.navLabel}`}>{t('charts.zoomed', { from: zoomEdges[0], to: zoomEdges[1] })}</span>
          <button type="button" className={ui.chip} aria-label={t('charts.later')} disabled={zoom.to >= end} onClick={() => panZoom(1)}>
            <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
          </button>
          <button type="button" className={ui.chip} onClick={() => setQuery(zoomParam(null))}>
            {t('charts.resetZoom')}
          </button>
        </div>
      ) : isWidth(range) ? (
        <OffsetBar
          width={range}
          at={atParam}
          end={end}
          zone={zone}
          onAt={next => {
            setScrubbed(null);
            setQuery({ at: next === null ? null : instant(next) });
          }}
        />
      ) : null}

      {range === 'custom' && zoom === null ? (
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
            onPick={() => pick({ metrics: toggle(chosen.metrics, metric) })}
          >
            {t(`charts.metric.${metric}`, { defaultValue: metric })}
          </Pick>
        ))}
        {offered.measurements.map(measurement => (
          <Pick
            key={measurement.key}
            on={chosen.measurements.includes(measurement.key)}
            dot
            onPick={() => pick({ measurements: toggle(chosen.measurements, measurement.key) })}
          >
            {measurement.name}
          </Pick>
        ))}
        {(moreOutputs ? offered.outputs : offered.outputs.slice(0, OUTPUTS_SHOWN)).map(output => (
          <Pick key={output} on={chosen.outputs.includes(output)} colour="output" onPick={() => pick({ outputs: toggle(chosen.outputs, output) })}>
            {outputTitle(t, output, data?.outputs ?? [])}
          </Pick>
        ))}
        {offered.outputs.length > OUTPUTS_SHOWN ? (
          <button type="button" className={`${ui.chip} ${styles.more}`} aria-expanded={moreOutputs} onClick={() => setMoreOutputs(!moreOutputs)}>
            {t(moreOutputs ? 'charts.less' : 'charts.more')}
          </button>
        ) : null}
        {/* What was written, and the picture at the cursor: drawn beside the curves rather than as one of them. */}
        <Pick on={showMessages} onPick={() => setQuery({ msgs: showMessages ? null : '1' })}>
          {t('chartMessages.chip')}
        </Pick>
        {cameras.length > 0 && !day ? (
          <Pick on={showCamera} onPick={() => setQuery({ cam: showCamera ? null : '1' })}>
            {t('charts.cameraChip')}
          </Pick>
        ) : null}
      </div>

      {/* Two runs of one tent lie over each other only where the axis counts days rather than dates. */}
      {day && others.length > 0 ? (
        <div className={styles.chips} role="group" aria-label={t('charts.compareLabel')}>
          <span className="label">{t('charts.compareLabel')}</span>
          {(moreRuns ? others : others.slice(0, RUNS_SHOWN)).map(one => (
            <Choice key={one.id} chosen={one.id === comparedId} onChoose={() => setQuery({ compare: one.id === comparedId ? null : one.id })}>
              {one.name}
            </Choice>
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
            <Choice key={view.id} chosen={view.id === appliedId} onChoose={() => apply(view)}>
              {view.name}
            </Choice>
          ))}
        </div>
      ) : null}

      {dropped.length > 0 ? (
        <p className={`${ui.note} ${styles.leftOut}`}>{t('charts.notHere', { count: dropped.length, names: dropped.join(', ') })}</p>
      ) : null}
    </>
  );

  const head = <Header spaceId={spaceId} growId={grow?.id ?? null} subject={visiting ? `${visitedName} · ${t('timeline.visiting')}` : subject} />;
  const advanced = (
    <AdvancedSection
      scope="charts"
      context={{
        growId: grow?.id ?? null,
        spaceId,
        settings,
        change,
        answeredStep: data && data.stepSeconds > 0 ? data.stepSeconds : null,
        vpdDrawn: chosen.metrics.includes('vpd'),
        endsNow,
      }}
    />
  );

  // A custom range with an end still to be picked, or with its two ends the
  // wrong way round, is not a read that is on its way: it is a question nobody
  // has finished asking, and the fields say so. The chart drawn before it goes
  // with it, because it is of a window the two fields no longer show.
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
          <LoadFailed retry={series.refetch} />
        )}
      </div>
    );
  }

  const nothingOffered = offered.metrics.length === 0 && offered.outputs.length === 0 && offered.measurements.length === 0;
  const origin = data.originAt === null ? left : at(data.originAt);
  const span = right - left;
  const edge = (time: number) => (day ? dayOfGrow(time, origin) : time);
  const from_ = edge(left);
  const to_ = edge(right);
  const cursor = from_ + (scrubbed ?? 1) * (to_ - from_);
  const cursorTime = day ? left : left + (scrubbed ?? 1) * span;
  const dayOf = (x: number) => t('timeline.dayN', { day: Math.max(1, Math.floor(x)) });
  const ends: [string, string] = day ? [dayOf(from_), dayOf(to_)] : edgesOf(left, right, zone, end);
  const toCursor = (time: number) => setScrubbed(span > 0 ? Math.min(1, Math.max(0, (time - left) / span)) : null);
  // Lines where the clock and the calendar turn over; an axis that counts grow days has its own two ends and no clock.
  const ticksOf = day ? undefined : (most: number) => timeTicks(left, right, zone, most, DAY_IN_YEAR);
  const pictureOn = showCamera && cameras.length > 0 && !day;
  const messagesOn = showMessages && !day;

  return (
    // Busy while a chip's window is still on its way, or while the one that was
    // asked for failed: what is drawn is the window before it, dimmed and dated
    // rather than taken off the screen.
    <div className={styles.screen} aria-busy={series.isPlaceholderData || (series.isError && series.heldAt !== null)}>
      {head}
      {chips}
      <RefreshFailed failedAt={series.isError ? series.dataUpdatedAt || series.heldAt : null} now={now} />

      {/* Two silences, told apart by the one fact the window cannot hold: a
          place that has never measured anything, and one that measured until
          Saturday and has said nothing since, which is dated. */}
      {nothingOffered ? (
        <p className={`${ui.cardDashed} ${ui.note} ${styles.empty}`}>
          {data.lastReadingAt === null ? t('charts.noData') : t('charts.quietWindow', { age: ageLabel(data.lastReadingAt, now) })}
        </p>
      ) : null}
      {!nothingOffered && isEmpty(chosen) ? <p className={`${ui.cardDashed} ${ui.note} ${styles.empty}`}>{t('charts.nothingPicked')}</p> : null}

      {/* The picture is read beside the curves: above them on a phone, and on
          a wide screen in a column of its own next to them, so the cursor can
          be dragged with the picture in view - the old charts' half and half,
          with the curves keeping the room. The messages are on the curves'
          own time axis, under the last card at every width, so a column stands
          under the swing in the curve it belongs to. */}
      <div className={styles.stage}>
        <div className={styles.curves}>
          {cards.length > 0 ? <ScrubHeader cards={cards} cursor={cursor} stamp={day ? dayOf : x => momentStamp(x, left, right, zone, end)} /> : null}

          {cards.length > 0 && !day ? (
            <div className={styles.zoomRow}>
              <button type="button" className={ui.chip} onClick={() => zoomTo(zoomedIn(left, right, cursorTime))} disabled={span <= NARROWEST_ZOOM}>
                <Plus size={14} strokeWidth={1.75} aria-hidden />
                {t('charts.zoomIn')}
              </button>
              <Help topic="chartZoom" />
            </div>
          ) : null}

          {cards.map(card => (
            <ChartCard key={card.key} card={card} cursor={cursor} scrub={scrub.handlers} selection={scrub.selection} ends={ends} ticksOf={ticksOf} />
          ))}

          {messagesOn ? (
            <div className={styles.written}>
              <Messages
                read={entries}
                from={left}
                to={right}
                cursor={cursorTime}
                onCursor={toCursor}
                hidden={hiddenMessages}
                onHidden={next => setQuery({ hide: next.length > 0 ? next.join(',') : null })}
              />
            </div>
          ) : null}
        </div>

        {pictureOn ? (
          <aside className={styles.beside}>
            <div className={styles.picture}>
              <CameraFrame cameras={cameras} from={left} to={right} cursor={cursorTime} day={null} onScrub={toCursor} />
            </div>
          </aside>
        ) : null}
      </div>

      <div className={styles.footer}>
        <div className={ui.segments} role="group" aria-label={t('charts.layoutLabel')}>
          {LAYOUTS.filter(one => one !== 'day_of_grow' || grow !== null).map(one => (
            <button
              key={one}
              type="button"
              className={ui.segment}
              aria-pressed={one === layout}
              disabled={one === 'day_of_grow' && !dayAxis}
              onClick={() => setQuery({ layout: one === 'stacked' ? null : one })}
            >
              {t(`charts.layout.${one}`)}
            </button>
          ))}
        </div>
        {/* Counting in grow days is explained only where a grow offers it. */}
        <Help topic={grow ? 'chartLayout' : 'chartLayoutPlace'} />
        <div className={styles.footerActions}>
          {/* The demo may look at every chart and keep none: a view is written to an account, and it has not got one. */}
          {mayManage ? (
            <button type="button" className={ui.chip} onClick={() => setSheet(true)}>
              {t('charts.saveView')}
            </button>
          ) : null}
          {mayShare && (spaceRow || grow) ? (
            <button type="button" className={ui.chip} onClick={() => setSharing(true)}>
              {t('charts.share')}
            </button>
          ) : null}
          <button
            type="button"
            className={ui.chip}
            disabled={cards.length === 0}
            onClick={() =>
              saveFile(
                new Blob([csvForCards(t, data, input, zone)], { type: 'text/csv;charset=utf-8' }),
                csvName(grow?.name ?? spaceRow?.name ?? '', range),
              )
            }
          >
            {t('charts.csv')}
          </button>
        </div>
      </div>

      {advanced}

      {/* The table is the answer already in hand, so it is written at the step
          the window decided and not at the rate the devices reported at - and
          the sentence goes wherever the table goes. */}
      <p className={`${ui.note} ${styles.csvNote}`}>
        {cards.length > 0 && data.stepSeconds > 0 ? `${t('charts.csvNote', { step: stepLabel(data.stepSeconds, t) })} ` : null}
        {grow ? (
          <>
            {t('charts.exportOn')} <Link to={`/grows/${grow.id}`}>{grow.name}</Link>.
          </>
        ) : null}
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

      {sharing ? (
        <NewLinkSheet
          grows={grow ? [grow] : []}
          spaces={spaceRow ? [spaceRow] : []}
          window={shareWindow}
          onClose={() => setSharing(false)}
          onCreated={link => {
            setSharing(false);
            setShared(link);
          }}
        />
      ) : null}
      {shared ? <SharedSheet link={shared} onClose={() => setShared(null)} /> : null}
    </div>
  );
}

/**
 * Back and on by the window's own width, and where it starts, picked: the old
 * charts' date and arrows. Stepped back, the window stays there - a live chart
 * stops following now - until "up to now" brings it back. The window is named
 * between the arrows, and tapping it opens the field its start is picked in.
 */
function OffsetBar({
  width,
  at: ending,
  end,
  zone,
  onAt,
}: {
  width: Width;
  at: number | null;
  end: number;
  zone: string | null;
  onAt: (at: number | null) => void;
}) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  const span = WIDTHS[width];
  const finish = ending ?? end;
  const start = finish - span;
  const [first, last] = edgesOf(start, finish, zone, end);
  const local = (time: number) => zonedAt(time, zone).toFormat("yyyy-LL-dd'T'HH:mm");

  return (
    <>
      <div className={styles.navRow} role="group" aria-label={t('charts.offsetLabel')}>
        <button type="button" className={ui.chip} aria-label={t('charts.earlier')} onClick={() => onAt(stepped(width, ending, end, -1))}>
          <ChevronLeft size={16} strokeWidth={1.75} aria-hidden />
        </button>
        <button type="button" className={`${ui.chip} ${styles.navLabel}`} aria-expanded={picking} onClick={() => setPicking(!picking)}>
          <CalendarDays size={14} strokeWidth={1.75} aria-hidden />
          <span className="mono">
            {first} – {ending === null ? t('charts.now') : last}
          </span>
        </button>
        <button
          type="button"
          className={ui.chip}
          aria-label={t('charts.later')}
          disabled={ending === null}
          onClick={() => onAt(stepped(width, ending, end, 1))}
        >
          <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
        </button>
        {ending !== null ? (
          <button type="button" className={ui.chip} onClick={() => onAt(null)}>
            {t('charts.backToNow')}
          </button>
        ) : null}
      </div>
      {picking ? (
        <label className={styles.navPick}>
          <span className="label">{t('charts.from')}</span>
          <input
            className={`mono ${ui.input}`}
            type="datetime-local"
            value={local(start)}
            max={local(end - span)}
            onChange={event => {
              const chosen = DateTime.fromISO(event.target.value, { zone: zone ?? undefined });
              if (!chosen.isValid) return;
              const next = chosen.toMillis() + span;
              onAt(next >= end ? null : next);
            }}
          />
        </label>
      ) : null}
    </>
  );
}

/** The link a chart was just shared by, to copy, with where it can be found and taken back later. */
function SharedSheet({ link, onClose }: { link: ShareLink; onClose: () => void }) {
  const { t } = useTranslation();
  const address = linkAddress(link);

  return (
    <Sheet title={t('charts.sharedTitle')} onClose={onClose}>
      <div className={styles.shared}>
        <p className={ui.note}>{t(link.subject.type === 'space' ? 'charts.sharedSpace' : 'charts.sharedGrow')}</p>
        <code className={`mono ${styles.address}`}>{address}</code>
        <CopyButton value={address} label={t('charts.copyLink')} />
        <Link to="/me/share-links" className={`mono ${ui.headLink}`}>
          {t('charts.allLinks')} ›
        </Link>
      </div>
    </Sheet>
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
 * output, and a dash where it says nothing. A metric is written to the
 * decimals it is written to everywhere else in the app, so the column under the
 * thumb keeps its width; a grower's own measurement is written as exactly as it
 * was taken.
 */
const readingOf = (t: Translate, line: PlotLine, cursor: number, span: number): string => {
  const value = readAt(line, cursor, span);
  if (value === null) return '—';
  if (line.shape === 'step') return t(value > 0 ? 'charts.on' : 'charts.off');

  return [line.metric ? figure(value, line.metric) : looseFigure(value), value === 1 && line.unitOne ? line.unitOne : line.unit]
    .filter(Boolean)
    .join(' ');
};

/** The title, and in the corner the place and the grow it is about. */
function Header({ spaceId, growId, subject }: { spaceId: string | null; growId: string | null; subject: string }) {
  const { t } = useTranslation();
  const back = spaceId ? timelinePath(spaceId) : growId ? `/grows/${growId}` : '/';

  return (
    <header className={styles.header}>
      <BackLink to={back} label={t('charts.back')} className={styles.back} />
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
const dayLabel = (t: Translate, series: ChartData): string => {
  if (series.dayFrom === null || series.dayTo === null) return '';

  return series.dayFrom === series.dayTo
    ? t('timeline.dayN', { day: series.dayTo })
    : t('timeline.dayRange', { from: series.dayFrom, to: series.dayTo });
};

/**
 * Both ends of the window as the axis writes them, in the account's zone. They
 * have to differ - a rolling window begins and ends at the same time of day -
 * and they have to say which moment they are, so the ladder of formats is
 * climbed from the rung the width itself asks for and only then widened until
 * the two differ.
 */
const edgesOf = (from: number, to: number, zone: string | null, now: number): [string, string] => {
  const written = stamps()
    .slice(Math.max(stampForEnds(to - from), datedFrom(from, now)))
    .map(format => [zonedAt(from, zone).toFormat(format), zonedAt(to, zone).toFormat(format)] as [string, string]);

  return written.find(([one, other]) => one !== other) ?? written[written.length - 1];
};

/**
 * The rung a window that lies further back than a week is written from at the
 * least: "Di 08:00 – Mi 08:00" two weeks ago named no week at all, and the old
 * charts dated every window. A window of this week keeps the weekday, which the
 * eye places at once.
 */
const datedFrom = (from: number, now: number): number => (now - from > 6 * 24 * 60 * 60 * 1000 ? 2 : 0);

/** A moment inside the window, as the cursor writes it: by the window's width, and dated where the window lies past this week. */
const momentStamp = (time: number, from: number, to: number, zone: string | null, now: number): string =>
  zonedAt(time, zone).toFormat(stamps()[Math.max(stampFor(to - from), datedFrom(from, now))]);

/** A stretch marked on the plot, as the two instants it covers. */
const spanOfSelection = (selection: Selection, from: number, to: number): Zoom => ({
  from: from + selection.from * (to - from),
  to: from + selection.to * (to - from),
});

/**
 * What the VPD panel takes the leaf to be, and what its band is worked out
 * from. A place with two controllers set up differently draws a curve that is
 * the mean of two computations, so where they disagree the panel says nothing
 * rather than something it cannot stand behind.
 */
const leafOffsetsOf = (
  devices: readonly { id: string; settings: { vpdLeafOffsetDay: number; vpdLeafOffsetNight: number } }[],
  series: ChartData | undefined,
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

/** The fine settings as the address carries them; anything it does not recognise is the default. */
const settingsOf = (params: URLSearchParams): ChartSettings => {
  const step = Number(params.get('step'));
  const half = params.get('vpd');

  return {
    stepSeconds: STEPS.includes(step) ? step : null,
    vpdHalf: VPD_HALVES.find(one => one === half) ?? 'all',
    live: params.get('live') === '1',
  };
};

/**
 * The curves an address names: a metric by its name, an output and a grow's own
 * measurement each behind a prefix of its own, comma separated. Nothing named is
 * the board's own pick; named and empty is every curve turned off.
 */
const OUTPUT_MARK = 'out.';
const MEASUREMENT_MARK = 'm.';

const pickedOf = (value: string | null): Picked | null => {
  if (value === null) return null;
  const names = value.split(',').filter(Boolean);
  return {
    metrics: CHART_METRICS.filter(metric => names.includes(metric)),
    outputs: CHART_OUTPUTS.filter(output => names.includes(OUTPUT_MARK + output)),
    measurements: names.filter(name => name.startsWith(MEASUREMENT_MARK)).map(name => name.slice(MEASUREMENT_MARK.length)),
  };
};

const showOf = (picked: Picked): string =>
  [...picked.metrics, ...picked.outputs.map(output => OUTPUT_MARK + output), ...picked.measurements.map(key => MEASUREMENT_MARK + key)].join(',');

/** The zoom an address names, as two instants, or null where it names none or two that are not a stretch. */
const zoomOf = (value: string | null): Zoom | null => {
  const [from, to] = (value ?? '').split('~').map(momentOf);
  return from != null && to != null && from < to ? { from, to } : null;
};

/** The instant an address names, or null where it names none or something that is not one. */
const momentOf = (value: string | null): number | null => {
  if (!value) return null;
  const moment = DateTime.fromISO(value);
  return moment.isValid ? moment.toMillis() : null;
};

/** A file a grower can find again: what it is of, and over what. */
const csvName = (name: string, range: ChartRange): string => {
  const slug = name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return `${slug || 'chart'}-${range}.csv`;
};
