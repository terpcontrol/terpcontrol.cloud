import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Camera, GrowListItem, MediaAspect, MediaOverlays, MediaQuality, MediaWindow, TimelapseCreate } from '@fg2/shared-types/v1';
import { useMe } from '@/api/account';
import { useCameras, useLatestStills } from '@/api/cameras';
import { serverNow } from '@/api/clock';
import { mediaUrl, THUMBNAIL_WIDTH, useSession } from '@/api/session';
import { Sheet } from '@/log/Sheet';
import { instantOf } from '@/ui/age';
import ui from '@/ui/ui.module.css';
import { zoneOf } from '@/ui/zone';
import styles from './CameraPage.module.css';

/** The ranges the composer offers, in the order the board draws them. */
const RANGES: MediaWindow[] = ['day', 'week', 'phase', 'grow', 'custom'];

const ASPECTS: MediaAspect[] = ['16_9', '9_16', '1_1'];

interface ComposerProps {
  camera: Camera;
  /** The grow standing where this camera does; null where nothing grows there. */
  grow: GrowListItem | null;
  pending: boolean;
  onRender: (body: TimelapseCreate) => void;
  onClose: () => void;
}

/**
 * The composer: which span, one camera or two side by side, what is drawn over
 * the frames, what shape the film is and how big it is rendered.
 *
 * The two rolling spans are worked out by the server around the instant it is
 * given; a phase, a whole grow and a span somebody drew name both of their own
 * ends, because where a phase began is the grow's record and not something the
 * server can guess. A range that needs a grow and has none is drawn refused
 * with the reason, rather than offered and then turned down.
 */
export function Composer({ camera, grow, pending, onRender, onClose }: ComposerProps) {
  const { t } = useTranslation();
  const { user } = useSession();
  // A date somebody picks here is a day of theirs, so the days the fields open
  // on and the instants they are turned into are the account's - the same zone
  // the rest of the app draws its clocks in. Read from the cache the camera
  // page has already filled; until it answers, the browser's zone stands in.
  const me = useMe(false, user?.isDemo !== true);
  const zone = zoneOf(me.data);
  const [range, setRange] = useState<MediaWindow>('day');
  const [from, setFrom] = useState(today(zone, 7));
  const [to, setTo] = useState(today(zone, 0));
  const [secondCameraId, setSecondCameraId] = useState<string | null>(null);
  const [overlays, setOverlays] = useState<MediaOverlays>({ dayCounter: true, climate: true, entries: true });
  const [includeLightsOff, setIncludeLightsOff] = useState(false);
  const [aspect, setAspect] = useState<MediaAspect>('16_9');

  const beside = useCameras(camera.spaceId ?? undefined);
  const others = (beside.data?.items ?? []).filter(one => one.id !== camera.id);
  // The newest picture, as the camera's own row reads it: the preview is what
  // the film is made of and not a frame of the range, which has no picture of
  // its own until it is rendered.
  const preview = useLatestStills([camera.id]).get(camera.id) ?? null;

  const free = camera.entitlement.tier === 'free';
  const span = spanOf(range, grow, from, to, zone);
  // A film of a whole grow is Premium whatever it is rendered at, so the range
  // is refused rather than only the HD button: SD would be offered and then
  // turned down by the server.
  const refusal = span.reason ? t(span.reason) : free && range === 'grow' ? t('camera.needsPremium') : null;

  const render = (quality: MediaQuality) =>
    onRender({
      window: range,
      ...(span.startsAt ? { startsAt: span.startsAt } : {}),
      ...(span.endsAt ? { endsAt: span.endsAt } : {}),
      quality,
      secondCameraId: secondCameraId ?? undefined,
      overlays,
      includeLightsOff,
      aspect,
    });

  return (
    <Sheet title={t('composer.title')} aside={grow?.name} onClose={onClose}>
      <div className={styles.composer}>
        <div className={styles.preview}>
          {preview ? (
            <img className={styles.still} src={mediaUrl(preview, THUMBNAIL_WIDTH.frame) ?? undefined} alt="" />
          ) : (
            <p className={`mono ${styles.noFrame}`}>{t('camera.noFramesToday')}</p>
          )}
          <span className={`mono ${styles.frameLabel}`}>{t('composer.previewOf', { range: t(`camera.window.${range}`) })}</span>
        </div>

        <Group label={t('composer.range')}>
          {RANGES.map(one => (
            <button key={one} type="button" className={`${ui.chip} ${styles.chip}`} aria-pressed={one === range} onClick={() => setRange(one)}>
              {t(`camera.window.${one}`)}
              {one === 'phase' && grow?.summary.stage ? ` · ${t(`home.stage.${grow.summary.stage}`)}` : ''}
            </button>
          ))}
        </Group>

        {range === 'custom' ? (
          <div className={styles.dates}>
            <label className="label">
              {t('composer.from')}
              <input className={ui.input} type="date" value={from} max={to} onChange={event => setFrom(event.target.value)} />
            </label>
            <label className="label">
              {t('composer.to')}
              <input className={ui.input} type="date" value={to} min={from} onChange={event => setTo(event.target.value)} />
            </label>
          </div>
        ) : null}

        <Group label={t('composer.cam')}>
          <button
            type="button"
            className={`${ui.chip} ${styles.chip}`}
            aria-pressed={secondCameraId === null}
            onClick={() => setSecondCameraId(null)}
          >
            {camera.name}
          </button>
          {others.map(one => (
            <button
              key={one.id}
              type="button"
              className={`${ui.chip} ${styles.chip}`}
              aria-pressed={secondCameraId === one.id}
              onClick={() => setSecondCameraId(one.id)}
            >
              {t('composer.split', { name: one.name })}
            </button>
          ))}
          {others.length === 0 ? <span className={ui.note}>{t('composer.oneCameraHere')}</span> : null}
        </Group>

        <div className={styles.switches}>
          <span className="label">{t('composer.overlays')}</span>
          <Toggle label={t('composer.dayCounter')} on={overlays.dayCounter} onToggle={value => setOverlays({ ...overlays, dayCounter: value })} />
          <Toggle label={t('composer.climate')} on={overlays.climate} onToggle={value => setOverlays({ ...overlays, climate: value })} />
          <Toggle
            label={t('composer.entries')}
            hint={t('composer.entriesHint')}
            on={overlays.entries}
            onToggle={value => setOverlays({ ...overlays, entries: value })}
          />
          <Toggle label={t('composer.lightsOff')} on={includeLightsOff} onToggle={setIncludeLightsOff} />
        </div>

        <Group label={t('composer.format')}>
          {ASPECTS.map(one => (
            <button key={one} type="button" className={`${ui.chip} ${styles.chip}`} aria-pressed={one === aspect} onClick={() => setAspect(one)}>
              {t(`composer.aspect.${one}`)}
            </button>
          ))}
        </Group>

        {refusal ? (
          <p className={ui.note} role="status">
            {refusal}
          </p>
        ) : null}

        <div className={styles.renderRow}>
          <button
            type="button"
            className={`${ui.button} ${ui.primary} ${styles.render}`}
            disabled={pending || refusal !== null || free}
            onClick={() => render('hd')}
          >
            {t('composer.renderHd')}
            {free ? <span className={styles.premium}>{t('devices.premium')}</span> : null}
          </button>
          <button type="button" className={ui.button} disabled={pending || refusal !== null} onClick={() => render('sd')}>
            {t('composer.renderSd')}
          </button>
        </div>
        {free && range !== 'grow' ? <p className={ui.note}>{t('camera.needsPremium')}</p> : null}
      </div>
    </Sheet>
  );
}

/** A day the account is in, some days back, as the date fields spell one. */
const today = (zone: string | null, daysAgo: number): string => {
  const at = serverNow().minus({ days: daysAgo });

  return (zone ? at.setZone(zone) : at).toISODate()!;
};

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.group}>
      <span className="label">{label}</span>
      <div className={styles.chips}>{children}</div>
    </div>
  );
}

function Toggle({ label, hint, on, onToggle }: { label: string; hint?: string; on: boolean; onToggle: (value: boolean) => void }) {
  return (
    <div className={`${ui.card} ${styles.toggle}`}>
      <span className={styles.toggleLabel}>
        {label}
        {hint ? <span className={styles.toggleHint}>{hint}</span> : null}
      </span>
      <button type="button" className={ui.switch} role="switch" aria-checked={on} aria-label={label} onClick={() => onToggle(!on)}>
        <span className={ui.knob} aria-hidden />
      </button>
    </div>
  );
}

/**
 * Both ends of the span, where the client is the one that knows them. The two
 * rolling windows carry only the instant they are worked out around, so that
 * the bucket stays the server's arithmetic and is not repeated here.
 */
const spanOf = (
  range: MediaWindow,
  grow: GrowListItem | null,
  from: string,
  to: string,
  zone: string | null,
): { startsAt?: string; endsAt?: string; reason: string | null } => {
  // The instant a rolling window is worked out around is the server's, so that
  // the film covers the day the frames were taken on rather than the day this
  // browser thinks it is.
  const now = serverNow();

  if (range === 'day' || range === 'week' || range === 'month') return { startsAt: instantOf(now), reason: null };

  if (range === 'phase') {
    const started = grow?.phases.at(-1)?.startedAt;
    return started ? { startsAt: started, endsAt: instantOf(now), reason: null } : { reason: 'camera.noGrowHere' };
  }

  if (range === 'grow') {
    return grow ? { startsAt: grow.startedAt, endsAt: grow.endedAt ?? instantOf(now), reason: null } : { reason: 'camera.noGrowHere' };
  }

  // A day is a day where the account is: asked for in the browser's zone, a
  // film of "18 September" would start and end a couple of hours out of the day
  // every other screen calls the 18th.
  const startsAt = DateTime.fromISO(from, { zone: zone ?? undefined }).startOf('day');
  const endsAt = DateTime.fromISO(to, { zone: zone ?? undefined }).endOf('day');

  return endsAt > startsAt ? { startsAt: instantOf(startsAt), endsAt: instantOf(endsAt), reason: null } : { reason: 'composer.backwards' };
};
