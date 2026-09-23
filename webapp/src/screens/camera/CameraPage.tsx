import { ChevronLeft, Play } from 'lucide-react';
import { DateTime } from 'luxon';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import type { Camera, GrowListItem, Media, TimelapseCreate } from '@fg2/shared-types/v1';
import { useMe } from '@/api/account';
import { useCamera, useCameraFrames, useRequestTimelapse, useTestCapture, useTimelapses } from '@/api/cameras';
import { useSpaceGrows } from '@/api/grows';
import { ApiError, noLongerThere } from '@/api/problem';
import { mediaUrl, THUMBNAIL_WIDTH, useSession } from '@/api/session';
import { ageLabel, instantOf } from '@/ui/age';
import { useReportFreshness } from '@/ui/freshness';
import { LoadFailed, NoLongerHere, Waiting } from '@/ui/PageState';
import { enough, useMayWith } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { zoneOf } from '@/ui/zone';
import { cameraFreshness } from '../devices/cameras';
import { at, STAMPS, stampFor } from '../timeline/window';
import { Slider } from '../timeline/CameraFrame';
import timeline from '../timeline/Timeline.module.css';
import { Composer } from './Composer';
import { Film } from './Film';
import { CameraSettings } from './CameraSettings';
import styles from './CameraPage.module.css';

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

/** Exported for the tests, which drive the page itself rather than the read above it. */
export function CameraScreen({ camera, refetching = null }: { camera: Camera; refetching?: string | null }) {
  const { t } = useTranslation();
  const now = useNow();
  const { user } = useSession();
  // Every clock time on this screen is the account's, which is what the server
  // means by one: quiet hours are read in that zone and the Appearance page
  // promises it of every hour the app draws. A camera stamps its own pictures
  // and burns the instant into them, so a label an hour or two off is one this
  // page can be caught out on by the picture beside it. The demo has no account
  // to ask, and until the answer lands the browser's zone stands in.
  const me = useMe(false, user?.isDemo !== true);
  const zone = zoneOf(me.data);
  // A camera belongs to whoever claimed it and stands in a place, and the two
  // answer different halves: its settings and the films it renders are `manage`
  // where it stands, unpairing it is `own` and reaches nobody else at all.
  const youMay = useMayWith()(camera);
  const mayManage = enough(youMay, 'manage');
  const mayOwn = enough(youMay, 'own');
  const [composing, setComposing] = useState(false);
  const [job, setJob] = useState<Media | null>(null);

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
  const shots = useMemo(() => [...(frames.data?.items ?? [])].sort((one, other) => at(one.capturedAt) - at(other.capturedAt)), [frames.data]);
  const from = shots.length > 0 ? at(shots[0].capturedAt) : DateTime.fromISO(day.startsAt).toMillis();
  const to = Math.max(now.toMillis(), from + 1);
  const [cursor, setCursor] = useState<number | null>(null);
  const time = cursor ?? to;
  const shown = frameAt(shots, time);
  const newest = shots.at(-1) ?? null;

  // Three films is the resting height of the section, not the whole of it: the
  // rest are behind the control below rather than dropped.
  const [everyFilm, setEveryFilm] = useState(false);
  const made = (films.data?.pages.flatMap(page => page.items) ?? []).filter(film => film.id !== job?.id);
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
        <Link to="/devices" className={styles.back} aria-label={t('shell.tabs.devices')}>
          <ChevronLeft size={22} strokeWidth={1.75} aria-hidden />
        </Link>
        <h1 className={styles.name}>{camera.name}</h1>
        <span className={`mono ${styles.pill}`} data-liveness={cameraFreshness(camera, now)}>
          <span className={styles.dot} aria-hidden />
          {camera.state.lastStillAt ? ageLabel(camera.state.lastStillAt, now) : t('camera.never')}
        </span>
      </header>

      {refetching ? (
        <p className={`mono ${ui.note}`} role="status">
          {refetching}
        </p>
      ) : null}
      {/* The reason a capture failed is the camera's address, its tunnel and the
          paths of the process that reached for it - which the decision record
          keeps for the owner, like every other way of finding the hardware.
          Somebody who shares the tent is told it is not delivering, and that is
          what the pill above already says. */}
      {mayOwn && camera.state.lastError ? (
        <p className={`${ui.problem} ${styles.lastError}`} role="alert" title={camera.state.lastError}>
          {t('camera.lastError', { reason: camera.state.lastError })}
        </p>
      ) : null}

      <div className={styles.frame}>
        {shown ? (
          <img
            className={styles.still}
            src={mediaUrl(shown.id, THUMBNAIL_WIDTH.frame) ?? undefined}
            alt={t('camera.frameAlt', { name: camera.name })}
          />
        ) : (
          <p className={`mono ${styles.noFrame}`}>{frames.isPending ? t('home.waiting') : t('camera.noFramesToday')}</p>
        )}
        {shown ? (
          <span className={`mono ${styles.frameLabel}`}>
            {inZone(at(shown.capturedAt), zone).toFormat(STAMPS[stampFor(to - from)])}
            {newest && shown.id === newest.id ? ` · ${t('camera.live')}` : ''}
          </span>
        ) : null}
        {mayManage ? <TestImage cameraId={camera.id} /> : null}
      </div>

      <div className={`${timeline.bareSlider} ${styles.transport}`}>
        <span className={`mono ${styles.edge}`}>{inZone(from, zone).toFormat('HH:mm')}</span>
        <Slider from={from} to={to} cursor={Math.min(Math.max(time, from), to)} onScrub={setCursor} />
        <span className={`mono ${styles.edge}`}>{t('camera.now')}</span>
      </div>
      <p className={`mono ${styles.count}`}>
        {/* A count the walk stopped short of is said as the floor it is, because
            a page size drawn as the day's total is a figure that is simply wrong. */}
        {t(frames.data?.partial ? 'camera.framesTodayAtLeast' : 'camera.framesToday', { count: shots.length })}
        {/* A free camera's picture is smaller than the one stored, and the line under it says so rather than leaving the blur unexplained. */}
        {camera.entitlement.tier === 'free' ? ` · ${t('camera.reduced')}` : ''}
      </p>

      <section className={styles.section}>
        <span className="label">{t('camera.timelapses')}</span>
        {mayManage ? <Quick buttons={quickFilms(t, camera, grow, now)} onPick={request} /> : null}
        {mayManage ? (
          <button type="button" className={`${ui.button} ${styles.compose}`} onClick={() => setComposing(true)}>
            {t('camera.makeOne')}
          </button>
        ) : null}
        {ask.error ? (
          <p className={ui.problem} role="alert">
            {ask.error instanceof ApiError ? ask.error.problem.detail || ask.error.problem.title : t('camera.askFailed')}
          </p>
        ) : null}
        {job ? <Film mediaId={job.id} /> : null}
        {shownFilms.length > 0 ? (
          <ul className={styles.films} aria-label={t('camera.timelapses')}>
            {shownFilms.map(film => (
              <li key={film.id}>
                <Film mediaId={film.id} collapsed />
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
      </section>

      {!mayManage && enough(youMay, 'log') ? <p className={`mono ${styles.role}`}>{t('camera.youMayLog')}</p> : null}

      <CameraSettings camera={camera} mayManage={mayManage} mayOwn={mayOwn} />

      {composing ? <Composer camera={camera} grow={grow} pending={ask.isPending} onRender={request} onClose={() => setComposing(false)} /> : null}
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
 * The four one-tap films. One that cannot be asked for is drawn refused rather
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
            <Play size={11} fill="currentColor" aria-hidden />
            {one.label}
            {one.premium ? <span className={styles.premium}>{t('devices.premium')}</span> : null}
          </button>
        ))}
      </div>
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
 * What each of the four asks for. The two rolling spans carry only the instant
 * the server works its bucket out around; a phase and a whole grow name both of
 * their own ends, because where either began is the grow's record.
 */
const quickFilms = (t: Translate, camera: Camera, grow: GrowListItem | null, now: DateTime): QuickFilm[] => {
  const free = camera.entitlement.tier === 'free';
  const noGrow = grow ? null : t('camera.noGrowHere');

  return [
    { label: t('camera.window.day'), body: { window: 'day', startsAt: instantOf(now) }, reason: null, premium: false },
    { label: t('camera.window.week'), body: { window: 'week', startsAt: instantOf(now) }, reason: null, premium: false },
    {
      label: t('camera.window.phase'),
      body: { window: 'phase', startsAt: phaseStart(grow) ?? '', endsAt: instantOf(now) },
      reason: noGrow,
      premium: false,
    },
    {
      label: `${t('camera.window.grow')} · ${t('camera.hd')}`,
      body: { window: 'grow', startsAt: grow?.startedAt ?? '', endsAt: grow?.endedAt ?? instantOf(now), quality: 'hd' },
      reason: noGrow ?? (free ? t('camera.needsPremium') : null),
      premium: free,
    },
  ];
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * One picture, now. A camera that could not be read says the reason it gave,
 * because a wrong address is an ordinary outcome of this button.
 */
function TestImage({ cameraId }: { cameraId: string }) {
  const { t } = useTranslation();
  const test = useTestCapture(cameraId);

  return (
    <span className={styles.testWrap}>
      <button type="button" className={`${ui.button} ${styles.test}`} disabled={test.isPending} onClick={() => test.mutate()}>
        {test.isPending ? t('camera.testing') : t('camera.testImage')}
      </button>
      {test.data && !test.data.succeeded ? (
        <span className={styles.testWhy} role="alert">
          {test.data.error}
        </span>
      ) : null}
    </span>
  );
}

/** The grow this camera films: the one still standing in its space, else the last one that did. */
const growOf = (grows: GrowListItem[]): GrowListItem | null => grows.find(grow => grow.endedAt === null) ?? grows[0] ?? null;

/** Where the phase being filmed began, which is the grow's own record and never a day counter read backwards. */
const phaseStart = (grow: GrowListItem | null): string | null => grow?.phases.at(-1)?.startedAt ?? null;

/** The account's own day around an instant, as the frames read asks for one. */
const dayOf = (now: DateTime, zone: string | null): { startsAt: string; endsAt: string } => {
  const start = inZone(now.toMillis(), zone).startOf('day');

  return { startsAt: instantOf(start), endsAt: instantOf(start.endOf('day')) };
};

/** A moment of the day read where the account is rather than where the browser is. */
const inZone = (time: number, zone: string | null): DateTime => {
  const at = DateTime.fromMillis(time);

  return zone ? at.setZone(zone) : at;
};

/** The newest picture taken by the cursor, and the oldest there is before the first one. */
const frameAt = (shots: Media[], time: number): Media | null => {
  if (shots.length === 0) return null;
  let found = shots[0];
  for (const shot of shots) {
    if (at(shot.capturedAt) > time) break;
    found = shot;
  }

  return found;
};
