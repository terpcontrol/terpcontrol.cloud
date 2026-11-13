import { DateTime } from 'luxon';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CardValue, ClimateVerdict, Metric, OverviewCamera, SpaceOverview } from '@fg2/shared-types/v1';
import { PUBLIC_WIDTH, type Picture } from '@/api/public';
import { ageAttribute, ageLabel, dayStamp, valueAge } from '@/ui/age';
import { Term } from '@/ui/Help';
import { readingNamesOf } from '@/ui/entries';
import ui from '@/ui/ui.module.css';
import { growDay } from '@/screens/grow/progress';
import { livenessOf, measuredAtOf } from '@/screens/start/attention';
import { LivenessPill } from '@/ui/LivenessPill';
import { figure, targetFigure, UNIT } from '@/ui/units';
import { Lines } from '@/ui/Lines';
import { Photo } from '@/ui/Photo';
import { PictureViewer } from '@/ui/PictureViewer';
import { dayLines } from '@/screens/grow/diary/days';
import { DiaryLine } from '@/screens/grow/diary/DiaryLine';
import { SharedTimeline } from '../timeline/Timeline';
import styles from './Public.module.css';
import { windowIsCurrent } from './window';
import { clock, DATED_CLOCK } from '@/ui/zone';

/** The four a shared place shows: the three a controller steers and the one it derives. */
const TILES: Metric[] = ['temperature', 'humidity', 'vpd', 'co2'];

/**
 * A tent as somebody holding a link to it reads it: what it is doing now, how
 * the last day went, what the cameras saw and what was written down.
 *
 * It is not the owner's Start of the place and does not try to be. That page is a way in
 * - to the timeline, to the devices, to logging a line - and every one of those
 * roads is shut to a reader with no account. What is left is the part that was
 * worth sharing: the readings with their ages, and the diary.
 */
export function SharedSpace({
  space,
  token,
  picture,
  now,
  banner,
}: {
  space: SpaceOverview;
  /** The link it is read through, which is also what reads its Timeline. */
  token: string;
  picture: Picture;
  now: DateTime;
  banner?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const [viewing, setViewing] = useState<{ pictures: string[]; from: number } | null>(null);
  // A place with two climates is about one of them on every page: the tiles, the pill and the curves under them
  // are the place's own device's, which the server names first.
  const values = space.climates[0]?.values ?? space.values;
  const liveness = livenessOf({ values, deviceIds: space.deviceIds }, now);
  const shown = TILES.flatMap(metric => values.filter(value => value.metric === metric));

  return (
    <article className={styles.diary}>
      {banner}

      <header className={ui.stack3}>
        <div className={ui.rowTop}>
          <h1 className={styles.title}>{space.name}</h1>
          <LivenessPill liveness={liveness} measuredAt={measuredAtOf(values)} now={now} explain />
        </div>
        <p className={styles.facts}>
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
        <p className={styles.verdict} data-rating={space.verdict.rating ?? undefined}>
          {t('space.climate24h')} · <Term topic="verdict">{t('space.inBand', { percent: Math.round(space.verdict.inBandFraction * 100) })}</Term>
        </p>
      ) : null}

      {space.cameras.map(camera => (
        <Stills key={camera.cameraId} camera={camera} picture={picture} now={now} />
      ))}

      {/* "Look at my curves" is why a place is shared, so its Timeline is
          here: the last day, week or month, read only and through the link's
          own window. */}
      <section className={ui.stack2}>
        <SharedTimeline
          spaceId={space.spaceId}
          shared={{ token, picture }}
          title={<h2>{t('publicPage.timeline')}</h2>}
        />
      </section>

      {space.grows.length > 0 ? (
        <ul className={ui.list} aria-label={t('space.growingHere')}>
          {space.grows.map(grow => (
            <li key={grow.growId} className={styles.growRow}>
              <span className={`name ${ui.cut}`}>{grow.name}</span>
              <span className={styles.cardMeta}>
                {[
                  growDay(t, grow),
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

      <section className={ui.stack3} aria-label={t('start.latest.title')}>
        <span className="label">{t('start.latest.title')}</span>
        {space.entries.length === 0 ? (
          <p className={styles.quiet}>{t('grow.diary.empty')}</p>
        ) : (
          <Lines>
            {/* The lines as Start says them, in the browser's zone: a share link answers what the lines and the
                pictures are, and not where the grower who wrote them keeps their clock. A line that carries
                pictures shows them: the diary is what a link shows off. */}
            {dayLines(t, i18n, { entries: space.entries, events: space.events, endsAt: now.toISO() ?? '' }, null).map(line => {
              const entry = line.what.kind === 'entry' ? line.what.entry : null;
              const mediaIds = entry?.mediaIds ?? [];
              return (
                <DiaryLine
                  key={line.key}
                  line={line}
                  stamp={dayStamp(line.at, now, null)}
                  zone={null}
                  now={now}
                  people={[]}
                  measurements={entry ? readingNamesOf(space.readingNames, entry.growId) : []}
                  byline={false}
                  plants={space.plants}
                  onPictures={from => setViewing({ pictures: mediaIds.map(mediaId => picture(mediaId, PUBLIC_WIDTH.cover)), from })}
                  thumbnails={mediaIds.map(mediaId => picture(mediaId, PUBLIC_WIDTH.dayTile))}
                />
              );
            })}
          </Lines>
        )}
      </section>
      {viewing ? <PictureViewer pictures={viewing.pictures} from={viewing.from} onClose={() => setViewing(null)} /> : null}
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
        <span className={styles.tileUnit}>{UNIT[value.metric] ?? value.metric}</span>
      </div>
      <div className={styles.tileTarget}>
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
  const at = (instant: string) => DateTime.fromISO(instant).toFormat(DATED_CLOCK);

  if (heard.length === 0) return <p className={`${ui.cardDashed} ${ui.note}`}>{t('publicPage.windowClimate.none')}</p>;

  return (
    <section className={ui.stack2}>
      <span className="label">{t('publicPage.windowClimate.title', { from: at(verdict.startsAt), to: at(verdict.endsAt) })}</span>
      <div className={styles.tiles}>
        {heard.map(row => (
          <div key={row.metric} className={`${ui.card} ${styles.tile}`}>
            <div className={styles.tileFigure}>
              <span className="figure">{figure(row.averageValue ?? 0, row.metric)}</span>
              <span className={styles.tileUnit}>{UNIT[row.metric] ?? row.metric}</span>
            </div>
            <div className={styles.tileTarget}>
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
    <section className={ui.stack2}>
      <span className="label">
        {camera.name}
        {camera.lastStillAt ? ` · ${t('space.lastStill', { age: ageLabel(camera.lastStillAt, now) })}` : ''}
      </span>
      <ul className={styles.stillStrip}>
        {camera.stills.map(still => (
          <li key={still.mediaId} className={styles.still}>
            <Photo
              src={picture(still.mediaId, PUBLIC_WIDTH.dayTile)}
              alt={t('space.stillAlt', { name: camera.name, time: clock(still.capturedAt, null) })}
              className={styles.stillFrame}
            />
            <span className={styles.stillTime}>{clock(still.capturedAt, null)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
