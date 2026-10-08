import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Camera, GrowListItem, MediaAspect, MediaOverlays, MediaQuality, MediaWindow, TimelapseCreate } from '@fg2/shared-types/v1';
import { useCameras, useLatestStills } from '@/api/cameras';
import { serverNow } from '@/api/clock';
import { useDevices } from '@/api/devices';
import { mediaUrl, THUMBNAIL_WIDTH } from '@/api/session';
import { Sheet } from '@/ui/Sheet';
import { ageLabel, instantOf } from '@/ui/age';
import { endOfDayOn, startOfDayOn } from '@/ui/days';
import type { HelpTopic } from '@/ui/explain';
import { Help } from '@/ui/Help';
import { Choice } from '@/ui/SheetParts';
import { Switch } from '@/ui/Switch';
import ui from '@/ui/ui.module.css';
import { nowThere, useZone } from '@/ui/zone';
import styles from './CameraPage.module.css';
import { emptyRolling } from './rolling';

/** The ranges the composer offers, in the order the board draws them. */
const RANGES: MediaWindow[] = ['day', 'week', 'phase', 'grow', 'custom'];

const ASPECTS: MediaAspect[] = ['16_9', '9_16', '1_1'];

interface ComposerProps {
  camera: Camera;
  /** The grow standing where this camera does; null where nothing grows there. */
  grow: GrowListItem | null;
  /** Whether the ranges of a phase and of a whole grow are offered: they are the diary's, and left out without it and without a grow. */
  growFilms?: boolean;
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
export function Composer({ camera, grow, growFilms = true, pending, onRender, onClose }: ComposerProps) {
  const { t } = useTranslation();
  // A date somebody picks here is a day of theirs, so the days the fields open
  // on and the instants they are turned into are the account's - the same zone
  // the rest of the app draws its clocks in. Read from the cache the camera
  // page has already filled; until it answers, the browser's zone stands in.
  const zone = useZone();
  const [range, setRange] = useState<MediaWindow>('day');
  const [from, setFrom] = useState(today(zone, 7));
  const [to, setTo] = useState(today(zone, 0));
  const [secondCameraId, setSecondCameraId] = useState<string | null>(null);
  // A climate curve and the frames taken in the dark are read off a device
  // standing where the camera does; without one there is nothing to draw and
  // no light to tell the dark by, so neither is offered.
  const devices = useDevices();
  const measured = !devices.data?.items || devices.data.items.some(device => device.spaceId !== null && device.spaceId === camera.spaceId);
  const [overlays, setOverlays] = useState<MediaOverlays>({ dayCounter: true, climate: true, entries: true });
  const drawn = { ...overlays, climate: overlays.climate && measured };
  const [includeLightsOff, setIncludeLightsOff] = useState(false);
  const [aspect, setAspect] = useState<MediaAspect>('16_9');

  const beside = useCameras(camera.spaceId ?? undefined);
  const others = (beside.data?.items ?? []).filter(one => one.id !== camera.id);
  // The newest picture, as the camera's own row reads it: the preview is what
  // the film is made of and not a frame of the range, which has no picture of
  // its own until it is rendered.
  const preview = useLatestStills([camera.id]).get(camera.id) ?? null;

  const free = camera.entitlement.tier === 'free';
  const span = spanOf(range, grow, from, to, zone, camera.state.lastStillAt);
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
      overlays: drawn,
      includeLightsOff: includeLightsOff && measured,
      aspect,
    });

  return (
    <Sheet title={t('composer.title')} aside={grow?.name} onClose={onClose}>
      <div className={styles.composer}>
        <div className={`${ui.mat} ${styles.preview}`}>
          {preview ? (
            <img src={mediaUrl(preview, THUMBNAIL_WIDTH.frame) ?? undefined} alt="" />
          ) : (
            // A preview that is missing means this camera has never delivered a
            // picture at all, which is not the same as today holding none.
            <p className={`mono ${ui.matNote}`}>{t('composer.noPictureYet')}</p>
          )}
          {/* The picture is the camera's newest still and not a frame of the
              range, which has no picture of its own until it is rendered - so
              the caption says which picture it is and how old, rather than
              naming a range it may be days outside of. */}
          {preview && camera.state.lastStillAt ? (
            <span className={ui.photoCaption}>{t('composer.latestPicture', { age: ageLabel(camera.state.lastStillAt) })}</span>
          ) : null}
        </div>

        <Group label={t('composer.range')}>
          {RANGES.filter(one => growFilms || (one !== 'phase' && one !== 'grow')).map(one => (
            <Choice key={one} chosen={one === range} onChoose={() => setRange(one)}>
              {t(`camera.window.${one}`)}
              {one === 'phase' && grow?.summary.stage ? ` · ${t(`home.stage.${grow.summary.stage}`)}` : ''}
            </Choice>
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
          <Choice chosen={secondCameraId === null} onChoose={() => setSecondCameraId(null)}>
            {camera.name}
          </Choice>
          {others.map(one => (
            <Choice key={one.id} chosen={secondCameraId === one.id} onChoose={() => setSecondCameraId(one.id)}>
              {t('composer.split', { name: one.name })}
            </Choice>
          ))}
          {others.length === 0 ? <span className={ui.note}>{t('composer.oneCameraHere')}</span> : null}
        </Group>

        <div className={styles.switches}>
          <span className="label">
            {t('composer.overlays')}
            <Help topic="overlays" />
          </span>
          <div className={ui.group}>
            <Toggle label={t('composer.dayCounter')} on={overlays.dayCounter} onToggle={value => setOverlays({ ...overlays, dayCounter: value })} />
            {measured ? (
              <Toggle label={t('composer.climate')} on={overlays.climate} onToggle={value => setOverlays({ ...overlays, climate: value })} />
            ) : null}
            <Toggle
              label={t('composer.entries')}
              hint={t('composer.entriesHint')}
              on={overlays.entries}
              onToggle={value => setOverlays({ ...overlays, entries: value })}
            />
            {measured ? <Toggle label={t('composer.lightsOff')} help="lightsOffFrames" on={includeLightsOff} onToggle={setIncludeLightsOff} /> : null}
          </div>
        </div>

        <Group label={t('composer.format')}>
          {ASPECTS.map(one => (
            <Choice key={one} chosen={one === aspect} onChoose={() => setAspect(one)}>
              {t(`composer.aspect.${one}`)}
            </Choice>
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
          <Help topic="render" />
        </div>
        {free && range !== 'grow' ? <p className={ui.note}>{t('camera.needsPremium')}</p> : null}
      </div>
    </Sheet>
  );
}

/** A day the account is in, some days back, as the date fields spell one. */
const today = (zone: string | null, daysAgo: number): string => nowThere(serverNow().minus({ days: daysAgo }), zone).toISODate()!;

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.group}>
      <span className="label">{label}</span>
      <div className={styles.chips}>{children}</div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  help,
  on,
  onToggle,
}: {
  label: string;
  hint?: string;
  help?: HelpTopic;
  on: boolean;
  onToggle: (value: boolean) => void;
}) {
  return (
    <div className={`${ui.card} ${styles.toggle}`}>
      <span className={styles.toggleLabel}>
        {label}
        {help ? <Help topic={help} /> : null}
        {hint ? <span className={styles.toggleHint}>{hint}</span> : null}
      </span>
      <Switch label={label} on={on} onChange={onToggle} />
    </div>
  );
}

/**
 * Both ends of the span, where the client is the one that knows them. The
 * rolling windows are cut by the server on the owner's calendar, so they carry
 * at most an instant inside the period meant: the day holding now, and for the
 * week no instant at all, which the route answers with the last complete week -
 * what the camera page's Week button has always asked for. Naming now there
 * filmed the week that had opened that morning, most of it still to come.
 */
const spanOf = (
  range: MediaWindow,
  grow: GrowListItem | null,
  from: string,
  to: string,
  zone: string | null,
  lastStillAt: string | null,
): { startsAt?: string; endsAt?: string; reason: string | null } => {
  // The instant a rolling window is worked out around is the server's, so that
  // the film covers the day the frames were taken on rather than the day this
  // browser thinks it is.
  const now = serverNow();

  if (range === 'week') return { reason: emptyRolling(range, lastStillAt, now) };
  if (range === 'day') return { startsAt: instantOf(now), reason: emptyRolling(range, lastStillAt, now) };

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
  const startsAt = startOfDayOn(from, zone);
  const endsAt = endOfDayOn(to, zone);

  return endsAt > startsAt ? { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), reason: null } : { reason: 'composer.backwards' };
};
