import { Play } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mediaUrl } from '@/api/session';
import { stageOfWeek, type FilmedWeek } from './days';
import styles from './Diary.module.css';

/**
 * A week's film: named by the stage of its week and the days it covers, and
 * played where it stands once somebody asks for it - silent, so it starts on
 * that tap.
 */
export function FilmCard({ week }: { week: FilmedWeek }) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const src = mediaUrl(week.film.mediaId);
  const stage = stageOfWeek(t, week);
  const days = t('grow.diary.days', { from: week.film.dayFrom, to: week.film.dayTo });

  if (!src) return null;
  if (playing) return <video className={styles.filmPlayer} src={src} controls autoPlay muted playsInline />;

  return (
    <button type="button" className={styles.film} onClick={() => setPlaying(true)}>
      <span className={styles.filmPlay}>
        <Play size={16} strokeWidth={2} fill="currentColor" aria-hidden />
      </span>
      <span className={styles.rowText}>
        {[t('grow.diary.weekFilm'), stage].filter(Boolean).join(' · ')}
        <span className={styles.rowLine}>
          {week.film.lengthSeconds ? t('grow.diary.filmIn', { days, count: Math.round(week.film.lengthSeconds) }) : days}
        </span>
      </span>
    </button>
  );
}
