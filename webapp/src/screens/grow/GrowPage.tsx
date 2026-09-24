import { ChevronLeft, CircleCheck, Globe, LineChart, Ruler, Share2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';
import type { GrowListItem, Plant, Space } from '@fg2/shared-types/v1';
import { fetchedAt } from '@/api/clock';
import { useGrow, useGrowPlants } from '@/api/grows';
import { noLongerThere } from '@/api/problem';
import { useSpaces } from '@/api/spaces';
import { useReportFreshness } from '@/ui/freshness';
import { LoadFailed, NoLongerHere, RefreshFailed, Waiting } from '@/ui/PageState';
import { enough, standsIn, useMayWith } from '@/ui/session-access';
import { Tabs } from '@/ui/Tabs';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { calendarDay, useZone } from '@/ui/zone';
import { Feeding } from './Feeding';
import { GrowLifecycle } from './Lifecycle';
import { PhaseBar } from './PhaseBar';
import { lastPlaceOf } from './placement';
import { Plants } from './Plants';
import { Report } from './Report';
import { ShareSheet } from './ShareSheet';
import { Weeks } from './Weeks';
import styles from './GrowPage.module.css';

const TABS = ['weeks', 'plants', 'feeding', 'report'] as const;
type GrowTab = (typeof TABS)[number];

const isTab = (value: string | undefined): value is GrowTab => (TABS as readonly string[]).includes(value ?? '');

/**
 * The grow page: its name, its day counter and its phase above a bar of the
 * stages, then the tab it opened on. It lands on Weeks. The grow is one read
 * and the tabs read their own; a refresh that fails keeps what was known on
 * the screen and says so.
 */
export function GrowPage() {
  const { growId = '', tab } = useParams();
  if (!isTab(tab)) return <Navigate to={`/grows/${growId}/weeks`} replace />;

  return <GrowScreen growId={growId} tab={tab} />;
}

function GrowScreen({ growId, tab }: { growId: string; tab: GrowTab }) {
  const { t } = useTranslation();
  const now = useNow();
  const grow = useGrow(growId);
  const plants = useGrowPlants(growId);
  const spaces = useSpaces();
  const mayWith = useMayWith();
  const [sharing, setSharing] = useState(false);

  // The instant this read answered is a millisecond this browser noted, so it
  // is restated on the server's clock before the shell ages it: the line under
  // the wordmark subtracts it from the server's now, and a browser three
  // quarters of an hour out otherwise has that gap read back to it as the age
  // of a read that had just landed.
  useReportFreshness(grow.dataUpdatedAt ? fetchedAt(grow.dataUpdatedAt) : null);

  if (grow.isPending) {
    return (
      <section className={styles.page}>
        <Waiting lines={2} />
        <Waiting lines={4} />
      </section>
    );
  }
  if (!grow.data) return noLongerThere(grow.error) ? <NoLongerHere what="grow" /> : <LoadFailed retry={() => void grow.refetch()} />;

  // A grow is written to through the place it stands in today, which is what
  // `access()` widens a membership over; the lifecycle moves are `manage` there
  // and putting the diary on the open web is the owner's alone.
  const youMay = mayWith({ ownerId: grow.data.ownerId, spaceId: standsIn(grow.data) });
  const mayManage = enough(youMay, 'manage');
  const mayOwn = enough(youMay, 'own');
  const tabs = TABS.map(key => ({ key, label: t(`grow.tabs.${key}`), to: `/grows/${growId}/${key}` }));

  return (
    <section className={styles.page} data-tab={tab}>
      <GrowHeader
        grow={grow.data}
        plants={plants.data?.items ?? []}
        spaces={spaces.data?.items ?? []}
        now={now}
        onShare={mayOwn ? () => setSharing(true) : null}
        actions={mayManage ? <GrowLifecycle grow={grow.data} plants={plants.data?.items ?? []} spaces={spaces.data?.items ?? []} /> : null}
      />
      {!mayManage && enough(youMay, 'log') ? <p className={`mono ${styles.role}`}>{t('grow.youMayLog')}</p> : null}
      <RefreshFailed failedAt={grow.isError ? grow.dataUpdatedAt : null} now={now} />
      <Tabs items={tabs} label={t('grow.tabsLabel')} />
      {tab === 'weeks' ? <Weeks grow={grow.data} now={now} /> : null}
      {tab === 'plants' ? <Plants grow={grow.data} plants={plants} spaces={spaces.data?.items ?? []} /> : null}
      {tab === 'feeding' ? <Feeding grow={grow.data} mayManage={mayManage} /> : null}
      {tab === 'report' ? <Report grow={grow.data} spaces={spaces.data?.items ?? []} mayOwn={mayOwn} now={now} /> : null}
      {sharing ? <ShareSheet grow={grow.data} onClose={() => setSharing(false)} /> : null}
    </section>
  );
}

/** "Amnesia ×2 · Gelato": each strain once, with its count where there is more than one. */
const strainsOf = (plants: Plant[]): string =>
  [...new Set(plants.map(plant => plant.strain))]
    .map(strain => {
      const count = plants.filter(plant => plant.strain === strain).length;
      return count > 1 ? `${strain} ×${count}` : strain;
    })
    .join(' · ');

interface HeaderProps {
  grow: GrowListItem;
  plants: Plant[];
  spaces: Space[];
  now: ReturnType<typeof useNow>;
  /** Null for a session that may only look: sharing a diary is the owner's, and a button that would be refused is not offered. */
  onShare: (() => void) | null;
  /**
   * The lifecycle row, for a session that may move the grow. It is drawn in
   * the header's own row of ways out rather than as a second row under it, so
   * the page opens on one line of chips instead of three stacked ones.
   */
  actions?: ReactNode;
}

/**
 * The head of the page: what the grow is called, where it stands, how far it
 * has come and how to share it.
 *
 * A grow that has ended says so here rather than drawing the shape of a running
 * one. Its counters are frozen at the day it ended, which is honest only while
 * the reader is told which day that was - undated, "218 DAY" beside a phase bar
 * reads as a grow that is still curing today. So the date it ended stands beside
 * the name and the figure is labelled as the last day rather than as the count
 * so far.
 */
export function GrowHeader({ grow, plants, spaces, now, onShare, actions = null }: HeaderProps) {
  const { t } = useTranslation();
  const zone = useZone();
  const { summary } = grow;
  // The date is read where the account is and the comparison is not, because
  // the day a grow ended on moves with the zone while the fact that it ended
  // does not.
  const endedOn = grow.endedAt ? calendarDay(grow.endedAt, zone) : null;
  const nameOf = (spaceId: string | null) => (spaceId ? (spaces.find(space => space.id === spaceId)?.name ?? '…') : t('grow.noFixedPlace'));
  // Where the plants are now, which a grow whose placements have all been
  // closed no longer has. Its report names the tent on every chapter and the
  // move sheet lists the span it stood there, so a header with nothing at all
  // in that slot is the one screen that forgets it - the closed placement
  // answers for it, said as the past tense it is.
  const places = summary.locations.map(location => ({ spaceId: location.spaceId, name: nameOf(location.spaceId) }));
  const stood = places.length > 0 ? null : lastPlaceOf(grow);
  const placeLink = (spaceId: string | null, label: string) =>
    spaceId ? (
      <Link to={`/spaces/${spaceId}`} className={styles.place}>
        {label}
      </Link>
    ) : (
      label
    );
  const said: ReactNode[] = [
    ...(plants.length > 0 ? [strainsOf(plants)] : []),
    ...places.map(place => placeLink(place.spaceId, place.name)),
    ...(stood ? [placeLink(stood.spaceId, t('grow.stoodIn', { name: nameOf(stood.spaceId) }))] : []),
  ];

  return (
    <header className={styles.header}>
      <div className={styles.titleRow}>
        <Link to="/" className={`${ui.back} ${styles.back}`} aria-label={t('shell.tabs.home')}>
          <ChevronLeft size={22} strokeWidth={1.75} aria-hidden />
        </Link>
        <div className={styles.titles}>
          <h1 className={styles.name}>{grow.name}</h1>
          <p className={styles.subtitle}>
            {/* Joined rather than each prefixed with its own separator, so a
                grow with no strains recorded does not open its subtitle with a
                dot in front of the tent. */}
            {said.map((part, index) => (
              <span key={index}>
                {index > 0 ? ' · ' : ''}
                {part}
              </span>
            ))}
            {endedOn ? (
              <span className={`mono ${styles.endedChip}`}>
                <CircleCheck size={12} strokeWidth={1.75} aria-hidden />
                {t('grow.ended', { date: endedOn })}
              </span>
            ) : null}
            {grow.visibility === 'public' ? (
              <Link to={`/g/${grow.slug}`} className={`mono ${styles.publicChip}`}>
                <Globe size={12} strokeWidth={1.75} aria-hidden />
                {t('sharing.publicChip')}
              </Link>
            ) : null}
          </p>
        </div>
        {summary.dayNumber !== null ? (
          <div className={styles.day}>
            <span className={`figure ${styles.dayFigure}`}>{summary.dayNumber}</span>
            <span className="caption">{t(endedOn ? 'grow.finalDay' : 'home.card.day')}</span>
          </div>
        ) : null}
      </div>

      <PhaseBar grow={grow} now={now} />

      <p className={styles.phaseLine}>
        {summary.stage ? (
          <span className={styles.phase}>
            {t(`home.stage.${summary.stage}`)}
            {summary.stageWeek !== null ? ` · ${t('grow.week', { week: summary.stageWeek })}` : ''}
            {summary.phaseDay !== null ? ` · ${t('grow.dayN', { day: summary.phaseDay })}` : ''}
          </span>
        ) : (
          <span className={styles.phase}>{t('home.card.noPhase')}</span>
        )}
        {summary.isAuto ? <span className={`mono ${styles.auto}`}>{t('home.card.auto')}</span> : null}
        {summary.groups.length > 0 ? (
          <span className={styles.muted}>
            {' · '}
            {summary.groups.map(group => `${group.plantIds.length} ${t(`home.stage.${group.stage}`).toLowerCase()}`).join(', ')}
          </span>
        ) : null}
        {/* A grow whose record carries no plants says so on its Plants tab, in
            words. A count of zero in the header says something else: that the
            plants were entered and are all gone. */}
        {plants.length > 0 ? <span className={styles.muted}> · {t('home.card.plants', { count: plants.length })}</span> : null}
      </p>

      {/* What the grow measures is the grow's own, not a week's and not a
          plant's, so the way in is a row of the header rather than a tab. It is
          drawn for everybody: reading what a grow measures is reading.

          Charts opens from the timeline and from a tent page. A grow that
          stands in no tent has neither, and would otherwise be told its
          measurements are drawn on a view it can never reach. */}
      <div className={styles.ways}>
        <Link to={`/grows/${grow.id}/measurements`} className={ui.chip}>
          <Ruler size={13} strokeWidth={1.75} aria-hidden />
          {t('grow.measurements.title')}
        </Link>
        {places.length === 0 || places.every(place => place.spaceId === null) ? (
          <Link to={`/charts?grow=${grow.id}`} className={ui.chip}>
            <LineChart size={13} strokeWidth={1.75} aria-hidden />
            {t('charts.title')}
          </Link>
        ) : null}
        {actions}
        {onShare ? (
          <button type="button" className={`${ui.chip} ${styles.share}`} onClick={onShare}>
            <Share2 size={13} strokeWidth={1.75} aria-hidden />
            {t('sharing.share')}
          </button>
        ) : null}
      </div>
    </header>
  );
}
