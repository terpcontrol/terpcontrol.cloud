import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Space } from '@fg2/shared-types/v1';
import { Choice, Choices } from './SheetParts';

/**
 * Where a thing is put, as chips: the places it may stand in, which the sheet hands over (`placesFor`, `placesOf`).
 * `nowhere` adds "no fixed place", chosen as null - a place a grow can be in rather than the absence of one - and
 * `keep` the answer of a sheet that may leave the thing where it is, chosen as `undefined`. What a sheet offers
 * beyond the places, such as a new one, it puts behind them as `children`.
 */
export function PlaceChoices<T extends null | undefined = never>(props: {
  label: string;
  places: readonly Space[];
  chosen: string | T;
  keep?: string;
  nowhere?: boolean;
  disabled?: boolean;
  onChoose: (spaceId: string | T) => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const choice = (spaceId: string | T, words: string) => (
    <Choice key={spaceId ?? String(spaceId)} chosen={props.chosen === spaceId} disabled={props.disabled} onChoose={() => props.onChoose(spaceId)}>
      {words}
    </Choice>
  );

  return (
    <Choices label={props.label}>
      {props.keep ? choice(undefined as T, props.keep) : null}
      {props.places.map(space => choice(space.id, space.name))}
      {props.nowhere ? choice(null as T, t('grow.noFixedPlace')) : null}
      {props.children}
    </Choices>
  );
}
