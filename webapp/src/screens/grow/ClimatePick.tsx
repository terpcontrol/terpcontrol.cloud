import type { GrowthStage } from '@fg2/shared-types/v1';
import { climatePreset } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { useTranslation } from 'react-i18next';
import { serverNow } from '@/api/clock';
import { useDevices } from '@/api/devices';
import { statesTargets } from '@/ui/climate-hardware';
import { climateChoiceName, presetsOf, writesClimate } from '@/ui/presets';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { useZone } from '@/ui/zone';
import { scheduleTitle } from '../control/targets/schedule-words';
import { draftOf, offsetOf } from '../control/targets/targets-draft';
import { targetFigure } from '../home/units';
import { KEEP_CLIMATE, type PhaseClimate } from './phase-climate';

interface Figures {
  /** When the light comes on, in seconds past midnight UTC: the device's, which no preset moves. */
  lightsOn: number;
  lightHours: number | null;
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
  const devices = useDevices();
  const controller =
    spaceId === null
      ? null
      : (devices.data?.items.find(device => device.spaceId === spaceId && device.configuration && statesTargets(device.configuration)) ?? null);

  if (!controller?.configuration) return null;
  if (!writesClimate(stage)) return <p className={ui.note}>{t('climatePick.noClimate', { stage: t(`home.stage.${stage}`) })}</p>;

  const options = [null, ...presetsOf(stage)].map(preset => ({ stage, preset }));
  const now = draftOf(controller.configuration);
  const preset = value.climate ? climatePreset(stage, value.preset) : null;
  // A preset sets how long the light is on, never when it comes on: the window it makes starts at the device's hour.
  const chosen = preset ? { ...preset, lightsOn: now.lightsOn } : null;
  const offset = offsetOf(serverNow(), zone);
  const startsDrying = stage === 'drying' && !controller.control?.drying;

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
        {chosen
          ? t(darkOf(chosen) ? 'climatePick.setsDark' : 'climatePick.sets', { figures: summary(t, chosen, offset) })
          : startsDrying
            ? // Drying keeps no day and no light: what stays is the night it holds round the clock.
              t('climatePick.keepsDrying', {
                temperature: targetFigure(now.nightTemperature, 'temperature'),
                humidity: targetFigure(now.nightHumidity, 'humidity'),
              })
            : t('climatePick.keeps', { figures: summary(t, now, offset) })}{' '}
        {/* The stage decides the drying spell whatever is chosen here: entering drying dries, leaving it ends it. */}
        {startsDrying && chosen ? `${t('climatePick.dries')} ` : null}
        {stage !== 'drying' && controller.control?.drying ? `${t('climatePick.endsDrying')} ` : null}
        {t('climatePick.alarms')}
      </p>
      {/* The grow's germination is a seedling's climate with light; a fridge has a dark mode of that name too. */}
      {stage === 'germination' && controller.type === 'fridge' ? <p className={ui.note}>{t('climatePick.germinationNote')}</p> : null}
    </Block>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * "Licht an 08:00–02:00 · 18 Std · Tag 25 °C · Nacht 20 °C · 50 %", or the
 * dark of a drying room. The window is said whole: a preset of eighteen hours
 * from the device's eight in the morning burns until two at night, which "18
 * Std" alone never told anybody.
 */
/** A climate kept dark: a drying room's, which leaves the light alone, or one with the lamp at nothing. */
const darkOf = (figures: Figures): boolean => figures.lightHours === null || figures.lightLimit === 0;

const summary = (t: Translate, figures: Figures, offset: number): string =>
  t(darkOf(figures) ? 'climatePick.dark' : 'climatePick.figures', {
    light: figures.lightHours === null ? '' : scheduleTitle(t, { lightsOn: figures.lightsOn, lightHours: figures.lightHours }, offset),
    day: targetFigure(figures.dayTemperature, 'temperature'),
    night: targetFigure(figures.nightTemperature, 'temperature'),
    humidity: targetFigure(figures.dayHumidity, 'humidity'),
  });
