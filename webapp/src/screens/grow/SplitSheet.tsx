import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowListItem, GrowthStage, Plant, Space } from '@fg2/shared-types/v1';
import { useSplit } from '@/api/lifecycle';
import { Sheet } from '@/log/Sheet';
import { instantOf } from '@/ui/age';
import { Refused } from '@/ui/PageState';
import { presetsOf } from '@/ui/presets';
import { Block, Choice, Choices, WhenField } from '@/ui/SheetParts';
import { STAGES } from '@/ui/stages';
import ui from '@/ui/ui.module.css';
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
 */
export function SplitSheet({ grow, plants, spaces, onClose }: { grow: GrowListItem; plants: Plant[]; spaces: Space[]; onClose: () => void }) {
  const { t } = useTranslation();
  const split = useSplit(grow.id);

  const open = spaces.filter(space => space.archivedAt === null && space.kind !== 'room');
  const [chosen, setChosen] = useState<string[]>([]);
  const [stage, setStage] = useState<GrowthStage | null>(null);
  const [preset, setPreset] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState<string | null | undefined>(undefined);
  const [at, setAt] = useState(() => new Date());

  const staying = plants.length - chosen.length;
  const ready = chosen.length > 0 && (stage !== null || spaceId !== undefined);

  return (
    <Sheet title={t('grow.lifecycle.split.title', { name: grow.name })} onClose={onClose}>
      <div className={styles.body}>
        <p className={`mono ${styles.now}`}>{t('grow.lifecycle.split.what')}</p>

        <Block
          label={t('grow.lifecycle.split.whichGoTheirOwnWay')}
          aside={chosen.length > 0 ? <span className="mono">{t('grow.lifecycle.split.staying', { count: staying })}</span> : undefined}
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
                  setPreset(current => (presetsOf(one).includes(current ?? '') ? current : null));
                }}
              >
                {t(`home.stage.${one}`)}
              </Choice>
            ))}
          </Choices>

          {stage !== null && presetsOf(stage).length > 0 ? (
            <Choices label={t('grow.lifecycle.phase.presetLabel')}>
              <Choice chosen={preset === null} onChoose={() => setPreset(null)}>
                {t('grow.lifecycle.phase.noPreset')}
              </Choice>
              {presetsOf(stage).map(one => (
                <Choice key={one} chosen={preset === one} onChoose={() => setPreset(one)}>
                  {t(`grow.presetName.${one}`, { defaultValue: one })}
                </Choice>
              ))}
            </Choices>
          ) : null}
        </Block>

        <Block label={t('grow.lifecycle.split.theirPlace')}>
          <Choices label={t('grow.lifecycle.split.theirPlace')}>
            <Choice chosen={spaceId === undefined} onChoose={() => setSpaceId(undefined)}>
              {t('grow.lifecycle.split.keepPlace')}
            </Choice>
            {open.map(space => (
              <Choice key={space.id} chosen={spaceId === space.id} onChoose={() => setSpaceId(space.id)}>
                {space.name}
              </Choice>
            ))}
            <Choice chosen={spaceId === null} onChoose={() => setSpaceId(null)}>
              {t('grow.noFixedPlace')}
            </Choice>
          </Choices>
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
              { onSuccess: () => onClose() },
            );
          }}
        >
          {split.isPending ? t('grow.lifecycle.saving') : t('grow.lifecycle.split.submit', { count: chosen.length })}
        </button>
      </div>
    </Sheet>
  );
}
