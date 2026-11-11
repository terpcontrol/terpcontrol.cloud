import { useTranslation } from 'react-i18next';
import type { PlaceCard } from '@/app/places';
import { useSpaceOverview } from '@/api/spaces';
import { useNow } from '@/ui/useNow';
import { livenessOf, measuredAtOf } from '../home/attention';
import { LivenessPill } from '../home/LivenessPill';
import styles from './PlaceTitle.module.css';

/**
 * The title of a page about the chosen place - Verlauf, Steuerung - and how
 * alive that place is, read off the home's own card rather than asked for
 * again; a place nothing measures has no pill. Which place it is stands in
 * the header, where it is chosen.
 */
export function PlaceTitle({ title, here }: { title: string; here: PlaceCard }) {
  const now = useNow();

  return (
    <header className={styles.head}>
      <h1>{title}</h1>
      <LivenessPill liveness={livenessOf(here, now)} measuredAt={measuredAtOf(here.values)} now={now} explain />
    </header>
  );
}

/** The title over a customer's place that support is reading: the page, the place's name, and that it is somebody else's. */
export function VisitingTitle({ title, spaceId }: { title: string; spaceId: string }) {
  const { t } = useTranslation();
  const overview = useSpaceOverview(spaceId);

  return (
    <h1>
      {title} · {overview.data?.name ?? '…'}
      <span className={`mono ${styles.visiting}`}>{t('timeline.visiting')}</span>
    </h1>
  );
}
