import { DateTime } from 'luxon';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CardValue, ClimateVerdict, Metric, OverviewCamera, SpaceOverview } from '@fg2/shared-types/v1';
import { PUBLIC_WIDTH, type Picture } from '@/api/public';
import { ageAttribute, ageLabel, valueAge } from '@/ui/age';
import { EntryRow } from '@/ui/EntryRow';
import { readingNamesOf } from '@/ui/entries';
import ui from '@/ui/ui.module.css';
import { livenessOf, measuredAtOf } from '../home/attention';
import { LivenessPill } from '../home/SpaceCard';
import { figure, targetFigure, UNIT } from '../home/units';
import { Photo } from '@/ui/Photo';
import styles from './Public.module.css';
import { windowIsCurrent } from './window';

/** The four the tent page shows: the three a controller steers and the one it derives. */
const TILES: Metric[] = ['temperature', 'humidity', 'vpd', 'co2'];

/**
 * A tent as somebody holding a link to it reads it: what it is doing now, how
 * the last day went, what the cameras saw and what was written down.
 *
 * It is not the owner's tent page and does not try to be. That page is a way in
 * - to the timeline, to the devices, to logging a line - and every one of those
 * roads is shut to a reader with no account. What is left is the part that was
 * worth sharing: the readings with their ages, and the diary.
 */
export function SharedSpace({ space, picture, now, banner }: { space: SpaceOverview; picture: Picture; now: DateTime; banner?: ReactNode }) {
  const { t } = useTranslation();
  const liveness = livenessOf(space, now);
  const shown = TILES.flatMap(metric => space.values.filter(value => value.metric === metric));

  return (
    <article className={styles.diary}>
      {banner}

      <header className={styles.hero}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{space.name}</h1>
          <LivenessPill liveness={liveness} measuredAt={measuredAtOf(space.values)} now={now} explain />
        </div>
        <p className={`mono ${styles.facts}`}>
          {[t(`publicPage.spaceKind.${space.kind}`), space.grows.map(grow => grow.name).join(', ')].filter(Boolean).join(' · ')}
        </p>
      </header>

      {shown.length === 0 ? (
        windowIsCurrent(space.verdict.endsAt, now) ? (
          <p className={`${ui.cardDashed} ${ui.note}`}>{t('space.noReadingsYet')}</p>
        ) : (
          <WindowClimate verdict={space.verdict} />
        )
      ) : (
        <div className={styles.tiles}>
          {shown.map(value => (
            <Tile
              key={value.metric}
              value={value}
              setpoint={space.setpoints.find(row => row.metric === value.metric)?.value ?? null}
              now={now}
            />
          ))}
        </div>
      )}

      {space.verdict.inBandFraction !== null ? (
        <p className={`mono ${styles.verdict}`} data-rating={space.verdict.rating ?? undefined}>
          {t('space.climate24h')} · {t('space.inBand', { percent: Math.round(space.verdict.inBandFraction * 100) })}
        </p>
      ) : null}

      {space.cameras.map(camera => (
        <Stills key={camera.cameraId} camera={camera} picture={picture} now={now} />
      ))}

      {space.grows.length > 0 ? (
        <ul className={styles.growRows} aria-label={t('space.growingHere')}>
          {space.grows.map(grow => (
            <li key={grow.growId} className={styles.growRow}>
              <span className={`name ${styles.cardTitle}`}>{grow.name}</span>
              <span className={`mono ${styles.cardMeta}`}>
                {[
                  grow.dayNumber !== null ? t('home.card.dayN', { day: grow.dayNumber }) : null,
                  grow.stage ? t(`home.stage.${grow.stage}`) : null,
                  grow.strains.join(', ') || null,
                  grow.plantCount ? t('home.card.plants', { count: grow.plantCount }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <section className={styles.weeks} aria-label={t('space.latest')}>
        <span className="label">{t('space.latest')}</span>
        {space.entries.length === 0 ? (
          <p className={styles.quiet}>{t('home.card.noEntries')}</p>
        ) : (
          <ul className={styles.entries}>
            {space.entries.map(entry => (
              // The browser's zone, said out loud: a share link answers what
              // the pictures and the lines are, and not where the grower who
              // wrote them keeps their clock.
              <EntryRow
                key={entry.id}
                entry={entry}
                people={[]}
                measurements={readingNamesOf(space.readingNames, entry.growId)}
                now={now}
                byline={false}
                picture={picture}
                zone={null}
              />
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}

/**
 * One reading, as large as it is on the owner's own page, dimmed by the age it
 * has at the moment it is drawn and never hidden.
 *
 * A shared page is the one screen in the app that is left open: it is a link
 * somebody keeps in a tab, and it does not sign anybody out when the readings
 * stop arriving. The state the answer carried was the truth when the answer was
 * made, so a tile drawing it unjudged kept a frozen figure at full brightness
 * for as long as the tab stayed open, under a pill that had already gone grey -
 * the pill judges again because `livenessOf` does, and these tiles did not.
 */
function Tile({ value, setpoint, now }: { value: CardValue; setpoint: number | null; now: DateTime }) {
  const { t } = useTranslation();

  return (
    <div className={`${ui.card} ${styles.tile}`} {...ageAttribute(valueAge(value, now))}>
      <div className={styles.tileFigure}>
        <span className="figure">{value.value === null ? t('home.card.noReading') : figure(value.value, value.metric)}</span>
        <span className={`mono ${styles.tileUnit}`}>{UNIT[value.metric] ?? value.metric}</span>
      </div>
      <div className={`mono ${styles.tileTarget}`}>
        <span>{t(`home.metric.${value.metric}`, { defaultValue: value.metric })}</span>
        <span>{setpoint === null ? t('home.card.noTarget') : `→ ${targetFigure(setpoint, value.metric)}`}</span>
      </div>
    </div>
  );
}

/**
 * The climate of a window that has closed.
 *
 * "Now" belongs to the present, so a link whose window ended answers no live
 * values - and drawn as a tent without readings, the page told the reader the
 * tent had recorded nothing while the same answer carried the window's last
 * day. That day is what is shown instead: each reading's average with its low
 * and high, under the hours it was read over.
 */
function WindowClimate({ verdict }: { verdict: ClimateVerdict }) {
  const { t } = useTranslation();
  const heard = TILES.flatMap(metric => verdict.metrics.filter(row => row.metric === metric && row.averageValue !== null));
  const at = (instant: string) => DateTime.fromISO(instant).toFormat('d LLL HH:mm');

  if (heard.length === 0) return <p className={`${ui.cardDashed} ${ui.note}`}>{t('publicPage.windowClimate.none')}</p>;

  return (
    <section className={styles.stills}>
      <span className="label">{t('publicPage.windowClimate.title', { from: at(verdict.startsAt), to: at(verdict.endsAt) })}</span>
      <div className={styles.tiles}>
        {heard.map(row => (
          <div key={row.metric} className={`${ui.card} ${styles.tile}`}>
            <div className={styles.tileFigure}>
              <span className="figure">{figure(row.averageValue ?? 0, row.metric)}</span>
              <span className={`mono ${styles.tileUnit}`}>{UNIT[row.metric] ?? row.metric}</span>
            </div>
            <div className={`mono ${styles.tileTarget}`}>
              <span>{t(`home.metric.${row.metric}`, { defaultValue: row.metric })}</span>
              {row.minValue !== null && row.maxValue !== null ? (
                <span>{t('publicPage.windowClimate.range', { low: figure(row.minValue, row.metric), high: figure(row.maxValue, row.metric) })}</span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** What one camera saw, oldest to newest, with the hour on each and how long ago the last one came. */
function Stills({ camera, picture, now }: { camera: OverviewCamera; picture: Picture; now: DateTime }) {
  const { t } = useTranslation();
  if (camera.stills.length === 0) return null;

  return (
    <section className={styles.stills}>
      <span className="label">
        {camera.name}
        {camera.lastStillAt ? ` · ${t('space.lastStill', { age: ageLabel(camera.lastStillAt, now) })}` : ''}
      </span>
      <ul className={styles.stillStrip}>
        {camera.stills.map(still => (
          <li key={still.mediaId} className={styles.still}>
            <Photo
              src={picture(still.mediaId, PUBLIC_WIDTH.dayTile)}
              alt={t('space.stillAlt', { name: camera.name, time: DateTime.fromISO(still.capturedAt).toFormat('HH:mm') })}
              className={styles.stillFrame}
            />
            <span className={`mono ${styles.stillTime}`}>{DateTime.fromISO(still.capturedAt).toFormat('HH:mm')}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
