import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';
import { useGrowsEverIn } from '@/api/grows';
import { useSpaceOverview } from '@/api/spaces';
import { GROW, ALL_GROWS, isPlace, useCurrentPlace } from '@/app/places';
import { PlaceEnded, Visited, VisitingTitle } from '@/screens/place/PlaceTitle';
import { LoadFailed, NoLongerHere, NothingHere, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { MoveHereSheet } from '../space/MoveHereSheet';
import { useMovableGrows } from '../space/movable-grows';
import { GrowScreen, NoGrow } from './GrowPage';
import { growTabOf, type GrowTab } from './grow-tabs';
import { StartGrowSheet } from './new/WhatGrows';
import styles from './GrowPage.module.css';

/**
 * Grow, the bar's item: the grow running in the chosen place, as that grow's
 * own page with its tabs under this address. A grow standing in no place is in
 * none to choose, and is shown where the chosen place grows nothing - "nothing
 * grows here" over a grow on the balcony read as having none. Where nothing
 * grows at all, the page offers to start a grow - in the chosen place where
 * there is one - and leads to every grow the account has had.
 */
export function CurrentGrow() {
  const { t } = useTranslation();
  const { tab: segment } = useParams();
  const { home, here, visiting, ended, stray } = useCurrentPlace(true);
  const tab = growTabOf(segment);

  if (tab === null) return <Navigate to={GROW} replace />;
  if (home.isPending || ended === undefined) {
    return (
      <NoGrow>
        <Waiting lines={4} />
      </NoGrow>
    );
  }
  if (!home.data) return <LoadFailed title={t('shell.tabs.grow')} read={home} />;
  // An address naming a place the account has not got, or one of its own that has ended, says so and draws no other.
  if (stray) return <NoLongerHere what="space" />;
  if (ended) {
    return (
      <section className={`${ui.stack3} ${styles.page}`}>
        <PlaceEnded title={t('shell.tabs.grow')} name={ended.name} spaceId={ended.id} />
      </section>
    );
  }
  // A customer's place, which support reads by the address: the grow standing there, or that there is no such place.
  if (visiting) {
    return (
      <Visited spaceId={visiting}>
        <VisitedGrow spaceId={visiting} tab={tab} />
      </Visited>
    );
  }

  const growId = here?.grow?.growId ?? home.data.spaces.find(card => !isPlace(card) && card.grow)?.grow?.growId ?? null;
  if (growId) return <GrowScreen key={growId} growId={growId} tab={tab} current />;

  return (
    <NoGrow>
      <div className={ui.card}>
        <NothingGrows place={here} />
      </div>
    </NoGrow>
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
    <section className={`${ui.stack3} ${styles.page}`}>
      <VisitingTitle title={t('shell.tabs.grow')} spaceId={spaceId} />
      <NothingHere>{t('home.invite.noGrow')}</NothingHere>
    </section>
  );
}

/**
 * Nothing grows here: the ways to change that, to somebody who may - a grow started, or one moved into the chosen
 * place where there is one to move. An account whose grows stand in no place has no place to move one into, and is
 * offered the start alone. Where a grow has come down here, the page says so and leads to its report.
 */
function NothingGrows({ place }: { place: { spaceId: string; name: string } | null }) {
  const { t } = useTranslation();
  const mayManage = useMayManage(place?.spaceId);
  const [moving, setMoving] = useState(false);
  const [starting, setStarting] = useState(false);
  const movable = useMovableGrows(place?.spaceId ?? '').items;
  // The grow that came down here last: after a harvest this page is where its place leads, and its report is a tap away.
  const last = useGrowsEverIn(place?.spaceId ?? null).data?.items.find(grow => grow.endedAt !== null);

  return (
    <div className={ui.stack1}>
      <p className={ui.note}>{t('home.invite.noGrow')}</p>
      {last ? (
        <Link to={`${ALL_GROWS}/${last.id}/report`} className={ui.headLink}>
          {t('grow.lifecycle.harvest.ended', { name: last.name })} ›
        </Link>
      ) : null}
      {mayManage ? (
        <p className={styles.growActions}>
          <button type="button" className={ui.button} onClick={() => setStarting(true)}>
            {t('home.invite.startGrow')}
          </button>
          {/* Only where a grow could come from: one running in another place, or in none. */}
          {place && movable.length > 0 ? (
            <button type="button" className={ui.button} onClick={() => setMoving(true)}>
              {t('home.invite.moveGrow')}
            </button>
          ) : null}
        </p>
      ) : null}
      {moving && place ? <MoveHereSheet spaceId={place.spaceId} spaceName={place.name} onClose={() => setMoving(false)} /> : null}
      {starting ? <StartGrowSheet spaceId={place?.spaceId} name={place?.name} onClose={() => setStarting(false)} /> : null}
    </div>
  );
}
