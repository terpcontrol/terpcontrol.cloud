import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { PlaceCard } from '@/app/places';
import { useDevices } from '@/api/devices';
import { noLongerThere } from '@/api/problem';
import { useSession } from '@/api/session';
import { useEndedSpaces, useSpaceOverview } from '@/api/spaces';
import { NoLongerHere, Waiting } from '@/ui/PageState';
import { useNow } from '@/ui/useNow';
import { livenessOf, measuredAtOf, silenceOf } from '@/screens/start/attention';
import { LivenessPill } from '@/ui/LivenessPill';
import ui from '@/ui/ui.module.css';
import place from './Place.module.css';
import styles from './PlaceTitle.module.css';

/**
 * The title of a page about the chosen place - Verlauf, Steuerung - and how
 * alive that place is, read off the home's own card rather than asked for
 * again; a place nothing measures has no pill. Which place it is stands in
 * the header, where it is chosen - and, on a desktop, beside the title where
 * the page hands it `place`, which it does once the account has several.
 *
 * `state` is what a page says in the pill's place while the place is heard:
 * Steuerung's "Regelung an". A place gone quiet, or waiting for its first
 * values, says that instead - no state is claimed for a device nobody hears -
 * unless the page says the silence itself (`silenceSaid`), in its box under
 * the title: then the pill is left out rather than said twice.
 */
export function PlaceTitle({
  title,
  here,
  place = null,
  state = null,
  deviceId = null,
  silenceSaid = false,
}: {
  title: string;
  here: PlaceCard;
  place?: string | null;
  state?: ReactNode;
  silenceSaid?: boolean;
  /** The device the page is about, where the place holds several climates: the pill dates that one, not whichever spoke last. */
  deviceId?: string | null;
}) {
  const now = useNow();
  const values = here.climates.find(climate => climate.deviceId === deviceId)?.values ?? here.values;
  const devices = useDevices(here.deviceIds.length > 0 && values.length === 0).data?.items ?? [];
  // As on the place's Start: no value at all is a device waiting for its first one, unless it was heard and went quiet.
  const silence = silenceOf(
    values,
    devices.filter(device => (deviceId ? device.id === deviceId : here.deviceIds.includes(device.id))),
    now,
  );
  const silentSince = silence && !silence.waiting ? silence.since : null;
  const liveness = livenessOf({ values, deviceIds: here.deviceIds }, now);
  const waiting = liveness === 'offline' && values.length === 0 && silentSince === null;

  return (
    <header className={styles.head}>
      <div className={styles.title}>
        <h1>{title}</h1>
        {place ? <span className={styles.place}>{place}</span> : null}
      </div>
      {state && !waiting && (liveness === 'live' || liveness === 'stale') ? (
        state
      ) : silenceSaid && liveness === 'offline' && !waiting ? null : (
        <LivenessPill liveness={liveness} measuredAt={measuredAtOf(values) ?? silentSince} now={now} explain waiting={waiting} />
      )}
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
      <span className={styles.visiting}>{t('timeline.visiting')}</span>
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

/**
 * What Start, Verlauf, Steuerung and the place's own pages say at an address
 * that names a place of the account's own that has ended - an old alert leads
 * there, a bookmark, the browser's Back after the removal: that it is gone and
 * where its curves still are, rather than another place drawn without a word.
 */
export function PlaceEnded({ title, name }: { title: string; name: string }) {
  const { t } = useTranslation();

  return (
    <>
      <h1>{title}</h1>
      <p className={`${ui.cardDashed} ${ui.note}`}>{t('place.ended', { name })}</p>
      <Link to="/" className={ui.button}>
        {t('shell.gone.home')}
      </Link>
    </>
  );
}

/**
 * A page about one place - "Ort bearbeiten", "Ort entfernen", who is let in - at an address its places in use do not
 * hold: one of the account's own that has ended says so under the page's own title, as its Start and Steuerung do;
 * any other cannot be opened, which is all that may be said of a place somebody else ended or took the reader out of.
 */
export function PlaceGone({ spaceId, title }: { spaceId: string; title: (name: string) => string }) {
  const { user } = useSession();
  const ended = useEndedSpaces(user !== null && !user.isDemo);
  const own = ended.data?.items.find(space => space.id === spaceId && space.kind !== 'room' && space.ownerId === user?.id);

  if (ended.isLoading) return <Waiting lines={4} />;
  if (!own) return <NoLongerHere what="space" />;
  return (
    <section className={`${ui.stack3} ${ui.page} ${place.reading}`}>
      <PlaceEnded title={title(own.name)} name={own.name} />
    </section>
  );
}
