import { ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';
import { noLongerThere } from '@/api/problem';
import { LoadFailed, NoLongerHere, RefreshFailed, Waiting } from '@/ui/PageState';
import { Tabs } from '@/ui/Tabs';
import { useNow } from '@/ui/useNow';
import { livenessOf, measuredAtOf } from '../home/attention';
import { LivenessPill } from '../home/LivenessPill';
import { Control } from '../control/Control';
import { DeviceList } from '../devices/DeviceList';
import { Timeline } from '../timeline/Timeline';
import { Members } from './members/Members';
import { PlaceCockpit } from '../cockpit/PlaceCockpit';
import { KIND_ICON } from '../cockpit/place';
import { PlaceMenu } from '../cockpit/PlaceMenu';
import { usePlace } from '../cockpit/reads';
import styles from './SpacePage.module.css';
import ui from '@/ui/ui.module.css';

const TABS = ['overview', 'timeline', 'devices', 'control', 'members'] as const;
type SpaceTab = (typeof TABS)[number];

const isTab = (value: string | undefined): value is SpaceTab => (TABS as readonly string[]).includes(value ?? '');

/**
 * The tent page: the place's name with how alive it is and its menu, the five
 * tabs, and the place's cockpit, which it lands on. The overview is read once a
 * minute, the live values every half minute, and whichever answered last is
 * what the figures show; a refresh that fails keeps the last values with their
 * ages.
 */
export function SpacePage() {
  const { spaceId = '', tab, sub = null } = useParams();
  if (!isTab(tab)) return <Navigate to={`/spaces/${spaceId}/overview`} replace />;

  return <SpaceScreen spaceId={spaceId} tab={tab} sub={sub} />;
}

function SpaceScreen({ spaceId, tab, sub }: { spaceId: string; tab: SpaceTab; sub: string | null }) {
  const { t } = useTranslation();
  const now = useNow();
  const { read, current, failedAt } = usePlace(spaceId);

  if (read.isPending) {
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
  if (!current) return noLongerThere(read.error) ? <NoLongerHere what="space" /> : <LoadFailed retry={() => void read.refetch()} />;

  const tabs = TABS.map(key => ({ key, label: t(`space.tabs.${key}`), to: `/spaces/${spaceId}/${key}` }));
  const Icon = KIND_ICON[current.kind];

  return (
    <section className={styles.page} data-tab={tab}>
      <header className={styles.header}>
        <Link to="/" className={`${ui.back} ${styles.back}`} aria-label={t('shell.tabs.home')}>
          <ChevronLeft size={22} strokeWidth={1.75} aria-hidden />
        </Link>
        <h1 className={styles.name}>
          <Icon size={18} strokeWidth={1.75} aria-hidden />
          {current.name}
        </h1>
        <LivenessPill liveness={livenessOf(current, now)} measuredAt={measuredAtOf(current.values)} now={now} explain />
        <PlaceMenu overview={current} />
      </header>
      <RefreshFailed failedAt={failedAt} now={now} />
      <Tabs items={tabs} label={t('space.tabsLabel')} />
      {tab === 'overview' ? (
        <PlaceCockpit overview={current} />
      ) : tab === 'timeline' ? (
        <Timeline spaceId={spaceId} />
      ) : tab === 'devices' ? (
        <DeviceList spaceId={spaceId} />
      ) : tab === 'control' ? (
        <Control spaceId={spaceId} sub={sub} />
      ) : (
        <Members spaceId={spaceId} name={current.name} kind={current.kind} roomId={current.roomId} />
      )}
    </section>
  );
}
