import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { slicesOf, shareOf, type Strip } from './model';
import { fractionOf } from './window';
import styles from './Timeline.module.css';

interface StripsProps {
  strips: readonly Strip[];
  from: number;
  to: number;
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
 * ran rather than as one solid bar. Past the last thing heard the strip is
 * blank, which is not "off".
 */
export function Strips({ strips, from, to, cursor, focus = null }: StripsProps) {
  if (strips.length === 0) return null;

  return (
    <ul className={styles.strips}>
      {strips.map(strip => (
        <StripRow key={strip.output} strip={strip} from={from} to={to} cursor={cursor} focused={strip.output === focus} />
      ))}
    </ul>
  );
}

function StripRow({ strip, from, to, cursor, focused }: { strip: Strip; from: number; to: number; cursor: number | null; focused: boolean }) {
  const { t } = useTranslation();
  const slices = useMemo(() => slicesOf(strip, from, to), [strip, from, to]);
  // Neighbours that ran the same share are one block, so a lamp on all day is one bar and not a row of seams.
  const blocks = useMemo(
    () =>
      slices.reduce<{ from: number; to: number; ran: number }[]>((kept, ran, index) => {
        const last = kept.at(-1);
        if (!ran) return kept;
        if (last && last.to === index && last.ran === ran) last.to = index + 1;
        else kept.push({ from: index, to: index + 1, ran });
        return kept;
      }, []),
    [slices],
  );
  const share = shareOf(strip, from, to);
  const heard = fractionOf(strip.heardUntil, from, to) * slices.length;

  return (
    <li className={styles.strip} data-output={strip.output} data-focus={focused || undefined}>
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
              width={block.to - block.from}
              height={1}
              opacity={0.35 + 0.65 * block.ran}
            />
          ))}
        </svg>
        {cursor === null ? null : <span className={styles.cursor} style={{ left: `${fractionOf(cursor, from, to) * 100}%` }} />}
      </span>
    </li>
  );
}
