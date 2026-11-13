import { Link } from 'react-router';
import { ageAttribute } from '@/ui/age';
import { unbroken } from '@/ui/fact-text';
import { Help, Term } from '@/ui/Help';
import { curvePath, type Reading } from './readings';
import styles from './Start.module.css';

/**
 * The readings of a place as four tiles, where no camera's picture carries
 * them: the figure, and under it whether it is where it should be. Every tile
 * is the way to its curve, a panel of Verlauf. What "im Ziel" means is said on
 * the first tile judged against a band, and VPD is explained beside its name.
 */
export function ReadingTiles({ spaceId, readings }: { spaceId: string; readings: Reading[] }) {
  const explained = readings.find(reading => reading.judged)?.key;

  return (
    <div className={styles.tiles}>
      {readings.map(reading => (
        <div key={reading.key} className={styles.tile} {...ageAttribute(reading.age)}>
          <span className={styles.tileHead}>
            <Link to={curvePath(spaceId, reading)} className={styles.tileLabel}>
              {reading.label}
            </Link>
            {reading.key === 'vpd' ? <Help topic="vpd" /> : null}
          </span>
          <span className={styles.tileFigure}>{reading.figure}</span>
          {reading.note ? (
            <span className={styles.tileNote} data-tone={reading.tone}>
              {reading.key === explained ? <Term topic="band">{unbroken(reading.note)}</Term> : unbroken(reading.note)}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
