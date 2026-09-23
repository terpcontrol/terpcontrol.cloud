import { Box, Fan, Leaf, Refrigerator, Sun, type LucideIcon } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { HomeSpaceCard, Person, SpaceKind } from '@fg2/shared-types/v1';
import { mediaUrl, THUMBNAIL_WIDTH } from '@/api/session';
import { ageLabel } from '@/ui/age';
import { clock, useZone } from '@/ui/zone';
import { livenessOf, measuredAtOf, worstAlertOf, type Liveness } from './attention';
import { ClimateHalf } from './ClimateHalf';
import { DayCounter, DeviceActions, GrowHalf, NewestEntry, NoGrow, NoSensor, PhaseLine } from './GrowHalf';
import styles from './SpaceCard.module.css';
import { alertLabel } from './units';

const KIND_ICON: Record<SpaceKind, LucideIcon> = { tent: Box, fridge: Refrigerator, room: Fan, balcony: Sun, other: Leaf };

interface SpaceCardProps {
  card: HomeSpaceCard;
  people: Person[];
  now: DateTime;
  compact: boolean;
}

/** "Not now" is remembered per place and per browser; it is a preference, not a fact about the space. */
const DISMISSED_KEY = 'terp.home.noGrowDismissed';

/** What a card is remembered by. A card with no place is its grow, and one null would stand for every one of them. */
const keyOf = (card: HomeSpaceCard): string => card.spaceId ?? `grow:${card.grow?.growId ?? ''}`;

const dismissed = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
};

const dismiss = (key: string) => {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...new Set([...dismissed(), key])]));
  } catch {
    // Private mode: the invitation comes back next time, which is no worse.
  }
};

/**
 * One place. The climate half on top and the grow half below, each of which
 * may be the one-line invitation instead - and when there is nothing measuring
 * and one grow, the grow takes the header, because the place is then only where
 * the plants happen to be.
 *
 * A card whose place is null is the whole of that last case: a grow standing
 * nowhere. It is named for the chip that put it there, its icon is the plain
 * leaf no kind of place carries, and nothing on it opens a space page, because
 * there is no space to open.
 */
export function SpaceCard({ card, people, now, compact }: SpaceCardProps) {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(() => dismissed().includes(keyOf(card)));
  const liveness = livenessOf(card);
  const alert = worstAlertOf(card);
  const growHeads = liveness === 'none' && card.grow !== null;
  const Icon = card.kind === null ? Leaf : KIND_ICON[card.kind];
  const placeName = card.spaceId === null ? t('grow.noFixedPlace') : card.name;

  const notNow = () => {
    dismiss(keyOf(card));
    setHidden(true);
  };

  return (
    <article className={`${styles.card} ${compact ? styles.compact : ''}`} data-severity={alert?.severity} aria-label={card.name}>
      <header className={styles.header}>
        <div className={styles.title}>
          {growHeads ? (
            <>
              <h2 className={styles.name}>
                <Link to={`/grows/${card.grow!.growId}`}>{card.grow!.name}</Link>
              </h2>
              <div className={styles.subtitle}>
                <Icon size={13} strokeWidth={1.75} aria-hidden />
                {card.spaceId === null ? <span>{placeName}</span> : <Link to={`/spaces/${card.spaceId}`}>{placeName}</Link>}
                <span className={styles.subtitleLine}>
                  {' · '}
                  <PhaseLine grow={card.grow!} />
                </span>
              </div>
            </>
          ) : (
            <h2 className={styles.name}>
              <Link to={card.spaceId === null ? `/grows/${card.grow?.growId}` : `/spaces/${card.spaceId}`} className={styles.nameLink}>
                <Icon size={16} strokeWidth={1.75} aria-hidden />
                {placeName}
              </Link>
            </h2>
          )}
        </div>
        {growHeads ? (
          <DayCounter day={card.grow!.dayNumber} />
        ) : (
          <LivenessPill liveness={liveness} measuredAt={measuredAtOf(card.values)} now={now} />
        )}
      </header>

      {alert ? (
        <p className={`mono ${styles.alert}`} data-severity={alert.severity}>
          {alertLabel(t, alert)} · {t('home.card.ago', { age: ageLabel(alert.startedAt, now) })}
        </p>
      ) : null}

      {liveness === 'none' ? growHeads ? null : <NoSensor /> : <ClimateHalf card={card} />}

      {card.latestStill && !compact ? <Still card={card} now={now} /> : null}

      {card.grow ? (
        <GrowHalf card={card} people={people} now={now} headed={growHeads} compact={compact} />
      ) : (
        <>
          {/* Nothing grows here, so the newest line is the place's own: what its device or an alarm wrote. */}
          {card.entries.length > 0 ? <NewestEntry entry={card.entries[0]} people={people} now={now} /> : null}
          {hidden ? null : <NoGrow card={card} onNotNow={notNow} />}
        </>
      )}

      {card.grow === null && liveness !== 'none' ? <DeviceActions card={card} /> : null}
    </article>
  );
}

/**
 * "● live · 20 s" - the dot is the state, the age is the newest reading on the
 * card.
 *
 * It says "no reading" and never "offline", because it is about the reading and
 * not about the hardware. A place is not one device: a shared or public reader
 * is told the tent and never what stands in it, and a tent may hold three
 * devices with three different silences, so the only thing this pill can
 * honestly age is the newest figure the place produced. "Offline · 4 d" is the
 * device's own word, said on the device row, by the offline alert and by the
 * note on a socket nobody is listening for - and it is counted from when the
 * device was last heard, which is a different instant from its last sample.
 * Saying both with the same word put two ages for one silence on one screen.
 */
export function LivenessPill({ liveness, measuredAt, now }: { liveness: Liveness; measuredAt: string | null; now: DateTime }) {
  const { t } = useTranslation();
  if (liveness === 'none') return null;

  return (
    <span className={`mono ${styles.pill}`} data-liveness={liveness}>
      <span className={styles.dot} aria-hidden />
      {t(`home.reading.${liveness}`)}
      {measuredAt ? ` · ${ageLabel(measuredAt, now)}` : ''}
    </span>
  );
}

/** The newest picture, with when it was taken. */
function Still({ card, now }: { card: HomeSpaceCard; now: DateTime }) {
  const { t } = useTranslation();
  // The hour the camera burns into the picture is the hour this caption has to
  // agree with, and the camera's own page already reads it where the account
  // is; the two were two hours apart on one still.
  const zone = useZone();
  const still = card.latestStill!;
  const src = mediaUrl(still.mediaId, THUMBNAIL_WIDTH.frame);
  if (!src) return null;

  return (
    <figure className={styles.still}>
      <img src={src} alt={t('home.card.stillAlt', { name: card.name })} loading="lazy" />
      <figcaption className={`mono ${styles.stillCaption}`}>
        {t('home.card.cam')} · {clock(still.capturedAt, zone)} · {t('home.card.ago', { age: ageLabel(still.capturedAt, now) })}
      </figcaption>
    </figure>
  );
}
