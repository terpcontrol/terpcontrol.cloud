import { DateTime } from 'luxon';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CardValue, Metric, OverviewCamera, SpaceOverview } from '@fg2/shared-types/v1';
import { PUBLIC_WIDTH, type Picture } from '@/api/public';
import { ageAttribute, ageLabel } from '@/ui/age';
import { EntryRow } from '@/ui/EntryRow';
import ui from '@/ui/ui.module.css';
import { livenessOf, measuredAtOf } from '../home/attention';
import { LivenessPill } from '../home/SpaceCard';
import { figure, targetFigure, UNIT } from '../home/units';
import { Photo } from '@/ui/Photo';
import styles from './Public.module.css';

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
  const liveness = livenessOf(space);
  const shown = TILES.flatMap(metric => space.values.filter(value => value.metric === metric));

  return (
    <article className={styles.diary}>
      {banner}

      <header className={styles.hero}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{space.name}</h1>
          <LivenessPill liveness={liveness} measuredAt={measuredAtOf(space.values)} now={now} />
        </div>
        <p className={`mono ${styles.facts}`}>
          {[t(`publicPage.spaceKind.${space.kind}`), space.grows.map(grow => grow.name).join(', ')].filter(Boolean).join(' · ')}
        </p>
      </header>

      {shown.length === 0 ? (
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('space.noReadingsYet')}</p>
      ) : (
        <div className={styles.tiles}>
          {shown.map(value => (
            <Tile key={value.metric} value={value} setpoint={space.setpoints.find(row => row.metric === value.metric)?.value ?? null} />
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
              <span className={styles.cardTitle}>{grow.name}</span>
              <span className={`mono ${styles.cardMeta}`}>
                {[
                  grow.dayNumber !== null ? t('home.card.dayN', { day: grow.dayNumber }) : null,
                  grow.stage ? t(`home.stage.${grow.stage}`) : null,
                  grow.strains.join(', ') || null,
                  grow.plantCount !== null ? t('home.card.plants', { count: grow.plantCount }) : null,
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
              <EntryRow key={entry.id} entry={entry} people={[]} now={now} byline={false} picture={picture} />
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}

/** One reading, as large as it is on the owner's own page, dimmed by the age the server gave it and never hidden. */
function Tile({ value, setpoint }: { value: CardValue; setpoint: number | null }) {
  const { t } = useTranslation();

  return (
    <div className={`${ui.card} ${styles.tile}`} {...ageAttribute(value.state)}>
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
