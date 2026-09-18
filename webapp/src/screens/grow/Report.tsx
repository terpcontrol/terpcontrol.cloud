import { Leaf } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import type { GrowListItem, GrowReportPhase, Space } from '@fg2/shared-types/v1';
import { useGrowReport } from '@/api/grows';
import { THUMBNAIL_WIDTH, mediaUrl } from '@/api/session';
import { EntryRow } from '@/ui/EntryRow';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import styles from './Report.module.css';

/**
 * The Report tab: the grow as chapters, one per phase, newest first. Each
 * chapter is its cover, its day range, how the tent was kept during it and
 * what was done to the plants - the same story the public page will tell.
 */
export function Report({ grow, spaces, now }: { grow: GrowListItem; spaces: Space[]; now: DateTime }) {
  const { t } = useTranslation();
  const report = useGrowReport(grow.id);

  if (report.isPending) return <Waiting lines={4} />;
  if (!report.data) return <LoadFailed retry={() => void report.refetch()} />;

  const { totals, harvest } = report.data;

  return (
    <div className={styles.report}>
      <RefreshFailed failedAt={report.isError ? report.dataUpdatedAt : null} now={now} />

      <dl className={styles.totals}>
        <Total value={report.data.dayCount} label={t('grow.report.days')} />
        <Total value={totals.entryCount} label={t('grow.report.entries')} />
        <Total value={totals.waterCount} label={t('grow.report.waters')} />
        <Total value={totals.feedCount} label={t('grow.report.feeds')} />
        <Total value={totals.photoCount} label={t('grow.report.photos')} />
      </dl>

      {harvest ? (
        <p className={`mono ${styles.harvest}`}>
          {t('grow.report.harvest')}
          {harvest.wetWeightG !== null ? ` · ${t('grow.report.wet', { grams: harvest.wetWeightG })}` : ''}
          {harvest.dryWeightG !== null ? ` · ${t('grow.report.dry', { grams: harvest.dryWeightG })}` : ''}
        </p>
      ) : null}

      {report.data.phases.length === 0 ? <p className={styles.empty}>{t('grow.noWeeks')}</p> : null}

      {report.data.phases.map(chapter => (
        <Chapter key={chapter.phaseId} chapter={chapter} people={report.data.people} spaces={spaces} measurements={grow.measurements} />
      ))}
    </div>
  );
}

function Total({ value, label }: { value: number; label: string }) {
  return (
    <div className={styles.total}>
      <dd className={`figure ${styles.totalValue}`}>{value}</dd>
      <dt className="label">{label}</dt>
    </div>
  );
}

function Chapter({
  chapter,
  people,
  spaces,
  measurements,
}: {
  chapter: GrowReportPhase;
  people: { id: string; handle: string }[];
  spaces: Space[];
  measurements: GrowListItem['measurements'];
}) {
  const { t } = useTranslation();
  const cover = chapter.coverMediaId ? mediaUrl(chapter.coverMediaId, THUMBNAIL_WIDTH.cover * 2) : null;
  const temperature = chapter.climate.find(row => row.metric === 'temperature');
  const humidity = chapter.climate.find(row => row.metric === 'humidity');
  const where = chapter.spaceIds.map(id => spaces.find(space => space.id === id)?.name ?? '…').join(', ');

  return (
    <article className={styles.chapter}>
      <span className={styles.cover}>{cover ? <img src={cover} alt="" loading="lazy" /> : <Leaf size={22} strokeWidth={1.5} aria-hidden />}</span>
      <div className={styles.chapterText}>
        <h2 className={styles.chapterTitle}>{chapter.preset === 'late_flowering' ? t('grow.lateFlower') : t(`home.stage.${chapter.stage}`)}</h2>
        <p className={`mono ${styles.chapterMeta}`}>
          {chapter.dayTo === null
            ? t('grow.report.dayFromToToday', { from: chapter.dayFrom })
            : t('grow.dayRange', { from: chapter.dayFrom, to: chapter.dayTo })}
          {` · ${t('grow.days', { count: chapter.dayCount })}`}
          {where ? ` · ${where}` : ''}
        </p>
        {temperature ? (
          <p className={`mono ${styles.chapterMeta}`}>
            {temperature.dayAverage !== null
              ? `${temperature.dayAverage.toFixed(1)} / ${temperature.nightAverage?.toFixed(1) ?? '–'} °C`
              : `${temperature.averageValue?.toFixed(1) ?? '–'} °C`}
            {humidity?.averageValue !== null && humidity !== undefined ? ` · ${humidity.averageValue.toFixed(0)} %` : ''}
            {chapter.inBandPercent !== null ? ` · ${t('space.inBand', { percent: Math.round(chapter.inBandPercent) })}` : ''}
          </p>
        ) : null}
        <p className={`mono ${styles.chapterMeta}`}>
          {t('grow.report.waterCount', { count: chapter.waterCount })} · {t('grow.report.feedCount', { count: chapter.feedCount })}
        </p>
        {chapter.training.length > 0 ? (
          <ul className={styles.training}>
            {chapter.training.map(entry => (
              <EntryRow key={entry.id} entry={entry} people={people} measurements={measurements} withDay />
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}
