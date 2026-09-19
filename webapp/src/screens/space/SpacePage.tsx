import { Box, ChevronLeft, Fan, Leaf, Refrigerator, Sun, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';
import type { SpaceKind, SpaceOverview } from '@fg2/shared-types/v1';
import { useSpaceLive, useSpaceOverview } from '@/api/spaces';
import { useReportFreshness } from '@/ui/freshness';
import { LaterRound } from '@/ui/LaterRound';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import { Tabs } from '@/ui/Tabs';
import { useNow } from '@/ui/useNow';
import { livenessOf, measuredAtOf } from '../home/attention';
import { LivenessPill } from '../home/SpaceCard';
import { useRememberSpace } from '../timeline/last-space';
import { Timeline } from '../timeline/Timeline';
import { Overview } from './Overview';
import styles from './SpacePage.module.css';

const TABS = ['overview', 'timeline', 'devices', 'control', 'members'] as const;
type SpaceTab = (typeof TABS)[number];

/** Which round each of the other tabs arrives with, as the decision record numbers them. */
const LATER: Record<Exclude<SpaceTab, 'overview' | 'timeline'>, number> = { devices: 5, control: 9, members: 13 };

const isTab = (value: string | undefined): value is SpaceTab => (TABS as readonly string[]).includes(value ?? '');

const KIND_ICON: Record<SpaceKind, LucideIcon> = { tent: Box, fridge: Refrigerator, room: Fan, balcony: Sun, other: Leaf };

/**
 * The tent page: the place's name with how alive it is, the five tabs, and the
 * overview it lands on. The overview is read once a minute, the live values
 * every half minute, and whichever answered last is what the figures show;
 * a refresh that fails keeps the last values with their ages.
 */
export function SpacePage() {
  const { spaceId = '', tab } = useParams();
  if (!isTab(tab)) return <Navigate to={`/spaces/${spaceId}/overview`} replace />;

  return <SpaceScreen spaceId={spaceId} tab={tab} />;
}

function SpaceScreen({ spaceId, tab }: { spaceId: string; tab: SpaceTab }) {
  const { t } = useTranslation();
  const now = useNow();
  // The tab bar's own Timeline lands on the place last looked at, and looking at one here is what makes it that place.
  useRememberSpace(spaceId);
  const overview = useSpaceOverview(spaceId);
  const live = useSpaceLive(spaceId, (overview.data?.deviceIds.length ?? 0) > 0);

  const freshestAt = Math.max(overview.dataUpdatedAt, live.dataUpdatedAt);
  useReportFreshness(freshestAt ? new Date(freshestAt).toISOString() : null);

  if (overview.isPending) {
    return (
      <section className={styles.page}>
        <Waiting lines={2} />
        <Waiting lines={4} />
      </section>
    );
  }
  if (!overview.data) return <LoadFailed retry={() => void overview.refetch()} />;

  // The live read is the newer of the two more often than not; the overview's own values stand in until it answers.
  const current: SpaceOverview =
    live.data && live.dataUpdatedAt > overview.dataUpdatedAt
      ? { ...overview.data, values: live.data.values, setpoints: live.data.setpoints }
      : overview.data;
  const failedAt = overview.isError || live.isError ? freshestAt : null;
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
      ) : (
        <LaterRound round={LATER[tab]} what={`space.later.${tab}`} />
      )}
    </section>
  );
}
