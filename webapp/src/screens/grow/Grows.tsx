import { ChevronRight, Sprout } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { MyGrowCard } from '@fg2/shared-types/v1';
import { useGrows, useMyGrows } from '@/api/grows';
import { useDiaryLayer } from '@/api/layers';
import { useOwnSchemes, useSchemes } from '@/api/schemes';
import { THUMBNAIL_WIDTH, mediaUrl, useSession } from '@/api/session';
import { useFollows, useShareLinks } from '@/api/sharing';
import { FOLLOWING, GROW, SCHEMES, SHARE_LINKS } from '@/app/places';
import type { Translate } from '@/i18n/i18n';
import { followingLine, lineOnce, schemesLine, shareLinksLine, type Read } from '@/screens/me/doors';
import { BackLink } from '@/ui/BackLink';
import { factsOf } from '@/ui/fact-text';
import { Facts } from '@/ui/Facts';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { nowThere, useZone, zoned } from '@/ui/zone';
import { StartGrowSheet } from './new/WhatGrows';
import styles from './Grows.module.css';

/**
 * "Grows": every grow the account sees on one page. The running ones first,
 * each with its picture, its day and phase and where it stands; then the
 * finished ones, each a row that leads to its report; then what belongs to
 * growing without being a grow - the feeding schemes, the share links and the
 * public grows of others the account follows.
 *
 * Grow in the bar shows the grow of the chosen place, so a finished grow, a
 * second grow sharing a tent and a grow somebody else runs in a tent the
 * grower was let into are found here, and a new one is started here.
 *
 * The list is read to its end, because a finished grow that merely sorts past
 * a page is not a grow that is gone; where the cap on reading stopped it first
 * the page says so instead of letting the missing ones read as none.
 */
export function Grows() {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const { user } = useSession();
  const grows = useMyGrows();
  const mayManage = useMayManage();
  const [starting, setStarting] = useState(false);

  if (grows.isPending) {
    return (
      <section className={styles.page}>
        <Waiting lines={2} />
        <Waiting lines={2} />
      </section>
    );
  }
  if (!grows.data) return <LoadFailed retry={() => void grows.refetch()} />;

  const running = grows.data.items.filter(grow => grow.endedAt === null);
  const finished = grows.data.items.filter(grow => grow.endedAt !== null);

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <BackLink to={GROW} label={t('place.backTo', { name: t('shell.tabs.grow') })} />
        <h1>{t('grow.all.title')}</h1>
        {mayManage ? (
          <button type="button" className={styles.new} onClick={() => setStarting(true)}>
            + {t('grow.all.new')}
          </button>
        ) : null}
      </header>

      <RefreshFailed failedAt={grows.isError ? grows.dataUpdatedAt : null} now={now} />

      {grows.data.items.length === 0 ? (
        <div className={`${ui.cardDashed} ${styles.empty}`}>
          <Sprout size={28} strokeWidth={1.5} aria-hidden />
          <p>{t('grow.all.none')}</p>
        </div>
      ) : null}

      {running.length > 0 ? (
        <section className={styles.shelf} aria-labelledby="grows-running">
          <h2 id="grows-running">{t('grow.all.running')}</h2>
          {running.map(grow => (
            <Link key={grow.growId} to={`/grows/${grow.growId}`} className={styles.card}>
              <Cover mediaId={grow.coverMediaId} />
              <span className={styles.text}>
                {grow.name}
                <Facts facts={[...progressOf(t, grow), placeOf(t, grow), sharedBy(t, grow)]} className={styles.line} />
              </span>
              <ChevronRight size={20} strokeWidth={2} className={styles.chevron} aria-hidden />
            </Link>
          ))}
        </section>
      ) : null}

      {finished.length > 0 ? (
        <section className={styles.shelf} aria-labelledby="grows-finished">
          <h2 id="grows-finished">{t('grow.all.finished')}</h2>
          {finished.map(grow => (
            <Link key={grow.growId} to={`/grows/${grow.growId}/report`} className={styles.row}>
              <span className={styles.text}>
                {grow.name}
                <Facts facts={[...ranOf(t, grow, zone, now), sharedBy(t, grow), t('grow.tabs.report')]} className={styles.line} />
              </span>
              <ChevronRight size={20} strokeWidth={2} className={styles.chevron} aria-hidden />
            </Link>
          ))}
        </section>
      ) : null}

      {/* Said rather than hidden: the cap on how far the list is read exists so
          a huge account cannot hold the screen open, and a reader who stopped
          at it has to know that what is missing may still be there. */}
      {grows.data.complete ? null : <p className={ui.note}>{t('grow.all.partial')}</p>}

      {/* The demo looks at somebody else's grow and has no shelf, links or follows of its own. */}
      {user && !user.isDemo ? <Beside /> : null}

      {starting ? <StartGrowSheet onClose={() => setStarting(false)} /> : null}
    </section>
  );
}

/**
 * What belongs to growing without being a grow: each a door that says under
 * its name what the page behind it holds, read from the server and never
 * guessed. A read still outstanding says it is loading and one that failed
 * says so, each under its own door.
 */
function Beside() {
  const { t } = useTranslation();
  const now = useNow();
  const grows = useGrows();
  const shipped = useSchemes();
  const own = useOwnSchemes();
  const links = useShareLinks();
  const follows = useFollows(true);
  const diary = useDiaryLayer();
  // The shelf is what a grow's feeds are dosed from: a door of the diary's, kept for whoever wrote a scheme of their own.
  const feeds = diary || (own.data?.items.length ?? 0) > 0;
  const line = (reads: Read[], text: () => string) => lineOnce(t, reads, text);
  const door = (to: string, title: string, says: string) => (
    <Link to={to} className={styles.door}>
      <span className={styles.text}>
        {title}
        <Facts facts={factsOf(says)} className={styles.line} />
      </span>
      <ChevronRight size={20} strokeWidth={2} className={styles.chevron} aria-hidden />
    </Link>
  );

  return (
    <section className={styles.shelf} aria-labelledby="grows-beside">
      <h2 id="grows-beside">{t('grow.all.beside')}</h2>
      <div className={styles.doors}>
        {feeds
          ? door(
              SCHEMES,
              t('me.schemes.title'),
              line([grows, shipped, own], () => schemesLine(t, grows.data!.items, shipped.data!, own.data!.items)),
            )
          : null}
        {door(
          SHARE_LINKS,
          t('me.shareLinks.title'),
          line([links], () => shareLinksLine(t, links.data!.items, now)),
        )}
        {door(
          FOLLOWING,
          t('me.following.title'),
          line([follows], () => followingLine(t, follows.data!.items.length)),
        )}
      </div>
    </section>
  );
}

/** The picture a grow is shown by; a grow without one gives its words the room. */
function Cover({ mediaId }: { mediaId: string | null }) {
  const [failed, setFailed] = useState(false);
  const src = mediaId ? mediaUrl(mediaId, THUMBNAIL_WIDTH.still) : null;

  return src && !failed ? <img className={styles.cover} src={src} alt="" loading="lazy" onError={() => setFailed(true)} /> : null;
}

/** "Tag 29 · Blüte, Woche 3", as the grow's own page states it; a grow with no phase yet says that. */
const progressOf = (t: Translate, grow: MyGrowCard): (string | null)[] => [
  grow.dayNumber !== null ? t('home.card.dayN', { day: grow.dayNumber }) : null,
  grow.stage
    ? [t(`home.stage.${grow.stage}`), grow.stageWeek !== null ? t('grow.week', { week: grow.stageWeek }) : null].filter(Boolean).join(', ')
    : t('home.card.noPhase'),
];

/** Where the grow stands; "Kein fester Ort" for a grow that stands in none, as its own page calls it. */
const placeOf = (t: Translate, grow: MyGrowCard): string | null =>
  grow.places.length === 0 ? null : grow.places.map(place => place.name ?? t('grow.noFixedPlace')).join(', ');

/** Whose grow it is, where it is somebody else's in a place the account was let into. */
const sharedBy = (t: Translate, grow: MyGrowCard): string | null => (grow.owner ? t('grow.all.sharedBy', { handle: grow.owner.handle }) : null);

/** "126 Tage · geerntet im August": how long it ran, and the month it came down - or ended, where nothing was harvested. */
const ranOf = (t: Translate, grow: MyGrowCard, zone: string | null, now: DateTime): (string | null)[] => {
  const ended = zoned(grow.endedAt!, zone);
  const month = ended.toFormat(ended.year === nowThere(now, zone).year ? 'LLLL' : 'LLLL yyyy');

  return [
    grow.dayNumber !== null ? t('grow.days', { count: grow.dayNumber }) : null,
    t(grow.harvest ? 'grow.all.harvested' : 'grow.all.ended', { month }),
  ];
};
