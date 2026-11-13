import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { blocksOf, type Strip } from './model';
import { fractionOf } from './window';
import styles from './Timeline.module.css';

interface StripsProps {
  strips: readonly Strip[];
  from: number;
  to: number;
  /** The width of a window of the answer, which is what a level stands for. */
  stepMs: number;
  /** Where the cursor stands; null while it rests at the end of the window. */
  cursor: number | null;
  /** The output a link was about, whose strip is marked. */
  focus?: string | null;
}

/**
 * What the outputs did, under the curve they act on and on its time axis. Every drawn point is counted from the
 * samples of its window: a switch is tinted by the share of them it ran in - a valve that pulses is a faint band,
 * not a bar open all day -, an output driven at a level is filled to its mean level. Unheard is blank, not "off".
 */
export function Strips({ strips, from, to, stepMs, cursor, focus = null }: StripsProps) {
  const { t } = useTranslation();
  if (strips.length === 0) return null;

  return (
    <ul className={styles.strips}>
      {strips.map(strip => (
        <li
          key={strip.output}
          className={styles.strip}
          data-output={strip.output}
          data-levelled={strip.points.some(point => point[3] !== null) || undefined}
          data-focus={strip.output === focus || undefined}
        >
          <span className={styles.stripName}>{[strip.name, strip.said ?? t('timeline.stripUnheard')].join(' · ')}</span>
          <span className={styles.stripTrack}>
            <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden>
              {blocksOf(strip, from, to, stepMs).map(block => {
                const [width, filled] = [block.to - block.from, block.level === null ? 1 : block.level / 100];
                // A switch on throughout is solid; one on for a part of the point is as much lighter.
                const opacity = block.level === null ? PART_ON + (1 - PART_ON) * block.share : 1;
                return (
                  <Fragment key={block.from}>
                    <rect className={styles.stripHeard} x={block.from} width={width} height={1} />
                    {block.share > 0 ? (
                      <rect className={styles.stripRan} x={block.from} y={1 - filled} width={width} height={filled} opacity={opacity} />
                    ) : null}
                  </Fragment>
                );
              })}
            </svg>
            {cursor === null ? null : <span className={styles.cursor} style={{ left: `${fractionOf(cursor, from, to) * 100}%` }} />}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** How faint a switch is drawn that ran in next to none of a point's samples: seen, and not mistaken for running. */
const PART_ON = 0.2;
