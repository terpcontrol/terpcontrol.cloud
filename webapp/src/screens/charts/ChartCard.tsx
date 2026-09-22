import { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Chart } from '@/charts/Chart';
import { AXIS_GUTTER, plotOption, valueAt } from '@/charts/series';
import type { ChartPalette } from '@/charts/tokens';
import ui from '@/ui/ui.module.css';
import { fractionOf } from '../timeline/window';
import type { Card } from './cards';
import styles from './Charts.module.css';

interface ChartCardProps {
  card: Card;
  /** Where the one cursor of the screen stands, on this card's own axis; the end of the window until it is moved. */
  cursor: number;
  scrub: React.HTMLAttributes<HTMLDivElement>;
  /** Both ends of the window as they are written under the plot; the screen settles them once so every card says the same. */
  ends: readonly [string, string];
}

/**
 * One panel: what it is, what it is measured in, and the picture.
 *
 * The header carries the whole of the explanation - "VPD · band moves with the
 * phase · leaf −2 °C" - because a chart with a legend inside it loses a third
 * of its height on a phone to words that never change. The figures are written
 * round the plot rather than on it: each scale's two ends in its own gutter and
 * the window's two ends underneath, so the card can be read from a screenshot
 * without anyone touching it, and the cursor's own values are pinned above the
 * stack where a thumb is not over them.
 */
export function ChartCard({ card, cursor, scrub, ends }: ChartCardProps) {
  const { t } = useTranslation();
  const option = useMemo(() => (palette: ChartPalette) => plotOption(palette, card.plot), [card.plot]);
  const { from, to, scales, lines } = card.plot;
  const left = `${fractionOf(cursor, from, to) * 100}%`;

  return (
    <section
      className={`${ui.card} ${styles.card}`}
      style={{ '--gutter': `${AXIS_GUTTER}px`, '--gutter-right': scales.length > 1 ? `${AXIS_GUTTER}px` : '0px' } as React.CSSProperties}
    >
      <header className={styles.cardHead}>
        <span className={styles.cardTitle}>{card.title}</span>
        {card.about ? <span className={styles.cardAbout}>· {card.about}</span> : null}
        <span className={`mono ${styles.cardUnit}`}>{card.unit}</span>
      </header>
      <div className={styles.plot}>
        <Chart option={option} height="100%" ariaLabel={t('charts.plotAlt', { title: card.title })} />
        {card.scaleEnds.map((scale, index) =>
          scale === null ? null : (
            <Fragment key={index}>
              <span className={`mono ${styles.scaleHigh}`} data-side={index === 1 ? 'right' : 'left'}>
                {scale.high}
              </span>
              <span className={`mono ${styles.scaleLow}`} data-side={index === 1 ? 'right' : 'left'}>
                {scale.low}
              </span>
            </Fragment>
          ),
        )}
        <div className={styles.overlay} {...scrub}>
          <span className={styles.cursor} style={{ left }} />
          {lines.map(line => {
            const value = line.label === undefined ? null : valueAt(line.points, cursor);
            const scale = scales[line.axis] ?? scales[0];
            if (value === null || !scale || scale.high === scale.low) return null;

            return (
              <span key={line.key} className={styles.mark} style={{ left, top: `${(1 - (value - scale.low) / (scale.high - scale.low)) * 100}%` }} />
            );
          })}
        </div>
      </div>
      <p className={`mono ${styles.axis}`}>
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </p>
      {card.left.length > 0 ? (
        <p className={`${ui.note} ${styles.leftOut}`}>{t('charts.leftOut', { count: card.left.length, names: card.left.join(', ') })}</p>
      ) : null}
    </section>
  );
}
