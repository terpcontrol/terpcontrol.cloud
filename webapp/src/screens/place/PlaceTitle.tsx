import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlaceCard } from '@/app/places';
import { useDevices } from '@/api/devices';
import { noLongerThere } from '@/api/problem';
import { useSpaceOverview } from '@/api/spaces';
import { NoLongerHere } from '@/ui/PageState';
import { useNow } from '@/ui/useNow';
import { livenessOf, measuredAtOf, silenceOf } from '@/screens/start/attention';
import { LivenessPill } from '@/ui/LivenessPill';
import styles from './PlaceTitle.module.css';

/**
 * The title of a page about the chosen place - Verlauf, Steuerung - and how
 * alive that place is, read off the home's own card rather than asked for
 * again; a place nothing measures has no pill. Which place it is stands in
 * the header, where it is chosen.
 */
export function PlaceTitle({ title, here }: { title: string; here: PlaceCard }) {
  const now = useNow();
  const devices = useDevices(here.deviceIds.length > 0 && here.values.length === 0).data?.items ?? [];
  // As on the place's Start: no value at all is a device waiting for its first one, unless it was heard and went quiet.
  const silence = silenceOf(
    here.values,
    devices.filter(device => here.deviceIds.includes(device.id)),
    now,
  );
  const silentSince = silence && !silence.waiting ? silence.since : null;
  const liveness = livenessOf(here, now);

  return (
    <header className={styles.head}>
      <h1>{title}</h1>
      <LivenessPill
        liveness={liveness}
        measuredAt={measuredAtOf(here.values) ?? silentSince}
        now={now}
        explain
        waiting={liveness === 'offline' && here.values.length === 0 && silentSince === null}
      />
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

/**
 * A page support reads of a customer's place, which the address names. Where
 * nothing is there under that name the page says so, with the way back,
 * rather than failing to load and offering a retry that cannot succeed.
 */
export function Visited({ spaceId, children }: { spaceId: string; children: ReactNode }) {
  const overview = useSpaceOverview(spaceId);

  return !overview.data && noLongerThere(overview.error) ? <NoLongerHere what="space" /> : children;
}
