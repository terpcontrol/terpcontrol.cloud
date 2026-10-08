import { Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { roundTheClock } from '@fg2/shared-types/v1-schemas/day-night.js';
import { decimalFigure, typedFigure } from '@/ui/figures';
import { TimeInput } from '../TimeInput';
import styles from './DayNight.module.css';

/**
 * A press that is held steps again and again, the way a thermostat's buttons
 * do: once on the press, then after a pause every tenth of a second until the
 * finger comes off. The click a press ends in is the one step a short press
 * makes, so a press that has been repeating swallows it rather than stepping
 * once more.
 */
function useRepeat(step: () => void) {
  const latest = useRef(step);
  useEffect(() => {
    latest.current = step;
  });
  const timer = useRef<number | null>(null);
  const repeated = useRef(false);

  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);

  const run = () => {
    repeated.current = true;
    latest.current();
    timer.current = window.setTimeout(run, 90);
  };

  return {
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      repeated.current = false;
      stop();
      timer.current = window.setTimeout(run, 450);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onClick: () => {
      if (repeated.current) {
        repeated.current = false;
        return;
      }
      latest.current();
    },
  };
}

interface StepperProps {
  /** What it is called to a screen reader: "Day temperature" rather than a bare "Temperature". */
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  decimals: number;
  /** Written after the figure inside the field, where the row's label does not carry the unit. */
  unit?: string;
  /** The two buttons, as a screen reader reads them out. */
  less: string;
  more: string;
  /** The figure differs from what the device holds, which is drawn so a save is seen to send it. */
  changed?: boolean;
  disabled?: boolean;
  onChange: (value: number) => void;
}

/**
 * One target, set in place: − and + either side of the figure, the figure
 * itself typed into where that is quicker. A thumb sets a temperature to the
 * half degree with a tap or two rather than chasing it along a slider a
 * hundred pixels wide, and the two halves of a table fit side by side on a
 * phone.
 *
 * The field keeps what is being typed until it is left, because "3" on the way
 * to "31" is not a temperature to snap to; the arrow keys step like the
 * buttons do.
 */
export function Stepper({ name, value, min, max, step, decimals, unit, less, more, changed = false, disabled = false, onChange }: StepperProps) {
  const [typing, setTyping] = useState<string | null>(null);
  const written = decimalFigure(value, Number.isInteger(value) ? 0 : decimals);

  const scale = 10 ** decimals;
  const clamp = (next: number) => Math.min(max, Math.max(min, Math.round(next * scale) / scale));
  const by = (direction: 1 | -1) => () => {
    // On the grid the step makes, so a figure typed off it lands back on it.
    const steps = direction > 0 ? Math.floor(value / step + 1e-9) + 1 : Math.ceil(value / step - 1e-9) - 1;
    const next = clamp(steps * step);
    if (next !== value) onChange(next);
  };
  const down = useRepeat(by(-1));
  const up = useRepeat(by(1));

  const commit = () => {
    if (typing === null) return;
    const typed = typedFigure(typing);
    if (typed !== null) onChange(clamp(typed));
    setTyping(null);
  };

  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      setTyping(null);
      by(event.key === 'ArrowUp' ? 1 : -1)();
    }
  };

  return (
    <span className={styles.stepper} data-changed={changed || undefined}>
      <button type="button" className={styles.stepButton} aria-label={less} disabled={disabled || value <= min} {...down}>
        <Minus size={16} strokeWidth={2} aria-hidden />
      </button>
      <span className={styles.stepFigure}>
        <input
          className={`mono ${styles.stepInput}`}
          type="text"
          inputMode="decimal"
          role="spinbutton"
          aria-label={name}
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuetext={unit ? `${written} ${unit}` : written}
          value={typing ?? written}
          disabled={disabled}
          size={Math.max(2, written.length)}
          onFocus={event => event.currentTarget.select()}
          onChange={event => setTyping(event.target.value)}
          onBlur={commit}
          onKeyDown={keys}
        />
        {unit ? <span className={styles.stepUnit}>{unit}</span> : null}
      </span>
      <button type="button" className={styles.stepButton} aria-label={more} disabled={disabled || value >= max} {...up}>
        <Plus size={16} strokeWidth={2} aria-hidden />
      </button>
    </span>
  );
}

interface ClockStepperProps {
  name: string;
  /** Seconds past midnight UTC: the document's clock. */
  seconds: number;
  /** How far the account's wall clock is ahead of UTC, in seconds. */
  offset: number;
  less: string;
  more: string;
  changed?: boolean;
  disabled?: boolean;
  onChange: (seconds: number) => void;
}

const HALF_HOUR = 30 * 60;

/**
 * A time of day, set the same way: the buttons move it by half an hour along
 * the account's wall clock, landing on the half hour, and the field in the
 * middle is the browser's own time field - a wheel on a phone - for a time
 * that is easier typed.
 */
export function ClockStepper({ name, seconds, offset, less, more, changed = false, disabled = false, onChange }: ClockStepperProps) {
  const local = roundTheClock(seconds + offset);

  const by = (direction: 1 | -1) => () => {
    const steps = direction > 0 ? Math.floor(local / HALF_HOUR) + 1 : Math.ceil(local / HALF_HOUR) - 1;
    onChange(roundTheClock(steps * HALF_HOUR - offset));
  };
  const down = useRepeat(by(-1));
  const up = useRepeat(by(1));

  return (
    <span className={styles.stepper} data-changed={changed || undefined}>
      <button type="button" className={styles.stepButton} aria-label={less} disabled={disabled} {...down}>
        <Minus size={16} strokeWidth={2} aria-hidden />
      </button>
      <span className={styles.stepFigure}>
        <TimeInput
          className={`mono ${styles.stepInput} ${styles.stepClock}`}
          aria-label={name}
          seconds={seconds}
          offset={offset}
          disabled={disabled}
          onChange={onChange}
        />
      </span>
      <button type="button" className={styles.stepButton} aria-label={more} disabled={disabled} {...up}>
        <Plus size={16} strokeWidth={2} aria-hidden />
      </button>
    </span>
  );
}
