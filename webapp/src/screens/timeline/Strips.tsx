import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { levelsOf, slicesOf, shareOf, type Strip } from './model';
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
 * What the outputs did, under the curve they act on and on its time axis, so
 * a dehumidifier's run stands under the dip it made. A strip says when an
 * output ran and how much of each stretch: a slice is tinted by the share of
 * it the output was on, so a compressor cycling all week reads as how often it
 * ran rather than as one solid bar. An output driven at a level - a dimmed
 * lamp, a fan's speed - fills its strip to that level, so a sunrise is a
 * ramp and 60 % is not 100 %. Past the last thing heard the strip is blank,
 * which is not "off".
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
  const slices = useMemo(() => slicesOf(strip, from, to), [strip, from, to]);
  const levels = useMemo(() => levelsOf(strip, from, to, stepMs), [strip, from, to, stepMs]);
  // Neighbours that ran the same share at the same level are one block, so a lamp on all day is one bar and not a row of seams.
  const blocks = useMemo(
    () =>
      slices.reduce<{ from: number; to: number; ran: number; level: number }[]>((kept, ran, index) => {
        const last = kept.at(-1);
        if (!ran) return kept;
        // A slice it ran in with no level of its own - the last, cut where the device was last heard - keeps the one before it.
        const level = levels ? (levels[index] ?? last?.level ?? 1) : 1;
        if (last && last.to === index && last.ran === ran && last.level === level) last.to = index + 1;
        else kept.push({ from: index, to: index + 1, ran, level });
        return kept;
      }, []),
    [slices, levels],
  );
  const share = shareOf(strip, from, to);
  const heard = fractionOf(strip.heardUntil, from, to) * slices.length;

  return (
    <li className={styles.strip} data-output={strip.output} data-levelled={levels !== null || undefined} data-focus={focused || undefined}>
      <span className={styles.stripName}>{strip.name}</span>
      <span className={styles.stripTrack}>
        <svg
          viewBox={`0 0 ${slices.length} 1`}
          preserveAspectRatio="none"
          role="img"
          aria-label={
            share === null
              ? t('timeline.stripUnheard', { name: strip.name })
              : t('timeline.stripShare', { name: strip.name, share: Math.round(share * 100) })
          }
        >
          <rect className={styles.stripHeard} width={heard} height={1} />
          {blocks.map(block => (
            <rect
              key={block.from}
              className={styles.stripRan}
              x={block.from}
              // An output with a level is a filled shape: how hard it ran over the slice, the level by the share of
              // the slice it ran - a heater's demand, not a row of ticks. One that only switches is tinted by its share.
              y={levels ? 1 - block.level * block.ran : 0}
              width={block.to - block.from}
              height={levels ? block.level * block.ran : 1}
              opacity={levels ? 1 : 0.35 + 0.65 * block.ran}
            />
          ))}
        </svg>
        {cursor === null ? null : <span className={styles.cursor} style={{ left: `${fractionOf(cursor, from, to) * 100}%` }} />}
      </span>
    </li>
  );
}
