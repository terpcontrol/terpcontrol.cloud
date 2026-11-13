import type { Device, GerminationChoices, GrowthStage, PhaseCreate } from '@fg2/shared-types/v1';
import type { ClimatePreset } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { useTranslation } from 'react-i18next';
import { serverNow } from '@/api/clock';
import type { Translate } from '@/i18n/i18n';
import { useLead } from '@/screens/control/lead';
import { scheduleTitle } from '@/screens/control/targets/schedule-words';
import { draftOf } from '@/screens/control/targets/targets-draft';
import { germinates, statesTargets } from '@/ui/climate-hardware';
import { writesClimate } from '@/ui/presets';
import { targetFigure } from '@/ui/units';
import { offsetOf } from '@/ui/wall-clock';
import { useZone } from '@/ui/zone';

/** What a phase does to the climate where its plants stand: nothing, or one climate of the one list. */
export interface PhaseClimate {
  /** Whether the controllers are put on the stage's climate as the phase is written. */
  climate: boolean;
  /** Which refinement of the stage, where one was chosen; null is the stage's own climate. */
  preset: string | null;
  /** What germination is to do about the humidity, where the sheet changed it; the device's own stands otherwise. */
  germination?: Partial<GerminationChoices>;
}

export const KEEP_CLIMATE: PhaseClimate = { climate: false, preset: null };

/**
 * What the request says about it: nothing at all where the climate is kept, so
 * an older server reads it the same way. The choices of germination go with
 * its climate alone, which is the one that puts a device into germination.
 */
export const climateRequest = (pick: PhaseClimate, stage: GrowthStage): Pick<PhaseCreate, 'preset' | 'climate' | 'germinationChoices'> => {
  if (!pick.climate) return { preset: null };
  const choices = stage === 'germination' && pick.germination && Object.keys(pick.germination).length > 0 ? pick.germination : null;
  return { preset: pick.preset, climate: true, ...(choices ? { germinationChoices: choices } : {}) };
};

/**
 * The device standing in a place that holds targets a climate could be written
 * to, or null: the place's climate as Steuerung reads it (`useLead`), so a form
 * that sets a climate asks about the device the climate preset is taken on -
 * its humidifier socket, what it does in germination, the stage it is on.
 * Until the place has said which that is (`known`), the first device there
 * that states targets.
 */
export const usePlaceClimate = (spaceId: string | null): { controller: Device | null; known: boolean } => {
  const { devices, overview, lead } = useLead(spaceId);
  const holds = (device: Device | null): device is Device => !!device?.configuration && statesTargets(device.configuration);
  const controller = spaceId === null ? null : holds(lead) ? lead : (devices.items.find(holds) ?? null);
  // A place whose overview could not be read is answered by the devices alone.
  return { controller, known: !devices.isPending && !overview.isPending };
};

export const usePlaceController = (spaceId: string | null): Device | null => usePlaceClimate(spaceId).controller;

/**
 * What a phase sheet starts on: the targets as they are - nothing is chosen for
 * the grower - except where the device germinates and the stage is another
 * with a climate. The light comes back with that stage, and its own climate is
 * the one it is owed.
 */
export const defaultPick = (stage: GrowthStage, controller: Device | null): PhaseClimate =>
  stage !== 'germination' && writesClimate(stage) && germinates(controller) ? { climate: true, preset: null } : KEEP_CLIMATE;

/** What a sheet says a device holds, in the figures of a targets draft. */
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

/** What a device in the dark holds: the night's figures round the clock, and no light. */
export const darkFigures = (t: Translate, temperature: number, humidity: number): string =>
  t('climatePick.dark', { day: targetFigure(temperature, 'temperature'), humidity: targetFigure(humidity, 'humidity') });

/** A work mode of the device's own, which a phase entered as a record leaves running and a phase taken back as well. */
export type OwnMode = 'drying' | 'germination';

/**
 * What a device holds now, in the figures the phase sheet says them in, and
 * the work mode of its own it runs: the dark of a drying room or of a
 * germination is the night's figures round the clock. It is what a phase left
 * alone goes on holding, and what taking a phase back leaves the tent on.
 */
export const heldNow = (t: Translate, device: Device, offset: number): { figures: string; mode: OwnMode | null } | null => {
  if (!device.configuration) return null;
  const now = draftOf(device.configuration);
  const mode = device.control?.drying ? 'drying' : germinates(device) ? 'germination' : null;
  return { mode, figures: mode ? darkFigures(t, now.nightTemperature, now.nightHumidity) : figuresSaid(t, now, null, offset) };
};

/** `heldNow` of the device that holds a place's climate, or null where nothing there states one. */
export const useHeldNow = (spaceId: string | null) => {
  const { t } = useTranslation();
  const zone = useZone();
  const controller = usePlaceController(spaceId);
  return controller ? heldNow(t, controller, offsetOf(serverNow(), zone)) : null;
};

/** A climate kept dark: a drying room's, which leaves the light alone, or one with the lamp at nothing. */
const darkOf = (figures: Figures, preset: ClimatePreset | null): boolean => preset?.lightHours === null || figures.lightLimit === 0;

/**
 * "Licht an 08:00–02:00 · 18 Std · Tag 25 °C · Nacht 20 °C · 50 %", or the
 * dark of a drying room. The window is said whole: a preset of eighteen hours
 * from the device's eight in the morning burns until two at night, which "18
 * Std" alone never told anybody.
 */
export const figuresSaid = (t: Translate, figures: Figures, preset: ClimatePreset | null, offset: number): string =>
  t(darkOf(figures, preset) ? 'climatePick.dark' : 'climatePick.figures', {
    light: scheduleTitle(t, { lightsOn: figures.lightsOn, lightHours: figures.lightHours }, offset),
    day: targetFigure(figures.dayTemperature, 'temperature'),
    night: targetFigure(figures.nightTemperature, 'temperature'),
    humidity: targetFigure(figures.dayHumidity, 'humidity'),
  });
