import { useState, type InputHTMLAttributes } from 'react';
import { secondsOf, wallClock } from '@/ui/wall-clock';

type Props = {
  /** In the document's seconds past midnight UTC. */
  seconds: number;
  /** How far the account's wall clock is ahead of UTC, in seconds. */
  offset: number;
  onChange: (seconds: number) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'onBlur'>;

/**
 * A time of day on the account's wall clock, in the browser's own time field.
 * The field hands over a whole time after every keystroke and nothing while a
 * part of it is cleared, so it keeps what is typed while it has the focus and
 * the draft takes every whole time it hands over.
 */
export function TimeInput({ seconds, offset, onChange, ...input }: Props) {
  const [typing, setTyping] = useState<string | null>(null);

  return (
    <input
      {...input}
      type="time"
      value={typing ?? wallClock(seconds, offset)}
      onChange={event => {
        setTyping(document.activeElement === event.target ? event.target.value : null);
        const next = secondsOf(event.target.value, offset);
        if (next !== null) onChange(next);
      }}
      onBlur={() => setTyping(null)}
    />
  );
}
