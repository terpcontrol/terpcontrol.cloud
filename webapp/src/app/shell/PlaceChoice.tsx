import { Check, ChevronDown } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import type { Device } from '@fg2/shared-types/v1';
import { useDevices } from '@/api/devices';
import { useHome, useHomeShape } from '@/api/home';
import { useDiaryLayer } from '@/api/layers';
import { THUMBNAIL_WIDTH, mediaUrl, useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { isAboutPlace, isPlace, usePlaceChoice, type PlaceCard } from '@/app/places';
import { useCardStatus } from '@/screens/cockpit/card-status';
import { toneOf } from '@/screens/cockpit/place';
import { groupedByRoom } from '@/screens/home/rooms';
import { LoadFailed, Waiting } from '@/ui/PageState';
import { Sheet } from '@/ui/Sheet';
import { Dot } from '@/ui/Spoken';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { useShape } from './shape';
import styles from './PlaceChoice.module.css';

/**
 * The one choice of place, which holds for Grow, Verlauf and Steuerung: a chip
 * with the chosen place's name, and behind it the sheet that lists the places
 * under their rooms. It is there from the second place on; with one place
 * there is nothing to choose and nothing is drawn.
 *
 * The phone's header carries it on the pages that show the chosen place, and
 * the rail on every page (`everywhere`), where it stands over the items it
 * holds for. Support reading a customer's place sees none: that place is named
 * by the address and is none of the reader's own.
 */
export function PlaceChoice({ everywhere = false }: { everywhere?: boolean }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const { pathname } = useLocation();
  const shape = useShape();
  const home = useHomeShape(user !== null);
  const places = home.data?.spaces.filter(isPlace);
  const { here, visiting, choose } = usePlaceChoice(places);
  const [open, setOpen] = useState(false);

  if (!everywhere && !isAboutPlace(pathname)) return null;
  // The rail keeps the chip's room while the places are on their way, so its items do not jump once they are in.
  if (!places) return everywhere && shape.places > 1 ? <span className={styles.chip} data-waiting aria-hidden /> : null;
  if (!here || places.length < 2 || visiting) return null;

  return (
    <>
      <button
        type="button"
        className={styles.chip}
        aria-haspopup="dialog"
        aria-label={t('shell.place.chip', { name: here.name })}
        onClick={() => setOpen(true)}
      >
        <span className={styles.name}>{here.name}</span>
        <ChevronDown size={14} strokeWidth={2.4} aria-hidden />
      </button>
      {/* Out of the header it is opened from: a frosted bar would otherwise be the frame a fixed sheet is laid out in. */}
      {open
        ? createPortal(
            <PlaceSheet
              chosen={here.spaceId}
              onChoose={spaceId => {
                setOpen(false);
                if (spaceId !== here.spaceId) choose(spaceId);
              }}
              onClose={() => setOpen(false)}
            />,
            document.body,
          )
        : null}
    </>
  );
}

/** The places under their rooms, in the order the account set them up, each saying how it is and what grows there. */
function PlaceSheet({ chosen, onChoose, onClose }: { chosen: string; onChoose: (spaceId: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const now = useNow();
  const home = useHome();
  const spaces = useSpaces();
  const diary = useDiaryLayer();
  const places = (home.data?.spaces ?? []).filter(isPlace);
  const devices = useDevices(places.some(place => place.deviceIds.length > 0));
  const row = (card: PlaceCard) => (
    <PlaceRow
      key={card.spaceId}
      card={card}
      devices={devices.data?.items}
      now={now}
      diary={diary}
      chosen={card.spaceId === chosen}
      onChoose={() => onChoose(card.spaceId)}
    />
  );

  return (
    <Sheet title={t('shell.place.title')} onClose={onClose}>
      <p className={`${ui.note} ${styles.holds}`}>{t('shell.place.holds')}</p>
      {home.isPending ? <Waiting lines={3} /> : null}
      {home.isError && !home.data ? <LoadFailed retry={() => void home.refetch()} /> : null}
      <div className={styles.places}>
        {groupedByRoom(places, spaces.data?.items ?? []).map(group =>
          group.room ? (
            <section key={group.room.id} className={styles.room} aria-label={group.room.name}>
              <h3 className={styles.roomName}>{group.room.name}</h3>
              {group.cards.map(row)}
            </section>
          ) : (
            row(group.cards[0])
          ),
        )}
      </div>
    </Sheet>
  );
}

function PlaceRow({
  card,
  devices,
  now,
  diary,
  chosen,
  onChoose,
}: {
  card: PlaceCard;
  devices: Device[] | undefined;
  now: DateTime;
  diary: boolean;
  chosen: boolean;
  onChoose: () => void;
}) {
  const { t } = useTranslation();
  const { status, said } = useCardStatus(card, devices, now);
  const tone = toneOf(status);
  const grow =
    diary && card.grow
      ? [card.grow.name, card.grow.dayNumber !== null ? t('home.card.dayN', { day: card.grow.dayNumber }) : null].filter(Boolean).join(', ')
      : null;
  const still = card.latestStill ? mediaUrl(card.latestStill.mediaId, THUMBNAIL_WIDTH.still) : null;
  // A place that asks for somebody says so on a line of its own; one that is fine says it and what grows there in one.
  const asks = tone === 'warn' || tone === 'alarm';

  return (
    <button type="button" className={styles.place} aria-current={chosen ? 'true' : undefined} onClick={onChoose}>
      {still ? <img className={styles.still} src={still} alt="" loading="lazy" /> : null}
      <span className={styles.text}>
        <span className={styles.placeName}>{card.name}</span>
        <span className={styles.status} data-tone={tone}>
          {said}
        </span>
        {grow ? (
          <span className={styles.grow} data-own-line={asks || undefined}>
            {asks ? null : <Dot />}
            {grow}
          </span>
        ) : null}
      </span>
      {chosen ? <Check size={22} strokeWidth={2.4} className={styles.check} role="img" aria-label={t('shell.place.chosen')} /> : null}
    </button>
  );
}
