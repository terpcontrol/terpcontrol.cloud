import { useTranslation } from 'react-i18next';
import type { HomeAnswer, HomeSpaceCard } from '@fg2/shared-types/v1';
import { useAccountMe } from '@/api/account';
import { mediaUrl, THUMBNAIL_WIDTH, useSession } from '@/api/session';
import { GROW } from '@/app/places';
import { dayStamp } from '@/ui/age';
import { RefreshFailed } from '@/ui/PageState';
import { useNow } from '@/ui/useNow';
import { useZone } from '@/ui/zone';
import { NotifyNotice } from '@/screens/notifications/NotifyNotice';
import { AddPlace } from './AddPlace';
import { Latest } from './Latest';
import { DeviceOffer } from './Offers';
import { PhaseLine } from './Phase';
import { Picture } from './Picture';
import { Today } from './Today';
import styles from './Start.module.css';

/**
 * Start of an account whose one grow stands in no place: a diary kept by
 * hand, drawn as a place without hardware is - the grow's name, its newest
 * photo, phase and week, what is due and what was written last - from the
 * home's own card, since there is no place to read.
 */
export function GrowStart({ card, answer, failedAt }: { card: HomeSpaceCard; answer: HomeAnswer; failedAt: number | null }) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const { user } = useSession();
  const me = useAccountMe();
  const grow = card.grow!;
  const photo = card.entries.find(entry => entry.cameraId === null && entry.mediaIds.length > 0) ?? null;
  const mediaId = photo?.mediaIds[0] ?? grow.coverMediaId;

  return (
    <section className={styles.page} data-single>
      <div className={styles.head}>
        <h1>{grow.name}</h1>
      </div>
      <RefreshFailed failedAt={failedAt} now={now} />
      <NotifyNotice later />
      {mediaId ? (
        <Picture
          to={GROW}
          src={mediaUrl(mediaId, THUMBNAIL_WIDTH.frame)}
          alt={t('start.picture.photoAlt', { name: grow.name })}
          opens={t('start.picture.openGrow')}
          day={grow.dayNumber !== null ? t('home.card.dayN', { day: grow.dayNumber }) : null}
          right={
            photo
              ? t(photo.authorId === user?.id ? 'start.picture.yours' : 'start.picture.photo', { day: dayStamp(photo.occurredAt, now, zone) })
              : null
          }
          empty=""
        />
      ) : null}
      <PhaseLine grow={grow} to={GROW} />
      <Today now={now} />
      <Latest
        entries={card.entries}
        events={card.events}
        people={answer.people}
        on={{ label: grow.name, spaceId: null, ownerId: user?.id ?? null }}
        diary
        now={now}
      />
      {me.data && me.data.preferences.deviceOfferDeclined !== true ? <DeviceOffer /> : null}
      <AddPlace />
    </section>
  );
}
