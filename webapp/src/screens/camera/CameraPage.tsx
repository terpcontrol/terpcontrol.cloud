import { Clapperboard } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import type { Camera, GrowListItem, Media, TimelapseCreate } from '@fg2/shared-types/v1';
import { CAPTURE_BUDGET_SECONDS, readsThroughDevice } from '@fg2/shared-types/v1-schemas/capture.js';
import { gaveUp, useCamera, useCameraFrames, useLatestStills, useRequestTimelapse, useTestCapture, useTimelapses } from '@/api/cameras';
import { useDevices } from '@/api/devices';
import { useSpaceGrows } from '@/api/grows';
import { useDiaryLayer } from '@/api/layers';
import { filmStatus } from '@/api/media';
import { itemsOf } from '@/api/pages';
import { noLongerThere } from '@/api/problem';
import { mediaUrl, THUMBNAIL_WIDTH } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { placePath, timelinePath } from '@/app/places';
import type { Translate } from '@/i18n/i18n';
import { rowReaches } from '@/screens/notifications/reach';
import { useCameraCalled } from '@/ui/camera-name';
import { ageLabel, deviceLiveness, instantOf } from '@/ui/age';
import { useReportFreshness } from '@/ui/freshness';
import { LoadFailed, NoLongerHere, Refused, Waiting } from '@/ui/PageState';
import { enough, useAccountMe, useMayWith } from '@/ui/session-access';
import { Help } from '@/ui/Help';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { CLOCK, DATED_CLOCK, WEEKDAY_DAY, zoned, zonedAt, zoneOf } from '@/ui/zone';
import { cameraFreshness } from '../devices/cameras';
import { deviceName } from '@/ui/naming';
import { OfflineHelp } from '../home/OfflineHelp';
import { causeOf } from './capture-failure';
import { at, frameAt, stampOf } from '../timeline/window';
import { Slider } from '../timeline/CameraFrame';
import { Composer } from './Composer';
import { emptyRolling } from './rolling';
import { Film } from './Film';
import { CameraSettings } from './CameraSettings';
import styles from './CameraPage.module.css';
import { refusalText } from '@/ui/refusal';
import { BackLink } from '@/ui/BackLink';

/** How many films the section rests at before somebody asks for the rest. */
const FILMS_AT_REST = 3;

/**
 * One camera: the picture it is taking, the day behind it, the four films it
 * makes in one tap, the composer, and what the camera itself is set to.
 */
export function CameraPage() {
  const { cameraId = '' } = useParams();
  const { t } = useTranslation();
  const camera = useCamera(cameraId);

  useReportFreshness(camera.data?.state.lastStillAt ?? null);

  if (camera.isPending) return <Waiting lines={3} />;
  if (!camera.data) return noLongerThere(camera.error) ? <NoLongerHere what="camera" /> : <LoadFailed retry={() => void camera.refetch()} />;

  return <CameraScreen camera={camera.data} refetching={camera.isError ? t('shell.loadFailed') : null} />;
}

/**
 * What this page knows about today's pictures, which is one question and not
 * three. The read can still be out, it can have come back unable to say, the
 * day can genuinely hold nothing, or here they are - and the frame, the count
 * under it and the scrubber between them are three views of that single answer.
 *
 * It is one value because the page was caught holding two answers at once: the
 * frame said the pictures were still loading while the line beneath it said
 * "0 pictures today" on a camera that had been filling the day since dawn. Each
 * of those places had decided for itself what an empty list meant, and only one
 * of them had remembered that a list is empty before it has been filled as well
 * as when there was nothing to fill it with.
 */
type DayPictures =
  /** The read has not answered yet, so the day's count is not known to be anything. */
  | 'waiting'
  /** The read answered that it could not say, which is a camera to look at and a page to try again. */
  | 'unread'
  /** The read answered, and the camera took nothing today. */
  | 'empty'
  /** The read answered with pictures, which are the ones the frame and the scrubber walk. */
  | 'filled';

/** Exported for the tests, which drive the page itself rather than the read above it. */
export function CameraScreen({ camera, refetching = null }: { camera: Camera; refetching?: string | null }) {
  const { t } = useTranslation();
  const now = useNow();
  // Every clock time on this screen is the account's, which is what the server
  // means by one: quiet hours are read in that zone and the Appearance page
  // promises it of every hour the app draws. A camera stamps its own pictures
  // and burns the instant into them, so a label an hour or two off is one this
  // page can be caught out on by the picture beside it. The demo has no account
  // to ask, and until the answer lands the browser's zone stands in.
  const me = useAccountMe();
  const zone = zoneOf(me.data);
  // The width a free camera's stills are served at is the install's setting,
  // and an install that sets none serves them whole - so the line under the
  // frame names a width only where `/me` gave one, and says nothing otherwise.
  const servedWidth = camera.entitlement.tier === 'free' ? (me.data?.premium.free.stillWidth ?? null) : null;
  // How late the camera's newest picture is. The header pill says it, and the
  // frame label reads it from here rather than deciding a second time.
  const liveness = cameraFreshness(camera, now);
  // A camera belongs to whoever claimed it and stands in a place, and the two
  // answer different halves: its settings and the films it renders are `manage`
  // where it stands, unpairing it is `own` and reaches nobody else at all.
  const youMay = useMayWith()(camera);
  const mayManage = enough(youMay, 'manage');
  const mayOwn = enough(youMay, 'own');
  const [composing, setComposing] = useState(false);
  const [job, setJob] = useState<Media | null>(null);
  const called = useCameraCalled();
  const spaces = useSpaces();
  const place = spaces.data?.items.find(space => space.id === camera.spaceId) ?? null;
  // A camera read through a device - a Terp Cam over its relay, a stream through
  // its tunnel - goes dark with that device, and is not even tried while the
  // device is offline. So that is what the page says then, rather than the
  // reason the last try before it failed, and the test button waits for it.
  const throughDevice = camera.deviceId !== null && readsThroughDevice(camera);
  const devices = useDevices(throughDevice);
  const carrier = throughDevice ? (devices.data?.items.find(device => device.id === camera.deviceId) ?? null) : null;
  const carrierOffline = carrier !== null && deviceLiveness(carrier.state.lastSeenAt, now) === 'offline';

  // The day the scrubber walks, which is the account's day and not the
  // browser's: a grower in Berlin reading a UTC account is two hours into
  // tomorrow at ten in the evening, and "today" would then be a day the camera
  // has taken no picture in. Its ends are fixed for as long as the day is - the
  // read is keyed on them, so the clock ticking is not a second read.
  const day = dayOf(now, zone);
  const frames = useCameraFrames(camera.id, day);
  const grows = useSpaceGrows(camera.spaceId);
  const films = useTimelapses(camera.id);
  const ask = useRequestTimelapse(camera.id);

  const grow = growOf(grows.data?.items ?? []);
  // The films of a phase and of a whole grow are the diary's: without it, and with no grow here, they are not offered at all.
  const diary = useDiaryLayer();
  const growFilms = grow !== null || diary;
  const shots = useMemo(() => [...(frames.data?.items ?? [])].sort((one, other) => at(one.capturedAt) - at(other.capturedAt)), [frames.data]);
  const from = shots.length > 0 ? at(shots[0].capturedAt) : at(day.startsAt);
  const newest = shots.at(-1) ?? null;
  // The right-hand end of the day is now, or the newest picture where that is
  // later. This screen's clock beats every ten seconds, and a picture taken
  // between two beats is already in the day's list while still being later than
  // the page's own now - so the frame drew the one before it and the label
  // under it said a time that had passed. It is what a press of the test button
  // produces every time: the picture the person asked for, a second old, and
  // the frame showing the one before it until the clock caught up.
  const to = Math.max(now.toMillis(), from + 1, newest ? at(newest.capturedAt) : 0);
  const [cursor, setCursor] = useState<number | null>(null);
  const time = cursor ?? to;
  const shown = frameAt(shots, time);
  const shownAt = shown ? stampOf(at(shown.capturedAt), to - from, zone) : null;
  // Decided once, above everything that draws from it, so that no two lines on
  // this screen can answer the same question differently. The read's own state
  // comes first: an empty `shots` is what a pending read and a failed one both
  // leave behind, and neither of them is the day being empty.
  const dayPictures: DayPictures = frames.isPending ? 'waiting' : frames.isError ? 'unread' : shots.length > 0 ? 'filled' : 'empty';
  // A day with no picture in it is not a camera with no picture. The tent's
  // card and the camera's own row both draw this camera's newest still with its
  // age, and this - the screen with the most room for it - is the one place
  // that drew a grey box instead. So the last picture there is stands in,
  // dimmed and dated, which is what an old value is owed. It is the same read
  // the composer on this page already makes.
  const lastStill = useLatestStills([camera.id]).get(camera.id) ?? null;
  const older = dayPictures === 'empty' || dayPictures === 'unread' ? lastStill : null;

  // Three films is the resting height of the section, not the whole of it: the
  // rest are behind the control below rather than dropped.
  const [everyFilm, setEveryFilm] = useState(false);
  const made = filmsOfEachSpan(itemsOf(films.data)).filter(film => film.id !== job?.id);
  const shownFilms = everyFilm ? made : made.slice(0, FILMS_AT_REST);
  const moreFilms = () => {
    if (everyFilm && films.hasNextPage) void films.fetchNextPage();
    setEveryFilm(true);
  };

  const request = (body: TimelapseCreate) =>
    ask.mutate(body, {
      onSuccess: accepted => {
        setJob(accepted.media);
        setComposing(false);
      },
    });

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        {/* The camera belongs to the place it watches: the way back leads there, as the cockpit's picture led here. */}
        <BackLink to={place ? placePath(place.id) : '/devices'} label={place?.name ?? t('shell.tabs.devices')} />
        <h1 className={styles.name}>{called(camera.name)}</h1>
        <span className={ui.live} data-liveness={liveness}>
          <span className={ui.liveDot} aria-hidden />
          {camera.state.lastStillAt
            ? liveness === 'live'
              ? t('camera.liveAge', { age: ageLabel(camera.state.lastStillAt, now) })
              : ageLabel(camera.state.lastStillAt, now)
            : t('camera.never')}
        </span>
      </header>

      {place ? (
        <p className={`mono ${styles.where}`}>
          <Link to={placePath(place.id)} className={ui.headLink}>
            {[place.name, grow && grow.endedAt === null ? `${grow.name} · ${t('home.card.dayN', { day: grow.summary.dayNumber ?? 1 })}` : null]
              .filter(Boolean)
              .join(' · ')}{' '}
            ›
          </Link>
          {' · '}
          <Link to={timelinePath(place.id)} className={ui.headLink}>
            {t('camera.inTimeline')} ›
          </Link>
        </p>
      ) : null}

      {refetching ? (
        <p className={`mono ${ui.note}`} role="status">
          {refetching}
        </p>
      ) : null}
      {/* The reason a capture failed is the camera's address, its tunnel and the
          paths of the process that reached for it - which the decision record
          keeps for the owner, like every other way of finding the hardware.
          Somebody who shares the tent is told it is not delivering, and that is
          what the pill above already says.

          What the line states is the kind of failure it was, because a
          paragraph of ffmpeg is the one thing a grower cannot act on and this
          is all the page says about a camera that has been dark for days. The
          words the server stored are the only way the one person who can fix
          the camera finds out what is wrong with it, so they stay - a tap
          below, selectable, rather than a line nobody can read. */}
      {carrier && carrierOffline ? (
        <OfflineHelp since={carrier.state.lastSeenAt} now={now} about={t('camera.carrierOffline', { device: deviceName(carrier, t) })} />
      ) : mayOwn && camera.state.lastError ? (
        <div className={styles.lastError} role="alert">
          <p className={ui.problem}>{t('camera.lastError', { reason: t(causeOf(camera.state.lastError)) })}</p>
          <details className={styles.rawError}>
            <summary className="mono">{t('camera.whatItSaid')}</summary>
            <p className="mono">{camera.state.lastError}</p>
          </details>
        </div>
      ) : null}

      {/* The picture and its films, and beside them on a wide screen what the
          camera is set to: two columns of one page. */}
      <div className={styles.watch}>
        <div className={`${ui.mat} ${styles.frame}`}>
          {shown ? (
            <img
              src={mediaUrl(shown.id, THUMBNAIL_WIDTH.frame) ?? undefined}
              // The same instant the label under the frame carries. A reader who
              // gets the picture through its alt text alone was told "just now"
              // about a still four days old, which is the one thing the frame's
              // own dimming and dated label were there to stop it saying.
              alt={t('camera.frameAlt', { name: camera.name, time: shownAt })}
            />
          ) : older && camera.state.lastStillAt ? (
            <img
              data-age="offline"
              src={mediaUrl(older, THUMBNAIL_WIDTH.frame) ?? undefined}
              // Its day, not just its hour: a picture from four days ago named by
              // the clock alone reads as this morning's.
              alt={t('camera.frameAlt', { name: camera.name, time: zonedAt(at(camera.state.lastStillAt), zone).toFormat(DATED_CLOCK) })}
            />
          ) : (
            // A read that failed is not a day with no picture in it. Told apart,
            // because the two ask for different things of whoever is reading:
            // one is a camera to go and look at, the other is this page to try
            // again - and a day the camera filled can be behind a read that
            // simply did not arrive.
            <p className={`mono ${ui.matNote}`}>
              {dayPictures === 'waiting' ? t('home.waiting') : dayPictures === 'unread' ? t('camera.framesUnread') : t('camera.noFramesToday')}
            </p>
          )}
          {shown ? (
            <span className={ui.photoCaption}>
              {shownAt}
              {/* "live" is a claim about how late the picture is, so it is the
                pill's own verdict that decides it and not the frame's position
                in the day. This camera misses most of its captures, and the
                header read "4 min · stale" over a frame that called itself
                live. Where the newest frame is not live it says how old it is,
                in the words the stale label four lines below uses - and from
                the instant of the picture actually on screen, which can be
                older than the camera row while that read is cached. */}
              {newest && shown.id === newest.id
                ? ` · ${liveness === 'live' ? t('camera.live') : t('devices.ago', { age: ageLabel(shown.capturedAt, now) })}`
                : ''}
            </span>
          ) : older && camera.state.lastStillAt ? (
            // Its own label rather than the one above: that stamp is scaled to
            // today's window and would date a picture from four days ago by the
            // clock alone. This one names its day and says how long ago it was,
            // exactly as the tent's card says it.
            <span className={ui.photoCaption} data-age="offline">
              {zonedAt(at(camera.state.lastStillAt), zone).toFormat(DATED_CLOCK)} ·{' '}
              {t('devices.ago', { age: ageLabel(camera.state.lastStillAt, now) })}
            </span>
          ) : null}
          {mayManage ? <TestImage cameraId={camera.id} mayOwn={mayOwn} offline={carrierOffline} /> : null}
        </div>

        {/* The scrubber walks between the day's pictures, so it is drawn where
          there are pictures to walk between. A camera dark for days drew one
          anyway, spanning midnight to now over a day that held nothing: the
          handle moved, the picture under it and its caption and the count
          never did, and a screen reader was told the cursor stood at an hour
          this morning over a still taken four days ago. A control that cannot
          change what it points at is worse than no control, and the same is
          true before the read has answered - the ends would be the whole day
          and then jump to the first picture as soon as it did. */}
        {dayPictures === 'filled' ? (
          <div className={ui.transport}>
            <span className={`mono ${styles.edge}`}>{zonedAt(from, zone).toFormat(CLOCK)}</span>
            <Slider from={from} to={to} cursor={Math.min(Math.max(time, from), to)} onScrub={setCursor} />
            <span className={`mono ${styles.edge}`}>{t('camera.now')}</span>
          </div>
        ) : null}
        {/* A read still out has no count in it and nothing here may invent one:
          "0 pictures today" under a frame still saying it is loading is the
          page contradicting itself in two adjacent lines. Nor does this line
          say "loading" a second time - by the same rule the failed read
          follows below, the frame above has the room and is already saying it,
          and while the read is out no older picture can be standing in that
          space instead. */}
        {dayPictures === 'waiting' ? null : dayPictures === 'unread' ? (
          // "0 pictures today" is a figure taken from a read that never arrived,
          // and a camera that has been filling the day all morning is the likeliest
          // thing behind it. So the day's count gives way to the read again, which
          // is the one move that gets the day back. The reason is said once: the
          // frame above carries it where it has the room, and this line takes it
          // over where an older picture is standing in that space instead.
          <p className={`mono ${styles.count}`} role="status">
            {shown || older ? `${t('camera.framesUnread')} ` : ''}
            <button type="button" className={styles.retryFrames} onClick={() => void frames.refetch()}>
              {t('home.retry')}
            </button>
          </p>
        ) : (
          <p className={`mono ${styles.count}`}>
            {/* A count the walk stopped short of is said as the floor it is, because
              a page size drawn as the day's total is a figure that is simply wrong. */}
            {t(frames.data?.partial ? 'camera.framesTodayAtLeast' : 'camera.framesToday', { count: shots.length })}
            {servedWidth !== null ? ` · ${t('camera.reduced', { width: servedWidth })}` : ''}
          </p>
        )}

        <section className={styles.section}>
          <span className="label">
            {t('camera.timelapses')}
            <Help topic="timelapses" />
          </span>
          {mayManage ? <Quick buttons={quickFilms(t, camera, grow, now, growFilms, zone)} onPick={request} /> : null}
          {mayManage ? <YoungerThan camera={camera} grow={grow} zone={zone} /> : null}
          {mayManage ? (
            <button type="button" className={`${ui.button} ${styles.compose}`} onClick={() => setComposing(true)}>
              {t('camera.makeOne')}
            </button>
          ) : null}
          <Refused error={ask.error} fallback={t('camera.askFailed')} />
          {job ? <Film mediaId={job.id} mayOwn={mayOwn} /> : null}
          {shownFilms.length > 0 ? (
            <ul className={`${ui.group} ${styles.films}`} aria-label={t('camera.timelapses')}>
              {shownFilms.map(film => (
                <li key={film.id}>
                  <Film mediaId={film.id} mayOwn={mayOwn} collapsed />
                </li>
              ))}
            </ul>
          ) : null}
          {made.length > shownFilms.length || films.hasNextPage ? (
            <button type="button" className={`${ui.button} ${styles.moreFilms}`} disabled={films.isFetchingNextPage} onClick={moreFilms}>
              {films.isFetchingNextPage ? t('home.waiting') : t('camera.moreFilms')}
            </button>
          ) : null}
          {!mayManage && made.length === 0 && !job ? <p className={ui.note}>{t('camera.noFilms')}</p> : null}
          {/* The week's film can come by itself every Monday; said here, where films are, rather than only in a grid under Me. */}
          {mayOwn && me.data?.notifications && !rowReaches(me.data, 'weekly_timelapse') ? (
            <Link to="/me/notifications" className={`mono ${styles.seePremium}`}>
              {t('camera.weekFilmByMail')} ›
            </Link>
          ) : null}
        </section>
      </div>

      <div className={styles.aside}>
        {!mayManage && enough(youMay, 'log') ? <p className={`mono ${styles.role}`}>{t('camera.youMayLog')}</p> : null}

        <CameraSettings camera={camera} mayManage={mayManage} mayOwn={mayOwn} />
      </div>

      {composing ? (
        <Composer camera={camera} grow={grow} growFilms={growFilms} pending={ask.isPending} onRender={request} onClose={() => setComposing(false)} />
      ) : null}
    </section>
  );
}

interface QuickFilm {
  label: string;
  body: TimelapseCreate;
  /** Why this one cannot be asked for, or null when it can. */
  reason: string | null;
  premium: boolean;
}

/**
 * The one-tap films. One that cannot be asked for is drawn refused rather
 * than left out, so the film that is missing has a reason beside it - and the
 * reason is given once however many buttons share it. Where the reason is
 * Premium, the page that says what Premium covers is one tap away from it.
 */
function Quick({ buttons, onPick }: { buttons: QuickFilm[]; onPick: (body: TimelapseCreate) => void }) {
  const { t } = useTranslation();
  const reasons = [...new Set(buttons.flatMap(one => (one.reason ? [one.reason] : [])))];
  const premiumRefused = buttons.some(one => one.premium && one.reason !== null);

  return (
    <>
      <div className={styles.buttons}>
        {buttons.map(one => (
          <button
            key={one.label}
            type="button"
            className={`${ui.chip} ${styles.quick}`}
            disabled={one.reason !== null}
            onClick={() => onPick(one.body)}
          >
            <Clapperboard size={13} strokeWidth={1.75} aria-hidden />
            {one.label}
            {one.premium ? <span className={styles.premium}>{t('devices.premium')}</span> : null}
          </button>
        ))}
      </div>
      {/* What a tap does, said once: it makes a film rather than playing one. */}
      {buttons.some(one => one.reason === null) ? <p className={ui.note}>{t('camera.quickNote')}</p> : null}
      {reasons.map(reason => (
        <p key={reason} className={ui.note}>
          {reason}
        </p>
      ))}
      {premiumRefused ? (
        <Link to="/me/premium" className={`mono ${styles.seePremium}`}>
          {t('camera.seePremium')} ›
        </Link>
      ) : null}
    </>
  );
}

/**
 * What each of the four asks for. Today carries the instant the server works
 * its bucket out around; a phase and a whole grow name both of their own ends,
 * because where either began is the grow's record. Those two are a diary's
 * films: for somebody who keeps none and has no grow here they are left out
 * rather than refused, because nothing is missing that they could start.
 * A diary with no grow standing here keeps them, refused with the reason.
 *
 * The week asks for a week and names no instant at all, which is what the route
 * documents as "the most recent complete window" and what it does with an
 * absent `startsAt`. Naming one was the bug: the server films the week holding
 * the instant it is given, which is the week still open, so the film offered
 * was the week that had opened that morning
 * - six days of it in the future, nothing in it but a few hours of stills, and
 * a failure every time. The camera it failed on had sixteen hundred pictures in
 * the week that had just ended, and its film of that week was sitting two rows
 * below, unreachable from this button.
 *
 * A film of a camera that has taken nothing is refused here rather than
 * rendered and failed, and each of the two buckets is proved empty by its own
 * arithmetic. The day bucket never starts earlier than a day before the instant
 * it is handed, so a newest picture older than that proves it empty whatever
 * zone anybody is in. The week the server picks for itself is the one before
 * the one holding now, so it cannot begin earlier than a fortnight ago, and a
 * picture older than that proves that one empty the same way. Both are the
 * conservative half of the rule - a camera that stopped after its bucket opened
 * can still produce an empty film - and both are the one test that can be made
 * on this side without repeating the server's arithmetic. The page's own count
 * of today's pictures is the wrong test, because that is the account's day and
 * the bucket is the server's.
 */
const quickFilms = (t: Translate, camera: Camera, grow: GrowListItem | null, now: DateTime, growFilms: boolean, zone: string | null): QuickFilm[] => {
  const free = camera.entitlement.tier === 'free';
  const noGrow = grow ? null : t('camera.noGrowHere');
  const empty = (window: 'day' | 'week'): string | null => {
    const reason = emptyRolling(window, camera.state.lastStillAt, now);
    return reason ? t(reason) : null;
  };
  const nothingToFilm = empty('day');
  // The week filmed is the last complete one, and a camera paired since it
  // began has no picture in it: said with the day it first has one, rather
  // than offered and failed.
  const firstWeekEnds = firstFullWeekEnd(camera, zone);
  const nothingThatWeek =
    firstWeekEnds !== null && firstWeekEnds.toMillis() > now.toMillis()
      ? t('camera.firstWeekEnds', { date: firstWeekEnds.toFormat(WEEKDAY_DAY) })
      : empty('week');

  const rolling: QuickFilm[] = [
    { label: t('camera.quick.day'), body: { window: 'day', startsAt: instantOf(now) }, reason: nothingToFilm, premium: false },
    { label: t('camera.quick.week'), body: { window: 'week' }, reason: nothingThatWeek, premium: false },
  ];
  if (!growFilms) return rolling;

  return [
    ...rolling,
    {
      label: t('camera.quick.phase'),
      body: { window: 'phase', startsAt: phaseStart(grow) ?? '', endsAt: instantOf(now) },
      reason: noGrow,
      premium: false,
    },
    {
      label: `${t('camera.quick.grow')} · ${t('camera.hd')}`,
      body: { window: 'grow', startsAt: grow?.startedAt ?? '', endsAt: grow?.endedAt ?? instantOf(now), quality: 'hd' },
      reason: noGrow ?? (free ? t('camera.needsPremium') : null),
      premium: free,
    },
  ];
};

/**
 * One picture, now. A camera that could not be read says the reason it gave,
 * because a wrong address is an ordinary outcome of this button.
 *
 * A press that worked says so as well. It stores a still, and the reads this
 * button asks again for then carry it onto the frame and into the count under
 * the scrubber - but the only line this ever drew was the failure, so on a
 * camera that was already delivering a press that took a picture and a press
 * that did nothing whatsoever looked exactly alike. The line names the picture
 * rather than the button's own success, because the picture is what the person
 * pressed it for.
 *
 * A request that never reached the server is neither of those two: the camera
 * was never asked, and the button may simply be pressed again.
 *
 * What a failed press says is the kind of failure it was, which the server
 * names by the same kinds the banner above the frame reads the camera's last
 * failure as: the words the server hands back are English whatever the screen
 * is set to, and "device aborted the capture" printed verbatim on a German page
 * was the button saying in the server's language what the line four rows above
 * was already saying in the grower's. A kind is the second half of a sentence -
 * the banner's "Last try failed: ..." - so standing alone here it is given the
 * first half the add screen gives it, "No picture: ...". The camera's own
 * words stay for the person who can go and fix it, behind the disclosure the
 * banner puts them behind and, like the banner, for the owner alone - they
 * name the address the cloud reaches the hardware at, and the server hands
 * them to nobody else.
 *
 * The press waits as long as the server's read of a camera may take - the
 * poller's and this button's are the same read - and a little longer. The
 * server ends that read itself, so nothing within it means the answers did not
 * get back here, and the line says to press again rather than to wait on.
 */
function TestImage({ cameraId, mayOwn, offline }: { cameraId: string; mayOwn: boolean; offline: boolean }) {
  const { t } = useTranslation();
  const test = useTestCapture(cameraId);
  const failed = test.data?.state === 'failed' ? test.data : null;

  return (
    <div className={styles.testWrap}>
      {/* Held while the device is offline, which the box above the picture says
          in full; the button carries the short reason for whoever reaches it alone. */}
      <button
        type="button"
        className={`${ui.button} ${styles.test}`}
        disabled={test.isPending || offline}
        title={offline ? t('camera.testOffline') : undefined}
        onClick={() => test.mutate()}
      >
        {test.isPending ? t('camera.testing') : t('camera.testImage')}
      </button>
      {test.error ? (
        <span className={styles.testWhy} role="alert">
          {gaveUp(test.error) ? t('camera.testNoAnswer', { minutes: CAPTURE_BUDGET_SECONDS / 60 }) : refusalText(test.error, t('camera.testFailed'))}
        </span>
      ) : test.data?.state === 'done' ? (
        <span className={`mono ${styles.testWorked}`} role="status">
          {t('camera.testWorked')}
        </span>
      ) : failed ? (
        <span className={styles.testWhy} role="alert">
          {t('camera.testNoPicture', { reason: t(`camera.failure.${failed.reason ?? 'unknown'}`) })}
        </span>
      ) : null}
      {mayOwn && failed?.error ? (
        <details className={styles.testSaid}>
          <summary className="mono">{t('camera.whatItSaid')}</summary>
          <p className="mono">{failed.error}</p>
        </details>
      ) : null}
    </div>
  );
}

/**
 * The films of this camera, one verdict per span: where a span has a film that
 * plays, a failed attempt at the same span is left out.
 *
 * A camera keeps a film per span and window, and the window is what the render
 * was asked for rather than what it covers - so "Today" and the same day
 * composed with the lights-off frames kept are two rows of one day, and nothing
 * on either row says which is which. They are also ordered by their span and
 * then by their id, so which of the two comes first is decided by a random
 * uuid: the page showed "24 Sep 00:00 -> 24 Sep 23:59 / failed" as the third of
 * the three rows it rests at, and the finished film of that very span - the one
 * the composer had just been watching go ready - sat behind "More films".
 *
 * A grower reading a span's row wants to know whether they can watch that day,
 * and where the answer is yes, a failed attempt at it is not an answer at all.
 * The failure is dropped rather than ranked below its twin, because two rows
 * that name the same span and disagree are what the reader cannot tell apart.
 */
const filmsOfEachSpan = (films: Media[]): Media[] => {
  const played = new Set(films.filter(film => filmStatus(film) === 'ready').map(spanOf));

  return films.filter(film => filmStatus(film) !== 'failed' || !played.has(spanOf(film)));
};

/** Which span a film is of, as the two ends the row itself draws. */
const spanOf = (film: Media): string => `${film.capturedAt}|${film.endsAt ?? ''}`;

/** The grow this camera films: the one still standing in its space, else the last one that did. */
const growOf = (grows: GrowListItem[]): GrowListItem | null => grows.find(grow => grow.endedAt === null) ?? grows[0] ?? null;

/**
 * The end of the first whole week this camera took pictures in, in the
 * account's calendar - Monday to Sunday, as the server cuts it - or null where
 * that week is long over.
 */
const firstFullWeekEnd = (camera: Camera, zone: string | null): DateTime | null => {
  const paired = zoned(camera.createdAt, zone);
  const weekStart = paired.startOf('week');
  const first = paired.toMillis() === weekStart.toMillis() ? weekStart : weekStart.plus({ weeks: 1 });
  return first.plus({ weeks: 1 }).minus({ milliseconds: 1 });
};

/**
 * Where the camera is younger than the phase or the grow it would film, the
 * films of those spans begin where its pictures do - which a grower expecting
 * five weeks of growth in one film should know before tapping.
 */
function YoungerThan({ camera, grow, zone }: { camera: Camera; grow: GrowListItem | null; zone: string | null }) {
  const { t } = useTranslation();
  const begun = phaseStart(grow) ?? grow?.startedAt ?? null;
  if (!grow || !begun || camera.createdAt <= begun) return null;

  return <p className={ui.note}>{t('camera.picturesSince', { date: zoned(camera.createdAt, zone).toFormat(DATED_CLOCK) })}</p>;
}

/** Where the phase being filmed began, which is the grow's own record and never a day counter read backwards. */
const phaseStart = (grow: GrowListItem | null): string | null => grow?.phases.at(-1)?.startedAt ?? null;

/** The account's own day around an instant, as the frames read asks for one. */
const dayOf = (now: DateTime, zone: string | null): { startsAt: string; endsAt: string } => {
  const start = zonedAt(now.toMillis(), zone).startOf('day');

  return { startsAt: instantOf(start), endsAt: instantOf(start.endOf('day')) };
};
