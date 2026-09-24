import { Download, Leaf } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowListItem, GrowReportPhase, Space } from '@fg2/shared-types/v1';
import { exportFilename, fileSize, isBuilding, useAskExport, useDownloadExport, useExport } from '@/api/exports';
import { useGrowReport } from '@/api/grows';
import { THUMBNAIL_WIDTH, mediaUrl } from '@/api/session';
import { EntryRow } from '@/ui/EntryRow';
import { useCorrecting } from '@/log/corrections';
import { decimalFigure } from '@/ui/figures';
import { growDayOf } from '@/ui/entries';
import { LoadFailed, RefreshFailed, Refused, Waiting } from '@/ui/PageState';
import { standsIn } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import styles from './Report.module.css';

/**
 * The Report tab: the grow as chapters, one per phase, newest first. Each
 * chapter is its cover, its day range, how the tent was kept during it and
 * what was done to the plants - the same story the public page will tell.
 *
 * It is also where the whole grow is taken away. A grower who wants everything
 * wants it as the record rather than as a screen, and the record of a grow is
 * what this tab already is, so the zip is offered at the end of it.
 */
export function Report({ grow, spaces, mayOwn, now }: { grow: GrowListItem; spaces: Space[]; mayOwn: boolean; now: DateTime }) {
  const { t } = useTranslation();
  const report = useGrowReport(grow.id);

  if (report.isPending) return <Waiting lines={4} />;
  if (!report.data) return <LoadFailed retry={() => void report.refetch()} />;

  const { totals, harvest } = report.data;

  return (
    <div className={styles.report}>
      <RefreshFailed failedAt={report.isError ? report.dataUpdatedAt : null} now={now} />

      <dl className={`${ui.strip} ${ui.stripEven} ${styles.totals}`}>
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
        <Chapter key={chapter.phaseId} chapter={chapter} grow={grow} people={report.data.people} spaces={spaces} measurements={grow.measurements} />
      ))}

      <Export growId={grow.id} mayOwn={mayOwn} />
    </div>
  );
}

/**
 * The grow as a file: its diary, its CSVs and its photos in one zip.
 *
 * The zip is built in the background, so this is a button and then a job: the
 * row it is asked for is polled until it is ready or has failed, and a failure
 * says what went wrong rather than sitting at "building" for ever. The demo is
 * offered nothing, because a demo session owns none of this and the route
 * refuses it - a button that would be refused is not a button.
 */
function Export({ growId, mayOwn }: { growId: string; mayOwn: boolean }) {
  const { t } = useTranslation();
  const ask = useAskExport(growId);
  const [mediaId, setMediaId] = useState<string | null>(null);
  const job = useExport(mediaId);
  const download = useDownloadExport();

  if (!mayOwn) return null;

  const row = job.data;
  const status = row?.exportJob?.status ?? null;
  const ready = row && status === 'ready' ? row : null;

  return (
    <section className={`${ui.card} ${styles.export}`}>
      <div className={styles.exportText}>
        <span className="label">{t('grow.report.export.title')}</span>
        <p className={ui.note}>{t('grow.report.export.note')}</p>
        {status === 'queued' || status === 'rendering' ? (
          <p className={`mono ${styles.exportStatus}`} role="status">
            {t(`grow.report.export.${status}`)}
          </p>
        ) : null}
        {status === 'failed' ? (
          <p className={ui.problem} role="alert">
            {row?.exportJob?.error || t('grow.report.export.failedPlain')}
          </p>
        ) : null}
        <Refused error={ask.error} />
        <Refused error={download.error} />
      </div>

      {/*
        A button rather than a link: an export is served to a session, not to
        the long-lived token a picture's URL carries, and nothing sets a header
        on a navigation - so the bytes are fetched and handed to a download.
      */}
      {ready ? (
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={download.isPending}
          onClick={() => download.mutate({ mediaId: ready.id, filename: exportFilename(ready) })}
        >
          <Download size={14} strokeWidth={1.75} aria-hidden />
          {t('grow.report.export.download', { size: fileSize(ready.bytes) })}
        </button>
      ) : (
        <button
          type="button"
          className={ui.button}
          disabled={ask.isPending || isBuilding(row)}
          onClick={() => ask.mutate(undefined, { onSuccess: accepted => setMediaId(accepted.media.id) })}
        >
          {status === 'failed' ? t('grow.report.export.again') : t('grow.report.export.ask')}
        </button>
      )}
    </section>
  );
}

function Total({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <dd className={`figure ${ui.stripValue} ${styles.totalValue}`}>{value}</dd>
      <dt className="caption">{label}</dt>
    </div>
  );
}

function Chapter({
  chapter,
  grow,
  people,
  spaces,
  measurements,
}: {
  chapter: GrowReportPhase;
  grow: GrowListItem;
  people: { id: string; handle: string }[];
  spaces: Space[];
  measurements: GrowListItem['measurements'];
}) {
  const { t } = useTranslation();
  const correcting = useCorrecting();
  const cover = chapter.coverMediaId ? mediaUrl(chapter.coverMediaId, THUMBNAIL_WIDTH.cover * 2) : null;
  const temperature = chapter.climate.find(row => row.metric === 'temperature');
  const humidity = chapter.climate.find(row => row.metric === 'humidity');
  const where = (chapter.spaceIds ?? []).map(id => spaces.find(space => space.id === id)?.name ?? '…').join(', ');

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
        {/* The same three figures a week card of this grow carries, in the same
            order - the temperatures, the humidity and the hours of light - and
            then how much of the chapter sat inside its own band. The light was
            the one the report left out, though the server had measured it for
            the day and night split this line is already drawn from. */}
        {temperature ? (
          <p className={`mono ${styles.chapterMeta}`}>
            {temperature.dayAverage !== null
              ? `${decimalFigure(temperature.dayAverage, 1)} / ${temperature.nightAverage === null ? '–' : decimalFigure(temperature.nightAverage, 1)} °C`
              : `${temperature.averageValue === null ? '–' : decimalFigure(temperature.averageValue, 1)} °C`}
            {humidity?.averageValue !== null && humidity !== undefined ? ` · ${decimalFigure(humidity.averageValue, 0)} %` : ''}
            {chapter.lightHours !== null ? ` · ${decimalFigure(chapter.lightHours, 0)} h` : ''}
            {chapter.inBandPercent !== null ? ` · ${t('space.inBand', { percent: Math.round(chapter.inBandPercent) })}` : ''}
          </p>
        ) : null}
        <p className={`mono ${styles.chapterMeta}`}>
          {t('grow.report.waterCount', { count: chapter.waterCount })} · {t('grow.report.feedCount', { count: chapter.feedCount })}
        </p>
        {chapter.training.length > 0 ? (
          <ul className={styles.training}>
            {chapter.training.map(entry => (
              <EntryRow
                key={entry.id}
                entry={entry}
                people={people}
                picture={mediaUrl}
                measurements={measurements}
                day={growDayOf(grow, entry.occurredAt)}
                onOpen={correcting(entry, {
                  label: grow.name,
                  dayNumber: growDayOf(grow, entry.occurredAt),
                  ownerId: grow.ownerId,
                  spaceId: standsIn(grow),
                })}
              />
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}
