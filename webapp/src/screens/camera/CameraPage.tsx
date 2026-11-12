import type { DateTime } from 'luxon';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import type { Camera, GrowListItem, Media, TimelapseCreate } from '@fg2/shared-types/v1';
import { CAPTURE_BUDGET_SECONDS, readsThroughDevice } from '@fg2/shared-types/v1-schemas/capture.js';
import { useAccountMe } from '@/api/account';
import { gaveUp, useCamera, useLatestStills, useRequestTimelapse, useTestCapture, useTimelapses } from '@/api/cameras';
import { useDevices } from '@/api/devices';
import { useGrowDiary, useSpaceGrows } from '@/api/grows';
import { useHomeShape } from '@/api/home';
import { useDiaryLayer } from '@/api/layers';
import { itemsOf } from '@/api/pages';
import { noLongerThere } from '@/api/problem';
import { mediaUrl, THUMBNAIL_WIDTH } from '@/api/session';
import { useSpaceOverview, useSpaces } from '@/api/spaces';
import { ALL_GROWS, devicePath, placePath, timelinePath, usePageOfPlace } from '@/app/places';
import type { Translate } from '@/i18n/i18n';
import { useLog } from '@/log/log-context';
import { shownStill } from '@/screens/start/place';
import { ageLabel, deviceLiveness, sinceLabel } from '@/ui/age';
import { useCameraCalled } from '@/ui/camera-name';
import { useKept, useKeptScroll } from '@/ui/kept';
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
import { firstDayOf, landsOn, nearestTo, picturedDays, reachesBackTo } from './days';
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
  if (!camera.data) return noLongerThere(camera.error) ? <NoLongerHere what="camera" /> : <LoadFailed retry={() => void camera.refetch()} />;

  return <CameraScreen camera={camera.data} failedAt={camera.isError ? camera.dataUpdatedAt : null} />;
}

type Diary = ReturnType<typeof useGrowDiary>;

/**
 * The page of a camera that is there. The days under the picture are the
 * days of the grow running where the camera looks, read from that grow's
 * diary - so a camera nothing grows in front of has no days, only its newest
 * picture, and the films that grow left stay those of the last one. Exported
 * for the tests, which drive the page itself rather than the read above it.
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

  // The day the slider was left on, kept for the history entry: Back from the curves of a day returns to that day.
  const [asked, setAsked] = useKept<number | null>('day', null);
  const lastDay = grow?.summary.dayNumber ?? null;
  const pages = diary?.data?.pages;
  const pictured = picturedDays(pages, camera.id).filter(one => lastDay === null || one.dayNumber < lastDay);
  const reaches = reachesBackTo(pages);
  const fetchEarlier = diary?.fetchNextPage;
  const fetchingEarlier = diary?.isFetchingNextPage === true;
  // Left on a day the pages read so far do not reach: the weeks before are read until they do.
  const reading = asked !== null && reaches !== null && asked < reaches && diary?.hasNextPage === true;
  useEffect(() => {
    if (reading && !fetchingEarlier) void fetchEarlier?.();
  }, [reading, fetchingEarlier, fetchEarlier]);
  const stops = pictured.map(one => one.dayNumber);
  const day = asked === null ? null : (pictured.find(one => one.dayNumber === nearestTo(stops, asked)) ?? null);
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
      onSuccess: accepted => {
        setJob(accepted.media);
        setOpen(null);
      },
    });

  return (
    <section className={styles.page}>
      {/* The camera belongs to the place it watches: the way back leads there, as Start's picture led here. */}
      <PageHead title={called(camera.name)} back={{ to: place ? placePath(place.id) : '/', label: place?.name ?? t('shell.tabs.home') }}>
        <span className={ui.live} data-liveness={freshness}>
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
                  <span className={styles.labelName}>{grow.name}</span>
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
                onClick={() => (carrierOffline ? undefined : test.mutate())}
              >
                {t(test.isPending ? 'camera.testing' : 'camera.testImage')}
              </button>
            ) : null
          }
          below={mayManage ? <Shot test={test} mayOwn={mayOwn} offline={carrierOffline} zone={zone} /> : null}
        />

        <Rows>
          {place && measured ? (
            <Row to={timelinePath(place.id, null, day?.capturedAt ?? null, day ? (grow?.id ?? null) : null)} title={t('camera.row.curves')} />
          ) : null}
          {grow ? <Row to={`${ALL_GROWS}/${grow.id}`} title={t('camera.row.diary')} /> : null}
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
 * What "Jetzt ein Bild" last answered, under the row it stands in. A press
 * that worked says so and the picture is on the frame; one that failed names
 * the kind of failure, as the box over the picture names the camera's last
 * one, and keeps the camera's own words for its owner. A request that never
 * reached the server is neither: the camera was not asked. The press waits
 * as long as the server's read may take and a little longer, so nothing
 * within that says to press again rather than to wait on.
 */
function Shot({ test, mayOwn, offline, zone }: { test: ReturnType<typeof useTestCapture>; mayOwn: boolean; offline: boolean; zone: string | null }) {
  const { t } = useTranslation();
  const failed = test.data?.state === 'failed' ? test.data : null;
  const taken = test.data?.state === 'done' ? test.data.still : null;

  if (offline) return <p className={ui.note}>{t('camera.testOffline')}</p>;
  if (test.isPending) return null;
  if (test.error) {
    return (
      <p className={ui.problem} role="alert">
        {gaveUp(test.error) ? t('camera.testNoAnswer', { minutes: CAPTURE_BUDGET_SECONDS / 60 }) : refusalText(test.error, t('camera.testFailed'))}
      </p>
    );
  }
  if (failed) {
    return (
      <div className={styles.said} role="alert">
        <p className={ui.problem}>{t('camera.testNoPicture', { reason: t(`camera.failure.${failed.reason ?? 'unknown'}`) })}</p>
        {mayOwn && failed.error ? <Raw summary={t('camera.whatItSaid')}>{failed.error}</Raw> : null}
      </div>
    );
  }

  return taken ? (
    <p className={`mono ${styles.taken}`} role="status">
      {t('camera.testTaken', { time: clock(taken.capturedAt, zone) })}
    </p>
  ) : null;
}
