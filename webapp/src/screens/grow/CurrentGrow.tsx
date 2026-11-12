import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';
import { useSpaceOverview } from '@/api/spaces';
import { GROW, ALL_GROWS, useCurrentPlace } from '@/app/places';
import { Visited, VisitingTitle } from '@/screens/place/PlaceTitle';
import { LoadFailed, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { MoveHereSheet } from '../space/MoveHereSheet';
import { GrowScreen } from './GrowPage';
import { growTabOf, type GrowTab } from './grow-tabs';
import { NewGrowSheet } from './new/NewGrowSheet';
import styles from './GrowPage.module.css';

/**
 * Grow, the bar's item: the grow running in the chosen place, as that grow's
 * own page with its tabs under this address. An account whose grows stand in
 * no place has none to choose, and is shown the first of them. Where nothing
 * grows, the page offers to start a grow - in the chosen place where there is
 * one - and leads to every grow the account has had.
 */
export function CurrentGrow() {
  const { t } = useTranslation();
  const { tab: segment } = useParams();
  const { home, places, here, visiting } = useCurrentPlace();
  const tab = growTabOf(segment);

  if (tab === null) return <Navigate to={GROW} replace />;
  if (home.isPending) return <Waiting lines={4} />;
  if (!home.data) return <LoadFailed retry={() => void home.refetch()} />;
  // A customer's place, which support reads by the address: the grow standing there, or that there is no such place.
  if (visiting) {
    return (
      <Visited spaceId={visiting}>
        <VisitedGrow spaceId={visiting} tab={tab} />
      </Visited>
    );
  }

  const growId = (places.length > 0 ? here : home.data.spaces[0])?.grow?.growId ?? null;
  if (growId) return <GrowScreen key={growId} growId={growId} tab={tab} current />;

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <div className={styles.title}>
          <h1>{t('shell.tabs.grow')}</h1>
          <div className={styles.actions}>
            <Link to={ALL_GROWS} className={styles.pill}>
              {t('grow.all.pill')}
            </Link>
          </div>
        </div>
      </header>
      <div className={ui.card}>
        <NothingGrows place={here} />
      </div>
    </section>
  );
}

/** The grow standing in a place support is reading, drawn as that grow's own page. */
function VisitedGrow({ spaceId, tab }: { spaceId: string; tab: GrowTab }) {
  const { t } = useTranslation();
  const overview = useSpaceOverview(spaceId);
  const growId = overview.data?.grows[0]?.growId ?? null;

  if (overview.isPending) return <Waiting lines={4} />;
  if (growId) return <GrowScreen key={growId} growId={growId} tab={tab} />;

  return (
    <section className={styles.page}>
      <VisitingTitle title={t('shell.tabs.grow')} spaceId={spaceId} />
      <p className={`${ui.cardDashed} ${ui.note}`}>{t('home.invite.noGrow')}</p>
    </section>
  );
}

/**
 * Nothing grows here: the ways to change that, to somebody who may - a grow started, or one moved into the chosen
 * place. An account whose grows stand in no place has no place to move one into, and is offered the start alone.
 */
function NothingGrows({ place }: { place: { spaceId: string; name: string } | null }) {
  const { t } = useTranslation();
  const mayManage = useMayManage(place?.spaceId);
  const [moving, setMoving] = useState(false);
  const [starting, setStarting] = useState(false);

  return (
    <div className={styles.nothingGrows}>
      <p className={ui.note}>{t('home.invite.noGrow')}</p>
      {mayManage ? (
        <p className={styles.growActions}>
          <button type="button" className={ui.button} onClick={() => setStarting(true)}>
            {t('home.invite.startGrow')}
          </button>
          {place ? (
            <button type="button" className={ui.button} onClick={() => setMoving(true)}>
              {t('home.invite.moveGrow')}
            </button>
          ) : null}
        </p>
      ) : null}
      {moving && place ? <MoveHereSheet spaceId={place.spaceId} spaceName={place.name} onClose={() => setMoving(false)} /> : null}
      {/* Started here, the grow is drawn here: the sheet opens over Grow and Grow is what it comes back to. */}
      {starting ? <NewGrowSheet spaceId={place?.spaceId ?? null} landOn={GROW} onClose={() => setStarting(false)} /> : null}
    </div>
  );
}
