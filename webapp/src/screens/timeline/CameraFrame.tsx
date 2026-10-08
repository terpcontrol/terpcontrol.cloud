import { Pause, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SpaceTimeline } from '@fg2/shared-types/v1';
import { mediaUrl, THUMBNAIL_WIDTH } from '@/api/session';
import { useCameraCalled } from '@/ui/camera-name';
import { DAY_MS } from '@/ui/days';
import { DATED_CLOCK, useZone, zonedAt } from '@/ui/zone';
import { at, captureOf, fractionOf, frameNear, stampOf } from './window';
import styles from './Timeline.module.css';
import ui from '@/ui/ui.module.css';

/** How long one frame is held while the window plays. Fast enough to read as a day passing, slow enough to see. */
const FRAME_MS = 320;

/** How many frames are fetched ahead of the one on screen while it plays: a still that starts downloading when it is due arrives late. */
const READ_AHEAD = 4;

interface CameraFrameProps {
  /** At least one, each with frames of its own; a space where nothing took a picture loses the frame and keeps the slider. */
  cameras: SpaceTimeline['cameras'];
  from: number;
  to: number;
  cursor: number;
  /** The one-line caption: which camera, when, and the day where the window is one. */
  day: number | null;
  /** The photos written in the window, which stand in where the camera took nothing near the cursor. */
  photos?: { mediaId: string; takenAt: string }[];
  onScrub: (time: number) => void;
  /** Where a picture comes from: the session's own, or a link's for somebody reading through one. */
  picture?: (mediaId: string, width?: number) => string | null;
}

/** How far from the cursor a written photo may have been taken to stand in for a camera picture. */
const PHOTO_REACH = DAY_MS;

/**
 * The picture at the cursor, with the window under it. The slider is the same
 * cursor the panels carry, so a thumb dragging it walks the curves as well as
 * the pictures; play steps through the frames there actually are.
 */
export function CameraFrame({ cameras, from, to, cursor, day, photos = [], onScrub, picture = mediaUrl }: CameraFrameProps) {
  const { t } = useTranslation();
  const zone = useZone();
  const called = useCameraCalled();
  const [shown, setShown] = useState(0);
  const camera = cameras[Math.min(shown, cameras.length - 1)];
  const frame = frameNear(camera, cursor);
  // No camera picture near the cursor: the photo written nearest it, where one was, rather than a picture of another day.
  const photo = frame
    ? null
    : (photos
        .filter(one => Math.abs(at(one.takenAt) - cursor) <= PHOTO_REACH)
        .sort((one, other) => Math.abs(at(one.takenAt) - cursor) - Math.abs(at(other.takenAt) - cursor))[0] ?? null);
  const playing = usePlay(camera.frames, cursor, onScrub);
  const source = frame ? picture(frame.mediaId, THUMBNAIL_WIDTH.frame) : photo ? picture(photo.mediaId, THUMBNAIL_WIDTH.frame) : null;
  const caption = frame ? captureOf(at(frame.capturedAt), to - from, zone) : null;
  const first = camera.frames[0] ? at(camera.frames[0].capturedAt) : null;
  const missing =
    first !== null && cursor < first
      ? t('timeline.camSince', { time: stampOf(cursor, to - from, zone), since: zonedAt(first, zone).toFormat(DATED_CLOCK) })
      : t('timeline.noFrameAt', { time: stampOf(cursor, to - from, zone) });
  useReadAhead(camera.frames, cursor, playing.on, picture);

  return (
    <section className={styles.frame}>
      <div className={ui.mat}>
        {source ? (
          <img src={source} alt={t('timeline.frameAlt', { name: called(camera.name) })} />
        ) : (
          <p className={`mono ${ui.matNote}`}>{camera.frames.length === 0 ? t('timeline.noFrames') : missing}</p>
        )}
        <span className={ui.photoCaption}>
          {frame
            ? `${called(camera.name)} · ${caption}`
            : photo
              ? `${t('timeline.photoAt', { time: captureOf(at(photo.takenAt), to - from, zone) })} · ${missing}`
              : called(camera.name)}
          {day !== null ? ` · ${t('timeline.dayN', { day })}` : ''}
        </span>
        {cameras.length > 1 ? (
          <span className={styles.dots}>
            {cameras.map((one, index) => (
              <button
                key={one.cameraId}
                type="button"
                className={styles.camDot}
                aria-label={called(one.name)}
                aria-current={index === shown}
                onClick={() => setShown(index)}
              />
            ))}
          </span>
        ) : null}
      </div>
      <div className={ui.transport}>
        <button type="button" className={styles.play} onClick={playing.toggle} aria-label={t(playing.on ? 'timeline.pause' : 'timeline.play')}>
          {playing.on ? <Pause size={15} fill="currentColor" aria-hidden /> : <Play size={15} fill="currentColor" aria-hidden />}
        </button>
        <Slider from={from} to={to} cursor={cursor} onScrub={onScrub} />
        <span className={`mono ${styles.transportTime}`}>{stampOf(cursor, to - from, zone)}</span>
      </div>
    </section>
  );
}

/**
 * The window as one control. It is a range input rather than a bar to drag,
 * because that is the one scrubber a thumb, a keyboard and a screen reader all
 * already know how to use.
 */
export function Slider({ from, to, cursor, onScrub }: { from: number; to: number; cursor: number; onScrub: (time: number) => void }) {
  const { t } = useTranslation();
  // The one thing a screen reader is told the cursor stands at, so it is the
  // same hour the sighted label beside it carries: the account's.
  const zone = useZone();

  return (
    <input
      className={ui.range}
      style={{ '--filled': `${fractionOf(cursor, from, to) * 100}%` } as React.CSSProperties}
      type="range"
      min={from}
      max={to}
      step={Math.max(1000, Math.round((to - from) / 600))}
      value={cursor}
      onChange={event => onScrub(Number(event.target.value))}
      aria-label={t('timeline.scrubber')}
      aria-valuetext={stampOf(cursor, to - from, zone)}
    />
  );
}

/**
 * The frames just after the cursor, fetched before they are due. Only while it
 * plays: three pictures a second is faster than a phone fetches them one at a
 * time, where a thumb on the slider asks for one and waits for it anyway.
 */
const useReadAhead = (
  frames: { mediaId: string; capturedAt: string }[],
  cursor: number,
  playing: boolean,
  picture: (mediaId: string, width?: number) => string | null,
) => {
  useEffect(() => {
    if (!playing) return;

    for (const frame of frames.filter(one => at(one.capturedAt) > cursor).slice(0, READ_AHEAD)) {
      const source = picture(frame.mediaId, THUMBNAIL_WIDTH.frame);
      // The browser keeps what it fetched; the element itself is only the ask.
      if (source) new Image().src = source;
    }
  }, [frames, cursor, playing, picture]);
};

/** Play walks the frames from where the cursor stands and stops at the last one; it never loops back. */
const usePlay = (frames: { capturedAt: string }[], cursor: number, onScrub: (time: number) => void) => {
  const [on, setOn] = useState(false);

  // One step at a time rather than one interval: moving the cursor is what
  // schedules the next frame, so dragging the slider mid-play stays in charge.
  useEffect(() => {
    if (!on) return;
    const timer = setTimeout(() => {
      const next = frames.find(frame => at(frame.capturedAt) > cursor);
      if (next) onScrub(at(next.capturedAt));
      else setOn(false);
    }, FRAME_MS);

    return () => clearTimeout(timer);
  }, [on, frames, cursor, onScrub]);

  const start = () => {
    if (frames.length === 0) return;
    // Pressing play at the end of the window rewinds rather than doing nothing; it never loops on its own.
    if (!frames.some(frame => at(frame.capturedAt) > cursor)) onScrub(at(frames[0].capturedAt));
    setOn(true);
  };

  return { on, toggle: () => (on ? setOn(false) : start()) };
};
