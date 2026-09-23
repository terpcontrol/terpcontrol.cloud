import { ChevronDown, Film, Leaf } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowWeekCard, WeekClimate } from '@fg2/shared-types/v1';
import { PUBLIC_WIDTH, type Picture } from '@/api/public';
import { ageLabel } from '@/ui/age';
import { EntryRow } from '@/ui/EntryRow';
import { decimalFigure } from '@/ui/figures';
import { readingFigure, weekDayOf } from '@/ui/entries';
import ui from '@/ui/ui.module.css';
import { Photo } from '@/ui/Photo';
import { windowIsCurrent } from './window';
import styles from './Public.module.css';

interface DiaryWeekProps {
  week: GrowWeekCard;
  picture: Picture;
  now: DateTime;
  /** The week the diary is in opens by itself; every earlier one opens on a tap. */
  current: boolean;
  /** Whether the grow is over, which decides whether an empty week is one that can still be written in. */
  ended: boolean;
  /**
   * The instant this card is true as of, which only the newest one carries:
   * every earlier week ended when it ended, and dating those would be dating
   * the past. It is the end of the reader's own window rather than the week's,
   * because a week that runs past where a link stops is shown only as far as
   * the link goes.
   */
  asOf: string | null;
}

const figure = (value: number | null, decimals: number): string => (value === null ? '–' : decimalFigure(value, decimals));

/** "25.5 / 20.7" where the controller told day from night; the plain mean where it did not. */
const dayNight = (row: WeekClimate | undefined, decimals: number): string =>
  row?.dayAverage !== null && row?.dayAverage !== undefined
    ? `${figure(row.dayAverage, decimals)} / ${figure(row.nightAverage, decimals)}`
    : figure(row?.averageValue ?? null, decimals);

/**
 * One week of a public diary: the seven pictures, how the tent was kept, what
 * was fed and what was written down.
 *
 * It is a leaner card than the one the owner reads, and deliberately a separate
 * component. The owner's card names a reading by the grow's own measurement
 * definitions, names the feeding scheme and says who wrote each line - three
 * things a stranger is not given and which the public answer therefore does not
 * carry. A card that took the owner's shape would have to invent all three.
 */
export function DiaryWeek({ week, picture, now, current, ended, asOf }: DiaryWeekProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(current);
  const temperature = week.climate.find(row => row.metric === 'temperature');
  const humidity = week.climate.find(row => row.metric === 'humidity');

  return (
    <article className={styles.week} aria-label={t('grow.weekN', { week: week.weekNumber })}>
      <button type="button" className={styles.weekHeader} aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span className={styles.weekTitle}>
          <span className={styles.weekName}>{t('grow.weekN', { week: week.weekNumber })}</span>
          <span className={`mono ${styles.weekRange}`} data-age={asOf && !windowIsCurrent(asOf, now) ? 'stale' : undefined}>
            {t('grow.dayRange', { from: week.dayFrom, to: week.dayTo })}
            {asOf ? ` · ${t('publicPage.asOf', { age: ageLabel(asOf, now) })}` : ''}
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
        {/* The grow's own days, which begin at the hour the grow did: a tile
            covers the tail of one date and the head of the next and is named
            after neither. A weekday there disagreed with the stage marker
            beside it and with the lines below, which are stamped with the day
            number the tile now carries. */}
        {week.days.map(day => {
          const src = day.mediaId ? picture(day.mediaId, PUBLIC_WIDTH.dayTile) : null;
          const at = DateTime.fromISO(day.startsAt);
          return (
            <li key={day.dayNumber} className={styles.dayTile} data-future={at > now}>
              <Photo src={src} alt={t('grow.dayStillAlt', { day: day.dayNumber })} className={styles.thumb} />
              <span className={`mono ${styles.dayName}`}>{t('grow.dayShort', { day: day.dayNumber })}</span>
              {/* Where the grow changed stage inside the week, which the pill
                  above cannot say: it names the stage the week ended in. */}
              {day.stage ? <span className={`mono ${styles.dayStage}`}>{t(`grow.stageShort.${day.stage}`)}</span> : null}
            </li>
          );
        })}
      </ul>

      {/* A reader is not told which controllers these averages came from, so an
          empty list is the one thing that list still says: nothing measures
          where the grow stood. Null is not being told, and then the averages
          speak for themselves. */}
      {week.deviceIds?.length === 0 ? (
        <p className={`mono ${styles.quiet}`}>{t('grow.noController')}</p>
      ) : week.climate.length === 0 ? (
        <p className={`mono ${styles.quiet}`}>{t('grow.nothingMeasured')}</p>
      ) : (
        <dl className={styles.stats}>
          <Stat value={dayNight(temperature, 1)} unit="°C" label={temperature?.dayAverage != null ? t('grow.dayNight') : t('grow.average')} />
          <Stat value={figure(humidity?.averageValue ?? null, 0)} unit="%" label={t('grow.humidity')} />
          <Stat value={figure(week.lightHours, 0)} unit="h" label={t('grow.light')} />
        </dl>
      )}

      {open ? (
        <>
          {week.timelapseMediaId ? <WeekFilm src={picture(week.timelapseMediaId)} /> : null}

          {week.feeding && week.feeding.amounts.some(amount => amount.value !== null) ? (
            <p className={`mono ${styles.feeding}`}>
              <Leaf size={13} strokeWidth={1.75} aria-hidden />
              {week.feeding.amounts
                .filter(amount => amount.value !== null)
                .map(amount => `${amount.name} ${amount.value} ${amount.unit}`)
                .join(' · ')}
              <span className={styles.feedsDone}>{t('grow.feedsDone', { done: week.feedCount, planned: week.feeding.plannedCount })}</span>
            </p>
          ) : null}

          {week.readings.length > 0 ? (
            <p className={`mono ${styles.readings}`}>
              {week.readings.map((reading, index) => (
                <span key={reading.key}>
                  {index > 0 ? ' · ' : ''}
                  <span className={styles.readingName}>{reading.key}</span> {readingFigure(reading.value)}
                  {reading.change ? <span className={styles.change}>{` ${reading.change > 0 ? '+' : ''}${readingFigure(reading.change)}`}</span> : null}
                </span>
              ))}
            </p>
          ) : null}

          {week.entries.length > 0 ? (
            <>
              <ul className={styles.entries}>
                {week.entries.map(entry => (
                  // A stranger reads a public diary on their own clock: the
                  // zone it was written in is not part of what the public API
                  // answers about somebody else's account.
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    people={[]}
                    day={weekDayOf(week, entry.occurredAt)}
                    byline={false}
                    picture={picture}
                    zone={null}
                  />
                ))}
              </ul>
              {/* A card carries the first handful of a week's lines, and a week
                  with an alarm storm or a busy fortnight in it has many more.
                  Said rather than offered: the owner's card fetches the rest,
                  and a public page has no id to ask with and no route to ask -
                  but a reader shown ten of twenty-five lines is owed the count,
                  or the week reads as a week in which that was all that
                  happened. */}
              {week.entryCount > week.entries.length ? (
                <p className={`mono ${styles.quiet}`}>{t('grow.moreEntries', { count: week.entryCount - week.entries.length })}</p>
              ) : null}
            </>
          ) : (
            // A finished diary's empty week is not one that is waiting for a
            // line: nothing can be logged into a grow that is over.
            <p className={styles.quiet}>{t(ended ? 'grow.noEntriesThisWeekEnded' : 'grow.noEntriesThisWeek')}</p>
          )}
        </>
      ) : null}
    </article>
  );
}

/**
 * The week's timelapse, asked for only when somebody wants it. A diary of
 * twenty weeks would otherwise put twenty players on the page, each of them a
 * blank rectangle the size of the card until it was pressed.
 */
function WeekFilm({ src }: { src: string }) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);

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
