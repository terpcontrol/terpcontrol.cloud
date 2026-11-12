import type { DateTime } from 'luxon';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';
import type { Camera, GrowListItem, Media, TimelapseCreate } from '@fg2/shared-types/v1';
import { CAPTURE_BUDGET_SECONDS, readsThroughDevice } from '@fg2/shared-types/v1-schemas/capture.js';
import { useAccountMe } from '@/api/account';
import { gaveUp, useCamera, useLatestStills, useRequestTimelapse, useTestCapture, useTimelapses } from '@/api/cameras';
import { useDevices } from '@/api/devices';
import { useGrowDiary, useSpaceGrows } from '@/api/grows';
import { useHomeShape } from '@/api/home';
import { useDiaryLayer } from '@/api/layers';
import { itemsOf } from '@/api/pages';
import { filmStatus } from '@/api/media';
import { noLongerThere } from '@/api/problem';
import { mediaUrl, THUMBNAIL_WIDTH } from '@/api/session';
import { useSpaceOverview, useSpaces } from '@/api/spaces';
import { ALL_GROWS, devicePath, placePath, timelinePath, usePageOfPlace } from '@/app/places';
import type { Translate } from '@/i18n/i18n';
import { useLog } from '@/log/log-context';
import { dayNamed, reachesBackTo, useReadBackTo } from '@/screens/grow/diary/read-back';
import { dayWindow } from '@/screens/timeline/view';
import { shownStill } from '@/screens/start/place';
import { ageLabel, deviceLiveness, sinceLabel } from '@/ui/age';
import { useCameraCalled } from '@/ui/camera-name';
import { useKeptScroll } from '@/ui/kept';
import { deviceName } from '@/ui/naming';
import { OfflineBox } from '@/ui/OfflineHelp';
import { PageHead } from '@/ui/PageHead';
import { LoadFailed, NoLongerHere, RefreshFailed, Waiting } from '@/ui/PageState';
import { refusalText } from '@/ui/refusal';
import { Row, Rows } from '@/ui/Rows';
import { enough, useMayWith } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { clock, DATED_CLOCK, nowThere, zoned, zoneOf } from '@/ui/zone';
import { cameraFreshness } from '../devices/cameras';
import { CameraSettings } from './CameraSettings';
import { causeOf } from './capture-failure';
import { Composer } from './Composer';
import { firstDayOf, landsOn, nearestTo, picturedDays } from './days';
import { Raw } from './Film';
import { Films, FilmsSheet } from './Films';
import { filmsOfEachSpan } from './film-spans';
import styles from './CameraPage.module.css';

/**
 * One camera: its picture, the days of the grow behind it, the films, one
 * picture now, and the ways on - to the curves of the day shown, to the
 * diary, to a film of one's own and to what the camera is set to.
 */
export function CameraPage() {
  const { cameraId = '' } = useParams();
  const camera = useCamera(cameraId);
  usePageOfPlace(camera.data?.spaceId ?? null);

  if (camera.isPending) return <Waiting lines={3} />;
  if (camera.data) return <CameraScreen camera={camera.data} failedAt={camera.isError ? camera.dataUpdatedAt : null} />;
  return noLongerThere(camera.error) ? <NoLongerHere what="camera" /> : <LoadFailed retry={() => void camera.refetch()} />;
}

/** The least time between two writes of the address: a drag across a grow is as many days, and a browser refuses a hundred writes in ten seconds. */
const ADDRESS_REST_MS = 150;

/**
 * The day the slider was left on, null for today. It stands in the address
 * (`?day=`), so a reload and the way back find it - written there without a
 * navigation, which would renew the entry's key, and what the page keeps for
 * the entry (`ui/kept.ts`) and what a sheet left on it (`ui/sheet-back.ts`)
 * are found by that key. So moving the slider adds nothing to the history. A
 * sheet stands on an entry of its own: Back out of one lands on the page's
 * first entry, whose address is then told the day too.
 */
function useDayInAddress(): [number | null, (day: number | null) => void] {
  const [params] = useSearchParams();
  const [day, setDay] = useState(() => dayNamed(params));
  const [path] = useState(() => window.location.pathname);
  // A stopwatch between two writes, not an instant: the browser's own.
  const wroteAt = useRef(Number.NEGATIVE_INFINITY);

  useEffect(() => {
    const write = () => {
      const url = new URL(window.location.href);
      // A step of the history that left the page has changed the address already: that one is not this page's to write.
      if (url.pathname !== path || dayNamed(url.searchParams) === day) return;
      if (day === null) url.searchParams.delete('day');
      else url.searchParams.set('day', String(day));
      window.history.replaceState(window.history.state, '', url);
      wroteAt.current = performance.now();
    };
    const wait = wroteAt.current + ADDRESS_REST_MS - performance.now();
    const timer = wait > 0 ? setTimeout(write, wait) : undefined;
    if (wait <= 0) write();
    window.addEventListener('popstate', write);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('popstate', write);
    };
  }, [day, path]);

  return [day, setDay];
}

type Diary = ReturnType<typeof useGrowDiary>;

/**
 * The page of a camera that is there. The days under the picture are the days
 * of the grow running where the camera looks, read from that grow's diary: a
 * camera nothing grows in front of has only its newest picture, and the films
 * the last grow left. Exported for the tests, which drive the page itself.
 */
export function CameraScreen({ camera, failedAt = null }: { camera: Camera; failedAt?: number | null }) {
  const grows = useSpaceGrows(camera.spaceId).data?.items ?? [];
  const running = grows.find(grow => grow.endedAt === null) ?? null;
  // One page whether or not the grow is known yet: drawn anew when it arrives, it lost its heading and the focus on it.
  const diary = useGrowDiary(running?.id ?? null);

  return <Watch camera={camera} grow={running} filmed={running ?? grows[0] ?? null} diary={running ? diary : null} failedAt={failedAt} />;
}

function Watch({
  camera,
  grow,
  filmed,
  diary,
  failedAt,
}: {
  camera: Camera;
  /** The grow running where the camera looks, whose days the slider walks. */
  grow: GrowListItem | null;
  /** The grow a film of a phase or of the whole grow is of: the running one, else the last that stood there. */
  filmed: GrowListItem | null;
  diary: Diary | null;
  failedAt: number | null;
}) {
  const { t } = useTranslation();
  const now = useNow();
  // Every clock time here is the account's: a camera burns its own instant
  // into its pictures, so a label an hour off is one the picture beside it
  // gives away. The demo has no account, and the browser's zone stands in.
  const me = useAccountMe();
  const zone = zoneOf(me.data);
  // Its settings and the films it renders are `manage` where it stands; taking it off the account is `own`.
  const youMay = useMayWith()(camera);
  const mayManage = enough(youMay, 'manage');
  const mayOwn = enough(youMay, 'own');
  const called = useCameraCalled();
  const { tell } = useLog();
  const place = useSpaces().data?.items.find(space => space.id === camera.spaceId) ?? null;
  // Curves are of a place something measures; a camera standing alone has none to lead to.
  const measured = (useHomeShape().data?.spaces ?? []).some(card => card.spaceId === camera.spaceId && card.deviceIds.length > 0);
  const growFilms = useDiaryLayer() || filmed !== null;
  useKeptScroll(true);

  // A camera read through a device - a Terp Cam over its relay, a stream
  // through its tunnel - goes dark with that device and is not even tried
  // while it is offline: the page says that rather than why the last try failed.
  const throughDevice = camera.deviceId !== null && readsThroughDevice(camera);
  const devices = useDevices(throughDevice);
  const carrier = throughDevice ? (devices.data?.items.find(device => device.id === camera.deviceId) ?? null) : null;
  const carrierOffline = carrier !== null && deviceLiveness(carrier.state.lastSeenAt, now) === 'offline';
  const freshness = cameraFreshness(camera, now);

  const [asked, setAsked] = useDayInAddress();
  const lastDay = grow?.summary.dayNumber ?? null;
  const pages = diary?.data?.pages;
  const pictured = picturedDays(pages, camera.id).filter(one => lastDay === null || one.dayNumber < lastDay);
  const reaches = reachesBackTo(pages);
  const reading = useReadBackTo(diary, asked);
  const stops = pictured.map(one => one.dayNumber);
  // An address can name any day: one the grow has not reached is today, as today itself is, and the address is told so.
  const beyond = asked !== null && lastDay !== null && asked >= lastDay;
  if (beyond) setAsked(null);
  const day = asked === null || beyond ? null : (pictured.find(one => one.dayNumber === nearestTo(stops, asked)) ?? null);
  const firstDay = grow && lastDay !== null ? firstDayOf(camera, grow) : null;
  const sliding = lastDay !== null && firstDay !== null && firstDay < lastDay && pictured.length > 0;
  const move = (to: number) => {
    if (lastDay === null || to >= lastDay) return setAsked(null);
    if (reaches !== null && to < reaches && diary?.hasNextPage) return setAsked(to);
    const landed = landsOn([...stops, lastDay], day?.dayNumber ?? lastDay, to);
    setAsked(landed === lastDay ? null : landed);
  };

  // Today's picture is the one Start shows: the newest taken in the light,
  // said to be that while the lamp is off. A picture just asked for is shown
  // whatever the light, because it is what the press was for; where the day
  // has none yet, the camera's newest stands in.
  const seen = useSpaceOverview(camera.spaceId ?? '', camera.spaceId !== null).data?.cameras.find(one => one.cameraId === camera.id);
  const lit = seen ? shownStill(seen) : null;
  const newest = useLatestStills(lit ? [] : [camera.id]).get(camera.id) ?? null;
  const test = useTestCapture(camera.id);
  const shot = test.data?.state === 'done' ? test.data.still : null;
  const live =
    shot && (!lit || Date.parse(shot.capturedAt) >= Date.parse(lit.capturedAt))
      ? { ...shot, dark: false }
      : (lit ?? (newest && camera.state.lastStillAt ? { mediaId: newest, capturedAt: camera.state.lastStillAt, dark: false } : null));
  const picture = day ?? live;
  const shownDay = day?.dayNumber ?? lastDay;
  const old = day === null && freshness === 'offline';
  const moment = !picture
    ? null
    : day
      ? zoned(picture.capturedAt, zone).toFormat(DATED_CLOCK)
      : old
        ? t('camera.picture.last', { time: sinceLabel(picture.capturedAt, now, zone) })
        : live?.dark
          ? t('camera.picture.lightOff', { time: sinceLabel(picture.capturedAt, now, zone) })
          : todayOr(t, picture.capturedAt, now, zone);

  const films = filmsOfEachSpan(itemsOf(useTimelapses(camera.id).data));
  const ask = useRequestTimelapse(camera.id);
  const [job, setJob] = useState<Media | null>(null);
  const [open, setOpen] = useState<'composer' | 'films' | 'settings' | null>(null);
  const make = (body: TimelapseCreate) =>
    ask.mutate(body, {
      onSuccess: ({ media }) => {
        setJob(media);
        setOpen(null);
        // A film that was there already plays at once, which the button then says.
        if (filmStatus(media) !== 'ready')
          tell({ label: t('camera.film.asked', { film: t(`camera.film.kind.${media.window ?? 'custom'}`) }), undo: null });
      },
    });
  // A picture taken is on the frame, and the toast says of when it is; one that failed is said under the button.
  const shoot = () =>
    test.mutate(undefined, {
      onSuccess: ({ still }) => still && tell({ label: t('camera.testTaken', { time: clock(still.capturedAt, zone) }), undo: null }),
    });

  return (
    <section className={styles.page}>
      {/* The camera belongs to the place it watches: the way back leads there, as Start's picture led here. */}
      <PageHead title={called(camera.name)} back={{ to: place ? placePath(place.id) : '/', label: place?.name ?? t('shell.tabs.home') }}>
        <span className={`${ui.live} ${styles.pill} ${styles.cut}`} data-liveness={freshness}>
          {freshness === 'live' ? <span className={ui.liveDot} aria-hidden /> : null}
          {pillOf(t, camera, freshness, carrierOffline && carrier ? deviceName(carrier, t) : null, now, zone)}
        </span>
      </PageHead>

      <RefreshFailed failedAt={failedAt} now={now} />
      {/* Why a capture failed names the camera's address and its tunnel, which
          are the owner's: somebody who shares the tent is told by the pill
          that it is not delivering. What is said is the kind of failure; the
          server's own words stay a tap below for the one who can fix it. */}
      {carrier && carrierOffline ? (
        <OfflineBox
          title={t('offline.title', {
            device: deviceName(carrier, t),
            time: carrier.state.lastSeenAt ? sinceLabel(carrier.state.lastSeenAt, now, zone) : '',
          })}
          deviceLink={devicePath(carrier.id)}
        >
          {t('camera.carrierOffline', { device: deviceName(carrier, t) })}
        </OfflineBox>
      ) : mayOwn && camera.state.lastError ? (
        <div className={styles.said} role="alert">
          <p className={ui.problem}>{t('camera.lastError', { reason: t(causeOf(camera.state.lastError)) })}</p>
          <Raw summary={t('camera.whatItSaid')}>{camera.state.lastError}</Raw>
        </div>
      ) : null}

      <div className={styles.look}>
        <div className={`${ui.mat} ${styles.frame}`} data-age={old ? 'offline' : undefined}>
          {picture ? (
            <img
              src={mediaUrl(picture.mediaId, THUMBNAIL_WIDTH.frame) ?? undefined}
              alt={t('camera.frameAlt', { name: camera.name, time: zoned(picture.capturedAt, zone).toFormat(DATED_CLOCK) })}
            />
          ) : (
            <p className={`mono ${ui.matNote}`}>{t(camera.state.lastStillAt ? 'home.waiting' : 'camera.noPicture')}</p>
          )}
          {picture ? (
            <span className={styles.labels}>
              {grow && shownDay !== null ? (
                <span className={ui.photoCaption}>
                  <span className={styles.cut}>{grow.name}</span>
                  <span className={styles.labelKept}>{` · ${t('home.card.dayN', { day: shownDay })}`}</span>
                </span>
              ) : null}
              <span className={ui.photoCaption} data-tone={old ? 'warn' : undefined}>
                {moment}
              </span>
            </span>
          ) : null}
        </div>

        {sliding ? (
          <div className={styles.days}>
            <p className={styles.daysHead}>
              <span className={styles.daysAt}>{t('camera.days.at', { day: reading ? asked : shownDay, days: lastDay })}</span>
              <span>{t(reading ? 'home.waiting' : 'camera.days.note')}</span>
            </p>
            <input
              className={ui.range}
              style={
                { '--filled': `${((((reading ? asked : shownDay) ?? lastDay) - firstDay) / (lastDay - firstDay)) * 100}%` } as React.CSSProperties
              }
              type="range"
              min={firstDay}
              max={lastDay}
              step={1}
              value={(reading ? asked : shownDay) ?? lastDay}
              onChange={event => move(Number(event.target.value))}
              aria-label={t('camera.days.label')}
              aria-valuetext={[
                t('home.card.dayN', { day: reading ? asked : shownDay }),
                day ? zoned(day.capturedAt, zone).toFormat(DATED_CLOCK) : null,
              ]
                .filter(Boolean)
                .join(', ')}
            />
          </div>
        ) : null}
      </div>

      <div className={styles.act}>
        <Films
          camera={camera}
          grow={filmed}
          growFilms={growFilms}
          films={films}
          now={now}
          zone={zone}
          dayAt={day?.capturedAt ?? null}
          mayManage={mayManage}
          mayOwn={mayOwn}
          ask={{ make, pending: ask.isPending, error: ask.error, job }}
          beside={
            mayManage ? (
              // Held while the device is offline, which the box above says in full; the sentence under the row says it short.
              <button
                type="button"
                className={ui.button}
                aria-disabled={carrierOffline || undefined}
                disabled={test.isPending}
                onClick={carrierOffline ? undefined : shoot}
              >
                {t(test.isPending ? 'camera.testing' : 'camera.testImage')}
              </button>
            ) : null
          }
          below={mayManage ? <Shot test={test} mayOwn={mayOwn} offline={carrierOffline} /> : null}
        />

        <Rows>
          {place && measured ? (
            <Row to={curvesOfDay(place.id, day?.capturedAt ?? null, day ? (grow ?? null) : null)} title={t('camera.row.curves')} />
          ) : null}
          {grow ? <Row to={`${ALL_GROWS}/${grow.id}${day ? `?day=${day.dayNumber}` : ''}`} title={t('camera.row.diary')} /> : null}
          {mayManage ? <Row onOpen={() => setOpen('composer')} title={t('camera.makeOne')} /> : null}
          {films.length > 0 ? <Row onOpen={() => setOpen('films')} title={t('camera.allFilms')} /> : null}
          <Row
            onOpen={() => setOpen('settings')}
            title={t(mayManage ? 'camera.settings' : 'camera.about')}
            line={mayManage ? t(mayOwn ? 'camera.row.settingsOwn' : 'camera.row.settingsLine') : t('camera.row.aboutLine')}
          />
        </Rows>
      </div>

      {open === 'composer' ? (
        <Composer camera={camera} grow={filmed} growFilms={growFilms} pending={ask.isPending} onRender={make} onClose={() => setOpen(null)} />
      ) : null}
      {open === 'films' ? <FilmsSheet camera={camera} me={me.data} mayOwn={mayOwn} onClose={() => setOpen(null)} /> : null}
      {open === 'settings' ? (
        <CameraSettings camera={camera} mayManage={mayManage} mayOwn={mayOwn} tell={tell} onClose={() => setOpen(null)} />
      ) : null}
    </section>
  );
}

/** "heute, 12:00" for a picture of the day the account is having, its day and hour for an older one. */
const todayOr = (t: Translate, at: string, now: DateTime, zone: string | null): string =>
  zoned(at, zone).hasSame(nowThere(now, zone), 'day') ? t('camera.picture.today', { time: clock(at, zone) }) : sinceLabel(at, now, zone);

/**
 * How old the camera's read is, as the pill in the head says it: online with
 * the age of its newest picture, late with that age alone, and once it has
 * stopped - by the stills it has missed (`cameraFreshness`) - whether it
 * waits for its device or since when nothing came.
 */
const pillOf = (t: Translate, camera: Camera, freshness: string, waitsFor: string | null, now: DateTime, zone: string | null): string => {
  const last = camera.state.lastStillAt;
  if (!last) return t('camera.pill.never');
  if (freshness === 'live') return t('camera.pill.live', { age: ageLabel(last, now) });
  if (freshness === 'stale') return t('camera.pill.late', { age: ageLabel(last, now) });
  return waitsFor ? t('camera.pill.waits', { device: waitsFor }) : t('camera.pill.since', { time: sinceLabel(last, now, zone) });
};

/**
 * Why "Jetzt ein Bild" brought no picture, under the row it stands in: the
 * kind of failure, with the camera's own words for its owner. A request that
 * never reached the server is not that: the camera was not asked. The press
 * waits as long as the server's read may take and a little longer.
 */
function Shot({ test, mayOwn, offline }: { test: ReturnType<typeof useTestCapture>; mayOwn: boolean; offline: boolean }) {
  const { t } = useTranslation();
  const failed = test.data?.state === 'failed' ? test.data : null;

  if (offline) return <p className={ui.note}>{t('camera.testOffline')}</p>;
  if (test.isPending) return null;
  if (test.error) {
    return (
      <p className={ui.problem} role="alert">
        {gaveUp(test.error) ? t('camera.testNoAnswer', { minutes: CAPTURE_BUDGET_SECONDS / 60 }) : refusalText(test.error, t('camera.testFailed'))}
      </p>
    );
  }

  return failed ? (
    <div className={styles.said} role="alert">
      <p className={ui.problem}>{t('camera.testNoPicture', { reason: t(`camera.failure.${failed.reason ?? 'unknown'}`) })}</p>
      {mayOwn && failed.error ? <Raw summary={t('camera.whatItSaid')}>{failed.error}</Raw> : null}
    </div>
  ) : null;
}

/**
 * Verlauf on the day the page shows: that day of the grow's calendar, with the
 * cursor on its picture, so the stills of that day are read along its curves.
 * Today is shown up to now.
 */
const curvesOfDay = (spaceId: string, at: string | null, grow: Pick<GrowListItem, 'id' | 'summary'> | null): string => {
  return timelinePath(spaceId, null, at, grow?.id ?? null, at ? dayWindow(Date.parse(at), grow?.summary.zone ?? null) : null);
};
