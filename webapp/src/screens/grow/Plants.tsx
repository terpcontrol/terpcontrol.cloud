import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { GrowListItem, PlantPage, Space } from '@fg2/shared-types/v1';
import type { useGrowPlants } from '@/api/grows';
import { LoadFailed, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import styles from './GrowPage.module.css';

interface PlantsProps {
  grow: GrowListItem;
  plants: ReturnType<typeof useGrowPlants>;
  spaces: Space[];
}

/**
 * The Plants tab: each plant, what it is and where it stands. The phase and
 * the place are the grow's, unless a split or a move has given this plant its
 * own - which the summary's groups and locations say.
 */
export function Plants({ grow, plants, spaces }: PlantsProps) {
  if (plants.isPending) return <Waiting lines={3} />;
  if (!plants.data) return <LoadFailed retry={() => void plants.refetch()} />;

  return <PlantList grow={grow} page={plants.data} spaces={spaces} />;
}

function PlantList({ grow, page, spaces }: { grow: GrowListItem; page: PlantPage; spaces: Space[] }) {
  const { t } = useTranslation();
  const { summary } = grow;

  const stageOf = (plantId: string) => summary.groups.find(group => group.plantIds.includes(plantId))?.stage ?? summary.stage;
  const placeOf = (plantId: string) => {
    const location = summary.locations.find(one => one.plantIds.includes(plantId));
    if (!location) return null;
    return location.spaceId ? (spaces.find(space => space.id === location.spaceId)?.name ?? '…') : t('grow.noFixedPlace');
  };

  if (page.items.length === 0) return <p className={`${ui.cardDashed} ${ui.note}`}>{t('grow.noPlants')}</p>;

  return (
    <ul className={styles.rows} aria-label={t('grow.tabs.plants')}>
      {page.items.map(plant => {
        const stage = stageOf(plant.id);
        const place = placeOf(plant.id);
        return (
          <li key={plant.id} className={styles.row}>
            {/* The whole row leads to the plant's own page: its readings, its
                pictures and the lines that name it alone. */}
            <Link to={`/grows/${grow.id}/plants/${plant.id}`} className={styles.rowMain}>
              <span className={styles.rowTitle}>{plant.label}</span>
              <span className={styles.rowSub}>
                {plant.strain}
                {plant.status !== 'active' ? ` · ${t(`grow.plantStatus.${plant.status}`)}` : ''}
              </span>
            </Link>
            <div className={`mono ${styles.rowAside}`}>
              <span>{stage ? t(`home.stage.${stage}`) : t('home.card.noPhase')}</span>
              {place ? <span className={styles.muted}>{place}</span> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
