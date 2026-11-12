import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chart } from '@/charts/Chart';
import type { Selection } from '@/charts/scrub';
import { plotOption } from '@/charts/series';
import { TICK_ROOM_PX, ticksFor, timeTicks } from '@/charts/ticks';
import type { ChartPalette } from '@/charts/tokens';
import { Facts } from '@/ui/Facts';
import { Help } from '@/ui/Help';
import { DAY_IN_YEAR, useZone } from '@/ui/zone';
import { nearestPoint, type PanelModel } from './model';
import { Strips } from './Strips';
import { fractionOf } from './window';
import styles from './Timeline.module.css';

/** How far the wheel turns for one width of the zoom: a notch of a mouse, a short pinch on a trackpad. */
const WHEEL_STEP = 60;

interface PanelProps {
  panel: PanelModel;
  cursor: number;
  /** How near the cursor a point has to stand to be read at it. */
  reach: (panel: PanelModel['curves'][number]) => number;
  /** Both ends of the window as the axis writes them. */
  ends: readonly [string, string];
  /** What the cursor is called to a screen reader: its instant. */
  stamp: string;
  scrub: React.HTMLAttributes<HTMLDivElement>;
  selection: Selection | null;
  onNudge: (direction: -1 | 1) => void;
  /** A pinch on a trackpad, or the wheel with Ctrl held: one width in (`1`) or out, around a fraction of the plot. */
  onWheelZoom: (direction: -1 | 1, fraction: number) => void;
  focus: string | null;
  /** The cursor rests at the end of the window: its dot is drawn and its line is not, which would stand on the scale's figures. */
  resting: boolean;
  /** The first panel explains what every panel draws: the band, the night, the stretch around the line. */
  explain?: boolean;
  /** The value of what is laid over, at the cursor, where something is. */
  comparedAt?: (key: string) => number | null;
}

/**
 * One panel: the curve with the stretch between its windows' lowest and
 * highest behind it, the band that was aimed at, the night, and under it the
 * outputs that act on it. Its head states the numbers - the low and the high
 * of the window, and the reading at the cursor - because a plot without one is
 * a shape.
 */
export function Panel({
  panel,
  cursor,
  reach,
  ends,
  stamp,
  scrub,
  selection,
  onNudge,
  onWheelZoom,
  focus,
  resting,
  explain = false,
  comparedAt,
}: PanelProps) {
  const { t } = useTranslation();
  const { from, to } = panel.plot;
  const option = useMemo(() => (palette: ChartPalette) => plotOption(palette, panel.plot), [panel.plot]);
  const left = `${fractionOf(cursor, from, to) * 100}%`;
  const read = panel.curves.map(curve => ({ curve, point: nearestPoint(curve.points, cursor, reach(curve)) }));
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
            <h2 data-colour={first.colour}>
              {first.name}
              {first.key === 'vpd' ? <Help topic="vpd" /> : explain ? <Help topic="nightBand" /> : null}
            </h2>
            <span className={styles.panelRange}>
              {compared !== null && compared !== undefined ? (
                t('timeline.comparedAt', { value: first.written(compared) })
              ) : first.low !== null && first.high !== null ? (
                <Facts
                  facts={[t('timeline.lowAt', { value: first.written(first.low) }), t('timeline.highAt', { value: first.written(first.high) })]}
                />
              ) : null}
            </span>
            <strong className={styles.panelValue}>
              {read[0].point ? `${first.written(read[0].point[1] as number)}\u00a0${first.unit}`.trim() : '—'}
            </strong>
          </>
        ) : (
          <h2 className={styles.panelMany}>
            {read.map(({ curve, point }) => (
              <span key={curve.key} data-colour={curve.colour}>
                {curve.name} <strong>{point ? `${curve.written(point[1] as number)}\u00a0${curve.unit}`.trim() : '—'}</strong>
              </span>
            ))}
          </h2>
        )}
      </header>
      <div className={styles.plot}>
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
        <span className={styles.scaleHigh} aria-hidden>
          {panel.curves.map(curve => (
            <span key={curve.key} data-colour={alone ? undefined : curve.colour}>
              {curve.corner(curve.line.scale.high)}
            </span>
          ))}
        </span>
        <span className={styles.scaleLow} aria-hidden>
          {panel.curves.map(curve => (
            <span key={curve.key} data-colour={alone ? undefined : curve.colour}>
              {curve.corner(curve.line.scale.low)}
            </span>
          ))}
        </span>
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
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            onNudge(event.key === 'ArrowLeft' ? -1 : 1);
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
                data-colour={curve.colour}
                style={{ left: `${fractionOf(point[0], from, to) * 100}%`, top: `${(1 - ((point[1] as number) - low) / (high - low)) * 100}%` }}
              />
            );
          })}
        </div>
      </div>
      <Strips strips={panel.strips} from={from} to={to} cursor={resting ? null : cursor} focus={focus} />
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
  const ticks = useMemo(() => (width > 0 ? timeTicks(from, to, zone, ticksFor(width, TICK_ROOM_PX), DAY_IN_YEAR) : []), [from, to, zone, width]);

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
        <Fragment key={tick.at}>
          <span data-tick style={{ left: `${fractionOf(tick.at, from, to) * 100}%` }}>
            {tick.label}
          </span>
        </Fragment>
      ))}
      <span data-end>{ends[1]}</span>
    </p>
  );
}
