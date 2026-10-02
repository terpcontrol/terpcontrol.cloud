import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chart } from '@/charts/Chart';
import { AXIS_GUTTER, plotOption, readAt } from '@/charts/series';
import type { Selection } from '@/charts/scrub';
import { ticksFor, type Tick } from '@/charts/ticks';
import type { ChartPalette } from '@/charts/tokens';
import { Help } from '@/ui/Help';
import ui from '@/ui/ui.module.css';
import { fractionOf } from '../timeline/window';
import type { Card } from './cards';
import styles from './Charts.module.css';

interface ChartCardProps {
  card: Card;
  /** Where the one cursor of the screen stands, on this card's own axis; the end of the window until it is moved. */
  cursor: number;
  scrub: React.HTMLAttributes<HTMLDivElement>;
  /** A stretch being marked with the mouse to zoom into, as fractions of the plot. */
  selection?: Selection | null;
  /** Both ends of the window as they are written under the plot; the screen settles them once so every card says the same. */
  ends: readonly [string, string];
  /** The gridlines across the window for a plot that has room for at most so many; none where the axis is not a clock's. */
  ticksOf?: (most: number) => Tick[];
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
export function ChartCard({ card, cursor, scrub, selection = null, ends, ticksOf }: ChartCardProps) {
  const { t } = useTranslation();
  const option = useMemo(() => (palette: ChartPalette) => plotOption(palette, card.plot), [card.plot]);
  const { from, to, scales, lines } = card.plot;
  const left = `${fractionOf(cursor, from, to) * 100}%`;
  const [plotWidth, axis] = useAxisRoom();
  const ticks = useMemo(() => (ticksOf ? ticksOf(ticksFor(plotWidth)) : []), [ticksOf, plotWidth]);

  return (
    // The same gutter on both sides of every card, whether this one has a
    // second scale to write in the right-hand one or not. The screen has one
    // cursor and stretches each plot across its own drawn area, so a card that
    // reserved nothing on the right drew the same instant 38 px further along
    // than the card above it - six per cent of a 1280 px window, which over a
    // 218-day grow is thirteen days, and on a phone nearer thirty. Reading the
    // VPD panel against the Temp + RH panel is the whole reason the cursor is
    // shared, and it cannot be done while the two disagree about where a
    // moment is. The cost is the width of one gutter on a single-scale card,
    // which is what the Timeline already pays for the same reason.
    <section
      className={`${ui.card} ${styles.card}`}
      style={{ '--gutter': `${AXIS_GUTTER}px`, '--gutter-right': `${AXIS_GUTTER}px` } as React.CSSProperties}
    >
      <header className={styles.cardHead}>
        <span className={styles.cardTitle}>
          {card.title}
          {/* An (i) rather than the word as a term: the chip that turns the line on is already a button called VPD. */}
          {card.key === 'vpd' ? <Help topic="vpd" /> : null}
        </span>
        {card.about ? <span className={styles.cardAbout}>· {card.about}</span> : null}
        <span className={`mono ${styles.cardUnit}`}>{card.unit}</span>
      </header>
      <div className={styles.plot}>
        {/* Behind the curves, so a line is read against the grid rather than crossed by it. */}
        {ticks.length > 0 ? (
          <div className={styles.grid} aria-hidden>
            {ticks.map(tick => (
              <span key={tick.at} className={styles.tick} style={{ left: `${fractionOf(tick.at, from, to) * 100}%` }} />
            ))}
          </div>
        ) : null}
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
          {selection ? (
            <span className={styles.selection} style={{ left: `${selection.from * 100}%`, width: `${(selection.to - selection.from) * 100}%` }} />
          ) : null}
          <span className={styles.cursor} style={{ left }} />
          {lines.map(line => {
            const value = line.label === undefined ? null : readAt(line, cursor, to - from);
            const scale = scales[line.axis] ?? scales[0];
            if (value === null || !scale || scale.high === scale.low) return null;

            return (
              <span key={line.key} className={styles.mark} style={{ left, top: `${(1 - (value - scale.low) / (scale.high - scale.low)) * 100}%` }} />
            );
          })}
        </div>
      </div>
      <p ref={axis} className={`mono ${styles.axis}`}>
        <span data-end>{ends[0]}</span>
        {ticks.length > 0 ? (
          <span className={styles.tickRow} aria-hidden>
            {ticks.map(tick => (
              <span key={tick.at} className={styles.tickLabel} style={{ left: `${fractionOf(tick.at, from, to) * 100}%` }}>
                {tick.label}
              </span>
            ))}
          </span>
        ) : null}
        <span data-end>{ends[1]}</span>
      </p>
      {card.left.length > 0 ? (
        <p className={`${ui.note} ${styles.leftOut}`}>{t('charts.leftOut', { count: card.left.length, names: card.left.join(', ') })}</p>
      ) : null}
    </section>
  );
}

/**
 * The width the axis has to write in, and the element to measure it on; and,
 * once it is drawn, the labels between the two ends that would stand on one of
 * them or on each other are hidden, so a phone keeps the lines and loses only
 * words it has no room for. The ends always stay: they are what dates the card.
 */
function useAxisRoom(): [number, React.RefObject<HTMLParagraphElement | null>] {
  const axis = useRef<HTMLParagraphElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = axis.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => setWidth(Math.round(entries[0]?.contentRect.width ?? 0)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const element = axis.current;
    if (!element) return;
    const taken = [...element.querySelectorAll<HTMLElement>('[data-end]')].map(end => end.getBoundingClientRect());
    for (const label of element.querySelectorAll<HTMLElement>(`.${styles.tickLabel}`)) {
      label.style.visibility = '';
      const box = label.getBoundingClientRect();
      const clash = taken.some(other => box.width > 0 && box.left < other.right + 8 && box.right > other.left - 8);
      label.style.visibility = clash ? 'hidden' : '';
      if (!clash) taken.push(box);
    }
  });

  return [width, axis];
}
