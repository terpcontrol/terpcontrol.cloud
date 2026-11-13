import { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { blocksOf, shareOf, type Strip } from './model';
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
 * What the outputs did, under the curve they act on and on its time axis, so a dehumidifier's run stands under
 * the dip it made. Every drawn point is counted from the samples of its window: one that only switches is tinted
 * by the share of them it ran in - a valve that pulses five seconds every two minutes is a faint band, not a bar
 * open all day -, one driven at a level is filled to its mean level over them, so a sunrise is a ramp and 60 %
 * is not 100 %. Where nothing was heard the strip is blank, which is not "off".
 */
export function Strips({ strips, from, to, stepMs, cursor, focus = null }: StripsProps) {
  if (strips.length === 0) return null;

  return (
    <ul className={styles.strips}>
      {strips.map(strip => (
        <StripRow key={strip.output} strip={strip} from={from} to={to} stepMs={stepMs} cursor={cursor} focused={strip.output === focus} />
      ))}
    </ul>
  );
}

function StripRow({ strip, from, to, stepMs, cursor, focused }: Omit<StripsProps, 'strips' | 'focus'> & { strip: Strip; focused: boolean }) {
  const { t } = useTranslation();
  const blocks = useMemo(() => blocksOf(strip, from, to, stepMs), [strip, from, to, stepMs]);
  const share = shareOf(strip);
  const levelled = strip.points.some(point => point[3] !== null);

  return (
    <li className={styles.strip} data-output={strip.output} data-levelled={levelled || undefined} data-focus={focused || undefined}>
      <span className={styles.stripName}>{strip.name}</span>
      <span className={styles.stripTrack}>
        <svg
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          role="img"
          aria-label={
            share === null
              ? t('timeline.stripUnheard', { name: strip.name })
              : t('timeline.stripShare', { name: strip.name, share: Math.round(share * 100) })
          }
        >
          {blocks.map(block => {
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
  );
}

/** How faint a switch is drawn that ran in next to none of a point's samples: seen, and not mistaken for running. */
const PART_ON = 0.2;
