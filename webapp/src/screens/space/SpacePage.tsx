import { Box, ChevronLeft, Fan, Leaf, Refrigerator, Sun, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';
import type { SpaceKind, SpaceOverview } from '@fg2/shared-types/v1';
import { fetchedAt } from '@/api/clock';
import { noLongerThere } from '@/api/problem';
import { useSpaceLive, useSpaceOverview } from '@/api/spaces';
import { useReportFreshness } from '@/ui/freshness';
import { LoadFailed, NoLongerHere, RefreshFailed, Waiting } from '@/ui/PageState';
import { Tabs } from '@/ui/Tabs';
import { useNow } from '@/ui/useNow';
import { livenessOf, measuredAtOf } from '../home/attention';
import { LivenessPill } from '../home/SpaceCard';
import { Control } from '../control/Control';
import { DeviceList } from '../devices/DeviceList';
import { useRememberSpace } from '../timeline/last-space';
import { Timeline } from '../timeline/Timeline';
import { Members } from './members/Members';
import { Overview } from './Overview';
import styles from './SpacePage.module.css';

const TABS = ['overview', 'timeline', 'devices', 'control', 'members'] as const;
type SpaceTab = (typeof TABS)[number];

const isTab = (value: string | undefined): value is SpaceTab => (TABS as readonly string[]).includes(value ?? '');

const KIND_ICON: Record<SpaceKind, LucideIcon> = { tent: Box, fridge: Refrigerator, room: Fan, balcony: Sun, other: Leaf };

/**
 * The tent page: the place's name with how alive it is, the five tabs, and the
 * overview it lands on. The overview is read once a minute, the live values
 * every half minute, and whichever answered last is what the figures show;
 * a refresh that fails keeps the last values with their ages.
 */
export function SpacePage() {
  const { spaceId = '', tab, sub = null } = useParams();
  if (!isTab(tab)) return <Navigate to={`/spaces/${spaceId}/overview`} replace />;

  return <SpaceScreen spaceId={spaceId} tab={tab} sub={sub} />;
}

function SpaceScreen({ spaceId, tab, sub }: { spaceId: string; tab: SpaceTab; sub: string | null }) {
  const { t } = useTranslation();
  const now = useNow();
  // The tab bar's own Timeline lands on the place last looked at, and looking at one here is what makes it that place.
  useRememberSpace(spaceId);
  const overview = useSpaceOverview(spaceId);
  const live = useSpaceLive(spaceId, (overview.data?.deviceIds?.length ?? 0) > 0);

  const freshestAt = Math.max(overview.dataUpdatedAt, live.dataUpdatedAt);
  useReportFreshness(freshestAt ? fetchedAt(freshestAt) : null);

  if (overview.isPending) {
    return (
      <section className={styles.page}>
        <Waiting lines={2} />
        <Waiting lines={4} />
      </section>
    );
  }
  // Being taken out of somebody's tent is what this usually is, and it is the
  // one failure a retry can never mend: every read behind this page answers 404
  // from then on.
  if (!overview.data) return noLongerThere(overview.error) ? <NoLongerHere what="space" /> : <LoadFailed retry={() => void overview.refetch()} />;

  // The live read is the newer of the two more often than not; the overview's own values stand in until it answers.
  const current: SpaceOverview =
    live.data && live.dataUpdatedAt > overview.dataUpdatedAt
      ? { ...overview.data, values: live.data.values, setpoints: live.data.setpoints }
      : overview.data;
  // Dated by the half that failed, not by the freshest of the two. The live
  // read comes round twice as often as the overview, so after the network was
  // back it had already succeeded while the overview's failure still stood -
  // and the banner said "could not refresh · showing what was known 0 s ago",
  // which is two things at once. Of two failed halves it is the older, the way
  // the alerts inbox puts it: what is on screen is as old as its older half.
  const staleAt = Math.min(overview.isError ? overview.dataUpdatedAt : Infinity, live.isError ? live.dataUpdatedAt : Infinity);
  const failedAt = Number.isFinite(staleAt) ? staleAt : null;
  const tabs = TABS.map(key => ({ key, label: t(`space.tabs.${key}`), to: `/spaces/${spaceId}/${key}` }));
  const Icon = KIND_ICON[current.kind];

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.back} aria-label={t('shell.tabs.home')}>
          <ChevronLeft size={22} strokeWidth={1.75} aria-hidden />
        </Link>
        <h1 className={styles.name}>
          <Icon size={18} strokeWidth={1.75} aria-hidden />
          {current.name}
        </h1>
        <LivenessPill liveness={livenessOf(current)} measuredAt={measuredAtOf(current.values)} now={now} />
      </header>
      <RefreshFailed failedAt={failedAt} now={now} />
      <Tabs items={tabs} label={t('space.tabsLabel')} />
      {tab === 'overview' ? (
        <Overview overview={current} now={now} />
      ) : tab === 'timeline' ? (
        <Timeline spaceId={spaceId} />
      ) : tab === 'devices' ? (
        <DeviceList spaceId={spaceId} verdict={current.verdict} />
      ) : tab === 'control' ? (
        <Control spaceId={spaceId} sub={sub} />
      ) : (
        <Members spaceId={spaceId} name={current.name} kind={current.kind} roomId={current.roomId} />
      )}
    </section>
  );
}
