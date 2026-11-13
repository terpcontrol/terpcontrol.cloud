import { Pause, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { SpaceTimeline } from '@fg2/shared-types/v1';
import { cameraPath } from '@/app/places';
import { mediaUrl, THUMBNAIL_WIDTH } from '@/api/session';
import { useCameraCalled } from '@/ui/camera-name';
import { Facts } from '@/ui/Facts';
import { at, frameNear } from './window';
import styles from './Timeline.module.css';

/** How long one picture is held while the window plays. */
const FRAME_MS = 320;

interface CursorCardProps {
  /** The instant in words: "jetzt, 14:31", "03:10:40", "letzter Wert · 00:40". */
  stamp: string;
  /** One figure per curve drawn, and under them what each output did. */
  readings: string[];
  outputs: string[];
  /** The cameras with pictures in the window; none leaves the card its words. */
  cameras: SpaceTimeline['cameras'];
  cursor: number;
  resting: boolean;
  onCursor: (time: number) => void;
  /** Where a picture comes from - a link's for somebody reading through one - and whether its camera's page can be opened. */
  picture?: (mediaId: string, width?: number) => string | null;
  linked: boolean;
  /** Zooming in and out: it stands with the card, which stays in sight while the page scrolls under a thumb. */
  zoom: React.ReactNode;
}

/**
 * What was true at the cursor, in a place that stays put - a tooltip under a
 * thumb cannot be read: the camera's picture of that moment, the instant, a
 * figure per curve and what the outputs did.
 */
export function CursorCard({ stamp, readings, outputs, cameras, cursor, resting, onCursor, picture = mediaUrl, linked, zoom }: CursorCardProps) {
  const { t } = useTranslation();
  const called = useCameraCalled();
  const [chosen, setChosen] = useState(0);
  const camera = cameras[Math.min(chosen, cameras.length - 1)];
  const frame = frameNear(camera, cursor);
  const source = frame ? picture(frame.mediaId, THUMBNAIL_WIDTH.frame) : null;
  const playing = usePlay(camera?.frames ?? [], cursor, resting, onCursor);
  const image = source ? (
    <img src={source} alt={t('timeline.frameAlt', { name: called(camera.name) })} />
  ) : (
    <span className={styles.noFrame}>{t('timeline.noFrame')}</span>
  );

  return (
    <section className={styles.cursorCard} aria-label={t('timeline.cursor')}>
      {camera ? (
        <div className={styles.frame}>
          {linked ? (
            <Link to={cameraPath(camera.cameraId)} aria-label={called(camera.name)}>
              {image}
            </Link>
          ) : (
            image
          )}
          <button type="button" className={styles.play} onClick={playing.toggle} aria-label={t(playing.on ? 'timeline.pause' : 'timeline.play')}>
            {playing.on ? <Pause size={14} fill="currentColor" aria-hidden /> : <Play size={14} fill="currentColor" aria-hidden />}
          </button>
        </div>
      ) : null}
      <div className={styles.cursorText} role="status">
        <span className={styles.cursorStamp}>
          {t('timeline.cursor')} · {stamp}
          {cameras.length > 1 ? (
            <button type="button" className={styles.otherCamera} onClick={() => setChosen((chosen + 1) % cameras.length)}>
              {called(camera.name)}
            </button>
          ) : null}
        </span>
        {readings.length > 0 ? <strong className={styles.cursorValues}>{<Facts facts={readings} />}</strong> : null}
        {outputs.length > 0 ? <Facts className={styles.cursorOutputs} facts={outputs} /> : null}
      </div>
      <div className={styles.zoom} role="group" aria-label={t('timeline.zoomLabel')}>
        {zoom}
      </div>
    </section>
  );
}

/**
 * Play walks the pictures from the cursor the address carries and stops at the last one. Rest is no such cursor -
 * it stands on the last reading, and a picture newer than that was the only one "after it": the window plays from its first.
 */
const usePlay = (frames: readonly { capturedAt: string }[], cursor: number, resting: boolean, onCursor: (time: number) => void) => {
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!on) return;
    const timer = setTimeout(() => {
      const next = frames.find(frame => at(frame.capturedAt) > cursor);
      if (next) onCursor(at(next.capturedAt));
      else setOn(false);
    }, FRAME_MS);
    return () => clearTimeout(timer);
  }, [on, frames, cursor, onCursor]);

  const start = () => {
    if (frames.length === 0) return;
    if (resting || !frames.some(frame => at(frame.capturedAt) > cursor)) onCursor(at(frames[0].capturedAt));
    setOn(true);
  };

  return { on, toggle: () => (on ? setOn(false) : start()) };
};
