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
 * mode holds the night round the clock, with the lamp off and no CO2: its
 * temperature, and its humidity for a humidifier socket to hold. So the row is
 * those two figures and nothing else: every figure it leaves out - the day, the
 * lamp, the light hours, the CO2 - stays as it is, for the seedling climate that
 * follows.
 *
 * The alarm bands at the end are derived from the same rows, so that what a
 * stage watches for cannot drift from what it asks for.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.watchNow = exports.restsInGermination = exports.isStageTooHumid = exports.watchesTooHumid = exports.germinationChoicesOf = exports.GERMINATION_CHOICES = exports.GERMINATION_TOO_HUMID = exports.stageAlarmBands = exports.CO2_ALARM_PPM = exports.climatePreset = exports.STAGES_WITH_CLIMATE = exports.PRESETS_OF_STAGE = exports.GERMINATION_HUMIDITY = exports.GERMINATION_TEMPERATURE = exports.AMBIENT_CO2 = void 0;
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
/**
 * The humidity germination brings with it, held through the dark by a
 * humidifier socket where the grower lets one hold it (owner's decision G3).
 * Seeds take up water to swell and push out the root, and they sprout well
 * anywhere from about 70 to 90 %: drier, the medium dries out at its surface
 * and the seed coat hardens; wetter, water stands on the medium and the tray.
 * 75 % is inside that with room on both sides - a humidifier switching on five
 * points under it never lets the box fall below 70 %, and it stays well clear of
 * the 90 % where "too humid" warns (`GERMINATION_TOO_HUMID`). The seedling
 * climate after it holds 65 to 70 %, so the step into the light is a small one.
 *
 * It is the night's humidity because that is the one the dark mode goes by: the
 * firmware knows no day in germination, and a humidifier socket follows the
 * night's figure there. Before germination the same figure told a dehumidifier
 * where to start drying a leafy plant's air - 50 % in flower - which is why it is
 * written whenever germination begins, by whatever way, rather than kept: held
 * by a humidifier in the dark, the flowering figure would leave the seeds dry.
 */
exports.GERMINATION_HUMIDITY = 75;
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
        nightHumidity: exports.GERMINATION_HUMIDITY,
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
 * Germination's "too humid" is not ten points over its humidity but the line
 * where germination itself goes wrong (`GERMINATION_TOO_HUMID`): its 75 % is
 * what a humidifier lifts dry air to, not a ceiling the box is kept under, and a
 * box that stands at 85 % is germinating well. It rests unless the grower asks
 * to be warned (`restsInGermination`).
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
    const tooHumid = stage === 'germination' ? exports.GERMINATION_TOO_HUMID : humidities.length > 0 ? Math.max(...humidities) + 10 : null;
    const bands = [
        { key: 'too_hot', watch: reading('temperature', warmest + 5, null), forSeconds: 10 * MINUTE, severity: 'critical' },
        tooHumid === null ? null : { key: 'too_humid', watch: reading('humidity', tooHumid, null), forSeconds: 20 * MINUTE, severity: 'warning' },
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
/* ----------------------------------------------------- germination choices */
/**
 * Germination's "too humid": air wetter than this for twenty minutes in the
 * dark. Seeds sprout well anywhere from about 70 to 90 % - a germination box is
 * meant to be humid - and above it water stands on the medium and on the tray,
 * which is where mould and damping-off begin. Germination's own humidity is
 * what a humidifier lifts the air to (`GERMINATION_HUMIDITY`), not a ceiling, so
 * this is the line itself rather than ten points over it.
 */
exports.GERMINATION_TOO_HUMID = 90;
/**
 * What holds where the grower has not chosen, which is also what every device
 * did before there was a choice, so that no tent changes by itself:
 *
 * - The stage's "too humid" rests. Seeds are kept moist on purpose, a
 *   germination box reads far above any band meant for leaves, and an alarm
 *   that goes off every night of a germination teaches the grower to stop
 *   reading alarms.
 * - A humidifier socket goes on holding the night's humidity, which germination
 *   sets to its own 75 % (`GERMINATION_HUMIDITY`). Dry air is what fails a
 *   germination - the medium dries out and the seed coat hardens - and a
 *   humidifier only ever adds moisture up to its target, so it cannot make the
 *   box too wet. It is also what the firmware has always done in the dark.
 */
exports.GERMINATION_CHOICES = { warnTooHumid: false, humidifierHolds: true };
/**
 * The choices a device keeps, or what holds where it keeps none; a choice it
 * does not state is the default's. A device keeps them for one germination:
 * they go back to the defaults when it ends, so a choice made for one batch of
 * seeds is not carried months later into the next by a way into germination
 * that does not ask (the device's own menu, a plan step written before steps
 * could say).
 */
const germinationChoicesOf = (kept) => ({
    warnTooHumid: typeof kept?.warnTooHumid === 'boolean' ? kept.warnTooHumid : exports.GERMINATION_CHOICES.warnTooHumid,
    humidifierHolds: typeof kept?.humidifierHolds === 'boolean' ? kept.humidifierHolds : exports.GERMINATION_CHOICES.humidifierHolds,
});
exports.germinationChoicesOf = germinationChoicesOf;
/**
 * Whether a rule watches the humidity from above and from nowhere else. A rule
 * that keeps the humidity inside a band from both sides watches for dry air as
 * well.
 */
const watchesTooHumid = (watch) => watch.kind === 'reading' && watch.metric === 'humidity' && typeof watch.upper === 'number' && (watch.lower ?? null) === null;
exports.watchesTooHumid = watchesTooHumid;
/**
 * Whether a rule is the stage's "too humid": the band a stage wrote (`preset`)
 * on the humidity from above. That is the one rule germination's choice is
 * about (owner's decision G2: "whether the stage's 'Zu feucht' alarm stays
 * on"). A rule a person wrote - the one-tap template's included - is theirs,
 * set for the box they know, and watches through germination like every other.
 */
const isStageTooHumid = (rule) => rule.origin === 'preset' && (0, exports.watchesTooHumid)(rule.watch);
exports.isStageTooHumid = isStageTooHumid;
/**
 * Whether a rule rests now: its device germinates in the dark (`breed`), the
 * grower did not ask to be warned, and it is the stage's "too humid". It is not
 * switched off - what a person set on it stays - and it watches again the
 * moment germination ends or the grower asks to be warned. The alarm engine
 * decides by this, and the screens say it by the same rule.
 */
const restsInGermination = (rule, workmode, kept) => workmode === 'breed' && !(0, exports.germinationChoicesOf)(kept).warnTooHumid && (0, exports.isStageTooHumid)(rule);
exports.restsInGermination = restsInGermination;
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
const watchNow = (rule, workmode) => workmode === 'breed' && (0, exports.isStageTooHumid)(rule) ? { ...rule.watch, upper: exports.GERMINATION_TOO_HUMID } : rule.watch;
exports.watchNow = watchNow;
