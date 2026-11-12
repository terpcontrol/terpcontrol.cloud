import { Link } from 'react-router';
import type { ValueState } from '@fg2/shared-types/v1';
import { ageAttribute } from '@/ui/age';
import ui from '@/ui/ui.module.css';
import type { Reading } from './readings';
import styles from './Start.module.css';

/**
 * The picture a place or a grow is shown by, as the head of Start: what it
 * shows named on it top left, when it was taken top right, and - for a
 * camera's - the readings of the place in a bar along its foot. A tap opens
 * where the picture comes from. Under a place nobody has heard from the
 * picture steps back and `stand` says how old the figures are.
 */
export function Picture({
  to,
  src,
  alt,
  opens,
  left,
  right,
  warns = false,
  readings = [],
  age = 'live',
  stand = null,
  empty,
}: {
  to: string;
  src: string | null;
  alt: string;
  /** Where a tap leads, said after what the picture shows. */
  opens: string;
  left: string | null;
  right: string | null;
  /** The right-hand words say the picture is old. */
  warns?: boolean;
  readings?: Reading[];
  age?: ValueState;
  stand?: string | null;
  /** What stands in place of a picture that has not been taken yet. */
  empty: string;
}) {
  return (
    <Link to={to} className={styles.picture} {...ageAttribute(age)}>
      {src ? <img src={src} alt={alt} /> : <span className={styles.pictureEmpty}>{empty}</span>}
      <span className={styles.chips}>
        {left ? (
          <span className={styles.chip} data-side="left">
            {left}
          </span>
        ) : null}
        {right ? (
          <span className={styles.chip} data-side="right" data-tone={warns ? 'warn' : undefined}>
            {right}
          </span>
        ) : null}
      </span>
      {readings.length > 0 ? (
        <span className={styles.pictureBar}>
          <span className={styles.pictureFigures}>
            {readings.map(reading => (
              <span key={reading.key} className={styles.pictureFigure}>
                <span className={styles.pictureValue} aria-hidden>
                  {reading.figure}
                </span>
                <span className={styles.pictureLabel} aria-hidden>
                  {reading.label}
                </span>
                {/* Said as one sentence that names the reading, with the verdict the picture has no room to draw. */}
                <span className={ui.visuallyHidden}>{[`${reading.label} ${reading.figure}`, reading.note].filter(Boolean).join(', ')}</span>
              </span>
            ))}
          </span>
          {stand ? <span className={styles.stand}>{stand}</span> : null}
        </span>
      ) : null}
      <span className={ui.visuallyHidden}>{`, ${opens}`}</span>
    </Link>
  );
}
