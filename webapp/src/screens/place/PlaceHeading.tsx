import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PlaceCard } from '@/app/places';
import { useNow } from '@/ui/useNow';
import { livenessOf, measuredAtOf } from '../home/attention';
import { LivenessPill } from '../home/LivenessPill';
import styles from './PlaceHeading.module.css';

/**
 * The title of a tab that is about one place - Verlauf, Steuerung - with the
 * place it is showing and how alive that place is. With one place its name is
 * the whole answer; with several the name is a switcher, so the tab is never
 * about a place the reader cannot see named or change.
 *
 * The name is what is read and the select is what is used, so the switcher is
 * one native control with the caption drawn over it.
 */
export function PlaceHeading({
  title,
  places,
  here,
  onChoose,
}: {
  title: string;
  places: PlaceCard[];
  here: PlaceCard;
  onChoose: (spaceId: string) => void;
}) {
  const { t } = useTranslation();
  const now = useNow();

  return (
    <h1 className={styles.title}>
      {title}
      <span className={styles.dot}>·</span>
      <span className={styles.picker} data-switch={places.length > 1 ? '' : undefined}>
        <span className={styles.name}>{here.name}</span>
        {places.length > 1 ? (
          <>
            <ChevronDown size={16} strokeWidth={2} aria-hidden />
            <select value={here.spaceId} aria-label={t('place.switch')} onChange={event => onChoose(event.target.value)}>
              {places.map(place => (
                <option key={place.spaceId} value={place.spaceId}>
                  {place.name}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </span>
      {/* How alive the place is, read off the home's own card rather than asked for again. */}
      <LivenessPill liveness={livenessOf(here, now)} measuredAt={measuredAtOf(here.values)} now={now} explain />
    </h1>
  );
}
