import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Help } from '@/ui/Help';
import ui from '@/ui/ui.module.css';
import { secondsOf, wallClock } from './targets-draft';
import styles from './Targets.module.css';

interface LightsOnRowProps {
  id: string;
  /** When the light comes on and goes off, in the document's seconds past midnight UTC. */
  lightsOn: number;
  lightsOff: number;
  /** How far the account's wall clock is ahead of UTC, in seconds. */
  offset: number;
  disabled: boolean;
  onChange: (lightsOn: number) => void;
}

/**
 * "Light on at [08:00] · off at 20:00": when the day begins, on the account's
 * wall clock, with when it ends beside it - which "Light on for" below decides.
 * A grower who moves the light into the night for cheaper power or a cooler
 * summer tent does it here.
 *
 * A time field hands over a whole time after every keystroke and nothing while
 * a part of it is cleared, so the field keeps what is being typed while it has
 * the focus and the draft takes every whole time it hands over; leaving the
 * field puts it back to what the draft holds.
 */
export function LightsOnRow({ id, lightsOn, lightsOff, offset, disabled, onChange }: LightsOnRowProps) {
  const { t } = useTranslation();
  const [typing, setTyping] = useState<string | null>(null);

  return (
    <div className={`${styles.row} ${styles.clockRow}`}>
      <label className={styles.rowLabel} htmlFor={id}>
        {t('targets.lightsOn')}
        <Help topic="lightsOn" />
      </label>
      <span className={styles.clockValue}>
        <input
          id={id}
          className={`mono ${ui.input} ${styles.clock}`}
          type="time"
          value={typing ?? wallClock(lightsOn, offset)}
          disabled={disabled}
          onChange={event => {
            const time = event.target.value;
            setTyping(document.activeElement === event.target ? time : null);
            const seconds = secondsOf(time, offset);
            if (seconds !== null) onChange(seconds);
          }}
          onBlur={() => setTyping(null)}
        />
        <span className={`mono ${styles.aside}`}>{t('targets.lightsOff', { time: wallClock(lightsOff, offset) })}</span>
      </span>
    </div>
  );
}
