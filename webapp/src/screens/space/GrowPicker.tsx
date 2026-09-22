import { useTranslation } from 'react-i18next';
import type { GrowListItem } from '@fg2/shared-types/v1';
import { useSpaces } from '@/api/spaces';
import { Choice, Choices } from '@/ui/SheetParts';
import styles from './GrowPicker.module.css';

/**
 * Which grow moves in here.
 *
 * Every chip says where its grow stands now, because that is the whole of what
 * a move costs: the one on offer may be day 35 of a flowering run in another
 * tent, with a plan and a set of alarm rules that follow it, and a name on its
 * own does not say so. A grow standing nowhere in particular says that instead
 * of nothing, which is a place a grow can be in.
 *
 * Choosing is not committing. The pick is held by whoever drew the picker and
 * spent by a button of its own, so that a mis-tap on a list of names cannot
 * take a running grow out of the tent it is in.
 */
export function GrowPicker({
  grows,
  chosen,
  disabled,
  onChoose,
}: {
  grows: GrowListItem[];
  chosen: string | null;
  disabled?: boolean;
  onChoose: (growId: string) => void;
}) {
  const { t } = useTranslation();
  const spaces = useSpaces();

  const standing = (grow: GrowListItem): string | null => {
    const open = grow.placements.find(one => one.endedAt === null);
    if (!open) return null;
    if (open.spaceId === null) return t('space.presets.growStandsNowhere');

    return spaces.data?.items.find(one => one.id === open.spaceId)?.name ?? null;
  };

  return (
    <div className={styles.list}>
      <Choices label={t('space.presets.whichGrow')}>
        {grows.map(grow => {
          const where = standing(grow);

          return (
            <Choice key={grow.id} chosen={chosen === grow.id} disabled={disabled} onChoose={() => onChoose(grow.id)}>
              {where === null ? grow.name : t('space.presets.growAt', { name: grow.name, place: where })}
            </Choice>
          );
        })}
      </Choices>
    </div>
  );
}
