import type { GrowthStage } from '@fg2/shared-types/v1';
import { climatePreset, GERMINATION_TOO_HUMID, type ClimatePreset } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { useTranslation } from 'react-i18next';
import { serverNow } from '@/api/clock';
import { germinates } from '@/ui/climate-hardware';
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
 * question beside it: leave the targets as they are (and say what they are), or
 * put the tent on one of the climates of the stage - the very names the chips
 * under Steuerung carry, from the same list - and say what that sets. Nothing
 * is chosen for the grower: leaving them is where it starts, and its line says
 * the light stays where it is.
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
 * is asked under the note, as everywhere germination is set: what the device
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

  const options = [null, ...presetsOf(stage)].map(preset => ({ stage, preset }));
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

  const line = (): string => {
    if (chosen && stage === 'germination')
      return t('climatePick.setsGermination', {
        temperature: targetFigure(chosen.nightTemperature, 'temperature'),
        humidity: targetFigure(chosen.nightHumidity, 'humidity'),
      });
    if (chosen) return t(darkOf(chosen, preset) ? 'climatePick.setsDark' : 'climatePick.sets', { figures: summary(t, chosen, preset, offset) });
    // Drying keeps no day and no light: what stays is the night it holds round the clock.
    if (startsDrying) {
      return t('climatePick.keepsDrying', {
        temperature: targetFigure(now.nightTemperature, 'temperature'),
        humidity: targetFigure(now.nightHumidity, 'humidity'),
      });
    }
    if (stage === 'germination' && germinates(controller)) {
      return t('climatePick.keepsGermination', { temperature: targetFigure(now.nightTemperature, 'temperature') });
    }
    const keeps = t('climatePick.keeps', { figures: summary(t, back, null, offset) });
    return stage === 'germination' ? `${keeps} ${t('climatePick.staysLit')}` : keeps;
  };

  return (
    <Block label={t('climatePick.label')} help="phasePreset">
      <Choices label={t('climatePick.label')}>
        <Choice chosen={!value.climate} onChoose={() => onChange(KEEP_CLIMATE)}>
          {t('climatePick.keep')}
        </Choice>
        {options.map(option => (
          <Choice
            key={option.preset ?? ''}
            chosen={value.climate && value.preset === option.preset}
            onChoose={() => onChange({ climate: true, preset: option.preset })}
          >
            {climateChoiceName(t, option)}
          </Choice>
        ))}
      </Choices>
      <p className={ui.note} role="status">
        {line()} {/* The stage decides the drying spell whatever is chosen here: entering drying dries, leaving it ends it. */}
        {startsDrying && chosen ? `${t('climatePick.dries')} ` : null}
        {stage !== 'drying' && controller.control?.drying ? `${t('climatePick.endsDrying')} ` : null}
        {/* Any other stage ends germination, and the light comes back. */}
        {endsGermination ? `${t('climatePick.endsGermination')} ` : null}
        {alarmsLine(t, stage, value.climate || germinates(controller), choices.warnTooHumid)}
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

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * What the phase does to the alarms its stage binds. Germination watches the
 * one temperature it holds in the dark, and its "too humid" line rests unless
 * the grower asked to be warned; entered without its climate beside a device
 * that keeps its light, it leaves the alarms that light is watched by, as the
 * server does.
 */
const alarmsLine = (t: Translate, stage: GrowthStage, dark: boolean, warns: boolean): string =>
  stage !== 'germination'
    ? t('climatePick.alarms')
    : dark
      ? t('climatePick.alarmsGermination', {
          line: GERMINATION_TOO_HUMID,
          humid: t(warns ? 'climatePick.humidWarns' : 'climatePick.humidRests'),
        })
      : t('climatePick.alarmsKept');

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
