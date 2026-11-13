import type { GrowthStage } from '@fg2/shared-types/v1';
import { climatePreset } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { serverNow } from '@/api/clock';
import { Facts } from '@/ui/Facts';
import { factsOf } from '@/ui/fact-text';
import { climateChoiceName, presetsOf, writesClimate } from '@/ui/presets';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { offsetOf } from '@/ui/wall-clock';
import { useZone } from '@/ui/zone';
import { draftOf, prefilled } from '../control/targets/targets-draft';
import { GerminationChoices } from '../control/germination/GerminationChoices';
import { choicesOf, useHumidifier } from '../control/germination/germination-choices';
import { darkFigures, figuresSaid, heldNow, KEEP_CLIMATE, usePlaceController, type PhaseClimate } from './phase-climate';

/**
 * Whether moving the grow into a stage also moves the tent's climate - asked
 * every time, with both answers spelled out.
 *
 * Moving into flower is the moment a grower expects the light to go to twelve
 * hours, and there were four ways to say "now flower" that did four different
 * things: the diary's phase moved the stage and left the light at eighteen
 * hours without a word. So wherever a phase is entered, the climate is the
 * question beside it: leave the targets as they are, or put the tent on one of
 * the climates of the stage - the very names the chips under Steuerung carry,
 * from the same list. Under the choice stands what the devices then hold, in
 * figures and no sentence: what the choices mean, and what a stage does to the
 * alarms, is behind the help beside the label. Nothing is chosen for the
 * grower: leaving them is where it starts.
 *
 * It is not asked where nothing could take a climate: a grow standing nowhere,
 * a place with no controller, or a stage that has none.
 *
 * Leaving them writes no device, whatever the stage: the phase alone is a
 * record. So the device goes dark only where "Keimung · dunkel" or drying's
 * climate is chosen here, and out of either the light comes back only with
 * the next stage's climate - which the sheet offers first where the device
 * germinates (`defaultPick`). Under "Lassen, wie sie sind" stands what the
 * device holds and goes on holding, the dark of a drying room included.
 *
 * Where "Keimung · dunkel" is chosen, what germination does about the humidity
 * is asked under the figures, as everywhere germination is set: what the device
 * keeps stands until a switch is moved here, and only what was moved is sent.
 */
export function ClimatePick({
  stage,
  spaceId,
  value,
  onChange,
}: {
  stage: GrowthStage;
  spaceId: string | null;
  value: PhaseClimate;
  onChange: (value: PhaseClimate) => void;
}) {
  const { t } = useTranslation();
  const zone = useZone();
  const controller = usePlaceController(spaceId);
  const humidifier = useHumidifier(controller);

  if (!controller?.configuration) return null;
  if (!writesClimate(stage)) return <p className={ui.note}>{t('climatePick.noClimate', { stage: t(`home.stage.${stage}`) })}</p>;

  const now = draftOf(controller.configuration);
  const choices = { ...choicesOf(controller), ...(value.germination ?? {}) };
  const preset = value.climate ? climatePreset(stage, value.preset) : null;
  // A preset sets how long the light is on, never when it comes on: the window
  // it makes starts at the device's hour, and a figure it leaves out stays.
  const chosen = preset ? prefilled(now, preset) : null;
  const offset = offsetOf(serverNow(), zone);

  // What the devices hold once the phase is written, in figures: the chosen climate, germination's being dark, or -
  // left as they are - what they hold now (`heldNow`).
  const after = (): string => {
    if (chosen && stage === 'germination') return darkFigures(t, chosen.nightTemperature, chosen.nightHumidity);
    if (chosen) return figuresSaid(t, chosen, preset, offset);
    return heldNow(t, controller, offset)?.figures ?? figuresSaid(t, now, null, offset);
  };

  return (
    <Block label={t('climatePick.label')} help="phasePreset">
      <StageClimates
        label={t('climatePick.label')}
        stage={stage}
        chosen={value.climate ? value.preset : undefined}
        onPick={preset => onChange({ climate: true, preset })}
      >
        <Choice chosen={!value.climate} onChoose={() => onChange(KEEP_CLIMATE)}>
          {t('climatePick.keep')}
        </Choice>
      </StageClimates>
      {/* The answer in figures, and nothing explained: what the choices mean is behind the help beside the label. */}
      <p className={ui.note} role="status">
        <Facts facts={factsOf(t(chosen ? 'climatePick.sets' : 'climatePick.keeps', { figures: after() }))} />
      </p>
      {/* The climate that puts the device into germination asks what it does about the humidity. */}
      {stage === 'germination' && value.climate ? (
        <GerminationChoices
          value={choices}
          onChange={change => onChange({ ...value, germination: { ...value.germination, ...change } })}
          humidifier={humidifier}
          humidity={chosen?.nightHumidity ?? now.nightHumidity}
        />
      ) : null}
    </Block>
  );
}

/**
 * The climates of one stage as chips: the stage's own and what refines it, under the names Steuerung's chips carry
 * ("Blüte", "Späte Blüte", "Auto · Blüte"). It is the one row wherever a phase names its climate: asked beside a
 * phase (above, behind the answer that leaves the targets alone), where a phase is corrected and where plants are
 * split off into one. `chosen` is null for the stage's own climate. A stage nothing refines has nothing to choose
 * between, so by itself the row is not drawn for it.
 */
export function StageClimates(props: {
  label: string;
  stage: GrowthStage;
  chosen: string | null | undefined;
  onPick: (preset: string | null) => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  if (!props.children && presetsOf(props.stage).length === 0) return null;

  return (
    <Choices label={props.label}>
      {props.children}
      {[null, ...presetsOf(props.stage)].map(preset => (
        <Choice key={preset ?? ''} chosen={props.chosen === preset} onChoose={() => props.onPick(preset)}>
          {climateChoiceName(t, { stage: props.stage, preset })}
        </Choice>
      ))}
    </Choices>
  );
}
