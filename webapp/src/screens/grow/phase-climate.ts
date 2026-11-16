import type { Device, GerminationChoices, GrowListItem, GrowthStage, Phase, PhaseCreate } from '@fg2/shared-types/v1';
import type { ClimatePreset } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { OWN_CLIMATE_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { useTranslation } from 'react-i18next';
import { serverNow } from '@/api/clock';
import { readRulesClimate } from '@/api/alarm-rules';
import { readConfiguration, useSaveConfiguration } from '@/api/devices';
import { useGrows } from '@/api/grows';
import type { Translate } from '@/i18n/i18n';
import { useLead } from '@/screens/control/lead';
import { alsoIn } from '@/screens/space/movable-grows';
import { scheduleTitle } from '@/screens/control/targets/schedule-words';
import { draftOf, withDraft } from '@/screens/control/targets/targets-draft';
import { darkStage, germinates, statesTargets } from '@/ui/climate-hardware';
import type { Told } from '@/log/log-context';
import { climateChoiceName, writesClimate } from '@/ui/presets';
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
 * What a phase written from a sheet says it did, `phase` being the server's answer and `before` the grow's phases as
 * the sheet had them. A phase begun says so ("Blüte begonnen · Einzelgrow", with "Zielwerte gesetzt" where its climate
 * was written) and is taken back from the toast where that is all it did: one that also wrote the place's targets would
 * leave them standing. Where the grow already stood in that stage no phase began - the answer is the phase it stands
 * in, and taking that back would undo a phase nobody asked about: the climate written is all there is to say
 * ("Zielwerte gesetzt · Blüte"), and it is taken back as a preset taken under Steuerung is (`takeBack`).
 */
export const phaseTold = (
  t: Translate,
  {
    phase,
    before,
    stage,
    pick,
    name,
    withdraw,
    takeBack,
  }: {
    phase: Phase;
    before: readonly Phase[];
    stage: GrowthStage;
    pick: PhaseClimate;
    name: string;
    withdraw: (phaseId: string) => Promise<unknown>;
    /** The way back from the climate written (`usePlaceTakeBack`), where there is one. */
    takeBack?: (() => Promise<unknown>) | null;
  },
): Told => {
  if (before.some(one => one.id === phase.id)) {
    const climate = climateChoiceName(t, { stage, preset: pick.preset });
    const said = (pick.climate ? [t('log.targetsSet'), climate, name] : [climate, name, t('log.phaseKept')]).join(' · ');
    const label = said.charAt(0).toLocaleUpperCase() + said.slice(1);
    return pick.climate && takeBack ? { label, undo: takeBack, undone: t('log.asBefore', { what: t('targets.title') }) } : { label, undo: null };
  }
  const label = [t('home.card.enteredPhase', { stage: t(`home.stage.${stage}`) }), name, pick.climate ? t('log.targetsSet') : null]
    .filter(Boolean)
    .join(' · ');
  return pick.climate ? { label, undo: null } : { label, undo: () => withdraw(phase.id), undone: t('log.phaseBefore') };
};

/**
 * The way back from a climate written to a place, read before it is written: every device there that holds targets
 * gets the figures it held and the name it had, and the place's alarm thresholds the climate they followed (`bands`).
 * None for a climate of the dark, which begins or ends more than figures - as under Steuerung.
 */
export const usePlaceTakeBack = (spaceId: string | null): ((stage: GrowthStage) => Promise<(() => Promise<unknown>) | null>) => {
  const { devices } = useLead(spaceId);
  const save = useSaveConfiguration();
  return async stage => {
    const held = devices.items.filter(device => !!device.configuration && statesTargets(device.configuration));
    if (held.length === 0 || darkStage(stage) !== null || held.some(device => device.control?.drying || germinates(device))) return null;
    const bands = await readRulesClimate(held[0].id);
    return async () => {
      for (const device of held) {
        const current = (await readConfiguration(device.id)) ?? device.configuration!;
        await save.mutateAsync({
          deviceId: device.id,
          configuration: withDraft(current, draftOf(device.configuration!)),
          preset: device.control?.preset ?? undefined,
          bands,
        });
      }
    };
  };
};

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
export const usePlaceClimate = (spaceId: string | null): { controller: Device | null; awaiting: Device | null; known: boolean } => {
  const { devices, overview, lead } = useLead(spaceId);
  const holds = (device: Device | null): device is Device => !!device?.configuration && statesTargets(device.configuration);
  const controller = spaceId === null ? null : holds(lead) ? lead : (devices.items.find(holds) ?? null);
  // A controller or fridge module that has not sent its settings yet: a climate chosen now waits on it, and the
  // server puts it on that climate as they arrive (`awaitedClimate`).
  const awaiting =
    spaceId === null || controller !== null
      ? null
      : (devices.items.find(device => OWN_CLIMATE_TYPES.includes(device.type) && device.configuration === null) ?? null);
  // A place whose overview could not be read is answered by the devices alone.
  return { controller, awaiting, known: !devices.isPending && !overview.isPending };
};

export const usePlaceController = (spaceId: string | null): Device | null => usePlaceClimate(spaceId).controller;

/** The other grows standing where a phase's plants do: a climate written there is theirs as well. */
export const useGrowsBeside = (spaceId: string | null, growId: string | null): GrowListItem[] => {
  const grows = useGrows().data?.items;
  return spaceId === null ? [] : alsoIn(grows, spaceId, growId ?? undefined);
};

/**
 * What a phase sheet starts on: the targets as they are - nothing is chosen for
 * the grower - except where the device germinates and the stage is another
 * with a climate. The light comes back with that stage, and its own climate is
 * the one it is owed - unless another grow stands there (`beside`), whose
 * climate it is too.
 */
export const defaultPick = (stage: GrowthStage, controller: Device | null, beside = false): PhaseClimate =>
  !beside && stage !== 'germination' && writesClimate(stage) && germinates(controller) ? { climate: true, preset: null } : KEEP_CLIMATE;

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
 * "Licht an 08:00–02:00 · 18 Std · Tag 25 °C · 60 % · Nacht 20 °C · 55 %", or
 * the dark of a drying room. The window is said whole: a preset of eighteen
 * hours from the device's eight in the morning burns until two at night, which
 * "18 Std" alone never told anybody; and each half with its own humidity, which
 * one figure after the night's read as the night's.
 */
export const figuresSaid = (t: Translate, figures: Figures, preset: ClimatePreset | null, offset: number): string =>
  t(darkOf(figures, preset) ? 'climatePick.dark' : 'climatePick.figures', {
    light: scheduleTitle(t, { lightsOn: figures.lightsOn, lightHours: figures.lightHours }, offset),
    day: targetFigure(figures.dayTemperature, 'temperature'),
    night: targetFigure(figures.nightTemperature, 'temperature'),
    humidity: targetFigure(figures.dayHumidity, 'humidity'),
    dayHumidity: targetFigure(figures.dayHumidity, 'humidity'),
    nightHumidity: targetFigure(figures.nightHumidity, 'humidity'),
  });
