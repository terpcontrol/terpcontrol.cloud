import { useTranslation } from 'react-i18next';
import type { Plant } from '@fg2/shared-types/v1';
import { Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';

/**
 * Which plants an action is about.
 *
 * `null` is every plant of the grow, which is the contract's own word for it
 * and not the same as having picked them all out by hand: a grow that gains a
 * plant tomorrow is still covered by a phase written for all of them, and is
 * not covered by a list that happened to name each one. So "All" is a choice of
 * its own rather than the state of every other chip, and picking the last plant
 * out of a list puts the action back on the whole grow rather than on nobody.
 *
 * A split is the one action that cannot mean "all of them" - plants that all go
 * their own way have not gone anywhere - so it leaves `everyLabel` out, and
 * then an empty list is a question nobody has answered yet rather than a scope.
 */
export function PlantPicker({
  plants,
  chosen,
  everyLabel,
  label,
  unavailable = [],
  onChange,
}: {
  plants: Plant[];
  /** Null is every plant; a list is exactly those. */
  chosen: string[] | null;
  /** What "all of them" reads as here - every plant, or every plant still standing. Null offers no such choice. */
  everyLabel: string | null;
  label: string;
  /** Plants this action cannot be about, such as ones that have already come down. */
  unavailable?: string[];
  onChange: (chosen: string[] | null) => void;
}) {
  const { t } = useTranslation();

  const toggle = (plantId: string) => {
    const next = chosen === null ? [plantId] : chosen.includes(plantId) ? chosen.filter(one => one !== plantId) : [...chosen, plantId];
    onChange(next.length === 0 && everyLabel !== null ? null : next);
  };

  if (plants.length === 0) return <p className={ui.note}>{t('grow.noPlants')}</p>;

  return (
    <Choices label={label}>
      {everyLabel === null ? null : (
        <Choice chosen={chosen === null} onChoose={() => onChange(null)}>
          {everyLabel}
        </Choice>
      )}
      {plants.map(plant => (
        <Choice
          key={plant.id}
          chosen={chosen !== null && chosen.includes(plant.id)}
          disabled={unavailable.includes(plant.id)}
          onChoose={() => toggle(plant.id)}
        >
          {plant.label}
        </Choice>
      ))}
    </Choices>
  );
}
