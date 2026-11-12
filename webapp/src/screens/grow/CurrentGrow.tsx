import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';
import { GROW, ALL_GROWS, useCurrentPlace } from '@/app/places';
import { LoadFailed, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { MoveHereSheet } from '../space/MoveHereSheet';
import { GrowScreen } from './GrowPage';
import { growTabOf } from './grow-tabs';
import { NewGrowRow } from './new/NewGrowRow';
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
  const { home, places, here } = useCurrentPlace();
  const [starting, setStarting] = useState(false);
  const tab = growTabOf(segment);

  if (tab === null) return <Navigate to={GROW} replace />;
  if (home.isPending) return <Waiting lines={4} />;
  if (!home.data) return <LoadFailed retry={() => void home.refetch()} />;

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
      {here ? (
        <div className={ui.card}>
          <NothingGrows spaceId={here.spaceId} name={here.name} />
        </div>
      ) : (
        <NewGrowRow onOpen={() => setStarting(true)} />
      )}
      {starting ? <NewGrowSheet onClose={() => setStarting(false)} /> : null}
    </section>
  );
}

/** Nothing grows here: the two ways to change that, to somebody who may put a grow into this place. */
function NothingGrows({ spaceId, name }: { spaceId: string; name: string }) {
  const { t } = useTranslation();
  const mayManage = useMayManage(spaceId);
  const [moving, setMoving] = useState(false);

  return (
    <div className={styles.nothingGrows}>
      <p className={ui.note}>{t('home.invite.noGrow')}</p>
      {mayManage ? (
        <p className={`${styles.growActions} ${ui.dots}`}>
          <Link to={`/grows/new?space=${spaceId}`} className={ui.headLink}>
            {t('home.invite.startGrow')}
          </Link>
          <span className={ui.dot}>
            {' · '}
            <button type="button" className={ui.headLink} onClick={() => setMoving(true)}>
              {t('home.invite.moveGrow')}
            </button>
          </span>
        </p>
      ) : null}
      {moving ? <MoveHereSheet spaceId={spaceId} spaceName={name} onClose={() => setMoving(false)} /> : null}
    </div>
  );
}
