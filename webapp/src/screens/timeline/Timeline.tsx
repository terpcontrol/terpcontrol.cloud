import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import { hashKey, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { ChartView, Entry, GrowListItem, GrowSeriesPoint, MeasurementDefinition, ShareLink, Space, SpaceTimeline } from '@fg2/shared-types/v1';
import { useDevices } from '@/api/devices';
import { useGrow, useMeasurementSeries } from '@/api/grows';
import { useHome } from '@/api/home';
import { ApiError } from '@/api/problem';
import type { Picture } from '@/api/public';
import { useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { rangeNeedsGrow, timelineKey, useTimeline } from '@/api/timeline';
import { isPlace, SHARE_LINKS } from '@/app/places';
import { useScrub, type Selection } from '@/charts/scrub';
import type { Translate } from '@/i18n/i18n';
import { useCorrecting } from '@/log/corrections';
import { useLog } from '@/log/log-context';
import { targetsOf } from '@/log/targets';
import { NewLinkSheet } from '@/screens/me/sharing/NewLinkSheet';
import { linkAddress } from '@/screens/me/sharing/links';
import { ageLabel, instantOf, valueAge } from '@/ui/age';
import { CopyButton } from '@/ui/CopyButton';
import { saveFile } from '@/ui/download';
import { DAY_MS, startOfDayOn } from '@/ui/days';
import { decimalMark } from '@/ui/figures';
import { deviceTitle } from '@/ui/naming';
import { RefreshFailed, Waiting } from '@/ui/PageState';
import { standsIn, useMayLogIn, useMayManage, useVisiting } from '@/ui/session-access';
import { Sheet } from '@/ui/Sheet';
import { refusalText } from '@/ui/refusal';
import { readStoredJson, writeStored } from '@/ui/stored';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { useWideWindow } from '@/ui/wide-window';
import { useZone, zonedAt } from '@/ui/zone';
import { Adjust, type Comparable } from './Adjust';
import { CursorCard } from './CursorCard';
import { DiaryCard } from './DiaryCard';
import { axisEnds, cursorStamp, meanStamp, stepWords, windowLabel } from './labels';
import {
  csvFor,
  figureAt,
  nearestPoint,
  offeredOf,
  panelsOf,
  reachOf,
  readAt,
  restOf,
  silenceAt,
  singleAt,
  SAMPLE_SECONDS,
  shownOf,
  stripsOf,
  type Compared,
  type Curve,
  type OutputFigure,
  type Strip,
} from './model';
import { Axis, Panel } from './Panel';
import { Strips } from './Strips';
import {
  appliedOf,
  askOf,
  chipOf,
  dayHolding,
  definitionOf,
  GRAINED_FROM_MS,
  inside,
  isRolling,
  nextWidth,
  RANGES,
  selected,
  stepped,
  toNow,
  viewOf,
  viewParams,
  windowOf,
  withParams,
  zoomed,
  type Span,
  type View,
} from './view';
import { at } from './window';
import styles from './Timeline.module.css';

/** The curves last ticked in this browser, a convenience the address overrides. */
const CURVES_KEY = 'terp.curves';

/** The beat a window that ends now moves on by, where its width is one no chip names. */
const LIVE_BEAT_MS = 30_000;

/** What only somebody with an account in this place has: a diary to correct and write in, measurements, views, links. */
interface Own {
  measured: { definition: MeasurementDefinition; points: GrowSeriesPoint[] }[];
  devices: { id: string; name: string }[];
  comparable: Comparable[];
  /** Whether what can be laid over is read: only then is one the address names known to be gone. */
  known: boolean;
  /** Whether a view can be kept: the account that keeps it is the session's own. */
  keeps: boolean;
  sharing: { grows: GrowListItem[]; spaces: Space[] } | null;
  /** What the address named and the place does not have - a device gone, a grow that never stood here - in a sentence. */
  missing: React.ReactNode;
  /** That the place has ended and its curves are read only, in a sentence; null for a place in use. */
  ended: string | null;
  correct: (entry: Entry) => (() => void) | undefined;
  /** Opens a note dated to an instant; null where the session may not write here. */
  note: ((time: number) => void) | null;
  byline: boolean;
}

interface TimelineProps {
  spaceId: string;
  /** The page's name, and beside it on a desktop the place it is about where the account has several. */
  title: React.ReactNode;
  place?: string | null;
  /** A place of the reader's own that has ended: its curves are read, and nothing is written - no line, no link, no view. */
  ended?: boolean;
}

/**
 * Verlauf of one place: one page for every stretch of time - the last day or twenty minutes of one night three months
 * ago - with one cursor through all of it. Its whole view is in the address (`view.ts`).
 */
export function Timeline({ spaceId, title, place = null, ended = false }: TimelineProps) {
  return <OwnTimeline key={spaceId} spaceId={spaceId} title={title} place={place} ended={ended} />;
}

function OwnTimeline({ spaceId, title, place: placeName, ended = false }: TimelineProps) {
  const { t } = useTranslation();
  const { user } = useSession();
  const devices = useDevices();
  // What the address names is looked up in what the account already holds before the place is asked: a device it
  // has not got or that stands elsewhere, a grow in no place or in another, are told from here, and the server is
  // not asked a question it can only refuse. A device's curves are drawn under the place it stands in, never one it left.
  const [params] = useSearchParams();
  const named = { deviceId: params.get('device'), growId: params.get('grow') };
  const namedGrow = useGrow(named.growId);
  const vain: Vain | 'checking' | null =
    named.deviceId && !devices.data
      ? 'checking'
      : named.deviceId && !devices.data?.items.some(one => one.id === named.deviceId && one.spaceId === spaceId)
        ? { what: 'device', id: named.deviceId }
        : named.growId && namedGrow.isPending
          ? 'checking'
          : named.growId && (namedGrow.isError || (namedGrow.data && !namedGrow.data.placements.some(one => one.spaceId === spaceId)))
            ? { what: 'grow', id: named.growId }
            : null;
  const page = usePage(spaceId, null, vain);
  const visiting = useVisiting(spaceId);
  const home = useHome();
  const spaces = useSpaces();
  const correcting = useCorrecting();
  const { openDetails } = useLog();
  const mayLog = useMayLogIn(spaceId) && user?.isDemo !== true && !visiting;
  const mayManage = useMayManage(spaceId) && user?.isDemo !== true && !visiting;
  const data = page.data;
  const growId = page.view.growId ?? data?.growId ?? null;
  const grow = useGrow(growId);
  const charted = useMemo(() => (grow.data?.measurements ?? []).filter(definition => definition.chart), [grow.data]);
  const series = useMeasurementSeries(
    growId,
    'grow',
    charted.map(definition => definition.key),
  );
  // What was read of the grow while the address still named it; it is not asked again for the sentence about it.
  const lost = useQueryClient().getQueryData<GrowListItem>(['grow', page.dropped?.what === 'grow' ? page.dropped.id : null]);
  const card = (home.data?.spaces ?? []).filter(isPlace).find(one => one.spaceId === spaceId);
  const climates = (card?.climates ?? []).flatMap(climate => (climate.deviceId ? [climate.deviceId] : []));
  const target = targetsOf(home.data).find(one => one.standsIn === spaceId || one.spaceId === spaceId) ?? null;
  const spaceRow = spaces.data?.items.find(space => space.id === spaceId) ?? null;

  const own: Own = {
    measured: charted.flatMap(definition => {
      const points = series.data?.measurements.find(one => one.key === definition.key)?.points ?? [];
      return points.length > 0 ? [{ definition, points }] : [];
    }),
    devices:
      climates.length > 1
        ? climates.map(id => {
            const device = devices.data?.items.find(one => one.id === id);
            return { id, name: device ? deviceTitle(device, t, devices.data?.items ?? []) : id };
          })
        : [],
    comparable: [
      // An earlier grow is laid over by its grow days, which only a grow standing here has to line up with.
      ...(data?.growId
        ? data.grows.filter(one => one.growId !== data.growId).map(one => ({ kind: 'grow' as const, id: one.growId, name: one.name }))
        : []),
      ...(home.data?.spaces ?? [])
        .filter(isPlace)
        .filter(one => one.spaceId !== spaceId && one.deviceIds.length > 0)
        .map(one => ({ kind: 'space' as const, id: one.spaceId, name: one.name })),
    ],
    known: home.data !== undefined && data !== undefined,
    keeps: user !== null && user.isDemo !== true && !visiting && !ended,
    missing:
      page.dropped === null ? null : lost && standsIn(lost) === null ? (
        // A grow without a place has no climate to draw; what was measured by hand has its curves on its own page.
        <>
          {t('timeline.missing.growNoPlace', { name: lost.name })}{' '}
          <Link to={`/grows/${lost.id}/measurements`} className={styles.more}>
            {t('grow.measurements.title')}
            {'\u00a0›'}
          </Link>
        </>
      ) : (
        t(`timeline.missing.${page.dropped.what}`)
      ),
    ended: ended ? t('timeline.ended', { name: placeName ?? data?.name ?? '' }) : null,
    sharing: mayManage && !ended && (spaceRow || grow.data) ? { grows: grow.data ? [grow.data] : [], spaces: spaceRow ? [spaceRow] : [] } : null,
    correct: entry => (ended ? undefined : correcting(entry, { label: data?.name ?? '', spaceId })),
    note: mayLog && target && !ended ? time => openDetails('note', target, null, new Date(time)) : null,
    // The demo is answered no authors, so its lines say what was done and name nobody.
    byline: user?.isDemo !== true,
  };

  return <Screen page={page} spaceId={spaceId} title={title} place={placeName} own={own} />;
}

/**
 * The same page for somebody reading a place through a link: the last day, week or month through the link's own
 * window, with nothing of the account behind it - no grow to name, no line to correct, no view to keep. A link whose
 * window ends (`bounds`) shows that window and nothing else: it opens on the whole of it, a zoom stays inside it,
 * and no chip, arrow or "jetzt" offers a stretch it does not hold.
 */
export function SharedTimeline({
  spaceId,
  shared,
  title,
  bounds = null,
}: {
  spaceId: string;
  shared: { token: string; picture: Picture };
  title: React.ReactNode;
  bounds?: Span | null;
}) {
  const page = usePage(spaceId, shared.token, null, bounds);
  return <Screen page={page} spaceId={spaceId} title={title} place={null} own={null} picture={shared.picture} />;
}

/** What an address names and the place does not have. */
interface Vain {
  what: 'device' | 'grow';
  id: string;
}

/** The view the address names, the answer to it, and the one way the view is changed. */
const usePage = (spaceId: string, share: string | null, vain: Vain | 'checking' | null = null, bounds: Span | null = null) => {
  const [params, setParams] = useSearchParams();
  const now = useNow();
  const view = useMemo(() => viewOf(params), [params]);
  const beat = Math.floor(now.toMillis() / LIVE_BEAT_MS) * LIVE_BEAT_MS;
  // A link's window that has not ended yet is shown up to now, and never said to end "jetzt".
  const confined = bounds && { from: bounds.from, to: Math.min(bounds.to, beat) };
  // A link without a start is opened on the last day before its end.
  const whole = confined && (Number.isFinite(confined.from) ? confined : { from: confined.to - DAY_MS, to: confined.to });
  const asked = confined && whole ? { ...inside(view.fixed ?? whole, confined), live: false } : windowOf(view, beat);
  // Keyed by its two ends, so the clock moving on does not ask again for a window that stands still.
  const ask = useMemo(
    () => askOf(confined ? { ...view, range: '24h', growId: null } : view, asked, share),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `asked` is new every render; its ends are what it is
    [view, asked?.from, asked?.to, asked?.live, share],
  );
  // Held back while what the address names is looked up, and for good where it names something in vain.
  const timeline = useTimeline(spaceId, vain === null ? ask : null);
  // Inside a link's window every change of the stretch - a zoom, a day, the way to a last reading - stands still in it.
  const held = (over: Partial<View>): Partial<View> => {
    if (!confined || !('fixed' in over || 'last' in over || 'range' in over)) return over;
    const next = windowOf({ ...view, ...over }, beat);
    return { ...over, range: '24h', last: null, fixed: next ? inside(next, confined) : null };
  };
  const change = (over: Partial<View>) => {
    if (over.show && share === null) writeStored(CURVES_KEY, JSON.stringify(over.show));
    setParams(withParams(params, viewParams(held(over))), { replace: true });
  };

  // What was last ticked in this browser stands in for an address that names no curves, and is written into it:
  // an address copied from here then draws the same curves anywhere. A reader through a link keeps nothing.
  const bare = share === null && view.show === null;
  useEffect(() => {
    const kept = bare ? readStoredJson<unknown>(CURVES_KEY) : null;
    if (Array.isArray(kept)) change({ show: kept.filter((key): key is string => typeof key === 'string') });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per bare address
  }, [bare]);

  // A window whose read fails keeps the last picture: the answer before it stays drawn, with the chips and arrows
  // that lead away from the window that would not load.
  const [before, setBefore] = useState<SpaceTimeline | null>(null);
  const fresh = timeline.data !== undefined && !timeline.isPlaceholderData ? timeline.data : null;
  if (fresh && fresh !== before) setBefore(fresh);
  // Which window would not load, and why - held here, since a query asked again goes back to "pending" with no
  // error and the notice would blink away while it tries. It goes when a read succeeds, this window's or another's.
  const asking = hashKey(timelineKey(spaceId, ask));
  const [refusal, setRefusal] = useState<{ asking: string; error: unknown } | null>(null);
  if (timeline.isError && timeline.data === undefined && (refusal?.asking !== asking || refusal.error !== timeline.error)) {
    setRefusal({ asking, error: timeline.error });
  }
  if (refusal !== null && (fresh !== null || refusal.asking !== asking)) setRefusal(null);
  const failed = refusal?.asking === asking && fresh === null;

  // A cursor the address sets after now stands in no window: it is dropped, and the page rests where it would.
  // Nor does one outside the window that is drawn: the card would read another instant than the address names.
  const ahead =
    view.at !== null &&
    (view.at > now.toMillis() + LIVE_BEAT_MS || (fresh !== null && (view.at < at(fresh.startsAt) || view.at > at(fresh.endsAt) + LIVE_BEAT_MS)));
  useEffect(() => {
    if (ahead) change({ at: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per such address
  }, [ahead]);

  // A device or a grow the address names and the place does not have: the place's own Verlauf, and a sentence.
  const [dropped, setDropped] = useState<Vain | null>(null);
  const refused = failed && refusal.error instanceof ApiError ? refusal.error.problem.code : null;
  // Known beforehand, or - a grow the account could not be asked about - by the server's refusal.
  const gone: Vain | null =
    vain !== null && vain !== 'checking' ? vain : refused === 'grow_not_found' && view.growId ? { what: 'grow', id: view.growId } : null;
  if (gone && gone.id !== dropped?.id) setDropped(gone);
  useEffect(() => {
    if (gone?.what === 'device') change({ deviceId: null });
    else if (gone?.what === 'grow') change({ growId: null, ...(isRolling(view.range) ? {} : { range: '24h' }) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per refusal
  }, [gone?.id]);

  return {
    view,
    asked,
    timeline,
    // The window that failed keeps the picture before it for as long as it is asked again.
    data: failed ? (before ?? undefined) : timeline.data,
    failed,
    refusal: failed ? refusal.error : null,
    dropped,
    change,
    now,
    clock: beat,
    confined,
  };
};

function Screen(props: TimelineProps & { page: ReturnType<typeof usePage>; own: Own | null; picture?: Picture }) {
  const { page, spaceId, title, place, own, picture } = props;
  const { t } = useTranslation();
  const zone = useZone();
  const wide = useWideWindow();
  const columns = useTwoColumns();
  const { view, asked, timeline, data, failed, refusal, change, now, clock, confined } = page;
  // The cursor is what the address says. Only while a mouse or a thumb moves it, and from being set down until the
  // address has followed, is it held here; a change of the address's own cursor clears it: the bar leaves none behind.
  const [scrubbed, setScrubbed] = useState<number | null>(null);
  const [addressed, setAddressed] = useState(view.at);
  if (addressed !== view.at) {
    setAddressed(view.at);
    setScrubbed(null);
  }
  const [adjusting, setAdjusting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [link, setLink] = useState<ShareLink | null>(null);
  const screen = useRef<HTMLDivElement>(null);
  const focused = useRef<string | null>(null);

  // What is laid over is read once the window is known, moved onto the other run's own days.
  const window = data ? { from: at(data.startsAt), to: at(data.endsAt) } : null;
  const here = data?.grows.find(one => one.growId === data.growId) ?? null;
  const other = view.compare?.kind === 'grow' ? (data?.grows.find(one => one.growId === view.compare?.id) ?? null) : null;
  const shift = here && other ? at(here.startedAt) - at(other.startedAt) : 0;
  const comparedTo = own?.comparable.find(one => one.kind === view.compare?.kind && one.id === view.compare.id) ?? null;
  const comparing = comparedTo !== null && window !== null && (comparedTo.kind === 'space' || other !== null);
  const laid = useTimeline(
    comparing ? (view.compare?.kind === 'space' ? view.compare.id : spaceId) : null,
    comparing && window && data
      ? {
          range: '24h',
          growId: other?.growId ?? null,
          from: instantOf(zonedAt(window.from - shift, 'UTC')),
          to: instantOf(zonedAt(window.to - shift, 'UTC')),
          stepSeconds: data.stepSeconds || null,
          follows: false,
        }
      : null,
  );
  const compared: Compared | null = useMemo(() => (comparing && laid.data ? { data: laid.data, shift } : null), [comparing, laid.data, shift]);

  // Whether the window drawn ends now: the one asked for does, or it is a grow's own stretch that reaches the clock.
  // The picture kept under a window that would not load is still the one it was: it ended now, and reads so.
  const live = asked && !failed ? asked.live : window !== null && window.to >= clock - 2 * LIVE_BEAT_MS;
  // The device's last reading, the same for every reader, closes the curves of any window that holds it. It is
  // "jetzt" while the server calls it fresh and "letzter Wert" with its own time once stale: the mark Start goes by.
  const reading = data?.reading ?? null;
  const lastHeard =
    reading && window && at(reading.measuredAt) >= window.from && at(reading.measuredAt) <= window.to + 2 * LIVE_BEAT_MS
      ? at(reading.measuredAt)
      : null;
  // A place of outputs alone has a reading without values, which is as old as its instant says.
  const heard = reading && reading.values.length === 0 ? [{ measuredAt: reading.measuredAt, state: 'live' as const }] : (reading?.values ?? []);
  const fresh = heard.some(value => valueAge(value, now) === 'live');
  const reads = useMemo(
    () => (reading && lastHeard !== null ? { values: reading.values, silentSince: fresh ? null : lastHeard } : null),
    [reading, fresh, lastHeard],
  );

  const measured = own?.measured;
  const model = useMemo(() => {
    if (!data) return null;
    const offered = offeredOf(data, measured ?? []);
    const shown = shownOf(view.show, offered, view.focus);
    const strips = stripsOf(t, data, { zone, live, quietAt: reads?.silentSince ?? null });
    return {
      offered,
      shown,
      strips,
      ...panelsOf(t, data, strips, {
        shown,
        one: view.one,
        vpdHalf: view.vpdHalf,
        measured: measured ?? [],
        compared,
        now: reads,
        restUnderLast: wide,
      }),
    };
  }, [data, measured, view.show, view.focus, view.one, view.vpdHalf, compared, reads, wide, t, zone, live]);

  // Once per focus, when what it names is drawn: scrolling again on every refresh would take the page from under a thumb.
  useEffect(() => {
    if (!view.focus || !model || focused.current === view.focus) return;
    const target = screen.current?.querySelector<HTMLElement>('[data-focus]');
    if (!target) return;
    focused.current = view.focus;
    target.scrollIntoView?.({ block: 'center' });
  }, [view.focus, model]);

  // At rest the cursor stands on the last thing that was heard (`restOf`), and the card and every head read it there.
  const stepMs = Math.max(data?.stepSeconds ?? 0, 1) * 1000;
  const curves = model?.panels.flatMap(panel => panel.curves) ?? [];
  const rest = model && window ? restOf(curves, model.strips, window.to, stepMs, lastHeard) : (window?.to ?? clock);
  // Rest is the reading's instant, which in a window that reaches now is up to a beat past its end: only a cursor
  // somebody set is held inside the window - clamped there, a zoom's card read a point's mean as "letzter Wert".
  const set = scrubbed ?? view.at;
  const cursor = window && set !== null ? Math.min(window.to, Math.max(window.from, set)) : rest;
  const toTime = (fraction: number) => (window ? window.from + fraction * (window.to - window.from) : clock);

  // Another window or another cursor in the address: what was scrubbed gives way to it.
  const go = (over: Partial<View> | null) => {
    setScrubbed(null);
    if (over) change(over);
  };

  const gestures = useScrub({
    onCursor: fraction => setScrubbed(toTime(fraction)),
    // The address follows a moment later, so the cursor stays where it was set down rather than springing back first.
    onPlace: fraction => {
      setScrubbed(toTime(fraction));
      change({ at: toTime(fraction) });
    },
    onLeave: () => setScrubbed(null),
    onZoom: (selection: Selection) => go(window ? selected(window, selection, view.at, clock) : null),
  });

  // The window the address names, which a second tap steps on from before the first one's answer is back; a grow's
  // stretch is known by its answer alone.
  const named = asked ?? (window ? { ...window, live } : null);
  // Today up to now is stepped as the day it is: back to the whole of yesterday.
  const whole = named && view.fixed && named.live ? { ...view.fixed, live: true } : named;
  const zoom = (direction: -1 | 1, around: number | null = view.at) => go(named ? zoomed(named, view.at, direction, clock, around) : null);
  const step = (direction: -1 | 1) => go(whole ? stepped(whole, direction, clock) : null);
  const width = named ? named.to - named.from : 0;
  const growId = view.growId ?? data?.growId ?? null;
  const chip = chipOf(view, asked);
  // An arrow is named as a person says it: by the chip's words, by whole days, and else as the stretch before and after.
  const days = chip === null && width > 0 && width % DAY_MS === 0 ? width / DAY_MS : null;
  const span = days !== null ? t('grow.days', { count: days }) : chip !== null && isRolling(chip) ? t(`timeline.range.${chip}`) : null;
  const stepName = (direction: -1 | 1): string =>
    span === null
      ? t(direction < 0 ? 'timeline.stretchBefore' : 'timeline.stretchAfter')
      : t(direction < 0 ? 'timeline.earlier' : 'timeline.later', { span });
  const ranges = confined ? [] : RANGES.filter(range => isRolling(range) || (own !== null && growId !== null));
  // Inside a link's window the zoom goes no wider than the window.
  const widest = (direction: -1 | 1) => direction < 0 && confined !== null && width >= confined.to - confined.from - 1000;
  // Said only where points are drawn: a window nothing was measured in has no step to speak of.
  const stepDrawn = data && data.stepSeconds > 0 && data.panels.length > 0 && !failed ? data.stepSeconds : null;
  const zoomButtons = ([-1, 1] as const).map(direction => (
    <button
      key={direction}
      type="button"
      className={styles.navButton}
      disabled={!named || nextWidth(width, direction) === null || widest(direction)}
      aria-label={t(direction < 0 ? 'timeline.zoomOut' : 'timeline.zoomIn')}
      onClick={() => zoom(direction)}
    >
      {direction < 0 ? <Minus size={20} strokeWidth={2} aria-hidden /> : <Plus size={20} strokeWidth={2} aria-hidden />}
    </button>
  ));
  // The zoom stays with the cursor's card, which stays in sight; only a window with no cursor to read keeps it in the head.
  const cursorShown = data !== undefined && (data.panels.length > 0 || data.outputs.length > 0);

  const adjustButton = (
    <button type="button" className={styles.adjustButton} disabled={!model} onClick={() => setAdjusting(true)}>
      {t('timeline.adjust.title')}
    </button>
  );
  // What is read first is reached first: "Anpassen" beside the title where the head is three rows, and last where it
  // is one - after the ranges and the window, as it stands at that row's end.
  const head = (
    <header className={styles.head}>
      <div className={styles.title}>
        {title}
        {place ? <span className={styles.place}>{place}</span> : null}
      </div>
      {columns ? null : adjustButton}
      {/* A place with several climates draws one of them - its own, unless another is chosen here. */}
      {own && own.devices.length > 1 ? (
        <label className={styles.device}>
          <span>{t('timeline.device')}</span>
          <select value={view.deviceId ?? data?.deviceId ?? ''} onChange={event => change({ deviceId: event.target.value || null })}>
            {own.devices.map(device => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {ranges.length > 0 ? (
        <div className={styles.ranges} role="group" aria-label={t('timeline.rangeLabel')}>
          {ranges.map(range => (
            <button
              key={range}
              type="button"
              className={styles.range}
              aria-pressed={range === chip}
              onClick={() => go({ range, fixed: null, last: null, at: null, growId: rangeNeedsGrow(range) ? growId : null })}
            >
              {t(`timeline.range.${range}`)}
            </button>
          ))}
        </div>
      ) : null}
      <div className={styles.nav} role="group" aria-label={t('timeline.navLabel')}>
        {confined ? null : (
          <button type="button" className={styles.navButton} disabled={!named} aria-label={stepName(-1)} onClick={() => step(-1)}>
            <ChevronLeft size={20} strokeWidth={2} aria-hidden />
          </button>
        )}
        <span className={styles.window}>
          {/* Under a window that would not load, the name is of the picture that is drawn. */}
          {failed && window
            ? windowLabel(t, window, live, now, zone, confined !== null)
            : named
              ? windowLabel(t, named, named.live, now, zone, confined !== null)
              : '…'}
          <small>
            {[
              data && data.dayFrom !== null && data.dayTo !== null && !timeline.isPlaceholderData && !failed
                ? data.dayFrom === data.dayTo
                  ? t('timeline.dayN', { day: data.dayTo })
                  : t('timeline.dayRange', { from: data.dayFrom, to: data.dayTo })
                : null,
              // How far apart the points are, said once and quietly: a point of a day is three minutes, not a sample.
              stepDrawn !== null && !timeline.isPlaceholderData ? stepWords(t, stepDrawn) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </small>
        </span>
        {confined ? null : (
          <button type="button" className={styles.navButton} disabled={!named || named.live} aria-label={stepName(1)} onClick={() => step(1)}>
            <ChevronRight size={20} strokeWidth={2} aria-hidden />
          </button>
        )}
        {/* The marked way back, wherever the arrows and the zoom led. */}
        {named && !named.live && !confined ? (
          <button type="button" className={styles.toNow} onClick={() => go(toNow(named, clock))}>
            {t('timeline.toNow')}
          </button>
        ) : null}
        {cursorShown || !data ? null : zoomButtons}
      </div>
      {columns ? adjustButton : null}
    </header>
  );

  const notice = (said: string) => (
    <div className={styles.failed} role="alert">
      <p className={ui.problem}>{said}</p>
      <button type="button" className={ui.button} disabled={timeline.isFetching} onClick={() => void timeline.refetch()}>
        {t(timeline.isFetching ? 'timeline.retrying' : 'home.retry')}
      </button>
    </div>
  );

  if (!data || !model || !window) {
    return (
      <div className={styles.screen}>
        {head}
        {failed
          ? // Nothing was ever drawn here: one sentence - whether the server answered or there is no connection - and the way to ask again.
            notice(refusalText(refusal))
          : [2, 4, 4].map((lines, index) => <Waiting key={index} lines={lines} />)}
      </div>
    );
  }

  const { shown, panels, rest: loose, strips } = model;
  const heardAs = reading && lastHeard !== null ? { at: lastHeard, values: reading.values } : null;
  const resting = scrubbed === null && view.at === null;
  // Two figures in one unit - the air's and the leaf's degrees - are told apart by name.
  const shared = new Set(curves.map(curve => curve.unit).filter((unit, index, all) => unit !== '' && all.indexOf(unit) !== index));
  const said = new Map((reading?.outputs ?? []).map(one => [one.output, { share: one.on ? 1 : 0, level: one.level }]));
  const ticked = strips.filter(strip => (strip.output === 'light' ? shown.light : shown.outputs));
  const timed = (time: number) => cursorStamp(time, window, 60, zone);
  // One point under a cursor, for the card and every head (`readAt`): a value from an older instant says when, and
  // on the reading each output is what the reading says - else what that point's samples came to.
  const cardAt = (time: number) => {
    // In a silence the answer names nothing is read: the cursor snaps to no neighbour's mean. Rest on the reading is none.
    const quiet = time === heardAs?.at ? null : silenceAt(data, time);
    const { at: stood, onReading, points } = readAt(curves, time, curve => (quiet ? 0 : reachOf(data, curve)), heardAs);
    const read = points.map(one => {
      const figure = one.value === null ? '—' : `${one.curve.written(one.value)}\u00a0${one.curve.unit}`.trim();
      return { ...one, written: one.saidAt === null ? figure : `${figure} · ${timed(one.saidAt)}` };
    });
    const figures = ticked.map(strip => (onReading ? (said.get(strip.output) ?? null) : quiet ? null : figureAt(strip, stood ?? time, stepMs)));
    return {
      quiet,
      stood,
      onReading,
      read,
      // A dash is never without its name; nor is a value with its own time.
      readings: read.map(one =>
        shared.has(one.curve.unit) || one.value === null || one.saidAt !== null ? `${one.curve.name} ${one.written}` : one.written,
      ),
      outputs: ticked.map((strip, index) => outputWords(t, strip, figures[index])),
      silent: !onReading && read.every(one => one.value === null) && figures.every(figure => figure === null),
    };
  };
  const under = cardAt(cursor);
  const { stood, onReading } = under;
  // What the card and the heads say at rest holds their room, whatever the cursor reads.
  const calm = resting ? under : cardAt(rest);
  const read = under.read.map((one, index) => ({ ...one, rest: calm.read[index].written }));
  // A silence is said once, with the ends its samples have, and not as a row of dashes: in the card's two rows, or in its one.
  const [since, until] = (under.quiet ?? []).map(time => time && cursorStamp(time, window, data.stepSeconds, zone));
  const quiet = since || until ? [t(`timeline.silence.${since ? (until ? 'between' : 'since') : 'until'}`, { from: since, to: until })] : [];
  const two = calm.outputs.length > 0;
  const rows = under.silent ? { readings: [t('timeline.silence.none'), ...(two ? [] : quiet)], outputs: two ? quiet : [] } : under;
  // The reading is said as what it is, with its own time; so is whatever else a live window rests on. A point of a
  // wider step is the mean of its window, and says over which - without the word where it holds one sample.
  const stamp = onReading
    ? t(fresh ? 'timeline.nowAt' : 'timeline.lastValue', { time: timed(lastHeard ?? cursor) })
    : resting && live
      ? t('timeline.lastValue', { time: timed(cursor) })
      : stood !== null && data.stepSeconds > SAMPLE_SECONDS
        ? meanStamp(t, stood, window, data.stepSeconds, zone, !singleAt(strips, stood, stepMs), overOf(curves, stood))
        : cursorStamp(stood ?? cursor, window, data.stepSeconds, zone);
  // The room beside every plot is as wide as the longest figure of any scale: the plots share one time axis.
  const gutter =
    Math.max(4, ...curves.flatMap(curve => [curve.corner(curve.line.scale.low).length, curve.corner(curve.line.scale.high).length])) * 6.5 + 12;

  const ends = axisEnds(t, window, live, zone);
  const nothing = data.panels.length === 0 && data.outputs.length === 0;
  const light = loose.find(strip => strip.output === 'light') ?? null;
  const setCursor = (time: number) => go({ at: Math.min(window.to, Math.max(window.from, time)) });
  const firstDay = zonedAt(window.from, zone).toFormat('yyyy-MM-dd');
  const saveCsv = () => {
    const closing = curves.find(curve => curve.lastAt !== null)?.lastAt ?? null;
    const text = csvFor(t, panels, ticked, stepMs, closing, said, zone, decimalMark() === ',');
    saveFile(new Blob([text], { type: 'text/csv;charset=utf-8' }), `${slug(data.name) || 'verlauf'}-${firstDay}.csv`);
  };

  const cursorCard = (
    <CursorCard
      stamp={stamp}
      readings={rows.readings}
      outputs={rows.outputs}
      held={calm}
      zoom={zoomButtons}
      cameras={data.cameras.filter(camera => camera.frames.length > 0)}
      cursor={cursor}
      resting={view.at === null}
      onCursor={setCursor}
      picture={picture}
      linked={own !== null}
    />
  );

  const diary =
    shown.diary || shown.machine ? (
      <DiaryCard
        data={data}
        shown={shown}
        now={now}
        onCursor={setCursor}
        correct={own?.correct}
        byline={own?.byline ?? false}
        note={own?.note && view.at !== null ? { at: cursorStamp(view.at, window, 60, zone), write: () => own.note?.(view.at as number) } : null}
      />
    ) : null;

  return (
    // Busy while another window is on its way: what is drawn is the one before it, dimmed rather than taken away.
    <div
      className={styles.screen}
      ref={screen}
      aria-busy={timeline.isPlaceholderData && !failed}
      style={{ '--gutter': `${gutter}px` } as React.CSSProperties}
    >
      {head}
      {failed ? (
        // The picture is the window before: this one would not load, for the reason said, and can be asked for again.
        notice(`${t('timeline.windowFailed')} ${refusalText(refusal)}`)
      ) : (
        <RefreshFailed failedAt={timeline.isError ? timeline.dataUpdatedAt : null} now={now} />
      )}
      {own?.ended ? <p className={`${ui.cardDashed} ${ui.note}`}>{own.ended}</p> : null}
      {own?.missing ? <p className={`${ui.cardDashed} ${ui.note}`}>{own.missing}</p> : null}
      {view.compare !== null && own?.known && comparedTo === null ? (
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('timeline.missing.compare')}</p>
      ) : null}
      {compared ? (
        <p className={styles.compared}>
          <span aria-hidden className={styles.dashes} />
          {t('timeline.comparedWith', { name: comparedTo?.name ?? '' })}
          <button type="button" className={styles.more} onClick={() => change({ compare: null })}>
            {t('timeline.comparedEnd')}
          </button>
        </p>
      ) : null}

      <div className={styles.stage} data-busy={timeline.isPlaceholderData || failed || undefined}>
        {/* In one column the cursor's card stands over the panels, and is reached before them; beside them it is the
            second column's head. */}
        {nothing || columns ? null : cursorCard}
        <div className={styles.curves}>
          {nothing ? (
            <Nothing
              data={data}
              now={now}
              // The moment alone: the view gives it its own day around it, and never a window past now.
              toLast={time => change({ range: '24h', fixed: null, last: null, at: time })}
            />
          ) : null}
          {panels.map((panel, index) => (
            <Panel
              key={panel.key}
              explain={index === 0}
              panel={panel}
              cursor={cursor}
              read={read.filter(one => panel.curves.includes(one.curve))}
              ends={ends}
              stamp={stamp}
              scrub={gestures.handlers}
              selection={gestures.selection}
              onNudge={to => (to === 'end' ? change({ at: null }) : setCursor(to === 'start' ? window.from : cursor + to * stepMs))}
              onWheelZoom={(direction, fraction) => zoom(direction, toTime(fraction))}
              focus={view.focus}
              stepMs={stepMs}
              resting={resting}
              comparedAt={
                compared
                  ? key => {
                      const line = panel.plot.lines.find(one => one.key === `${key}~compared`);
                      return line
                        ? ((nearestPoint(line.points, cursor, Math.max(compared.data.stepSeconds, 1) * 1500)?.[1] as number | undefined) ?? null)
                        : null;
                    }
                  : undefined
              }
            />
          ))}
          {loose.length > 0 ? (
            <section className={styles.card} data-focus={(view.focus === 'light' && light !== null) || undefined}>
              <header className={styles.panelHead}>
                <h2>{t(loose.length === 1 && light ? 'timeline.output.light' : light ? 'timeline.lightAndOutputs' : 'timeline.adjust.outputs')}</h2>
              </header>
              <Strips strips={loose} from={window.from} to={window.to} stepMs={stepMs} cursor={resting ? null : cursor} focus={view.focus} />
              {panels.length === 0 ? <Axis from={window.from} to={window.to} ends={ends} /> : null}
            </section>
          ) : null}
        </div>
        <aside className={styles.beside}>
          {nothing || !columns ? null : cursorCard}
          {diary}
          {wide && panels.length > 0 ? <p className={styles.hint}>{t('timeline.mouseHint')}</p> : null}
        </aside>
      </div>

      {adjusting ? (
        <Adjust
          view={view}
          offered={model.offered}
          shown={shown}
          change={change}
          stepDrawn={data.stepSeconds}
          grained={window.to - window.from > GRAINED_FROM_MS}
          comparable={own?.comparable ?? []}
          views={
            own?.keeps
              ? {
                  definition: definitionOf(view, {
                    ...shown,
                    outputs: ticked.map(strip => strip.output),
                    deviceIds: data.deviceIds ?? [],
                    growId: data.growId,
                  }),
                  apply: (kept: ChartView) => change(appliedOf(kept, growId)),
                }
              : null
          }
          day={{
            shown: firstDay,
            first: confined && Number.isFinite(confined.from) ? zonedAt(confined.from, zone).toFormat('yyyy-MM-dd') : undefined,
            last: zonedAt(confined?.to ?? clock, zone).toFormat('yyyy-MM-dd'),
            // That day of the calendar; today's is shown up to now.
            jump: day =>
              go({ range: '24h', growId: null, fixed: dayHolding(startOfDayOn(day, zone).getTime() + 12 * 3600_000, zone), last: null, at: null }),
          }}
          onShare={own?.sharing ? () => (setAdjusting(false), setSharing(true)) : null}
          onCsv={curves.length + strips.length > 0 ? saveCsv : null}
          onClose={() => setAdjusting(false)}
        />
      ) : null}
      {sharing && own?.sharing ? (
        <NewLinkSheet
          grows={own.sharing.grows}
          spaces={own.sharing.spaces}
          // The window on screen is named and offered; one that stands still is a stretch somebody went looking for, and is what the link shows unless they take the whole.
          window={
            window
              ? { startsAt: data.startsAt, endsAt: data.endsAt, label: windowLabel(t, window, false, now, zone), fixed: view.fixed !== null }
              : null
          }
          first="space"
          onClose={() => setSharing(false)}
          onCreated={made => (setSharing(false), setLink(made))}
        />
      ) : null}
      {link ? (
        <Sheet title={t('timeline.shared.title')} onClose={() => setLink(null)}>
          <div className={styles.shared}>
            <code>{linkAddress(link)}</code>
            <CopyButton value={linkAddress(link)} label={t('timeline.shared.copy')} />
            <Link to={SHARE_LINKS} className={styles.more}>
              {t('timeline.shared.all')}
              {'\u00a0›'}
            </Link>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}

/**
 * A window with no curve and no strip, said as what it is: a place that measures and was not heard in this window -
 * dated, with the way to its last reading -, one whose device has sent nothing yet, or one where nothing measures.
 * Only the answer's `lastReadingAt` and devices tell them apart.
 */
function Nothing({ data, now, toLast }: { data: SpaceTimeline; now: ReturnType<typeof useNow>; toLast: (time: number) => void }) {
  const { t } = useTranslation();
  const last = data.lastReadingAt;

  return (
    <div className={`${ui.cardDashed} ${styles.nothing}`}>
      <p className={ui.note}>
        {last !== null
          ? t('timeline.quietWindow', { age: ageLabel(last, now) })
          : (data.deviceIds ?? []).length > 0
            ? t('timeline.waiting')
            : t('timeline.noDevice')}
      </p>
      {last !== null ? (
        <button type="button" className={styles.more} onClick={() => toLast(at(last))}>
          {t('timeline.toLast')}
          {'\u00a0›'}
        </button>
      ) : null}
    </div>
  );
}

/**
 * What an output did at the cursor, in one form per output: one driven at a level in per cent - over a point, its
 * mean level - and "aus" at none, as on Start; a switch on or off, and over a point it ran in part of, the share.
 * A dash where nobody heard of it.
 */
const outputWords = (t: Translate, strip: Strip, said: OutputFigure | null): string => {
  if (said === null) return `${strip.name} —`;
  if (said.level !== null && said.share > 0) return `${strip.name} ${Math.max(1, Math.round(said.level))}\u00a0%`;
  const part = said.share > 0 && said.share < 1;
  return `${strip.name} ${part ? t('timeline.partlyOn', { share: Math.max(1, Math.round(said.share * 100)) }) : t(said.share > 0 ? 'timeline.on' : 'timeline.off')}`;
};

/** Whether the page stands in two columns, as `Timeline.module.css` lays it out from 1200 px: a browser without `matchMedia` - a test's - is one. */
const TWO_COLUMNS = '(min-width: 1200px)';

const useTwoColumns = (): boolean => {
  const [two, setTwo] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(TWO_COLUMNS).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(TWO_COLUMNS);
    const onChange = () => setTwo(query.matches);
    query.addEventListener('change', onChange);
    onChange();
    return () => query.removeEventListener('change', onChange);
  }, []);
  return two;
};

/** The stretch the point at an instant stands for, where a silence or the read's end left less than its window. */
const overOf = (curves: readonly Curve[], time: number): Span | null =>
  curves.map(curve => curve.over?.get(time)).find(one => one !== undefined) ?? null;

/** A file name a grower finds again: the place's name without what a file system trips on. */
const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[äöüß]/g, letter => ({ ä: 'ae', ö: 'oe', ü: 'ue' })[letter] ?? 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
