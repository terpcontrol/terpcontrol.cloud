import type { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowListItem } from '@fg2/shared-types/v1';
import { useGrowWeeks } from '@/api/grows';
import { THUMBNAIL_WIDTH, mediaUrl } from '@/api/session';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import { PictureViewer } from '@/ui/PictureViewer';
import ui from '@/ui/ui.module.css';
import { useZone } from '@/ui/zone';
import { pictureCaption, picturesOf, useGrowPhotoLines } from './photos';
import { WeekCard } from './WeekCard';
import styles from './GrowPage.module.css';

/**
 * The Weeks tab: the cards, newest first, with the current week open and the
 * rest folded to their pictures and figures. A screenful at a time - the
 * earlier ones arrive when asked for, because each costs the server a read of
 * its time series.
 */
export function Weeks({ grow, now }: { grow: GrowListItem; now: DateTime }) {
  const { t } = useTranslation();
  const zone = useZone();
  const weeks = useGrowWeeks(grow.id);
  const lines = useGrowPhotoLines(grow.id);
  // A day's picture opens every picture of the grow, so last week is a swipe away from this one.
  const [viewing, setViewing] = useState<string | null>(null);

  if (weeks.isPending) {
    return (
      <div className={styles.cards}>
        <Waiting lines={4} />
        <Waiting lines={3} />
      </div>
    );
  }
  if (!weeks.data) return <LoadFailed retry={() => void weeks.refetch()} />;

  const cards = weeks.data.pages.flatMap(page => page.items);
  const people = weeks.data.pages.flatMap(page => page.people);
  const pictures = viewing ? picturesOf(grow, lines.data, cards) : [];

  return (
    <div className={styles.cards}>
      <RefreshFailed failedAt={weeks.isError ? weeks.dataUpdatedAt : null} now={now} />
      {cards.length === 0 ? <p className={`${ui.cardDashed} ${ui.note}`}>{t('grow.noWeeks')}</p> : null}
      {cards.map((week, index) => (
        // The server answers newest first, so the first card of a grow that is
        // still going is the week it is in; no clock of the client's decides it.
        <WeekCard
          key={week.weekNumber}
          week={week}
          grow={grow}
          people={people}
          now={now}
          current={index === 0 && grow.endedAt === null}
          explain={index === 0}
          onPicture={setViewing}
        />
      ))}
      {viewing && pictures.length > 0 ? (
        <PictureViewer
          pictures={pictures.map(picture => mediaUrl(picture.mediaId, THUMBNAIL_WIDTH.frame) ?? '')}
          captions={pictures.map(picture => pictureCaption(t, picture, zone))}
          from={Math.max(
            0,
            pictures.findIndex(picture => picture.mediaId === viewing),
          )}
          onClose={() => setViewing(null)}
        />
      ) : null}
      {weeks.hasNextPage ? (
        <button type="button" className={ui.button} disabled={weeks.isFetchingNextPage} onClick={() => void weeks.fetchNextPage()}>
          {weeks.isFetchingNextPage ? t('home.waiting') : t('grow.earlierWeeks')}
        </button>
      ) : null}
    </div>
  );
}
