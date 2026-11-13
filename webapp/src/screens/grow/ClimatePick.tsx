import type { GrowthStage } from '@fg2/shared-types/v1';
import { climatePreset, type ClimatePreset } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { serverNow } from '@/api/clock';
import type { Translate } from '@/i18n/i18n';
import { germinates } from '@/ui/climate-hardware';
import { Facts } from '@/ui/Facts';
import { factsOf } from '@/ui/fact-text';
import { climateChoiceName, presetsOf, writesClimate } from '@/ui/presets';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { offsetOf } from '@/ui/wall-clock';
import { useZone } from '@/ui/zone';
import { scheduleTitle } from '../control/targets/schedule-words';
import { draftOf, prefilled } from '../control/targets/targets-draft';
import { targetFigure } from '@/ui/units';
import { GerminationChoices } from '../control/germination/GerminationChoices';
import { choicesOf, useHumidifier } from '../control/germination/germination-choices';
import { KEEP_CLIMATE, usePlaceController, type PhaseClimate } from './phase-climate';

interface Figures {
  /** When the light comes on, in seconds past midnight UTC: the device's, which no preset moves. */
  lightsOn: number;
  lightHours: number;
  lightLimit: number;
  dayTemperature: number;
  nightTemperature: number;
  dayHumidity: number;
  nightHumidity: number;
}

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
 * Germination is dark, so the device goes dark only where "Keimung · dunkel"
 * is chosen here: the phase alone is the record of seeds sprouting, wherever
 * they are. Out of germination it is the other way round - any other stage
 * brings the light back, with the stage's climate or with the targets from
 * before germination - and the sheet offers the stage's climate first there
 * (`defaultPick`).
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
  const startsDrying = stage === 'drying' && !controller.control?.drying;
  const endsGermination = stage !== 'germination' && germinates(controller);
  // What comes back where germination ends without a climate: the targets from before it, the night it wrote over included.
  const back = endsGermination ? { ...now, nightTemperature: controller.control?.afterGermination?.nightTemperature ?? now.nightTemperature } : now;

  const dark = (temperature: number, humidity: number): string =>
    t('climatePick.dark', { day: targetFigure(temperature, 'temperature'), humidity: targetFigure(humidity, 'humidity') });
  // What the devices hold once the phase is written, in figures. Drying is dark whatever is chosen here; germination
  // darkens only with its climate and stays dark where the device already germinates; any other stage brings the
  // light back to a device that does.
  const after = (): string => {
    if (chosen && stage === 'germination') return dark(chosen.nightTemperature, chosen.nightHumidity);
    if (chosen) return summary(t, chosen, preset, offset);
    if (startsDrying || (stage === 'germination' && germinates(controller))) return dark(now.nightTemperature, now.nightHumidity);
    return summary(t, back, null, offset);
  };
  const moves = chosen !== null || startsDrying || endsGermination || (stage !== 'drying' && controller.control?.drying === true);

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
        <Facts facts={factsOf(t(moves ? 'climatePick.sets' : 'climatePick.keeps', { figures: after() }))} />
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

/** A climate kept dark: a drying room's, which leaves the light alone, or one with the lamp at nothing. */
const darkOf = (figures: Figures, preset: ClimatePreset | null): boolean => preset?.lightHours === null || figures.lightLimit === 0;

/**
 * "Licht an 08:00–02:00 · 18 Std · Tag 25 °C · Nacht 20 °C · 50 %", or the
 * dark of a drying room. The window is said whole: a preset of eighteen hours
 * from the device's eight in the morning burns until two at night, which "18
 * Std" alone never told anybody.
 */
const summary = (t: Translate, figures: Figures, preset: ClimatePreset | null, offset: number): string =>
  t(darkOf(figures, preset) ? 'climatePick.dark' : 'climatePick.figures', {
    light: scheduleTitle(t, { lightsOn: figures.lightsOn, lightHours: figures.lightHours }, offset),
    day: targetFigure(figures.dayTemperature, 'temperature'),
    night: targetFigure(figures.nightTemperature, 'temperature'),
    humidity: targetFigure(figures.dayHumidity, 'humidity'),
  });
