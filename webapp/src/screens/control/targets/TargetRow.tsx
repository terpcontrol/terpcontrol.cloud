import { useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './Targets.module.css';
import type { HelpTopic } from '@/ui/explain';
import { Help } from '@/ui/Help';
import ui from '@/ui/ui.module.css';

interface TargetRowProps {
  id: string;
  label: string;
  /** What the slider is called to a screen reader, where "Temperature" alone would not say which of the two. */
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  /** What stands beside the figure: the VPD it amounts to, the hours the light is on. */
  aside?: ReactNode;
  /** What the label cannot say on its own, as the (i) beside it. */
  help?: HelpTopic;
  disabled: boolean;
  onChange: (value: number) => void;
}

/**
 * One target: a slider for the thumb and, where the figure is, a field for a
 * value that is easier typed than dragged to. The two are the same value, so
 * moving either moves the other; the field keeps what is being typed until it
 * is left, because "3" on the way to "31" is not a temperature to snap to.
 */
export function TargetRow({ id, label, name, value, min, max, step, unit, aside, help, disabled, onChange }: TargetRowProps) {
  const { t } = useTranslation();
  const [typing, setTyping] = useState<string | null>(null);
  const fill = `${((value - min) / (max - min)) * 100}%`;

  const commit = () => {
    if (typing === null) return;
    const typed = Number(typing.replace(',', '.'));
    if (Number.isFinite(typed)) onChange(Math.min(max, Math.max(min, typed)));
    setTyping(null);
  };

  return (
    <div className={styles.row}>
      <label className={styles.rowLabel} htmlFor={id}>
        {label}
        {help ? <Help topic={help} /> : null}
      </label>
      <input
        id={id}
        className={`${ui.range} ${styles.slider}`}
        style={{ '--filled': fill } as CSSProperties}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={name}
        aria-valuetext={`${value} ${unit}`}
        onChange={event => onChange(Number(event.target.value))}
      />
      <span className={styles.value}>
        <span className={`mono ${styles.figure}`}>
          <input
            className={styles.typed}
            type="number"
            inputMode="decimal"
            min={min}
            max={max}
            step={step}
            value={typing ?? value}
            disabled={disabled}
            aria-label={t('targets.typed', { name })}
            onChange={event => setTyping(event.target.value)}
            onBlur={commit}
            onKeyDown={event => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
          <span className={styles.unit}>{unit}</span>
        </span>
        {aside ? <span className={`mono ${styles.aside}`}>{aside}</span> : null}
      </span>
    </div>
  );
}
