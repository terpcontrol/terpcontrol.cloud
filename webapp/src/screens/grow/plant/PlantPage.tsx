import { ChevronLeft, Move, Scissors, Split } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import type { Entry, GrowListItem, GrowSeries, MeasurementDefinition, Plant } from '@fg2/shared-types/v1';
import { growDayAt, growOriginOf } from '@fg2/shared-types/v1-schemas/feeding.js';
import { useGrow, useGrowPlants, useGrowSeries, usePlantEntries } from '@/api/grows';
import { noLongerThere } from '@/api/problem';
import { mediaUrl, THUMBNAIL_WIDTH, useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { useCorrecting } from '@/log/corrections';
import { authorOf, headlineOf, KIND_ICON, readingFigure } from '@/ui/entries';
import { LoadFailed, NoLongerHere, RefreshFailed, Waiting } from '@/ui/PageState';
import { enough, standsIn, useMayWith } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { zoned, NARROW_DAY, useZone } from '@/ui/zone';
import { HarvestSheet } from '../HarvestSheet';
import { withUnit } from '../measurements/definitions';
import { MoveSheet } from '../MoveSheet';
import { SplitSheet } from '../SplitSheet';
import { PlantChart } from './PlantChart';
import { RenameSheet } from './RenameSheet';
import styles from './Plant.module.css';

/** How many lines of its own a plant shows before the rest are left to the timeline. */
const LINES = 12;

/**
 * One plant of a grow: what it is, where it stands in the grow's day count,
 * what has been measured on it, and what was written about it alone.
 *
 * It is deliberately a small page. A plant is not a second grow - its climate,
 * its feeding and its phase are the grow's - so what is here is only what is
 * true of this plant and of no other: its own readings against its siblings',
 * its own pictures, and the lines that name it.
 */
export function PlantPage() {
  const { growId = '', plantId = '' } = useParams();

  return <PlantScreen growId={growId} plantId={plantId} />;
}

function PlantScreen({ growId, plantId }: { growId: string; plantId: string }) {
  const { t } = useTranslation();
  const now = useNow();
  const grow = useGrow(growId);
  const plants = useGrowPlants(growId);
  const entries = usePlantEntries(plantId);
  const perPlant = (grow.data?.measurements ?? []).filter(definition => definition.perPlant);
  const series = useGrowSeries(
    growId,
    'grow',
    perPlant.map(definition => definition.key),
  );
  const spaces = useSpaces();
  const mayWith = useMayWith();
  const [sheet, setSheet] = useState<PlantSheet | null>(null);

  if (grow.isPending || plants.isPending) {
    return (
      <section className={styles.page}>
        <Waiting lines={2} />
        <Waiting lines={3} />
      </section>
    );
  }
  if (!grow.data || !plants.data) {
    return noLongerThere(grow.error) || noLongerThere(plants.error) ? (
      <NoLongerHere what="grow" />
    ) : (
      <LoadFailed
        retry={() => {
          void grow.refetch();
          void plants.refetch();
        }}
      />
    );
  }

  const all = plants.data.items;
  const plant = all.find(one => one.id === plantId);
  if (!plant) return <p className={`${ui.cardDashed} ${ui.note}`}>{t('grow.plant.notHere')}</p>;

  // Moving, splitting, harvesting and renaming a plant are the grow's own
  // moves, which are `manage` where the grow stands today.
  const youMay = mayWith({ ownerId: grow.data.ownerId, spaceId: standsIn(grow.data) });
  const mayManage = enough(youMay, 'manage');
  const lines = entries.data?.items ?? [];
  const photos = lines.filter(entry => entry.mediaIds.length > 0);

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <Link to={`/grows/${growId}/plants`} className={`${ui.back} ${styles.back}`} aria-label={t('grow.plant.back')}>
          <ChevronLeft size={22} strokeWidth={1.75} aria-hidden />
        </Link>
        <div className={styles.titles}>
          <h1 className={styles.title}>{plant.label}</h1>
          <p className={styles.subtitle}>{subtitle(t, grow.data, plant)}</p>
        </div>
        <span className={`mono ${styles.corner}`}>
          {grow.data.name}
          {' · '}
          {t('grow.plant.ofCount', { index: all.indexOf(plant) + 1, count: all.length })}
        </span>
      </header>

      <RefreshFailed failedAt={grow.isError ? grow.dataUpdatedAt : null} now={now} />

      {/* A read that failed is not an absence: the figures and the chart below
          are missing because nothing could be read, which is a different thing
          from this plant never having been measured. */}
      {series.isError ? (
        <p className={ui.problem} role="status">
          {t('grow.plant.readingsUnread')}
        </p>
      ) : null}

      <Hero plant={plant} photos={photos} grow={grow.data} />

      <Figures grow={grow.data} plant={plant} entries={lines} definitions={perPlant} series={series.data} />

      {perPlant.map(definition => {
        const drawn = series.data?.measurements.find(one => one.key === definition.key);
        if (!drawn || !drawn.points.some(point => point.plantId === plant.id)) return null;

        return (
          <PlantChart
            key={definition.key}
            definition={definition}
            series={drawn}
            plantId={plant.id}
            label={plant.label}
            others={all.filter(one => one.id !== plant.id)}
            nights={series.data?.nights ?? []}
            from={new Date(series.data!.startsAt).getTime()}
            to={new Date(series.data!.endsAt).getTime()}
          />
        );
      })}

      {perPlant.length > 0 && series.isSuccess && !hasReadings(series.data, plant.id) ? (
        <p className={ui.note}>{t('grow.plant.nothingMeasured')}</p>
      ) : null}

      <div className={styles.sectionHead}>
        <span className="label">{t('grow.plant.ownEntries')}</span>
        <span className={`mono ${styles.aside}`}>{t('grow.plant.growEntriesToo')}</span>
      </div>

      {entries.isPending ? (
        <Waiting lines={3} />
      ) : lines.length === 0 ? (
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('grow.plant.noEntries')}</p>
      ) : (
        <ul className={styles.lines} aria-label={t('grow.plant.ownEntries')}>
          {lines.slice(0, LINES).map(entry => (
            <Line key={entry.id} entry={entry} grow={grow.data!} plant={plant} measurements={grow.data!.measurements} />
          ))}
        </ul>
      )}

      {mayManage ? (
        <div className={styles.actions} role="group" aria-label={t('grow.plant.actionsLabel')}>
          <button type="button" className={ui.button} onClick={() => setSheet('move')}>
            <Move size={13} strokeWidth={1.75} aria-hidden />
            {t('grow.plant.move')}
          </button>
          {/* Splitting every plant out of a grow splits nothing, and a plant
              already down cannot come down again - the sheets refuse both, so
              neither is offered. */}
          {all.length > 1 ? (
            <button type="button" className={ui.button} onClick={() => setSheet('split')}>
              <Split size={13} strokeWidth={1.75} aria-hidden />
              {t('grow.plant.split')}
            </button>
          ) : null}
          {standing(plant) ? (
            <button type="button" className={ui.button} onClick={() => setSheet('harvest')}>
              <Scissors size={13} strokeWidth={1.75} aria-hidden />
              {t('grow.plant.harvest')}
            </button>
          ) : null}
          <button type="button" className={ui.button} onClick={() => setSheet('rename')}>
            {t('grow.plant.rename')}
          </button>
        </div>
      ) : null}

      {/* The grow's own sheets, opened on this plant. What they do and what
          they refuse is theirs; all this page says is which plant it is about. */}
      {sheet === 'move' ? (
        <MoveSheet grow={grow.data} plants={all} spaces={spaces.data?.items ?? []} preselect={[plant.id]} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'split' ? (
        <SplitSheet grow={grow.data} plants={all} spaces={spaces.data?.items ?? []} preselect={[plant.id]} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'harvest' ? <HarvestSheet grow={grow.data} plants={all} preselect={[plant.id]} onClose={() => setSheet(null)} /> : null}
      {sheet === 'rename' ? <RenameSheet growId={growId} plant={plant} onClose={() => setSheet(null)} /> : null}
    </section>
  );
}

/** What the plant's own actions row can open. */
type PlantSheet = 'move' | 'split' | 'harvest' | 'rename';

/** Still in the ground, which is what the harvest sheet means by a plant it can cut. */
const standing = (plant: Plant): boolean => plant.status === 'active' && plant.harvest === null;

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The strain, the stage this plant is in - its own where a split gave it one - and what has become of it. */
const subtitle = (t: Translate, grow: GrowListItem, plant: Plant): string => {
  const stage = grow.summary.groups.find(group => group.plantIds.includes(plant.id))?.stage ?? grow.summary.stage;

  return [plant.strain, stage ? t(`home.stage.${stage}`) : '', plant.status === 'active' ? '' : t(`grow.plantStatus.${plant.status}`)]
    .filter(Boolean)
    .join(' · ');
};

/** The newest picture of this plant, with how many there are of it altogether. */
function Hero({ plant, photos, grow }: { plant: Plant; photos: Entry[]; grow: GrowListItem }) {
  const { t } = useTranslation();
  const newest = photos[0];
  const mediaId = newest?.mediaIds[0];
  const src = mediaId ? mediaUrl(mediaId, THUMBNAIL_WIDTH.frame) : null;

  if (!newest || !src) return <p className={`${ui.cardDashed} ${ui.note}`}>{t('grow.plant.noPhotos')}</p>;

  return (
    <figure className={styles.hero}>
      <img src={src} alt={t('grow.plant.photoAlt', { label: plant.label, day: dayOfEntry(grow, newest) ?? '—' })} loading="lazy" />
      <figcaption className={`mono ${styles.heroChip}`}>{t('grow.plant.photos', { count: photos.length })}</figcaption>
    </figure>
  );
}

interface FiguresProps {
  grow: GrowListItem;
  plant: Plant;
  entries: Entry[];
  definitions: MeasurementDefinition[];
  series: GrowSeries | undefined;
}

/**
 * The four figures the page opens on: where its first measurement stands and
 * how far it has moved, the last thing done to it, how much has been written
 * about it alone, and how far into the grow it is.
 */
function Figures({ grow, plant, entries, definitions, series }: FiguresProps) {
  const { t } = useTranslation();
  const definition = definitions.find(one => series?.measurements.some(drawn => drawn.key === one.key && drawn.points.some(byPlant(plant))));
  const points = series?.measurements.find(one => one.key === definition?.key)?.points.filter(byPlant(plant)) ?? [];
  const newest = points[points.length - 1];
  const before = points[points.length - 2];
  const training = entries.find(entry => entry.kind === 'training');
  const trainedOn = training ? dayOfEntry(grow, training) : null;

  return (
    <dl className={ui.strip}>
      {newest && definition ? (
        <Figure value={readingFigure(newest.value)} label={[definition.unit, movement(t, newest, before)].filter(Boolean).join(' · ')} />
      ) : null}
      {training && trainedOn !== null ? <Figure value={`d${trainedOn}`} label={t('grow.plant.lastTraining')} /> : null}
      <Figure value={String(entries.length)} label={t('grow.plant.entryCount')} />
      {grow.summary.dayNumber !== null ? (
        <Figure value={t('grow.plant.day', { day: grow.summary.dayNumber })} label={t('grow.plant.withTheGrow')} />
      ) : null}
    </dl>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dt className={`figure ${ui.stripValue} ${styles.figureValue}`}>{value}</dt>
      <dd className="caption">{label}</dd>
    </div>
  );
}

interface LineProps {
  entry: Entry;
  grow: GrowListItem;
  plant: Plant;
  measurements: MeasurementDefinition[];
}

/**
 * One line about this plant: the day of the grow it happened on, what it was,
 * and who wrote it.
 *
 * A line somebody wrote opens the sheet it was written in, because a figure
 * read off a tape wrongly is read wrongly on this row and nowhere else - and
 * the diary that carries a reading has to be able to carry the correction too.
 * What a device or the server recorded is not ours to rewrite, so those lines
 * stay what they are.
 *
 * Whose line it is decides who may open it: one's own is `log` and anybody
 * else's is `manage`, which is the rule the server writes down in one place and
 * this row has to agree with - otherwise a member taps somebody else's reading,
 * fills the sheet in and is refused on save.
 */
function Line({ entry, grow, plant, measurements }: LineProps) {
  const { t, i18n } = useTranslation();
  const zone = useZone();
  const { user } = useSession();
  const correcting = useCorrecting();
  const Icon = KIND_ICON[entry.kind];
  const day = dayOfEntry(grow, entry);
  const readings = 'readings' in entry.values ? entry.values.readings : [];
  // The plant's own label rather than the grow's: a line drawn here is about
  // this plant, and the toast that acknowledges the correction says so.
  const open = correcting(entry, { label: plant.label, dayNumber: day, ownerId: grow.ownerId, spaceId: standsIn(grow) });

  const body = (
    <>
      <span className={`mono ${styles.lineDay}`}>
        {day === null ? zoned(entry.occurredAt, zone).toFormat(NARROW_DAY) : t('grow.dayShort', { day })}
      </span>
      <span className={styles.lineKind} aria-label={t(`home.entryKind.${entry.kind}`)}>
        <Icon size={13} strokeWidth={1.75} aria-hidden />
      </span>
      <span className={styles.lineText}>
        {headlineOf(t, i18n, entry)}
        {readings.map(reading => {
          const definition = measurements.find(one => one.key === reading.key);

          return (
            <span key={`${reading.key}-${reading.plantId ?? ''}`} className={`mono ${styles.lineReading}`}>
              {' · '}
              {definition?.name ?? reading.key} {withUnit(reading.value, definition?.unit ?? '')}
            </span>
          );
        })}
      </span>
      {entry.source === 'human' ? <span className={styles.lineAuthor}>{authorOf(t, entry, [], user?.id)}</span> : null}
    </>
  );

  if (open === undefined) return <li className={styles.line}>{body}</li>;

  return (
    <li>
      <button type="button" className={`${styles.line} ${styles.lineOpen}`} aria-label={t('grow.correctLine')} onClick={open}>
        {body}
      </button>
    </li>
  );
}

const byPlant = (plant: Plant) => (point: { plantId: string | null }) => point.plantId === plant.id;

const hasReadings = (series: GrowSeries | undefined, plantId: string): boolean =>
  (series?.measurements ?? []).some(one => one.points.some(point => point.plantId === plantId));

/** Which day of the grow a line happened on, from the grow's own origin; null before the first phase. */
const dayOfEntry = (grow: GrowListItem, entry: Entry): number | null =>
  grow.summary.dayNumber === null ? null : growDayAt(growOriginOf(grow), entry.occurredAt);

/** How far the newest reading has moved since the one before it, and over how long. */
const movement = (t: Translate, newest: { value: number; measuredAt: string }, before: { value: number; measuredAt: string } | undefined): string => {
  if (!before) return '';
  const change = newest.value - before.value;
  const days = Math.max(1, Math.round(DateTime.fromISO(newest.measuredAt).diff(DateTime.fromISO(before.measuredAt), 'days').days));

  return t('grow.plant.sinceLast', { change: `${change > 0 ? '+' : ''}${readingFigure(change)}`, days });
};
