import { useTranslation } from 'react-i18next';
import type { GrowListItem } from '@fg2/shared-types/v1';
import { writeEntry } from '@/api/entries';
import { useUpdateGrow } from '@/api/grows';
import { THUMBNAIL_WIDTH, mediaUrl, useSession } from '@/api/session';
import { useLog } from '@/log/log-context';
import { Refused } from '@/ui/PageState';
import { PictureViewer } from '@/ui/PictureViewer';
import { enough, growStanding, useMayWith } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { pictureCaption, type GrowPicture } from '../diary/days';

/**
 * The pictures of a grow, one at a time, opened on one of them: the camera's
 * of each day and what was written into the diary, in the order the page
 * that opened them drew them.
 *
 * A picture is where it is made more of. The camera's picture of a day
 * becomes a line of the diary with one tap - a line like any other, taken
 * back from its toast - and any picture becomes the grow's cover, the one it
 * is shown by among all grows. A line is offered to whoever may write in the
 * diary of a grow still running, the cover to whoever may change the grow.
 */
export function PictureShow({
  grow,
  pictures,
  opened,
  onClose,
}: {
  grow: GrowListItem;
  pictures: GrowPicture[];
  opened: GrowPicture;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useSession();
  const { log } = useLog();
  const update = useUpdateGrow(grow.id);
  const youMay = useMayWith()(growStanding(grow));
  const mayLog = enough(youMay, 'log') && grow.endedAt === null;
  const mayManage = enough(youMay, 'manage');

  const write = (picture: GrowPicture) => {
    onClose();
    log({
      label: [t('home.entryKind.photo'), grow.name, t('home.card.dayN', { day: picture.dayNumber })].join(' · '),
      send: () =>
        writeEntry({
          kind: 'photo',
          growId: grow.id,
          cameraId: picture.cameraId ?? undefined,
          occurredAt: picture.takenAt,
          mediaIds: [picture.mediaId],
          values: { kind: 'photo' },
        }),
    });
  };

  return (
    <PictureViewer
      pictures={pictures.map(picture => mediaUrl(picture.mediaId, THUMBNAIL_WIDTH.frame) ?? '')}
      captions={pictures.map(picture => pictureCaption(t, picture, user?.id ?? null))}
      from={Math.max(
        0,
        pictures.findIndex(picture => picture.mediaId === opened.mediaId),
      )}
      actions={shown => {
        const picture = pictures[shown];
        if (!picture) return null;
        const isCover = grow.coverMediaId === picture.mediaId;

        return (
          <>
            {mayLog && picture.entry === null ? (
              <button type="button" className={ui.button} onClick={() => write(picture)}>
                {t('grow.pictures.makeEntry')}
              </button>
            ) : null}
            {mayManage ? (
              <button
                type="button"
                className={ui.button}
                disabled={isCover || update.isPending}
                onClick={() => update.mutate({ coverMediaId: picture.mediaId })}
              >
                {t(isCover ? 'grow.pictures.isCover' : 'grow.pictures.makeCover')}
              </button>
            ) : null}
            <Refused error={update.error} />
          </>
        );
      }}
      onClose={onClose}
    />
  );
}
