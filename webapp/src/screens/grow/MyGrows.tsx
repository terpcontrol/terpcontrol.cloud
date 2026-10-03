import { ChevronLeft, ChevronRight, Leaf, Plus, Sprout } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { MyGrowCard } from '@fg2/shared-types/v1';
import { FROM_MY_GROWS, MY_GROWS } from '@/app/places';
import { useMyGrows } from '@/api/grows';
import { THUMBNAIL_WIDTH, mediaUrl } from '@/api/session';
import { Help } from '@/ui/Help';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { DAY, DAY_IN_YEAR, useZone, zoned } from '@/ui/zone';
import { NewGrowSheet } from './new/NewGrowSheet';
import { countsOf } from './my-grows';
import styles from './MyGrows.module.css';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * "My grows": every grow of the account on one page, the running ones above
 * the finished ones, each a card with its picture, where it stands, what was
 * sown and - once it is over - how long it ran and what came down.
 *
 * Start draws the places and what stands in each of them today, so a grow
 * that has ended, a second grow sharing a tent and a grow somebody else runs
 * in a tent the grower was let into had no screen to be found on. This page is
 * where all of them are, and Start and Ich lead to it.
 *
 * The list is read to its end, because a finished grow that merely sorts past
 * a page is not a grow that is gone; where the cap on reading stopped it first
 * the page says so instead of letting the missing ones read as none.
 */
export function MyGrows() {
  const { t } = useTranslation();
  const now = useNow();
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
  const empty = grows.data.items.length === 0;

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <Link to="/" className={ui.back} aria-label={t('shell.tabs.home')}>
          <ChevronLeft size={22} strokeWidth={1.75} aria-hidden />
        </Link>
        <h1 className={styles.title}>{t('grow.mine.title')}</h1>
        <Help topic="myGrows" />
      </header>

      <RefreshFailed failedAt={grows.isError ? grows.dataUpdatedAt : null} now={now} />

      {empty ? (
        <div className={`${ui.cardDashed} ${styles.empty}`}>
          <Sprout size={28} strokeWidth={1.5} className={styles.emptyIcon} aria-hidden />
          <p className={styles.emptyTitle}>{t('grow.mine.emptyTitle')}</p>
          <p className={ui.note}>{t('grow.mine.emptyText')}</p>
          {mayManage ? (
            <button type="button" className={`${ui.button} ${ui.primary}`} onClick={() => setStarting(true)}>
              <Plus size={16} strokeWidth={2} aria-hidden />
              {t('grow.mine.new')}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          {/* A new grow is a running one, so the way to start it is the last
              tile among them: the dashed shape the app gives the thing that is
              not there yet, as under Start's cards. */}
          <Shelf
            title={t('grow.mine.running')}
            grows={running}
            none={t('grow.mine.noneRunning')}
            more={
              mayManage ? (
                <li className={styles.item}>
                  <button type="button" className={`${ui.addRow} ${styles.add}`} onClick={() => setStarting(true)}>
                    <Plus size={18} strokeWidth={1.75} className={styles.addIcon} aria-hidden />
                    {t('grow.mine.new')}
                  </button>
                </li>
              ) : null
            }
          />
          <Shelf title={t('grow.mine.finished')} grows={finished} none={t('grow.mine.noneFinished')} />
        </>
      )}

      {/* Said rather than hidden: the cap on how far the list is read exists so
          a huge account cannot hold the screen open, and a reader who stopped
          at it has to know that what is missing may still be there. */}
      {grows.data.complete ? null : <p className={`mono ${ui.note}`}>{t('grow.mine.partial')}</p>}

      {starting ? <NewGrowSheet onClose={() => setStarting(false)} /> : null}
    </section>
  );
}

/** One half of the page under its label and its count; an empty half says what would stand in it. */
function Shelf({ title, grows, none, more = null }: { title: string; grows: MyGrowCard[]; none: string; more?: ReactNode }) {
  return (
    <section className={styles.shelf} aria-label={title}>
      <header className={styles.shelfHead}>
        <span className="label">{title}</span>
        {grows.length > 0 ? <span className={`mono ${styles.count}`}>{grows.length}</span> : null}
      </header>
      {grows.length === 0 ? <p className={`${ui.note} ${styles.none}`}>{none}</p> : null}
      {grows.length > 0 || more ? (
        <ul className={styles.cards}>
          {grows.map(grow => (
            <GrowCard key={grow.growId} grow={grow} />
          ))}
          {more}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * One grow: its picture, its name, and then what kind of grow it is now - the
 * day, the phase and the week of a running one, the span and length of a
 * finished one - where it stands, what was sown, and what came down.
 */
function GrowCard({ grow }: { grow: MyGrowCard }) {
  const { t } = useTranslation();
  const zone = useZone();
  // How long a finished grow ran opens the line under its dates, which on a phone is as wide as the dates alone.
  const where = [
    grow.endedAt && grow.dayNumber !== null ? t('grow.mine.ranDays', { count: grow.dayNumber }) : null,
    placeOf(t, grow),
    grow.owner ? t('grow.mine.sharedBy', { handle: grow.owner.handle }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const plants = plantsOf(grow);
  const harvest = harvestOf(t, grow);

  return (
    <li className={styles.item}>
      <Link to={`/grows/${grow.growId}`} state={FROM_MY_GROWS} className={styles.card} data-ended={grow.endedAt !== null || undefined}>
        <Cover mediaId={grow.coverMediaId} />
        <span className={styles.text}>
          <span className={styles.nameRow}>
            <span className={`name ${styles.name}`}>{grow.name}</span>
            {grow.owner ? <span className={`${ui.tag} ${ui.tagSmall} ${styles.shared}`}>{t('grow.mine.sharedTag')}</span> : null}
          </span>
          <span className={styles.status}>{grow.endedAt ? spanOf(t, grow.startedAt, grow.endedAt, zone) : progressOf(t, grow)}</span>
          {where ? <span className={styles.meta}>{where}</span> : null}
          {plants ? <span className={styles.meta}>{plants}</span> : null}
          {harvest ? <span className={`mono ${styles.harvest}`}>{harvest}</span> : null}
        </span>
        <ChevronRight size={16} strokeWidth={1.75} className={styles.chevron} aria-hidden />
      </Link>
    </li>
  );
}

/**
 * The picture, asked for at two sizes: the small square a phone draws beside
 * the words and the wide one a desktop draws over them. A picture that does
 * not arrive leaves the quiet frame the grow without one has.
 */
function Cover({ mediaId }: { mediaId: string | null }) {
  const [failed, setFailed] = useState(false);
  const small = mediaId ? mediaUrl(mediaId, THUMBNAIL_WIDTH.still) : null;
  const large = mediaId ? mediaUrl(mediaId, THUMBNAIL_WIDTH.frame) : null;
  const shown = small !== null && large !== null && !failed;

  return (
    <span className={styles.cover}>
      {shown ? (
        <img
          src={large}
          srcSet={`${small} ${THUMBNAIL_WIDTH.still}w, ${large} ${THUMBNAIL_WIDTH.frame}w`}
          sizes="(min-width: 700px) 400px, 112px"
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <Leaf size={24} strokeWidth={1.5} aria-hidden />
      )}
    </span>
  );
}

/** "Tag 33 · Blüte · Woche 3", as the grow's own page states it; a grow with no phase yet says that. */
const progressOf = (t: Translate, grow: MyGrowCard): string =>
  [
    grow.dayNumber !== null ? t('home.card.dayN', { day: grow.dayNumber }) : null,
    grow.stage ? t(`home.stage.${grow.stage}`) : t('home.card.noPhase'),
    grow.stage && grow.stageWeek !== null ? t('grow.week', { week: grow.stageWeek }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

/** Spaces that do not break, so a narrow card breaks a line between two dates and never inside one. */
const whole = (text: string): string => text.replace(/ /g, '\u00a0');

/** "2. Feb – 8. Jun 2026": the days it began and ended where the account is, the year once where both fall in it. */
const spanOf = (t: Translate, startedAt: string, endedAt: string, zone: string | null): string => {
  const from = zoned(startedAt, zone);
  const to = zoned(endedAt, zone);

  return t('grow.mine.ran', { from: whole(from.toFormat(from.year === to.year ? DAY_IN_YEAR : DAY)), to: whole(to.toFormat(DAY)) });
};

/** Where the grow stands, or stood last; "ohne Ort" for a grow that stands in none. */
const placeOf = (t: Translate, grow: MyGrowCard): string | null =>
  grow.places.length === 0 ? null : grow.places.map(place => place.name ?? t('grow.mine.noPlace')).join(', ');

/** "Gelato ×2 · Amnesia Haze": each strain once, with its count where there is more than one - as the grow page writes it. */
const plantsOf = (grow: MyGrowCard): string =>
  grow.strains.map(({ strain, count }) => (count !== null && count > 1 ? `${strain} ×${count}` : strain)).join(' · ');

/** What came down, where it was weighed; a harvest with no weight says nothing the dates above do not. */
const harvestOf = (t: Translate, grow: MyGrowCard): string | null => {
  const harvest = grow.harvest;
  if (!harvest || (harvest.dryWeightG === null && harvest.wetWeightG === null)) return null;

  return [
    t('grow.mine.harvest'),
    harvest.dryWeightG !== null ? t('grow.report.dry', { grams: harvest.dryWeightG }) : null,
    harvest.wetWeightG !== null ? t('grow.report.wet', { grams: harvest.wetWeightG }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
};

/**
 * The way from Start to this page: one quiet line under the cards, "Meine
 * Grows · 2 laufend · 3 abgeschlossen", for whoever keeps a diary. It appears
 * once there is a grow behind it, which is Start's rule for its strips, and
 * its read is the page's own, so the page opens on an answer already there.
 */
export function MyGrowsLine() {
  const { t } = useTranslation();
  const grows = useMyGrows();
  const items = grows.data?.items ?? [];

  if (items.length === 0) return null;

  return (
    <Link to={MY_GROWS} className={styles.line}>
      <Sprout size={16} strokeWidth={1.75} className={styles.lineIcon} aria-hidden />
      <span className={styles.lineTitle}>{t('grow.mine.title')}</span>
      <span className={`mono ${styles.lineCounts}`}>{countsOf(t, items)}</span>
      <ChevronRight size={16} strokeWidth={1.75} className={styles.chevron} aria-hidden />
    </Link>
  );
}
