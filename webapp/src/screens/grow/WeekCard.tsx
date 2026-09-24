import { ChevronDown, Leaf } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowListItem, GrowWeekCard, Person, WeekClimate } from '@fg2/shared-types/v1';
import { useWeekEntries } from '@/api/grows';
import { useCorrecting } from '@/log/corrections';
import { THUMBNAIL_WIDTH, mediaUrl } from '@/api/session';
import { EntryRow } from '@/ui/EntryRow';
import { unitSymbol } from '@/ui/age';
import { decimalFigure } from '@/ui/figures';
import { readingFigure, weekDayOf } from '@/ui/entries';
import { standsIn } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
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

const figure = (value: number | null, decimals: number): string => (value === null ? '–' : decimalFigure(value, decimals));

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
  // A line is corrected where it is read, which for most of this account's
  // diary is here: a migrated grow has no plants and so no plant page, which
  // used to be the only screen in the app that opened a written line again.
  const correcting = useCorrecting();
  // The last day the grow lived through. A week card is always seven days wide -
  // "day 218-224" is what the week *is* - so the tiles are where it says how
  // much of it happened, and for a grow that ended in August the unlived days
  // are in the past and were drawn as days like any other.
  const lived = grow.endedAt ? DateTime.fromISO(grow.endedAt) : now;
  const shown = rest.data ? rest.data.items : week.entries;
  const missing = week.entryCount - shown.length;
  const temperature = week.climate.find(row => row.metric === 'temperature');
  const humidity = week.climate.find(row => row.metric === 'humidity');
  const readingName = (key: string) => grow.measurements.find(definition => definition.key === key);

  return (
    <article className={styles.card} aria-label={t('grow.weekN', { week: week.weekNumber })}>
      <button type="button" className={styles.header} aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span className={styles.title}>
          <span className={`name ${styles.weekName}`}>{t('grow.weekN', { week: week.weekNumber })}</span>
          <span className={`mono ${styles.range}`}>
            {t('grow.dayRange', { from: week.dayFrom, to: week.dayTo })}
            {current ? ` · ${t('grow.thisWeek')}` : ''}
          </span>
        </span>
        {week.stage ? (
          <span className={ui.tag}>
            {week.preset === 'late_flowering' ? t('grow.lateFlower') : t(`home.stage.${week.stage}`)}
            {week.stageWeek !== null ? ` ${t('home.card.week', { week: week.stageWeek })}` : ''}
          </span>
        ) : null}
        <ChevronDown size={16} strokeWidth={1.75} className={styles.chevron} data-open={open} aria-hidden />
      </button>

      <ul className={styles.days}>
        {/* A tile is one of the grow's own days, and those begin when the grow
            began rather than at midnight - so a tile straddles two dates and is
            named after neither. Called after the weekday it opens on, it put
            the stage marker a day before the line on this very card that
            announces that stage, and dimmed as unlived a day whose lines the
            card was already drawing. The day number is what the tile is, it is
            unique inside the card, and the lines below are stamped with it. */}
        {week.days.map(day => {
          const at = DateTime.fromISO(day.startsAt);
          const src = day.mediaId ? mediaUrl(day.mediaId, THUMBNAIL_WIDTH.dayTile) : null;
          return (
            <li key={day.dayNumber} className={styles.dayTile} data-future={at > lived}>
              <span className={styles.thumb} title={t('home.card.dayN', { day: day.dayNumber })}>
                {src ? <img src={src} alt={t('grow.dayStillAlt', { day: day.dayNumber })} loading="lazy" /> : null}
              </span>
              <span className={`mono ${styles.dayName}`}>{t('grow.dayShort', { day: day.dayNumber })}</span>
              {/* The card is named after the stage its week ended in, which says
                  nothing about a week that held two or three of them. The day a
                  stage began is where that belongs, and it is the only place a
                  stage the grow passed through inside one week is recorded. The
                  day it began is the grow's day, not the calendar's: a stage
                  entered at four in the morning belongs to the day that was
                  running at four in the morning. */}
              {day.stage ? <span className={`${ui.tag} ${ui.tagSmall}`}>{t(`grow.stageShort.${day.stage}`)}</span> : null}
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
        <dl className={`${ui.strip} ${styles.stats}`}>
          <Stat value={dayNight(temperature, 1)} unit="°C" label={temperature?.dayAverage != null ? t('grow.dayNight') : t('grow.average')} />
          <Stat value={figure(humidity?.averageValue ?? null, 0)} unit="%" label={t('grow.humidity')} />
          <Stat value={figure(week.lightHours, 0)} unit={unitSymbol('h')} label={t('grow.light')} />
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
              {shown.map(entry => {
                const day = weekDayOf(week, entry.occurredAt);

                return (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    people={people}
                    picture={mediaUrl}
                    measurements={grow.measurements}
                    day={day}
                    onOpen={correcting(entry, { label: grow.name, dayNumber: day, ownerId: grow.ownerId, spaceId: standsIn(grow) })}
                  />
                );
              })}
            </ul>
          ) : (
            // "yet" is a promise that the week can still be written in. An
            // earlier week of a running grow can - a line is filed against the
            // day it is dated to - but a grow that has ended is on no Log
            // sheet's list of targets at all, so nothing can ever be added to
            // any week of it.
            <p className={styles.noEntries}>{t(grow.endedAt ? 'grow.noEntriesThisWeekEnded' : 'grow.noEntriesThisWeek')}</p>
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
    <div>
      <dd className={ui.stripValue}>
        <span className="figure">{value}</span>
        <span className={`mono ${ui.stripUnit}`}>{unit}</span>
      </dd>
      <dt className="caption">{label}</dt>
    </div>
  );
}
