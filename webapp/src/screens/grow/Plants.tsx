import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { GrowListItem, Plant, PlantPage, Space } from '@fg2/shared-types/v1';
import { useAddPlant, useRemovePlant, type useGrowPlants } from '@/api/grows';
import { useLog } from '@/log/log-context';
import { NameSheet } from '@/ui/NameSheet';
import { LoadFailed, NothingHere, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { placeName } from './placement';
import styles from './GrowPage.module.css';

interface PlantsProps {
  grow: GrowListItem;
  plants: ReturnType<typeof useGrowPlants>;
  spaces: Space[];
  mayManage: boolean;
}

/**
 * The Plants tab: each plant, what it is and where it stands. The phase and
 * the place are the grow's, unless a split or a move has given this plant its
 * own - which the summary's groups and locations say.
 */
export function Plants({ grow, plants, spaces, mayManage }: PlantsProps) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);

  if (plants.isPending) return <Waiting lines={3} />;
  if (!plants.data) return <LoadFailed retry={() => void plants.refetch()} />;

  return (
    <>
      <PlantList grow={grow} page={plants.data} spaces={spaces} />
      {/* A grow that has ended takes no more plants. */}
      {mayManage && grow.endedAt === null ? (
        <div className={ui.wrap}>
          <button type="button" className={ui.button} onClick={() => setAdding(true)}>
            {t('grow.plant.add')}
          </button>
        </div>
      ) : null}
      {adding ? <AddPlantSheet growId={grow.id} plants={plants.data.items} onClose={() => setAdding(false)} /> : null}
    </>
  );
}

/**
 * One more plant: what replaces a dead one, a cutting that came later. The strain is the last plant's until another
 * is typed; without a label the server numbers the plant among its strain. The answer offers to take it out again,
 * which is one call while nothing was written about it.
 */
function AddPlantSheet({ growId, plants, onClose }: { growId: string; plants: readonly Plant[]; onClose: () => void }) {
  const { t } = useTranslation();
  const { tell } = useLog();
  const add = useAddPlant(growId);
  const remove = useRemovePlant();

  return (
    <NameSheet
      title={t('grow.plant.add')}
      fields={{
        strain: { label: t('grow.plant.strain'), value: plants.at(-1)?.strain ?? '' },
        label: { label: t('grow.plant.labelOptional'), value: '' },
      }}
      error={add.error}
      busy={add.isPending}
      save={add.isPending ? t('grow.plant.saving') : t('grow.plant.addIt')}
      ready={body => body.strain !== ''}
      refused={body => (plants.some(other => other.label === body.label) ? t('grow.plant.nameTaken', { name: body.label }) : null)}
      onSave={body =>
        add.mutate(
          { strain: body.strain, ...(body.label ? { label: body.label } : {}) },
          {
            onSuccess: plant => {
              onClose();
              tell({
                label: t('grow.plant.told.added', { name: plant.label }),
                undo: () => remove.mutateAsync(plant.id),
                undone: t('log.noMore', { what: plant.label }),
              });
            },
          },
        )
      }
      onClose={onClose}
    />
  );
}

function PlantList({ grow, page, spaces }: { grow: GrowListItem; page: PlantPage; spaces: Space[] }) {
  const { t } = useTranslation();
  const { summary } = grow;

  const stageOf = (plantId: string) => summary.groups.find(group => group.plantIds.includes(plantId))?.stage ?? summary.stage;
  const placeOf = (plantId: string) => {
    const location = summary.locations.find(one => one.plantIds.includes(plantId));
    return location ? placeName(t, spaces, location.spaceId) : null;
  };

  if (page.items.length === 0) return <NothingHere>{t('grow.noPlants')}</NothingHere>;

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
            <div className={styles.rowAside}>
              <span>{stage ? t(`home.stage.${stage}`) : t('home.card.noPhase')}</span>
              {place ? <span className={styles.muted}>{place}</span> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
