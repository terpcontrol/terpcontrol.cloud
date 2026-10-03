/**
 * What each growth stage asks of a tent: the one table of the figures a climate
 * preset writes.
 *
 * It is shared rather than the server's alone because two things read it. The
 * server writes it to a controller when a stage is applied, and the manual
 * targets page prefills its sliders from it before a person adjusts anything -
 * and a client holding a copy of these numbers would be a second answer to
 * what the tent is being put on. Like `VALUE_AGE`, it carries no schema, so a
 * client imports this module on its own without pulling zod in.
 *
 * The figures are the ones the phase tiles have always written, and they are
 * deliberately conservative: they are what a beginner's tent is safe at rather
 * than what a competition is won with. The reasoning per row is kept with the
 * company documents.
 *
 * `stage` is the botanical fact and is the key; a preset refines one stage into
 * the step the screens draw - "Late flower" is `flowering` with the preset
 * `late_flowering`, and the two `autoflower` rows are veg and flower kept under
 * a long day, because an autoflower never gets the 12/12 flip that tells a
 * photoperiod plant to bloom. A preset this table has never heard of falls back
 * to its stage, and a stage with no row - curing - writes nothing at all.
 *
 * What is *not* here is as deliberate: the heating and dehumidifying
 * behaviour, the fans and the dimming ramps are what the hardware is tuned to
 * and survive a phase change. A preset is a target climate, not a decision
 * about the machine - except where the stage is one of the firmware's own
 * modes: drying dries, and germination germinates in the dark (`breed`), which
 * the server decides from the stage rather than from this table.
 *
 * Germination is the one row that holds less than a whole climate. The dark
 * mode holds the night's temperature round the clock, with the lamp off, no
 * CO2 and the humidity left to itself, so the row is that one temperature and
 * nothing else: every figure it leaves out stays as it is, for the seedling
 * climate that follows.
 *
 * The alarm bands at the end are derived from the same rows, so that what a
 * stage watches for cannot drift from what it asks for.
 */

import type { z } from 'zod';
import type { growthStage } from './common.js';

type GrowthStage = z.infer<typeof growthStage>;

/** A figure that is null is one the stage does not hold, and it is left as it is. */
export interface ClimatePreset {
  /** Null where the stage knows no day: germination holds its one temperature in the night's place. */
  dayTemperature: number | null;
  /** What every climate holds: drying and germination hold it round the clock. */
  nightTemperature: number;
  /** Null where the humidity is not held: germination lets it be. */
  dayHumidity: number | null;
  nightHumidity: number | null;
  /** How long the light is on, in hours. Null leaves the photoperiod where it is, which is what a stage kept dark does. */
  lightHours: number | null;
  /** Per cent of the light's own maximum. Zero is a stage that is kept dark; null leaves it for when the light comes back. */
  lightLimit: number | null;
  /** Parts per million. The firmware forces it to zero where no CO2 sensor is fitted, so a tent without one opens no valve. */
  co2: number | null;
}

/** What outdoor air holds: the target a stage that does not enrich is written with. */
export const AMBIENT_CO2 = 400;

/**
 * What seeds germinate at in the dark, held round the clock. Seeds sprout
 * fastest between about 22 and 26 °C: colder, they take days longer and rot
 * more often; warmer, the medium dries out and damping-off sets in. 24 °C is
 * the middle of that and the day temperature of the seedling climate that
 * follows, so the step out of the dark brings the light without a change of
 * warmth.
 */
export const GERMINATION_TEMPERATURE = 24;

/** The presets that refine a stage, by the stage they refine. The stage on its own is always an option and is not one of them. */
export const PRESETS_OF_STAGE: Readonly<Partial<Record<GrowthStage, readonly string[]>>> = {
  vegetative: ['autoflower'],
  flowering: ['late_flowering', 'autoflower'],
};

const PRESETS: Readonly<Record<string, ClimatePreset>> = {
  germination: {
    dayTemperature: null,
    nightTemperature: GERMINATION_TEMPERATURE,
    dayHumidity: null,
    nightHumidity: null,
    lightHours: null,
    lightLimit: null,
    co2: null,
  },
  seedling: { dayTemperature: 24, nightTemperature: 21, dayHumidity: 70, nightHumidity: 65, lightHours: 18, lightLimit: 40, co2: AMBIENT_CO2 },
  vegetative: { dayTemperature: 26, nightTemperature: 22, dayHumidity: 62, nightHumidity: 58, lightHours: 18, lightLimit: 80, co2: 900 },
  'vegetative:autoflower': { dayTemperature: 26, nightTemperature: 22, dayHumidity: 62, nightHumidity: 58, lightHours: 20, lightLimit: 80, co2: 900 },
  flowering: { dayTemperature: 25, nightTemperature: 20, dayHumidity: 50, nightHumidity: 50, lightHours: 12, lightLimit: 100, co2: 1000 },
  'flowering:late_flowering': {
    dayTemperature: 24,
    nightTemperature: 18,
    dayHumidity: 45,
    nightHumidity: 45,
    lightHours: 12,
    lightLimit: 100,
    co2: AMBIENT_CO2,
  },
  'flowering:autoflower': { dayTemperature: 25, nightTemperature: 20, dayHumidity: 50, nightHumidity: 50, lightHours: 18, lightLimit: 100, co2: 1000 },
  drying: { dayTemperature: 18, nightTemperature: 18, dayHumidity: 58, nightHumidity: 58, lightHours: null, lightLimit: 0, co2: AMBIENT_CO2 },
};

/** The stages that have a climate at all, in the order a grow passes through them. */
export const STAGES_WITH_CLIMATE: readonly GrowthStage[] = ['germination', 'seedling', 'vegetative', 'flowering', 'drying'];

/** The row for a stage and the preset on top of it, falling back to the stage's own; null for a stage with none. */
export const climatePreset = (stage: GrowthStage, preset: string | null): ClimatePreset | null =>
  (preset === null ? null : PRESETS[`${stage}:${preset}`]) ?? PRESETS[stage] ?? null;

/* ------------------------------------------------------------ alarm bands */

/**
 * One alarm threshold a stage binds, derived from its climate row so that the
 * rules a tent is watched by move with the stage the way its targets do.
 *
 * `key` is what a rule written from a band is found by again when the next
 * stage moves it, whatever it has been renamed to since. The watch is the
 * contract's own `ReadingWatch`, so the server stores it as it is.
 */
export interface StageAlarmBand {
  key: 'too_hot' | 'too_humid' | 'too_cold' | 'co2_high';
  watch: { kind: 'reading'; metric: 'temperature' | 'humidity' | 'co2'; upper: number | null; lower: number | null };
  forSeconds: number;
  severity: 'critical' | 'warning';
}

/**
 * Above this, enriched air is wasted gas and most likely a valve that has stuck
 * open. It is the same in every stage because it is about the valve, not the
 * plants; the firmware forces the target to zero where no sensor is fitted, so
 * the rule can only ever trip on a tent that measures it.
 */
export const CO2_ALARM_PPM = 1500;

const MINUTE = 60;

/**
 * The rules a stage implies, or null for a stage with no climate: curing
 * happens in a jar, and a rule watching a flowering band there is noise.
 * Germination holds no humidity, so its "too humid" is not ten points over a
 * target but the line where germination itself goes wrong
 * (`GERMINATION_TOO_HUMID`), and it rests unless the grower asks to be warned
 * (`restsInGermination`).
 *
 * Each margin is what tells a failure from weather. Five degrees over the day
 * target is a cooler that has failed rather than a warm afternoon, and it is
 * critical because heat stress sets in within the hour. Ten points of humidity
 * over the higher of the two targets is where mould starts, and it is given
 * twenty minutes because a watering or a door opened for a look pushes the
 * reading up for a while. Four degrees under the night target is a heater that
 * has given up, and at night nobody is looking. Like the climate table these
 * come from, the figures are deliberately conservative: they are the bands a
 * beginner's tent is safe inside, and a grower who knows better moves them on
 * the rule.
 */
export const stageAlarmBands = (stage: GrowthStage, preset: string | null): StageAlarmBand[] | null => {
  const climate = climatePreset(stage, preset);
  if (!climate) return null;

  const warmest = climate.dayTemperature ?? climate.nightTemperature;
  const humidities = [climate.dayHumidity, climate.nightHumidity].filter((value): value is number => value !== null);
  const tooHumid = humidities.length > 0 ? Math.max(...humidities) + 10 : stage === 'germination' ? GERMINATION_TOO_HUMID : null;
  const bands: (StageAlarmBand | null)[] = [
    { key: 'too_hot', watch: reading('temperature', warmest + 5, null), forSeconds: 10 * MINUTE, severity: 'critical' },
    tooHumid === null ? null : { key: 'too_humid', watch: reading('humidity', tooHumid, null), forSeconds: 20 * MINUTE, severity: 'warning' },
    { key: 'too_cold', watch: reading('temperature', null, climate.nightTemperature - 4), forSeconds: 15 * MINUTE, severity: 'critical' },
    { key: 'co2_high', watch: reading('co2', CO2_ALARM_PPM, null), forSeconds: 10 * MINUTE, severity: 'warning' },
  ];
  return bands.filter((band): band is StageAlarmBand => band !== null);
};

const reading = (metric: StageAlarmBand['watch']['metric'], upper: number | null, lower: number | null): StageAlarmBand['watch'] => ({
  kind: 'reading',
  metric,
  upper,
  lower,
});

/* ----------------------------------------------------- germination choices */

/**
 * Germination's "too humid": air wetter than this for twenty minutes in the
 * dark. Seeds sprout well anywhere from about 70 to 90 % - a germination box is
 * meant to be humid - and above it water stands on the medium and on the tray,
 * which is where mould and damping-off begin. Germination holds no humidity of
 * its own, so this is the line itself rather than ten points over a target.
 */
export const GERMINATION_TOO_HUMID = 90;

/** What a device does about the humidity while it germinates, where nobody has said (`GerminationChoices` in the contract). */
export interface GerminationChoiceValues {
  warnTooHumid: boolean;
  humidifierHolds: boolean;
}

/**
 * What holds where the grower has not chosen, which is also what every device
 * did before there was a choice, so that no tent changes by itself:
 *
 * - The stage's "too humid" rests. Seeds are kept moist on purpose, a
 *   germination box reads far above any band meant for leaves, and an alarm
 *   that goes off every night of a germination teaches the grower to stop
 *   reading alarms.
 * - A humidifier socket goes on holding the night's humidity. Dry air is what
 *   fails a germination - the medium dries out and the seed coat hardens - and
 *   a humidifier only ever adds moisture up to its target, so it cannot make
 *   the box too wet. It is also what the firmware has always done in the dark.
 */
export const GERMINATION_CHOICES: Readonly<GerminationChoiceValues> = { warnTooHumid: false, humidifierHolds: true };

/**
 * The choices a device keeps, or what holds where it keeps none; a choice it
 * does not state is the default's. A device keeps them for one germination:
 * they go back to the defaults when it ends, so a choice made for one batch of
 * seeds is not carried months later into the next by a way into germination
 * that does not ask (the device's own menu, a plan step written before steps
 * could say).
 */
export const germinationChoicesOf = (kept: Partial<GerminationChoiceValues> | null | undefined): GerminationChoiceValues => ({
  warnTooHumid: typeof kept?.warnTooHumid === 'boolean' ? kept.warnTooHumid : GERMINATION_CHOICES.warnTooHumid,
  humidifierHolds: typeof kept?.humidifierHolds === 'boolean' ? kept.humidifierHolds : GERMINATION_CHOICES.humidifierHolds,
});

/** As much of a watch as says what it is about: the contract's `AlarmWatch`, read without the rest of the contract. */
interface WatchShape {
  kind: string;
  metric?: string;
  upper?: number | null;
  lower?: number | null;
}

/** As much of a rule as says whose it is and what it watches: the contract's `AlarmRule`. */
interface RuleShape<W extends WatchShape = WatchShape> {
  origin: string;
  watch: W;
}

/**
 * Whether a rule watches the humidity from above and from nowhere else. A rule
 * that keeps the humidity inside a band from both sides watches for dry air as
 * well.
 */
export const watchesTooHumid = (watch: WatchShape): boolean =>
  watch.kind === 'reading' && watch.metric === 'humidity' && typeof watch.upper === 'number' && (watch.lower ?? null) === null;

/**
 * Whether a rule is the stage's "too humid": the band a stage wrote (`preset`)
 * on the humidity from above. That is the one rule germination's choice is
 * about (owner's decision G2: "whether the stage's 'Zu feucht' alarm stays
 * on"). A rule a person wrote - the one-tap template's included - is theirs,
 * set for the box they know, and watches through germination like every other.
 */
export const isStageTooHumid = (rule: RuleShape): boolean => rule.origin === 'preset' && watchesTooHumid(rule.watch);

/**
 * Whether a rule rests now: its device germinates in the dark (`breed`), the
 * grower did not ask to be warned, and it is the stage's "too humid". It is not
 * switched off - what a person set on it stays - and it watches again the
 * moment germination ends or the grower asks to be warned. The alarm engine
 * decides by this, and the screens say it by the same rule.
 */
export const restsInGermination = (rule: RuleShape, workmode: unknown, kept: Partial<GerminationChoiceValues> | null | undefined): boolean =>
  workmode === 'breed' && !germinationChoicesOf(kept).warnTooHumid && isStageTooHumid(rule);

/**
 * What a rule watches while its device is where it is now. The stage's "too
 * humid" watches germination's own line (`GERMINATION_TOO_HUMID`) while the
 * device germinates, whatever stage wrote its band: germination is set from
 * Steuerung, the operating mode or a plan as often as by a phase, and the band
 * of the stage before - ten points over a leafy plant's humidity - is one a
 * germination box stands above all night. Once germination ends the rule's own
 * band holds again, unmoved, so nothing has to be put back. Every other rule
 * watches what it says.
 */
export const watchNow = <W extends WatchShape>(rule: RuleShape<W>, workmode: unknown): W =>
  workmode === 'breed' && isStageTooHumid(rule) ? { ...rule.watch, upper: GERMINATION_TOO_HUMID } : rule.watch;
