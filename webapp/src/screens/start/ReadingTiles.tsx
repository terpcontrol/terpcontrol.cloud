import { Link } from 'react-router';
import { timelinePath } from '@/app/places';
import { ageAttribute } from '@/ui/age';
import { Term } from '@/ui/Help';
import type { Reading } from './readings';
import styles from './Start.module.css';

/**
 * The readings of a place as four tiles, where no camera's picture carries
 * them: the figure, and under it whether it is where it should be. A tile is
 * the way to its curve in Verlauf. What "im Ziel" means is said on the first
 * tile judged against a band, and VPD explains itself.
 */
export function ReadingTiles({ spaceId, readings }: { spaceId: string; readings: Reading[] }) {
  const explained = readings.find(reading => reading.judged)?.key;

  return (
    <div className={styles.tiles}>
      {readings.map(reading => (
        <div key={reading.key} className={styles.tile} {...ageAttribute(reading.age)}>
          {reading.focus ? (
            <Link to={timelinePath(spaceId, reading.focus)} className={styles.tileLabel}>
              {reading.label}
            </Link>
          ) : (
            <span className={styles.tileLabel}>{reading.key === 'vpd' ? <Term topic="vpd">{reading.label}</Term> : reading.label}</span>
          )}
          <span className={styles.tileFigure}>{reading.figure}</span>
          {reading.note ? (
            <span className={styles.tileNote} data-tone={reading.tone}>
              {reading.key === explained ? <Term topic="band">{reading.note}</Term> : reading.note}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
