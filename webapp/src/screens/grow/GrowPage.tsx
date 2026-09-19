import { ChevronLeft, Globe, Share2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';
import type { GrowListItem, Plant, Space } from '@fg2/shared-types/v1';
import { useGrow, useGrowPlants } from '@/api/grows';
import { useSpaces } from '@/api/spaces';
import { useReportFreshness } from '@/ui/freshness';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import { weekOfPhase } from '@/ui/stages';
import { Tabs } from '@/ui/Tabs';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { Feeding } from './Feeding';
import { PhaseBar } from './PhaseBar';
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
  const mayManage = useMayManage();
  const [sharing, setSharing] = useState(false);

  useReportFreshness(grow.dataUpdatedAt ? new Date(grow.dataUpdatedAt).toISOString() : null);

  if (grow.isPending) {
    return (
      <section className={styles.page}>
        <Waiting lines={2} />
        <Waiting lines={4} />
      </section>
    );
  }
  if (!grow.data) return <LoadFailed retry={() => void grow.refetch()} />;

  const tabs = TABS.map(key => ({ key, label: t(`grow.tabs.${key}`), to: `/grows/${growId}/${key}` }));

  return (
    <section className={styles.page}>
      <Header
        grow={grow.data}
        plants={plants.data?.items ?? []}
        spaces={spaces.data?.items ?? []}
        now={now}
        onShare={mayManage ? () => setSharing(true) : null}
      />
      <RefreshFailed failedAt={grow.isError ? grow.dataUpdatedAt : null} now={now} />
      <Tabs items={tabs} label={t('grow.tabsLabel')} />
      {tab === 'weeks' ? <Weeks grow={grow.data} now={now} /> : null}
      {tab === 'plants' ? <Plants grow={grow.data} plants={plants} spaces={spaces.data?.items ?? []} /> : null}
      {tab === 'feeding' ? <Feeding grow={grow.data} /> : null}
      {tab === 'report' ? <Report grow={grow.data} spaces={spaces.data?.items ?? []} now={now} /> : null}
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
}

function Header({ grow, plants, spaces, now, onShare }: HeaderProps) {
  const { t } = useTranslation();
  const { summary } = grow;
  const week = weekOfPhase(summary.phaseDay);
  const places = summary.locations.map(location => ({
    spaceId: location.spaceId,
    name: location.spaceId ? (spaces.find(space => space.id === location.spaceId)?.name ?? '…') : t('grow.noFixedPlace'),
  }));

  return (
    <header className={styles.header}>
      <div className={styles.titleRow}>
        <Link to="/" className={styles.back} aria-label={t('shell.tabs.home')}>
          <ChevronLeft size={22} strokeWidth={1.75} aria-hidden />
        </Link>
        <div className={styles.titles}>
          <h1 className={styles.name}>{grow.name}</h1>
          <p className={styles.subtitle}>
            {plants.length > 0 ? <span>{strainsOf(plants)}</span> : null}
            {places.map(place => (
              <span key={place.spaceId ?? 'none'}>
                {' · '}
                {place.spaceId ? (
                  <Link to={`/spaces/${place.spaceId}`} className={styles.place}>
                    {place.name}
                  </Link>
                ) : (
                  place.name
                )}
              </span>
            ))}
            {grow.visibility === 'public' ? (
              <Link to={`/g/${grow.slug}`} className={`mono ${styles.publicChip}`}>
                <Globe size={12} strokeWidth={1.75} aria-hidden />
                {t('sharing.publicChip')}
              </Link>
            ) : null}
          </p>
        </div>
        {onShare ? (
          <button type="button" className={`${ui.chip} ${styles.share}`} onClick={onShare}>
            <Share2 size={13} strokeWidth={1.75} aria-hidden />
            {t('sharing.share')}
          </button>
        ) : null}
        {summary.dayNumber !== null ? (
          <div className={styles.day}>
            <span className={`figure ${styles.dayFigure}`}>{summary.dayNumber}</span>
            <span className="label">{t('home.card.day')}</span>
          </div>
        ) : null}
      </div>

      <PhaseBar grow={grow} now={now} />

      <p className={styles.phaseLine}>
        {summary.stage ? (
          <span className={styles.phase}>
            {t(`home.stage.${summary.stage}`)}
            {week !== null ? ` · ${t('grow.week', { week })}` : ''}
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
        <span className={styles.muted}> · {t('home.card.plants', { count: plants.length })}</span>
      </p>
    </header>
  );
}
