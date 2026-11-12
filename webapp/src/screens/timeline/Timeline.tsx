import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type {
  CardValue,
  ChartView,
  Entry,
  GrowListItem,
  GrowSeriesPoint,
  MeasurementDefinition,
  ShareLink,
  Space,
  SpaceTimeline,
} from '@fg2/shared-types/v1';
import { useDevices } from '@/api/devices';
import { useGrow, useMeasurementSeries } from '@/api/grows';
import { useHome } from '@/api/home';
import { ApiError } from '@/api/problem';
import type { Picture } from '@/api/public';
import { useSession } from '@/api/session';
import { useSpaceLive, useSpaces } from '@/api/spaces';
import { rangeNeedsGrow, useTimeline } from '@/api/timeline';
import { isPlace, SHARE_LINKS } from '@/app/places';
import { useScrub, type Selection } from '@/charts/scrub';
import type { Translate } from '@/i18n/i18n';
import { useCorrecting } from '@/log/corrections';
import { useLog } from '@/log/log-context';
import { targetsOf } from '@/log/targets';
import { NewLinkSheet } from '@/screens/me/sharing/NewLinkSheet';
import { linkAddress } from '@/screens/me/sharing/links';
import { ageLabel, durationLabel, instantOf, valueAge } from '@/ui/age';
import { CopyButton } from '@/ui/CopyButton';
import { saveFile } from '@/ui/download';
import { startOfDayOn } from '@/ui/days';
import { decimalMark } from '@/ui/figures';
import { deviceTitle } from '@/ui/naming';
import { LoadFailed, RefreshFailed, Refused, Waiting } from '@/ui/PageState';
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
  nearestPoint,
  offeredOf,
  panelsOf,
  quietSince,
  reachOf,
  SAMPLE_SECONDS,
  shareOf,
  shownOf,
  stateAt,
  stripsOf,
  type Compared,
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
}

/**
 * Verlauf of one place: one page for every stretch of time - the last day or
 * twenty minutes of one night three months ago - with one cursor through all
 * of it. Its whole view is in the address (`view.ts`).
 */
export function Timeline({ spaceId, title, place = null }: TimelineProps) {
  return <OwnTimeline key={spaceId} spaceId={spaceId} title={title} place={place} />;
}

function OwnTimeline({ spaceId, title, place: placeName }: TimelineProps) {
  const { t } = useTranslation();
  const { user } = useSession();
  const page = usePage(spaceId, null);
  const visiting = useVisiting(spaceId);
  const home = useHome();
  const devices = useDevices();
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
  // The read Start lays over its readings every half minute: one `last()`, under the same key.
  const reads = useSpaceLive(spaceId, true).data;
  const lost = useGrow(page.dropped?.what === 'grow' ? page.dropped.id : null).data;
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
    keeps: user !== null && user.isDemo !== true && !visiting,
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
    sharing: mayManage && (spaceRow || grow.data) ? { grows: grow.data ? [grow.data] : [], spaces: spaceRow ? [spaceRow] : [] } : null,
    correct: entry => correcting(entry, { label: data?.name ?? '', spaceId }),
    note: mayLog && target ? time => openDetails('note', target, null, new Date(time)) : null,
    // The demo is answered no authors, so its lines say what was done and name nobody.
    byline: user?.isDemo !== true,
  };

  // What the device drawn reads now, as Start says it: the climate asked for, else the place's own.
  const drawn = reads?.devices.find(one => one.deviceId === (page.view.deviceId ?? data?.deviceId));
  return <Screen page={page} spaceId={spaceId} title={title} place={placeName} own={own} values={drawn?.values ?? reads?.values ?? null} />;
}

/**
 * The same page for somebody reading a place through a link: the last day,
 * week or month through the link's own window, with nothing of the account
 * behind it - no grow to name, no line to correct, no view to keep.
 */
export function SharedTimeline({
  spaceId,
  shared,
  title,
  values,
}: {
  spaceId: string;
  shared: { token: string; picture: Picture };
  title: React.ReactNode;
  /** What the place reads now, as the page above says it. */
  values: CardValue[];
}) {
  const page = usePage(spaceId, shared.token);
  return <Screen page={page} spaceId={spaceId} title={title} place={null} own={null} picture={shared.picture} values={values} />;
}

/** The view the address names, the answer to it, and the one way the view is changed. */
const usePage = (spaceId: string, share: string | null) => {
  const [params, setParams] = useSearchParams();
  const now = useNow();
  const view = useMemo(() => viewOf(params), [params]);
  const beat = Math.floor(now.toMillis() / LIVE_BEAT_MS) * LIVE_BEAT_MS;
  const asked = windowOf(view, beat);
  // Keyed by its two ends, so the clock moving on does not ask again for a window that stands still.
  const ask = useMemo(
    () => askOf(view, asked, share),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `asked` is new every render; its ends are what it is
    [view, asked?.from, asked?.to, asked?.live, share],
  );
  const timeline = useTimeline(spaceId, ask);
  const change = (over: Partial<View>) => {
    if (over.show && share === null) writeStored(CURVES_KEY, JSON.stringify(over.show));
    setParams(withParams(params, viewParams(over)), { replace: true });
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
  const [kept, setKept] = useState<SpaceTimeline | null>(null);
  const fresh = timeline.data !== undefined && !timeline.isPlaceholderData ? timeline.data : null;
  if (fresh && fresh !== kept) setKept(fresh);
  const failed = timeline.isError && timeline.data === undefined;

  // A device or a grow the address names and the place does not have: the place's own Verlauf, and a sentence.
  const [dropped, setDropped] = useState<{ what: 'device' | 'grow'; id: string } | null>(null);
  const refused = failed && timeline.error instanceof ApiError ? timeline.error.problem.code : null;
  const gone =
    refused === 'device_not_here' && view.deviceId
      ? ({ what: 'device', id: view.deviceId } as const)
      : refused === 'grow_not_found' && view.growId
        ? ({ what: 'grow', id: view.growId } as const)
        : null;
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
    data: timeline.data ?? (failed ? (kept ?? undefined) : undefined),
    failed,
    dropped,
    change,
    now,
    clock: beat,
    shared: share !== null,
  };
};

function Screen({
  page,
  spaceId,
  title,
  place,
  own,
  picture,
  values,
}: TimelineProps & { page: ReturnType<typeof usePage>; own: Own | null; picture?: Picture; values: CardValue[] | null }) {
  const { t } = useTranslation();
  const zone = useZone();
  const wide = useWideWindow();
  const { view, asked, timeline, data, failed, change, now, clock } = page;
  // Where the cursor is being moved to before the address says so: under a mouse or a dragging thumb for as long as it
  // moves, and once set down until the address has followed - `before` is the cursor the address held then.
  const [scrub, setScrub] = useState<{ time: number; before?: number | null } | null>(null);
  const setScrubbed = (time: number | null) => setScrub(time === null ? null : { time });
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
  const live = !failed && (asked ? asked.live : window !== null && window.to >= clock - 60_000);
  // "Jetzt" is the device's last reading, as Start and Steuerung say it, and only while the device reports: by the
  // offline rule it is "letzter Wert" with its own time, on every range.
  const heard = live ? (values ?? []).filter(value => value.value !== null && value.measuredAt !== null) : [];
  const lastHeard = heard.length > 0 ? Math.max(...heard.map(value => at(value.measuredAt as string))) : null;
  const silent = heard.length > 0 && heard.every(value => valueAge(value, now) === 'offline');
  const reads = useMemo(() => (live && values ? { values, silentSince: silent ? lastHeard : null } : null), [live, values, silent, lastHeard]);

  const measured = own?.measured;
  const model = useMemo(() => {
    if (!data) return null;
    const offered = offeredOf(data, measured ?? []);
    const shown = shownOf(view.show, offered, view.focus);
    const strips = stripsOf(t, data);
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
  }, [data, measured, view.show, view.focus, view.one, view.vpdHalf, compared, reads, wide, t]);

  // Once per focus, when what it names is drawn: scrolling again on every refresh would take the page from under a thumb.
  useEffect(() => {
    if (!view.focus || !model || focused.current === view.focus) return;
    const target = screen.current?.querySelector<HTMLElement>('[data-focus]');
    if (!target) return;
    focused.current = view.focus;
    target.scrollIntoView?.({ block: 'center' });
  }, [view.focus, model]);

  const quiet = !data || !live ? null : values ? (silent ? lastHeard : null) : quietSince(data);
  const rest = quiet ?? window?.to ?? clock;
  const scrubbed = scrub && (scrub.before === undefined || scrub.before === view.at) ? scrub.time : null;
  const cursor = window ? Math.min(window.to, Math.max(window.from, scrubbed ?? view.at ?? rest)) : rest;
  const toTime = (fraction: number) => (window ? window.from + fraction * (window.to - window.from) : clock);

  const gestures = useScrub({
    onCursor: fraction => setScrubbed(toTime(fraction)),
    // The address follows a moment later, so the cursor stays where it was set down rather than springing back first.
    onPlace: fraction => {
      setScrub({ time: toTime(fraction), before: view.at });
      change({ at: toTime(fraction) });
    },
    onLeave: () => setScrubbed(null),
    onZoom: (selection: Selection) => {
      setScrubbed(null);
      if (window) change(selected(window, selection, view.at, clock));
    },
  });

  // The window the address names, which a second tap steps on from before the first one's answer is back; a grow's
  // stretch is known by its answer alone.
  const named = asked ?? (window ? { ...window, live } : null);
  // Today up to now is stepped as the day it is: back to the whole of yesterday.
  const whole = named && view.fixed && named.live ? { ...view.fixed, live: true } : named;
  const zoom = (direction: -1 | 1, around: number | null = view.at) => {
    const next = named ? zoomed(named, view.at, direction, clock, around) : null;
    setScrubbed(null);
    if (next) change(next);
  };
  const step = (direction: -1 | 1) => {
    setScrubbed(null);
    if (whole) change(stepped(whole, direction, clock));
  };
  const width = named ? named.to - named.from : 0;
  const growId = view.growId ?? data?.growId ?? null;
  const chip = chipOf(view, asked);
  const ranges = RANGES.filter(range => isRolling(range) || (own !== null && growId !== null));
  // Said only where points are drawn: a window nothing was measured in has no step to speak of.
  const stepDrawn = data && data.stepSeconds > 0 && data.panels.length > 0 && !failed ? data.stepSeconds : null;
  const zoomButtons = (
    <>
      <button
        type="button"
        className={styles.navButton}
        disabled={!named || nextWidth(width, -1) === null}
        aria-label={t('timeline.zoomOut')}
        onClick={() => zoom(-1)}
      >
        <Minus size={20} strokeWidth={2} aria-hidden />
      </button>
      <button
        type="button"
        className={styles.navButton}
        disabled={!named || nextWidth(width, 1) === null}
        aria-label={t('timeline.zoomIn')}
        onClick={() => zoom(1)}
      >
        <Plus size={20} strokeWidth={2} aria-hidden />
      </button>
    </>
  );
  // The zoom stays with the cursor's card, which stays in sight while the page scrolls; only a window with nothing
  // to read a cursor in keeps it in the head.
  const cursorShown = data !== undefined && (data.panels.length > 0 || data.outputs.length > 0);

  const head = (
    <header className={styles.head}>
      <div className={styles.title}>
        {title}
        {place ? <span className={styles.place}>{place}</span> : null}
      </div>
      <button type="button" className={styles.adjustButton} disabled={!model} onClick={() => setAdjusting(true)}>
        {t('timeline.adjust.title')}
      </button>
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
      <div className={styles.ranges} role="group" aria-label={t('timeline.rangeLabel')}>
        {ranges.map(range => (
          <button
            key={range}
            type="button"
            className={styles.range}
            aria-pressed={range === chip}
            onClick={() => {
              setScrubbed(null);
              change({ range, fixed: null, last: null, at: null, growId: rangeNeedsGrow(range) ? growId : null });
            }}
          >
            {t(`timeline.range.${range}`)}
          </button>
        ))}
      </div>
      <div className={styles.nav} role="group" aria-label={t('timeline.navLabel')}>
        <button
          type="button"
          className={styles.navButton}
          disabled={!named}
          aria-label={t('timeline.earlier', { span: durationLabel(width / 1000) })}
          onClick={() => step(-1)}
        >
          <ChevronLeft size={20} strokeWidth={2} aria-hidden />
        </button>
        <span className={styles.window}>
          {named ? windowLabel(t, named, named.live, now, zone) : '…'}
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
        <button
          type="button"
          className={styles.navButton}
          disabled={!named || named.live}
          aria-label={t('timeline.later', { span: durationLabel(width / 1000) })}
          onClick={() => step(1)}
        >
          <ChevronRight size={20} strokeWidth={2} aria-hidden />
        </button>
        {/* The marked way back, wherever the arrows and the zoom led. */}
        {named && !named.live ? (
          <button
            type="button"
            className={styles.toNow}
            onClick={() => {
              setScrubbed(null);
              change(toNow(named, clock));
            }}
          >
            {t('timeline.toNow')}
          </button>
        ) : null}
        {cursorShown ? null : zoomButtons}
      </div>
    </header>
  );

  if (!data || !model || !window) {
    return (
      <div className={styles.screen}>
        {head}
        {timeline.isPending && !timeline.isError ? (
          <>
            <Waiting lines={2} />
            <Waiting lines={4} />
            <Waiting lines={4} />
          </>
        ) : (
          <>
            <Refused error={timeline.error} />
            <LoadFailed retry={() => void timeline.refetch()} />
          </>
        )}
      </div>
    );
  }

  const { shown, panels, rest: loose, strips } = model;
  const stepMs = Math.max(data.stepSeconds, 1) * 1000;
  const curves = panels.flatMap(panel => panel.curves);
  const read = curves.map(curve => ({ curve, point: nearestPoint(curve.points, cursor, reachOf(data, curve)) }));
  const first = read.find(one => one.point && one.curve.line.shape === 'line');
  // Where the points are fine the cursor reads the one it stands on, to its second.
  const stood = data.stepSeconds > 0 && data.stepSeconds < 60 ? (first?.point?.[0] ?? cursor) : cursor;
  const resting = scrubbed === null && view.at === null;
  const stamp =
    resting && quiet !== null
      ? t('timeline.lastValue', { time: cursorStamp(quiet, window, 60, zone) })
      : resting && live
        ? t('timeline.nowAt', { time: cursorStamp(cursor, window, 60, zone) })
        : // A point of a wider step is the mean of its window, and says over which; a device's own reading is an instant.
          first?.point && data.stepSeconds > SAMPLE_SECONDS && first.point[0] !== first.curve.lastAt
          ? meanStamp(t, first.point[0], window, data.stepSeconds, zone)
          : cursorStamp(stood, window, data.stepSeconds, zone);
  // The room beside every plot is as wide as the longest figure a scale writes there, and the same for all of
  // them: the plots stand on one time axis down the page.
  const gutter =
    Math.max(4, ...curves.flatMap(curve => [curve.corner(curve.line.scale.low).length, curve.corner(curve.line.scale.high).length])) * 6.5 + 12;
  // Two figures in one unit - the air's and the leaf's degrees - are told apart by name.
  const shared = new Set(curves.map(curve => curve.unit).filter((unit, index, all) => unit !== '' && all.indexOf(unit) !== index));
  const outputsAt = (shown.light || shown.outputs ? strips : [])
    .filter(strip => (strip.output === 'light' ? shown.light : shown.outputs))
    .map(strip => outputWords(t, strip, stateAt(strip, cursor, stepMs)));
  const cameras = data.cameras.filter(camera => camera.frames.length > 0);
  const ends = axisEnds(t, window, live, zone);
  const nothing = data.panels.length === 0 && data.outputs.length === 0;
  const light = loose.find(strip => strip.output === 'light') ?? null;
  const setCursor = (time: number) => {
    setScrubbed(null);
    change({ at: Math.min(window.to, Math.max(window.from, time)) });
  };

  const cursorCard = (
    <CursorCard
      stamp={stamp}
      readings={read.map(({ curve, point }) =>
        [shared.has(curve.unit) ? curve.name : null, point ? `${curve.written(point[1] as number)}\u00a0${curve.unit}`.trim() : '—']
          .filter(Boolean)
          .join(' '),
      )}
      zoom={zoomButtons}
      outputs={outputsAt}
      cameras={cameras}
      cursor={cursor}
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
    <div className={styles.screen} ref={screen} aria-busy={timeline.isPlaceholderData} style={{ '--gutter': `${gutter}px` } as React.CSSProperties}>
      {head}
      {failed ? (
        // The picture is the window before: this one would not load, for the reason said, and can be asked for again.
        <div className={styles.failed} role="alert">
          <p className={ui.problem}>
            {t('timeline.windowFailed')} {refusalText(timeline.error)}
          </p>
          <button type="button" className={ui.button} disabled={timeline.isFetching} onClick={() => void timeline.refetch()}>
            {t(timeline.isFetching ? 'timeline.retrying' : 'home.retry')}
          </button>
        </div>
      ) : (
        <RefreshFailed failedAt={timeline.isError ? timeline.dataUpdatedAt : null} now={now} />
      )}
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
        <div className={styles.curves}>
          {nothing ? (
            <Nothing
              data={data}
              now={now}
              // The moment alone: the view gives it its own day around it, and never a window past now.
              toLast={time => change({ range: '24h', fixed: null, last: null, at: time })}
            />
          ) : panels.length === 0 && curves.length === 0 && data.panels.length > 0 ? (
            <p className={`${ui.cardDashed} ${ui.note}`}>{t('timeline.noneTicked')}</p>
          ) : null}
          {panels.map((panel, index) => (
            <Panel
              key={panel.key}
              explain={index === 0}
              panel={panel}
              cursor={cursor}
              reach={curve => reachOf(data, curve)}
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
                {light ? <span className={styles.panelRange}>{lightWords(t, light, window, live, zone)}</span> : null}
              </header>
              <Strips strips={loose} from={window.from} to={window.to} stepMs={stepMs} cursor={resting ? null : cursor} focus={view.focus} />
              {panels.length === 0 ? <Axis from={window.from} to={window.to} ends={ends} /> : null}
            </section>
          ) : null}
        </div>
        <aside className={styles.beside}>
          {nothing ? null : cursorCard}
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
          comparable={own?.comparable ?? []}
          views={
            own?.keeps
              ? {
                  definition: definitionOf(view, {
                    metrics: shown.metrics,
                    measurements: shown.measurements,
                    outputs: strips.filter(strip => (strip.output === 'light' ? shown.light : shown.outputs)).map(strip => strip.output),
                    deviceIds: data.deviceIds ?? [],
                    growId: data.growId,
                  }),
                  apply: (kept: ChartView) => change(appliedOf(kept, growId)),
                }
              : null
          }
          day={{
            shown: zonedAt(window.from, zone).toFormat('yyyy-MM-dd'),
            last: zonedAt(clock, zone).toFormat('yyyy-MM-dd'),
            jump: day => {
              // That day of the calendar; today's is shown up to now.
              setScrubbed(null);
              change({
                range: '24h',
                growId: null,
                fixed: dayHolding(startOfDayOn(day, zone).getTime() + 12 * 3600_000, zone),
                last: null,
                at: null,
              });
            },
          }}
          onShare={
            own?.sharing
              ? () => {
                  setAdjusting(false);
                  setSharing(true);
                }
              : null
          }
          onCsv={
            curves.length + strips.length > 0
              ? () =>
                  saveFile(
                    new Blob([csvFor(t, panels, shown.outputs || shown.light ? strips : [], window.from, window.to, zone, decimalMark() === ',')], {
                      type: 'text/csv;charset=utf-8',
                    }),
                    `${slug(data.name) || 'verlauf'}-${zonedAt(window.from, zone).toFormat('yyyy-MM-dd')}.csv`,
                  )
              : null
          }
          onClose={() => setAdjusting(false)}
        />
      ) : null}
      {sharing && own?.sharing ? (
        <NewLinkSheet
          grows={own.sharing.grows}
          spaces={own.sharing.spaces}
          // A window that stands still is a stretch somebody went looking for, and is what the link offers to show.
          window={view.fixed ? { startsAt: data.startsAt, endsAt: data.endsAt, label: windowLabel(t, window, false, now, zone) } : null}
          onClose={() => setSharing(false)}
          onCreated={made => {
            setSharing(false);
            setLink(made);
          }}
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
 * A window with no curve and no strip, said as what it is: a place that
 * measures and was not heard in this window - dated, with the way to its last
 * reading -, one whose device has sent nothing yet, or one where nothing
 * measures. Only the answer's `lastReadingAt` and devices tell them apart.
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

/** What an output did at the cursor: its level where it says one, on or off, and a dash where nobody heard of it. */
const outputWords = (t: Translate, strip: Strip, state: ReturnType<typeof stateAt>): string =>
  `${strip.name} ${state === null ? '—' : !state.on ? t('timeline.off') : state.level !== null ? `${state.level}\u00a0%` : t('timeline.on')}`;

/**
 * The lamp over the window in a few words: its last lit stretch by the clock
 * where the window is read by the clock, else the share of the window it was
 * on; and how bright it last ran.
 */
const lightWords = (t: Translate, light: Strip, window: { from: number; to: number }, live: boolean, zone: string | null): string => {
  const run = light.runs.at(-1);
  // How bright it ran while it last ran: the middle of its levels, which a ramp at either end does not move.
  const levels = light.levels
    .filter(([end]) => !run || (end > run.from && end <= run.to + 1))
    .map(([, value]) => value)
    .sort((one, other) => one - other);
  const level = levels.length > 0 ? levels[Math.floor(levels.length / 2)] : null;
  const clock = (time: number) => zonedAt(time, zone).toFormat('HH:mm');
  const share = shareOf(light, window.from, window.to);
  const when =
    !run || window.to - window.from > 36 * 3600_000
      ? share === null
        ? null
        : share === 0
          ? t('timeline.off')
          : t('timeline.lightShare', { share: Math.round(share * 100) })
      : run.to >= window.to && live
        ? t('timeline.lightSince', { from: clock(run.from) })
        : t('timeline.lightSpan', { from: clock(run.from), to: clock(run.to) });

  return [when, level === null ? null : `${level}\u00a0%`].filter(Boolean).join(' · ');
};

/** A file name a grower finds again: the place's name without what a file system trips on. */
const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
