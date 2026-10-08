import { Film } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowWeekCard } from '@fg2/shared-types/v1';
import { unitSymbol } from './age';
import { dashFigure, dayNightFigure } from './figures';
import { Term } from './Help';
import ui from './ui.module.css';
import styles from './GrowFigures.module.css';

/**
 * The week's temperatures, humidity and hours of light, a strip under the
 * days, on the owner's week card and the public diary's alike. Where nothing
 * measures where the grow stood there is no climate to
 * average, and a diary kept by hand is not told on every card what it lacks:
 * null is not being told, and then the strip is left out. Each card keeps its
 * own look for the line that says nothing was measured.
 */
export function WeekClimateStrip({ week, explain, emptyClassName }: { week: GrowWeekCard; explain?: boolean; emptyClassName: string }) {
  const { t } = useTranslation();
  if (week.deviceIds?.length === 0) return null;
  if (week.climate.length === 0) return <p className={`mono ${emptyClassName}`}>{t('grow.nothingMeasured')}</p>;

  const temperature = week.climate.find(row => row.metric === 'temperature');
  const humidity = week.climate.find(row => row.metric === 'humidity');

  return (
    <dl className={`${ui.strip} ${styles.stats}`}>
      <Stat
        value={dayNightFigure(temperature, 1)}
        unit="°C"
        label={
          temperature?.dayAverage == null ? (
            t('grow.average')
          ) : explain ? (
            <Term topic="dayNightAverages">{t('grow.dayNight')}</Term>
          ) : (
            t('grow.dayNight')
          )
        }
      />
      <Stat value={dashFigure(humidity?.averageValue ?? null, 0)} unit="%" label={t('grow.humidity')} />
      <Stat value={dashFigure(week.lightHours, 0)} unit={unitSymbol('h')} label={t('grow.light')} />
    </dl>
  );
}

function Stat({ value, unit, label }: { value: string; unit: string; label: ReactNode }) {
  return (
    <div>
      <dd className={ui.stripValue}>
        <span className="figure">{value}</span>
        <span className={`mono ${ui.stripUnit}`}>{unit}</span>
      </dd>
      <dt className="caption">{label}</dt>
    </div>
  );
}

/**
 * The week's timelapse, asked for only when somebody wants it. A diary of
 * twenty weeks would otherwise put twenty players on the page, each of them a
 * blank rectangle the size of the card until it was pressed.
 */
export function WeekFilm({ src }: { src: string | null }) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);

  if (!src) return null;
  if (!playing) {
    return (
      <button type="button" className={`${ui.chip} ${styles.weekFilmButton}`} onClick={() => setPlaying(true)}>
        <Film size={13} strokeWidth={1.75} aria-hidden />
        {t('publicPage.weekFilm')}
      </button>
    );
  }

  // Silent by nature, so it starts on the tap that asked for it rather than on a second one.
  return <video className={styles.weekFilm} src={src} controls autoPlay muted playsInline />;
}
