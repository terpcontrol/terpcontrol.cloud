"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.stageAlarmBands = exports.CO2_ALARM_PPM = exports.climatePreset = exports.STAGES_WITH_CLIMATE = exports.PRESETS_OF_STAGE = exports.GERMINATION_TEMPERATURE = exports.AMBIENT_CO2 = void 0;
/** What outdoor air holds: the target a stage that does not enrich is written with. */
exports.AMBIENT_CO2 = 400;
/**
 * What seeds germinate at in the dark, held round the clock. Seeds sprout
 * fastest between about 22 and 26 °C: colder, they take days longer and rot
 * more often; warmer, the medium dries out and damping-off sets in. 24 °C is
 * the middle of that and the day temperature of the seedling climate that
 * follows, so the step out of the dark brings the light without a change of
 * warmth.
 */
exports.GERMINATION_TEMPERATURE = 24;
/** The presets that refine a stage, by the stage they refine. The stage on its own is always an option and is not one of them. */
exports.PRESETS_OF_STAGE = {
    vegetative: ['autoflower'],
    flowering: ['late_flowering', 'autoflower'],
};
const PRESETS = {
    germination: {
        dayTemperature: null,
        nightTemperature: exports.GERMINATION_TEMPERATURE,
        dayHumidity: null,
        nightHumidity: null,
        lightHours: null,
        lightLimit: null,
        co2: null,
    },
    seedling: { dayTemperature: 24, nightTemperature: 21, dayHumidity: 70, nightHumidity: 65, lightHours: 18, lightLimit: 40, co2: exports.AMBIENT_CO2 },
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
        co2: exports.AMBIENT_CO2,
    },
    'flowering:autoflower': { dayTemperature: 25, nightTemperature: 20, dayHumidity: 50, nightHumidity: 50, lightHours: 18, lightLimit: 100, co2: 1000 },
    drying: { dayTemperature: 18, nightTemperature: 18, dayHumidity: 58, nightHumidity: 58, lightHours: null, lightLimit: 0, co2: exports.AMBIENT_CO2 },
};
/** The stages that have a climate at all, in the order a grow passes through them. */
exports.STAGES_WITH_CLIMATE = ['germination', 'seedling', 'vegetative', 'flowering', 'drying'];
/** The row for a stage and the preset on top of it, falling back to the stage's own; null for a stage with none. */
const climatePreset = (stage, preset) => (preset === null ? null : PRESETS[`${stage}:${preset}`]) ?? PRESETS[stage] ?? null;
exports.climatePreset = climatePreset;
/**
 * Above this, enriched air is wasted gas and most likely a valve that has stuck
 * open. It is the same in every stage because it is about the valve, not the
 * plants; the firmware forces the target to zero where no sensor is fitted, so
 * the rule can only ever trip on a tent that measures it.
 */
exports.CO2_ALARM_PPM = 1500;
const MINUTE = 60;
/**
 * The rules a stage implies, or null for a stage with no climate: curing
 * happens in a jar, and a rule watching a flowering band there is noise.
 * Germination holds no humidity, so it implies no rule about one: seeds are
 * kept moist, and a sprouting tray reads far above any band meant for leaves.
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
const stageAlarmBands = (stage, preset) => {
    const climate = (0, exports.climatePreset)(stage, preset);
    if (!climate)
        return null;
    const warmest = climate.dayTemperature ?? climate.nightTemperature;
    const humidities = [climate.dayHumidity, climate.nightHumidity].filter((value) => value !== null);
    const bands = [
        { key: 'too_hot', watch: reading('temperature', warmest + 5, null), forSeconds: 10 * MINUTE, severity: 'critical' },
        humidities.length === 0
            ? null
            : { key: 'too_humid', watch: reading('humidity', Math.max(...humidities) + 10, null), forSeconds: 20 * MINUTE, severity: 'warning' },
        { key: 'too_cold', watch: reading('temperature', null, climate.nightTemperature - 4), forSeconds: 15 * MINUTE, severity: 'critical' },
        { key: 'co2_high', watch: reading('co2', exports.CO2_ALARM_PPM, null), forSeconds: 10 * MINUTE, severity: 'warning' },
    ];
    return bands.filter((band) => band !== null);
};
exports.stageAlarmBands = stageAlarmBands;
const reading = (metric, upper, lower) => ({
    kind: 'reading',
    metric,
    upper,
    lower,
});
