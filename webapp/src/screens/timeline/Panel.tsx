import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chart } from '@/charts/Chart';
import type { Selection } from '@/charts/scrub';
import { plotOption, type PlotPoint } from '@/charts/series';
import { CLOCK_ROOM_PX, TICK_ROOM_PX, ticksFor, timeTicks } from '@/charts/ticks';
import type { ChartPalette } from '@/charts/tokens';
import { HOUR_MS } from '@/ui/days';
import { Facts } from '@/ui/Facts';
import { Help } from '@/ui/Help';
import { DAY_IN_YEAR, useZone } from '@/ui/zone';
import type { PanelModel } from './model';
import { Strips } from './Strips';
import { fractionOf } from './window';
import styles from './Timeline.module.css';

/** How far the wheel turns for one width of the zoom: a notch of a mouse, a short pinch on a trackpad. */
const WHEEL_STEP = 60;

interface PanelProps {
  panel: PanelModel;
  cursor: number;
  /** What the cursor reads of each curve: the page reads it once, for the card and for every head. */
  read: { curve: PanelModel['curves'][number]; point: PlotPoint | null; written: string; rest: string }[];
  /** Both ends of the window as the axis writes them. */
  ends: readonly [string, string];
  /** What the cursor is called to a screen reader: its instant. */
  stamp: string;
  scrub: React.HTMLAttributes<HTMLDivElement>;
  selection: Selection | null;
  /** The cursor by the keys: a point to either side, the window's start, or back to its end where it rests. */
  onNudge: (to: -1 | 1 | 'start' | 'end') => void;
  /** A pinch on a trackpad, or the wheel with Ctrl held: one width in (`1`) or out, around a fraction of the plot. */
  onWheelZoom: (direction: -1 | 1, fraction: number) => void;
  focus: string | null;
  /** The width of one window of the answer, in milliseconds. */
  stepMs: number;
  /** The cursor rests at the end of the window: its dot is drawn and its line is not, which would stand on the scale's figures. */
  resting: boolean;
  /** The first panel explains what every panel draws: the band, the night, the stretch around the line. */
  explain?: boolean;
  /** The value of what is laid over, at the cursor, where something is. */
  comparedAt?: (key: string) => number | null;
}

/**
 * One panel: the curve with the stretch between its windows' lowest and highest behind it, the band that was aimed
 * at, the night, and under it the outputs that act on it. Its head states the numbers - the low and the high of the
 * window, and the reading at the cursor - because a plot without one is a shape.
 */
export function Panel(props: PanelProps) {
  const { panel, cursor, read, ends, stamp, scrub, selection, onNudge, onWheelZoom, focus, stepMs, resting, explain = false, comparedAt } = props;
  const { t } = useTranslation();
  const { from, to } = panel.plot;
  const option = useMemo(() => (palette: ChartPalette) => plotOption(palette, panel.plot), [panel.plot]);
  const left = `${fractionOf(cursor, from, to) * 100}%`;
  const [first] = panel.curves;
  const alone = panel.curves.length === 1;
  const compared = alone && comparedAt ? comparedAt(first.key) : null;
  const overlay = useRef<HTMLDivElement>(null);
  const turned = useRef(0);

  // A listener of its own, because the page must not scroll or zoom under the gesture and React's wheel cannot say so.
  // Without the key the wheel is the page's: a plot never takes a scroll.
  useEffect(() => {
    const element = overlay.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      turned.current += event.deltaY;
      if (Math.abs(turned.current) < WHEEL_STEP) return;
      const box = element.getBoundingClientRect();
      onWheelZoom(turned.current < 0 ? 1 : -1, box.width > 0 ? Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) : 0.5);
      turned.current = 0;
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [onWheelZoom]);

  return (
    <section
      className={styles.panel}
      data-focus={(panel.metric !== null && panel.metric === focus) || undefined}
      aria-label={panel.curves.map(curve => curve.name).join(', ')}
    >
      <header className={styles.panelHead}>
        {alone ? (
          <>
            {/* The name and its low and high wrap beside the figure, which keeps the end of the name's row at every width. */}
            <span className={styles.panelLabel}>
              {/* The (i) beside the heading rather than in it, which a screen reader would read as part of the name. */}
              <span className={styles.panelName} style={inked(first)}>
                <h2>{first.name}</h2>
                {first.key === 'vpd' ? <Help topic="vpd" /> : explain ? <Help topic="nightBand" /> : null}
              </span>
              <span className={styles.panelRange}>
                <Facts
                  facts={[
                    ...(first.low === null || first.high === null
                      ? []
                      : [t('timeline.lowAt', { value: first.written(first.low) }), t('timeline.highAt', { value: first.written(first.high) })]),
                    // Said beside the figures, so a low that rises when the window widens by a minute contradicts nothing.
                    ...(first.of ? [first.of] : []),
                    ...(compared !== null && compared !== undefined ? [t('timeline.comparedAt', { value: first.written(compared) })] : []),
                  ]}
                />
              </span>
            </span>
            <strong className={styles.panelValue} data-rest={read[0].rest}>
              <span>{read[0].written}</span>
            </strong>
          </>
        ) : (
          <h2 className={styles.panelMany}>
            {read.map(({ curve, written, rest }) => (
              <span key={curve.key} style={inked(curve)}>
                {curve.name}{' '}
                <strong data-rest={rest}>
                  <span>{written}</span>
                </strong>
              </span>
            ))}
          </h2>
        )}
      </header>
      {/* One picture of many curves has a pair of figures for each, so it is as high as they need. */}
      <div className={styles.plot} style={alone || panel.curves.length < 4 ? undefined : { height: panel.curves.length * 28 + 8 }}>
        <Chart
          option={option}
          height="100%"
          ariaLabel={t('timeline.plotAlt', {
            names: panel.curves
              .map(curve =>
                curve.low === null || curve.high === null
                  ? curve.name
                  : t('timeline.plotRange', { name: curve.name, low: curve.written(curve.low), high: curve.written(curve.high), unit: curve.unit }),
              )
              .join(', '),
          })}
        />
        {(['high', 'low'] as const).map(end => (
          <span key={end} className={end === 'high' ? styles.scaleHigh : styles.scaleLow} aria-hidden>
            {panel.curves.map(curve => (
              <span key={curve.key} style={alone ? undefined : inked(curve)}>
                {/* A scale so narrow that both ends are written alike says the figure once. */}
                {end === 'low' && curve.corner(curve.line.scale.low) === curve.corner(curve.line.scale.high)
                  ? null
                  : curve.corner(curve.line.scale[end])}
              </span>
            ))}
          </span>
        ))}
        <div
          className={styles.overlay}
          ref={overlay}
          role="slider"
          tabIndex={0}
          aria-label={t('timeline.cursorOn', { name: panel.curves.map(curve => curve.name).join(', ') })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fractionOf(cursor, from, to) * 100)}
          aria-valuetext={stamp}
          onKeyDown={event => {
            const to = ({ ArrowLeft: -1, ArrowRight: 1, Home: 'start', End: 'end' } as const)[event.key];
            if (to === undefined) return;
            event.preventDefault();
            onNudge(to);
          }}
          {...scrub}
        >
          {selection ? (
            <span className={styles.selection} style={{ left: `${selection.from * 100}%`, width: `${(selection.to - selection.from) * 100}%` }} />
          ) : null}
          {resting ? null : <span className={styles.cursor} style={{ left }} />}
          {read.map(({ curve, point }) => {
            const { low, high } = curve.line.scale;
            if (!point || high === low) return null;
            return (
              <span
                key={curve.key}
                className={styles.dot}
                style={{
                  ...inked(curve),
                  left: `${fractionOf(point[0], from, to) * 100}%`,
                  top: `${(1 - ((point[1] as number) - low) / (high - low)) * 100}%`,
                }}
              />
            );
          })}
        </div>
      </div>
      <Strips strips={panel.strips} from={from} to={to} stepMs={stepMs} cursor={resting ? null : cursor} focus={focus} />
      <Axis from={from} to={to} ends={ends} />
    </section>
  );
}

/**
 * The window's two ends, and between them the instants a reader counts by -
 * the full hour, midnight - where their label has room.
 */
export function Axis({ from, to, ends }: { from: number; to: number; ends: readonly [string, string] }) {
  const zone = useZone();
  const axis = useRef<HTMLParagraphElement>(null);
  const [width, setWidth] = useState(0);
  const ticks = useMemo(
    () => (width > 0 ? timeTicks(from, to, zone, ticksFor(width, to - from <= HOUR_MS ? CLOCK_ROOM_PX : TICK_ROOM_PX), DAY_IN_YEAR) : []),
    [from, to, zone, width],
  );

  useEffect(() => {
    const element = axis.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => setWidth(Math.round(entries[0]?.contentRect.width ?? 0)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A label that would stand on one already written is left out: the ends first, then each line in turn.
  useLayoutEffect(() => {
    const element = axis.current;
    if (!element) return;
    const taken = [...element.querySelectorAll<HTMLElement>('[data-end]')].map(end => end.getBoundingClientRect());
    for (const label of element.querySelectorAll<HTMLElement>('[data-tick]')) {
      label.style.visibility = '';
      const box = label.getBoundingClientRect();
      const clash = taken.some(other => box.width > 0 && box.left < other.right + 8 && box.right > other.left - 8);
      label.style.visibility = clash ? 'hidden' : '';
      if (!clash) taken.push(box);
    }
  });

  return (
    <p ref={axis} className={styles.axis} aria-hidden>
      <span data-end>{ends[0]}</span>
      {ticks.map(tick => (
        <span key={tick.at} data-tick style={{ left: `${fractionOf(tick.at, from, to) * 100}%` }}>
          {tick.label}
        </span>
      ))}
      <span data-end>{ends[1]}</span>
    </p>
  );
}

/** A curve's own colour, by the token it is drawn in. */
const inked = (curve: Pick<PanelModel['curves'][number], 'colour'>) => ({ color: `var(--${curve.colour})` });
