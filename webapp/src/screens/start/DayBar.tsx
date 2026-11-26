import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { nowThere } from '@/ui/zone';
import type { LightWindow } from './place';
import styles from './Tiles.module.css';

/**
 * Today from midnight to midnight on the account's clock, lit where the lamp
 * is on, with now marked: the window "08:00–20:00" drawn rather than read. A
 * window that runs past midnight is two pieces, one at each end.
 */
export function DayBar({ window, now, zone }: { window: LightWindow; now: DateTime; zone: string | null }) {
  const { t } = useTranslation();
  const end = window.start + window.hours;
  const pieces: [number, number][] =
    end <= 24
      ? [[window.start, end]]
      : [
          [window.start, 24],
          [0, end - 24],
        ];
  const here = nowThere(now, zone);
  const current = here.hour + here.minute / 60;

  return (
    <div
      role="img"
      aria-label={
        window.always ? t('start.light.always') : window.never ? t('start.light.never') : t('start.light.barAlt', { on: window.on, off: window.off })
      }
    >
      <div className={styles.dayTrack}>
        {window.never
          ? null
          : pieces.map(([from, to]) => (
              <span key={from} className={styles.dayLit} style={{ left: `${(from / 24) * 100}%`, width: `${((to - from) / 24) * 100}%` }} />
            ))}
        <span className={styles.dayNow} style={{ left: `${(current / 24) * 100}%` }} />
      </div>
      <div className={styles.dayTicks} aria-hidden>
        <span>0</span>
        <span>6</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </div>
  );
}
