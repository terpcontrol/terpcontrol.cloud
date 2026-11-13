import { useTranslation } from 'react-i18next';
import type { Space } from '@fg2/shared-types/v1';
import { placesFor } from '@/app/places';
import { Choice, Choices } from '@/ui/SheetParts';

/**
 * Where plants are put: the places a grow may stand in (`placesFor`) and "no fixed place", which is a place a grow
 * can be in rather than the absence of one. `keep` is the answer of a sheet that may leave them where they are,
 * chosen as `undefined`.
 */
export function PlaceChoices(props: {
  label: string;
  spaces: Space[];
  chosen: string | null | undefined;
  keep?: string;
  onChoose: (spaceId: string | null | undefined) => void;
}) {
  const { t } = useTranslation();
  const choice = (spaceId: string | null | undefined, words: string) => (
    <Choice key={spaceId ?? String(spaceId)} chosen={props.chosen === spaceId} onChoose={() => props.onChoose(spaceId)}>
      {words}
    </Choice>
  );

  return (
    <Choices label={props.label}>
      {props.keep ? choice(undefined, props.keep) : null}
      {placesFor(props.spaces).map(space => choice(space.id, space.name))}
      {choice(null, t('grow.noFixedPlace'))}
    </Choices>
  );
}
