import { ChevronDown, Leaf } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowListItem, GrowWeekCard, Person, WeekClimate } from '@fg2/shared-types/v1';
import { useWeekEntries } from '@/api/grows';
import { THUMBNAIL_WIDTH, mediaUrl } from '@/api/session';
import { EntryRow } from '@/ui/EntryRow';
import { readingFigure } from '@/ui/entries';
import { amountLabel, schemeName } from './scheme';
import styles from './WeekCard.module.css';

interface WeekCardProps {
  week: GrowWeekCard;
  grow: GrowListItem;
  people: Person[];
  now: DateTime;
  /** The week the grow is in opens by itself; every other one opens on a tap. */
  current: boolean;
}

const figure = (value: number | null, decimals: number): string => (value === null ? '–' : value.toFixed(decimals));

/**
 * One week of the grow: its number and day range, the seven thumbnails, the
 * day and night averages, what the scheme says to feed and how much of that
 * was done, where the grow's own readings stand, and the week's lines with who
 * wrote them.
 */
export function WeekCard({ week, grow, people, now, current }: WeekCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(current);
  // The rest of the week's lines, asked for only once somebody asks to read
  // them: a card carries the first ten and a week with an alarm storm in it
  // spends all ten on the machine, so the note the grower wrote falls off the
  // one screen it was ever drawn on.
  const [all, setAll] = useState(false);
  const rest = useWeekEntries(grow.id, all ? week : null);
  const shown = rest.data ? rest.data.items : week.entries;
  const missing = week.entryCount - shown.length;
  const temperature = week.climate.find(row => row.metric === 'temperature');
  const humidity = week.climate.find(row => row.metric === 'humidity');
  const readingName = (key: string) => grow.measurements.find(definition => definition.key === key);

  return (
    <article className={styles.card} aria-label={t('grow.weekN', { week: week.weekNumber })}>
      <button type="button" className={styles.header} aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span className={styles.title}>
          <span className={styles.weekName}>{t('grow.weekN', { week: week.weekNumber })}</span>
          <span className={`mono ${styles.range}`}>
            {t('grow.dayRange', { from: week.dayFrom, to: week.dayTo })}
            {current ? ` · ${t('grow.thisWeek')}` : ''}
          </span>
        </span>
        {week.stage ? (
          <span className={`mono ${styles.stagePill}`}>
            {week.preset === 'late_flowering' ? t('grow.lateFlower') : t(`home.stage.${week.stage}`)}
            {week.stageWeek !== null ? ` ${t('home.card.week', { week: week.stageWeek })}` : ''}
          </span>
        ) : null}
        <ChevronDown size={16} strokeWidth={1.75} className={styles.chevron} data-open={open} aria-hidden />
      </button>

      <ul className={styles.days}>
        {week.days.map(day => {
          const at = DateTime.fromISO(day.startsAt);
          const src = day.mediaId ? mediaUrl(day.mediaId, THUMBNAIL_WIDTH.dayTile) : null;
          return (
            <li key={day.dayNumber} className={styles.dayTile} data-future={at > now}>
              <span className={styles.thumb} title={t('home.card.dayN', { day: day.dayNumber })}>
                {src ? <img src={src} alt={t('grow.dayStillAlt', { day: day.dayNumber })} loading="lazy" /> : null}
              </span>
              <span className={`mono ${styles.dayName}`}>{at.toFormat('ccc')}</span>
            </li>
          );
        })}
      </ul>

      {week.deviceIds?.length === 0 ? (
        // Nothing measures where the grow stands, so there is nothing to average: the card says so rather than drawing dashes.
        <p className={`mono ${styles.noClimate}`}>{t('grow.noController')}</p>
      ) : week.climate.length === 0 ? (
        <p className={`mono ${styles.noClimate}`}>{t('grow.nothingMeasured')}</p>
      ) : (
        <dl className={styles.stats}>
          <Stat value={dayNight(temperature, 1)} unit="°C" label={temperature?.dayAverage != null ? t('grow.dayNight') : t('grow.average')} />
          <Stat value={figure(humidity?.averageValue ?? null, 0)} unit="%" label={t('grow.humidity')} />
          <Stat value={figure(week.lightHours, 0)} unit="h" label={t('grow.light')} />
        </dl>
      )}

      {open ? (
        <>
          {week.feeding ? (
            <div className={styles.feeding}>
              <Leaf size={14} strokeWidth={1.75} className={styles.feedingIcon} aria-hidden />
              <div className={styles.feedingText}>
                {/* A grid the grower has corrected is no longer the chart it was printed from, and a card that
                    named the manufacturer alone would credit that chart with figures it never published. */}
                <span className={styles.feedingTitle}>
                  {schemeName(grow, t)}
                  {grow.scheme?.edited ? ` · ${t('grow.edited')}` : ''} · {t('grow.weekN', { week: week.weekNumber }).toLowerCase()}
                </span>
                <span className={styles.feedingAmounts}>
                  {week.feeding.amounts
                    .filter(amount => amount.value !== null)
                    .map(amountLabel)
                    .join(' · ') || t('grow.nothingThisWeek')}
                </span>
              </div>
              <span className={`mono ${styles.done}`} data-complete={week.feedCount >= week.feeding.plannedCount}>
                {t('grow.feedsDone', { done: week.feedCount, planned: week.feeding.plannedCount })}
              </span>
            </div>
          ) : null}

          {week.readings.length > 0 ? (
            <p className={`mono ${styles.readings}`}>
              {week.readings.map((reading, index) => {
                const definition = readingName(reading.key);
                return (
                  <span key={reading.key}>
                    {index > 0 ? ' · ' : ''}
                    <span className={styles.readingName}>{definition?.name ?? reading.key}</span> {readingFigure(reading.value)}
                    {definition?.unit ? ` ${definition.unit}` : ''}
                    {reading.change ? (
                      <span className={styles.change}>{` ${reading.change > 0 ? '+' : ''}${readingFigure(reading.change)}`}</span>
                    ) : null}
                  </span>
                );
              })}
            </p>
          ) : null}

          {shown.length > 0 ? (
            <ul className={styles.entries}>
              {shown.map(entry => (
                <EntryRow key={entry.id} entry={entry} people={people} picture={mediaUrl} measurements={grow.measurements} withDay />
              ))}
            </ul>
          ) : (
            <p className={styles.noEntries}>{t('grow.noEntriesThisWeek')}</p>
          )}
          {missing > 0 ? (
            <button type="button" className={`mono ${styles.more}`} disabled={rest.isFetching} onClick={() => setAll(true)}>
              {rest.isFetching ? t('home.waiting') : t('grow.moreEntries', { count: missing })}
            </button>
          ) : null}
          {rest.isError ? (
            <p className={`mono ${styles.more}`} role="alert">
              {t('shell.loadFailed')}
            </p>
          ) : null}
        </>
      ) : null}
    </article>
  );
}

/** "25.1 / 22.1" where the controller told day from night; the plain mean where it did not. */
const dayNight = (row: WeekClimate | undefined, decimals: number): string =>
  row?.dayAverage !== null && row?.dayAverage !== undefined
    ? `${figure(row.dayAverage, decimals)} / ${figure(row.nightAverage, decimals)}`
    : figure(row?.averageValue ?? null, decimals);

function Stat({ value, unit, label }: { value: string; unit: string; label: string }) {
  return (
    <div className={styles.stat}>
      <dd className={styles.statValue}>
        <span className="figure">{value}</span>
        <span className={`mono ${styles.statUnit}`}>{unit}</span>
      </dd>
      <dt className="label">{label}</dt>
    </div>
  );
}
