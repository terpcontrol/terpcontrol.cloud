import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCurrentPlace } from '@/app/places';
import { LoadFailed, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { NothingGrows } from '../cockpit/GrowBlock';
import { GrowScreen } from './GrowPage';
import { MyGrowsLine } from './MyGrows';
import { NewGrowRow } from './new/NewGrowRow';
import { NewGrowSheet } from './new/NewGrowSheet';
import styles from './GrowPage.module.css';

/**
 * Grow, the bar's item: the grow running in the chosen place, as that grow's
 * own page. An account whose grows stand in no place has none to choose, and
 * is shown the first of them. Where nothing grows, the page offers to start a
 * grow - in the chosen place where there is one - and leads to every grow the
 * account has had.
 */
export function CurrentGrow() {
  const { t } = useTranslation();
  const { home, places, here } = useCurrentPlace();
  const [starting, setStarting] = useState(false);

  if (home.isPending) return <Waiting lines={4} />;
  if (!home.data) return <LoadFailed retry={() => void home.refetch()} />;

  const growId = (places.length > 0 ? here : home.data.spaces[0])?.grow?.growId ?? null;
  if (growId) return <GrowScreen key={growId} growId={growId} tab="weeks" current />;

  return (
    <section className={styles.page}>
      <h1>{t('shell.tabs.grow')}</h1>
      {here ? (
        <div className={ui.card}>
          <NothingGrows spaceId={here.spaceId} name={here.name} />
        </div>
      ) : (
        <NewGrowRow onOpen={() => setStarting(true)} />
      )}
      <MyGrowsLine />
      {starting ? <NewGrowSheet onClose={() => setStarting(false)} /> : null}
    </section>
  );
}
