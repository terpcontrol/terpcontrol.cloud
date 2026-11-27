import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useParams, useSearchParams } from 'react-router';
import type { Camera, StillDeletion, StillDeletionHour } from '@fg2/shared-types/v1';
import { serverNow } from '@/api/clock';
import { useCamera, useDeleteStills, useStillDeletionPreview, useStillsOf } from '@/api/cameras';
import { itemsOf } from '@/api/pages';
import { noLongerThere } from '@/api/problem';
import { mediaUrl, THUMBNAIL_WIDTH } from '@/api/session';
import { usePageOfPlace } from '@/app/places';
import { useLog } from '@/log/log-context';
import { Asking } from '@/ui/Asking';
import { useCameraCalled } from '@/ui/camera-name';
import { clockOf, dayOf, HOUR_MS, momentAt } from '@/ui/days';
import { PageHead } from '@/ui/PageHead';
import { LoadFailed, NoLongerHere, Refused, Waiting } from '@/ui/PageState';
import { enough, useMayWith } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { CLOCK, DAY_IN_YEAR, useZone, zoned } from '@/ui/zone';
import { sayImpact } from './impact';
import { countOf, deletionOf, isPicked, NOTHING, toggled, type Picked } from './selection';
import styles from './CameraPictures.module.css';

/** A span longer than this shows each hour folded to one tile, opened by a tap: a month of hours is too many rows to read. */
const UNFOLDED_MS = 24 * HOUR_MS;

/** A whole minute typed into the "until" field takes the pictures of that minute too. */
const LAST_OF_A_MINUTE_MS = 59_999;

/**
 * Deleting pictures of one camera: a span by its two ends, its pictures hour by
 * hour, newest first, picked one by one or all at once, and deleted for good -
 * the films holding them are made again without them. A picture the diary
 * holds stays, and is shown so.
 */
export function CameraPictures() {
  const { t } = useTranslation();
  const { cameraId = '' } = useParams();
  const camera = useCamera(cameraId);
  usePageOfPlace(camera.data?.spaceId ?? null);

  if (camera.isPending) return <Waiting lines={3} />;
  if (camera.data) return <Pictures camera={camera.data} />;
  return noLongerThere(camera.error) ? <NoLongerHere what="camera" /> : <LoadFailed title={t('shell.gone.title.camera')} read={camera} />;
}

function Pictures({ camera }: { camera: Camera }) {
  const { t } = useTranslation();
  const zone = useZone();
  const called = useCameraCalled();
  const { tell } = useLog();
  const mayManage = enough(useMayWith()(camera), 'manage');
  const [params] = useSearchParams();
  const [day] = useState(() => params.get('date') ?? dayOf(serverNow().toJSDate(), zone));
  const [from, setFrom] = useState({ day, time: '00:00' });
  const [until, setUntil] = useState({ day, time: '23:59' });

  const startsAt = momentAt(from.day, from.time, zone);
  const endsAt = momentAt(until.day, until.time, zone);
  const span =
    startsAt && endsAt && startsAt <= endsAt
      ? { startsAt: startsAt.toISOString(), endsAt: new Date(endsAt.getTime() + LAST_OF_A_MINUTE_MS).toISOString() }
      : null;

  const laid = useStillDeletionPreview(camera.id, span);
  const hours = laid.data?.hours ?? [];
  const kept = useMemo(() => new Set(laid.data?.kept ?? []), [laid.data]);
  const total = hours.reduce((sum, hour) => sum + hour.stills, 0);
  // Another span is other pictures: what was picked in the last one is not carried over.
  const spanKey = span ? `${span.startsAt}/${span.endsAt}` : '';
  const [choice, setChoice] = useState<{ spanKey: string; picked: Picked }>({ spanKey, picked: NOTHING });
  const picked = choice.spanKey === spanKey ? choice.picked : NOTHING;
  const count = countOf(picked, total, kept.size);
  const folded = span !== null && Date.parse(span.endsAt) - Date.parse(span.startsAt) > UNFOLDED_MS;

  const [asking, setAsking] = useState<StillDeletion | null>(null);
  // A question asked of other pictures than the ones picked now is not answered.
  const setPicked = (next: Picked) => {
    setChoice({ spanKey, picked: next });
    setAsking(null);
  };
  const impact = useStillDeletionPreview(camera.id, asking);
  const remove = useDeleteStills(camera.id);
  const ask = () => span && setAsking(deletionOf(picked, span));
  const yes = () =>
    asking &&
    remove.mutate(asking, {
      onSuccess: done => {
        setAsking(null);
        setPicked(NOTHING);
        tell({ label: t(done.films.some(film => film.remade) ? 'pictures.deletedRemade' : 'pictures.deleted', { count: done.stills }), undo: null });
      },
    });

  if (!mayManage) return <Navigate to={`/cameras/${camera.id}`} replace />;

  return (
    <section className={`${ui.stack3} ${ui.page} ${styles.page}`}>
      <PageHead title={t('pictures.title')} back={{ to: `/cameras/${camera.id}`, label: called(camera.name) }} />
      <p className={ui.note}>{t('pictures.intro')}</p>

      <div className={styles.span}>
        <When label={t('pictures.from')} at={from} onChange={setFrom} />
        <When label={t('pictures.until')} at={until} onChange={setUntil} />
      </div>
      {span === null ? <p className={ui.problem}>{t('pictures.backwards')}</p> : null}

      <div className={styles.summary}>
        <p aria-live="polite">{laid.isPending && span ? t('home.waiting') : t('pictures.picked', { count, total })}</p>
        {total > kept.size ? (
          <button
            type="button"
            className={ui.button}
            onClick={() => setPicked(picked.all && picked.ids.size === 0 ? NOTHING : { all: true, ids: new Set() })}
          >
            {t(picked.all && picked.ids.size === 0 ? 'pictures.none' : 'pictures.all')}
          </button>
        ) : null}
      </div>
      {kept.size > 0 ? <p className={ui.note}>{t('pictures.keptNote', { count: kept.size })}</p> : null}
      <Refused error={laid.error} />

      {span && laid.data && total === 0 ? <p className={ui.note}>{t('pictures.empty')}</p> : null}
      <div className={styles.hours}>
        {hours.map(hour => (
          <Hour
            key={hour.startsAt}
            cameraId={camera.id}
            hour={hour}
            zone={zone}
            dated={folded}
            foldedAtFirst={folded}
            picked={picked}
            kept={kept}
            onToggle={id => setPicked(toggled(picked, id))}
          />
        ))}
      </div>

      <div className={styles.foot}>
        {asking ? (
          impact.data ? (
            <Asking
              note={sayImpact(t, impact.data.stills, impact.data.films, zone)}
              yes={t('pictures.yes', { count: impact.data.stills })}
              danger
              busy={remove.isPending}
              onYes={yes}
              onCancel={() => setAsking(null)}
            >
              <Refused error={remove.error} />
            </Asking>
          ) : (
            <>
              <p>{t('home.waiting')}</p>
              <Refused error={impact.error} />
            </>
          )
        ) : (
          <button type="button" className={`${ui.button} ${ui.dangerOutline}`} disabled={count === 0} onClick={ask}>
            {t('pictures.delete', { count })}
          </button>
        )}
      </div>
    </section>
  );
}

/** One end of the span: a day and a time of day, where the account is. */
function When({ label, at, onChange }: { label: string; at: { day: string; time: string }; onChange: (at: { day: string; time: string }) => void }) {
  return (
    <fieldset className={styles.when}>
      <legend className="label">{label}</legend>
      <input className={ui.input} type="date" aria-label={label} value={at.day} onChange={event => onChange({ ...at, day: event.target.value })} />
      <input className={ui.input} type="time" aria-label={label} value={at.time} onChange={event => onChange({ ...at, time: event.target.value })} />
    </fieldset>
  );
}

/**
 * One hour of the span: its pictures in a row that scrolls sideways, read once
 * the row comes into view. Folded, it is one tile with the hour's newest picture
 * and how many it holds.
 */
function Hour({
  cameraId,
  hour,
  zone,
  dated,
  foldedAtFirst,
  picked,
  kept,
  onToggle,
}: {
  cameraId: string;
  hour: StillDeletionHour;
  zone: string | null;
  dated: boolean;
  foldedAtFirst: boolean;
  picked: Picked;
  kept: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  const { t } = useTranslation();
  const row = useRef<HTMLDivElement>(null);
  const seen = useSeen(row);
  const [open, setOpen] = useState(!foldedAtFirst);
  const span = { startsAt: hour.startsAt, endsAt: new Date(Date.parse(hour.startsAt) + HOUR_MS - 1).toISOString() };
  const stills = useStillsOf(cameraId, span, open && seen);
  const starts = zoned(hour.startsAt, zone);
  const heading = `${dated ? `${starts.toFormat(DAY_IN_YEAR)} ` : ''}${starts.toFormat(CLOCK)}–${starts.plus({ hours: 1 }).toFormat(CLOCK)}`;

  return (
    <div className={styles.hour} ref={row}>
      <h2 className={styles.hourHead}>
        <span>{heading}</span>
        <span className={styles.hourCount}>{t('pictures.inHour', { count: hour.stills })}</span>
      </h2>
      {open ? (
        <div className={`${ui.scrollRow} ${styles.tiles}`}>
          {itemsOf(stills.data).map(still => (
            <Tile
              key={still.id}
              id={still.id}
              time={clockOf(new Date(still.capturedAt), zone)}
              kept={kept.has(still.id)}
              picked={isPicked(picked, still.id) && !kept.has(still.id)}
              onToggle={onToggle}
            />
          ))}
          {stills.hasNextPage ? (
            <button
              type="button"
              className={`${ui.button} ${styles.more}`}
              disabled={stills.isFetchingNextPage}
              onClick={() => void stills.fetchNextPage()}
            >
              {t('pictures.more')}
            </button>
          ) : null}
          {stills.isPending && seen ? <span className={styles.wait}>{t('home.waiting')}</span> : null}
        </div>
      ) : (
        <button
          type="button"
          className={styles.folded}
          onClick={() => setOpen(true)}
          aria-label={t('pictures.unfold', { hour: heading, count: hour.stills })}
        >
          <img src={mediaUrl(hour.newestId, THUMBNAIL_WIDTH.still) ?? undefined} alt="" loading="lazy" />
          <span>{t('pictures.inHour', { count: hour.stills })} ›</span>
        </button>
      )}
      <Refused error={stills.error} />
    </div>
  );
}

function Tile({ id, time, kept, picked, onToggle }: { id: string; time: string; kept: boolean; picked: boolean; onToggle: (id: string) => void }) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      className={styles.tile}
      data-picked={picked || undefined}
      data-kept={kept || undefined}
      aria-pressed={kept ? undefined : picked}
      aria-disabled={kept || undefined}
      aria-label={t(kept ? 'pictures.keptTile' : 'pictures.tile', { time })}
      onClick={kept ? undefined : () => onToggle(id)}
    >
      <img src={mediaUrl(id, THUMBNAIL_WIDTH.still) ?? undefined} alt="" loading="lazy" />
      <span className={styles.time}>{time}</span>
      <span className={styles.mark} aria-hidden>
        {kept ? t('pictures.keptMark') : picked ? '✓' : ''}
      </span>
    </button>
  );
}

/** Whether the element has come into view once; true at once where the browser cannot tell. */
function useSeen(element: React.RefObject<HTMLElement | null>): boolean {
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    if (seen || !element.current) return;
    const observer = new IntersectionObserver(entries => entries.some(entry => entry.isIntersecting) && setSeen(true), { rootMargin: '200px' });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [seen, element]);

  return seen;
}
