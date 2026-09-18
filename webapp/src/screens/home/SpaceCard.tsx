import { Box, Fan, Leaf, Refrigerator, Sun, type LucideIcon } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { HomeSpaceCard, Person, SpaceKind } from '@fg2/shared-types/v1';
import { mediaUrl } from '@/api/session';
import { ageLabel } from '@/ui/age';
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

const dismissed = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
};

const dismiss = (spaceId: string) => {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...new Set([...dismissed(), spaceId])]));
  } catch {
    // Private mode: the invitation comes back next time, which is no worse.
  }
};

/**
 * One place. The climate half on top and the grow half below, each of which
 * may be the one-line invitation instead - and when there is nothing measuring
 * and one grow, the grow takes the header, because the place is then only where
 * the plants happen to be.
 */
export function SpaceCard({ card, people, now, compact }: SpaceCardProps) {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(() => dismissed().includes(card.spaceId));
  const liveness = livenessOf(card);
  const alert = worstAlertOf(card);
  const growHeads = liveness === 'none' && card.grow !== null;
  const Icon = KIND_ICON[card.kind];

  const notNow = () => {
    dismiss(card.spaceId);
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
                <Link to={`/spaces/${card.spaceId}`}>{card.name}</Link>
                <span className={styles.subtitleLine}>
                  {' · '}
                  <PhaseLine grow={card.grow!} />
                </span>
              </div>
            </>
          ) : (
            <h2 className={styles.name}>
              <Link to={`/spaces/${card.spaceId}`} className={styles.nameLink}>
                <Icon size={16} strokeWidth={1.75} aria-hidden />
                {card.name}
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

/** "● live · 20 s" - the dot is the state, the age is the newest reading on the card. */
export function LivenessPill({ liveness, measuredAt, now }: { liveness: Liveness; measuredAt: string | null; now: DateTime }) {
  const { t } = useTranslation();
  if (liveness === 'none') return null;

  return (
    <span className={`mono ${styles.pill}`} data-liveness={liveness}>
      <span className={styles.dot} aria-hidden />
      {t(`home.liveness.${liveness}`)}
      {measuredAt ? ` · ${ageLabel(measuredAt, now)}` : ''}
    </span>
  );
}

/** The newest picture, with when it was taken. */
function Still({ card, now }: { card: HomeSpaceCard; now: DateTime }) {
  const { t } = useTranslation();
  const still = card.latestStill!;
  const src = mediaUrl(still.mediaId);
  if (!src) return null;

  return (
    <figure className={styles.still}>
      <img src={src} alt={t('home.card.stillAlt', { name: card.name })} loading="lazy" />
      <figcaption className={`mono ${styles.stillCaption}`}>
        {t('home.card.cam')} · {DateTime.fromISO(still.capturedAt).toFormat('HH:mm')} · {t('home.card.ago', { age: ageLabel(still.capturedAt, now) })}
      </figcaption>
    </figure>
  );
}
