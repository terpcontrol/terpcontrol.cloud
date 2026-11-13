import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowListItem, GrowthStage, Plant, Space } from '@fg2/shared-types/v1';
import { serverNow } from '@/api/clock';
import { useSplit } from '@/api/lifecycle';
import { placesFor } from '@/app/places';
import { useLog } from '@/log/log-context';
import { PlaceChoices } from '@/ui/PlaceChoices';
import { Sheet } from '@/ui/Sheet';
import { instantOf } from '@/ui/age';
import { Refused } from '@/ui/PageState';
import { keptPreset } from '@/ui/presets';
import { Block, Choice, Choices, WhenField } from '@/ui/SheetParts';
import { STAGES } from '@/ui/stages';
import ui from '@/ui/ui.module.css';
import { StageClimates } from './ClimatePick';
import { placeName } from './placement';
import { PlantPicker } from './PlantPicker';
import styles from './Lifecycle.module.css';

/**
 * Some plants going their own way while the rest of the grow carries on: a
 * mother kept back, a clone run started beside its parents, four drying in the
 * fridge while four go on flowering.
 *
 * It is one action rather than a phase and a move made in turn, and the sheet
 * asks it as one question for the same reason the server answers it as one: two
 * halves done separately would leave the grow half split, and the phase has to
 * be read from where the plants have gone, so the fridge is put on the drying
 * climate before its targets are written into the phase.
 *
 * A split that names neither a stage nor a place has not split anything, which
 * is why the button waits until one of them is chosen rather than asking the
 * server to say so.
 *
 * A grow whose record carries no plants has nothing to split off, and the whole
 * sheet is then one sentence. Everything on it leads somewhere the server
 * refuses - a split names at least one plant - so drawing the picker, the phase
 * chips, the place chips and a dead "Split off 0 plants" is four choices ending
 * in a refusal, where the rule is that a control somebody may not use is absent
 * rather than refused after the tap. Harvest, given the same record, says the
 * same thing and offers nothing.
 */
/** Which plants the sheet opens on, for a caller that is already about one of them; the grow page names none and the scope is the grow's. */
export function SplitSheet({
  grow,
  plants,
  spaces,
  preselect,
  onClose,
}: {
  grow: GrowListItem;
  plants: Plant[];
  spaces: Space[];
  preselect?: string[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const split = useSplit(grow.id);
  const { tell } = useLog();

  const [chosen, setChosen] = useState<string[]>(preselect ?? []);
  const [stage, setStage] = useState<GrowthStage | null>(null);
  const [preset, setPreset] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState<string | null | undefined>(undefined);
  // Now as the server reckons it, which is the clock the day field's cap is on.
  const [at, setAt] = useState(() => serverNow().toJSDate());

  const staying = plants.length - chosen.length;
  const ready = chosen.length > 0 && (stage !== null || spaceId !== undefined);

  if (plants.length === 0) {
    return (
      <Sheet title={t('grow.lifecycle.split.title', { name: grow.name })} onClose={onClose}>
        <div className={ui.sheetBody}>
          <p className={ui.note}>{t('grow.lifecycle.split.noPlantsRecorded')}</p>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title={t('grow.lifecycle.split.title', { name: grow.name })} onClose={onClose}>
      <div className={ui.sheetBody}>
        <p className={styles.now}>{t('grow.lifecycle.split.what')}</p>

        <Block
          label={t('grow.lifecycle.split.whichGoTheirOwnWay')}
          aside={chosen.length > 0 ? t('grow.lifecycle.split.staying', { count: staying }) : undefined}
        >
          <PlantPicker
            plants={plants}
            chosen={chosen}
            everyLabel={null}
            label={t('grow.lifecycle.whichPlants')}
            onChange={next => setChosen(next ?? [])}
          />
        </Block>

        <Block label={t('grow.lifecycle.split.theirPhase')}>
          <Choices label={t('grow.lifecycle.split.theirPhase')}>
            <Choice chosen={stage === null} onChoose={() => setStage(null)}>
              {t('grow.lifecycle.split.keepPhase')}
            </Choice>
            {STAGES.map(one => (
              <Choice
                key={one}
                chosen={stage === one}
                onChoose={() => {
                  setStage(one);
                  setPreset(current => keptPreset(one, current));
                }}
              >
                {t(`home.stage.${one}`)}
              </Choice>
            ))}
          </Choices>

          {stage ? <StageClimates label={t('grow.lifecycle.phase.presetLabel')} stage={stage} chosen={preset} onPick={setPreset} /> : null}
        </Block>

        <Block label={t('grow.lifecycle.split.theirPlace')}>
          <PlaceChoices
            label={t('grow.lifecycle.split.theirPlace')}
            places={placesFor(spaces)}
            nowhere
            chosen={spaceId}
            keep={t('grow.lifecycle.split.keepPlace')}
            onChoose={setSpaceId}
          />
        </Block>

        <WhenField label={t('grow.lifecycle.when')} at={at} onChange={setAt} />

        <p className={ui.note}>{t(ready ? 'grow.lifecycle.split.note' : 'grow.lifecycle.split.needsOne')}</p>
        <Refused error={split.error} />

        <button
          type="button"
          className={`${ui.button} ${ui.primary} ${styles.submit}`}
          disabled={split.isPending || !ready}
          onClick={() => {
            // The contract asks for at least one plant, so the first one is
            // handed over as itself rather than as a list that might be empty.
            const [first, ...rest] = chosen;
            if (first === undefined) return;

            split.mutate(
              {
                plantIds: [first, ...rest],
                startedAt: instantOf(DateTime.fromJSDate(at)),
                stage: stage ?? undefined,
                preset: stage === null ? undefined : preset,
                spaceId,
              },
              {
                onSuccess: () => {
                  onClose();
                  // What holds for the plants that went their own way; phase and place are two writes, so there is no one way back.
                  const what = [stage ? t(`home.stage.${stage}`) : null, spaceId === undefined ? null : placeName(t, spaces, spaceId)];
                  tell({ label: [t('grow.told.split', { count: chosen.length }), ...what].filter(Boolean).join(' · '), undo: null });
                },
              },
            );
          }}
        >
          {split.isPending ? t('grow.lifecycle.saving') : t('grow.lifecycle.split.submit', { count: chosen.length })}
        </button>
      </div>
    </Sheet>
  );
}
