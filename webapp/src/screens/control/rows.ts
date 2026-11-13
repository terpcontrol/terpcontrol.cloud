import type { DateTime } from 'luxon';
import type { AlarmRule, Device, PendingSetting, Plan, SocketPage } from '@fg2/shared-types/v1';
import type { OutputLevel } from '@/api/devices';
import { configurationFieldsOf, workModesOf, type WorkMode } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import type { Translate } from '@/i18n/i18n';
import type { Held } from '@/screens/devices/HandHold';
import { isLightRole, lightOutputOf, percentLabel } from '@/screens/devices/lights';
import { forcedOf, socketName, socketState } from '@/screens/devices/socket-words';
import { rowsOf, type SocketRowModel } from '@/screens/devices/sockets';
import { planLineOf } from '@/screens/start/plan-line';
import { fieldValue } from '@/ui/advanced/field-values';
import { deviceLiveness, sinceLabel } from '@/ui/age';
import { climateLanding } from '@/ui/climate-hardware';
import { deviceName } from '@/ui/naming';
import { ruleTitle } from './alarms/rules';
import { MODE_PATHS, pendingField, pendingMode, savedWords } from './climate/figures';
import { fanFactsOf } from './devices/own-summary';
import { heldWords } from './held-light';
import { activeStep, isWaiting, readingAt } from './plan-clock';
import { pauseReasonOf } from './plan-labels';

/** What a row under Steuerung's climate says of the page behind it, in a few words; amber is for what needs a person. */
export interface RowLine {
  text: string;
  warn?: boolean;
}

/**
 * The one rule for a line that sums up a device. What it reported is dated
 * once it has gone quiet (`standOf`: "Stand 13:49 · Licht 80 %"). A setting is
 * what is stored and carries no date; one the silent device has not been
 * handed is said as that, in amber (`notTaken`), never behind a "Stand" at
 * which the device held another.
 */
export const standOf = (t: Translate, spoke: string | null, now: DateTime, zone: string | null): string | null =>
  spoke !== null && deviceLiveness(spoke, now) === 'offline' ? t('control.stand', { time: sinceLabel(spoke, now, zone) }) : null;

export const notTaken = (t: Translate, what: string, savedAt: string, now: DateTime, zone: string | null): string =>
  t('control.pending.stored', { what, saved: savedWords(t, savedAt, now, zone) });

/** Control switched off for a device that was not there to hear it and goes on regulating: the stored switch, else null. */
export const offNotTaken = (device: Device, pending: ReadonlyMap<string, PendingSetting>): PendingSetting | null => {
  const held = pending.get(MODE_PATHS[0]);
  return device.control?.running === false && held !== undefined && held.held !== 'off' ? held : null;
};

/** The work modes a person picks on Betriebsart: the ones no climate preset sets. Germination and drying follow the stage. */
export const modesOf = (device: Device): readonly WorkMode[] => workModesOf(device.type).filter(mode => mode !== 'germination' && mode !== 'drying');

/** Whether Betriebsart has anything to choose for a device: a second mode, or a fridge's energy saving. */
export const hasMode = (device: Device): boolean =>
  Boolean(device.control) && (modesOf(device).length > 1 || configurationFieldsOf(device.type).energySaving !== undefined);

/** "Normal", "Trocknung", "Keimung · dunkel": the mode the device runs. */
const modeWord = (t: Translate, device: Device): string =>
  device.control ? t(`operatingMode.${device.control.drying ? 'drying' : device.control.mode}`) : '';

/** "3 Regeln · alle ruhig", or which rule has raised; "1 von 7 Regeln an" where some are off - in amber when the offline rule is one of them. */
export const alarmsLine = (t: Translate, rules: AlarmRule[]): RowLine => {
  const on = rules.filter(rule => rule.enabled);
  const deaf = rules.some(rule => rule.origin === 'always' && !rule.enabled);
  if (on.length === 0) return { text: t('control.rows.alarmsNone'), warn: deaf };
  const raised = on.filter(rule => rule.state.triggered);
  const count =
    on.length < rules.length
      ? t('control.rows.alarmsOnOf', { on: on.length, total: rules.length })
      : t('control.rows.alarmsOn', { count: on.length });
  const state =
    raised.length === 0
      ? t('control.rows.alarmsCalm')
      : raised.length === 1
        ? t('control.rows.alarmRaised', { name: ruleTitle(t, raised[0]) })
        : t('control.rows.alarmsRaised', { count: raised.length });
  const off = deaf ? ` · ${t('control.rows.alarmOff', { name: t('alarms.offlineRule') })}` : '';

  return { text: `${count} · ${state}${off}`, warn: raised.length > 0 || deaf };
};

/** Whether a plan could set this device's climate as it runs: its document states targets, and an AIR fan at a fixed speed follows none. */
export const followsPlan = (device: Device): boolean =>
  climateLanding(device) !== 'nowhere' && !(device.type === 'fan' && fieldValue(device, 'fanMode') === 'fixed');

/**
 * "aus · Zielwerte stellst du von Hand" - the second half only while something `holds` targets - or where the plan
 * stands; in amber a step waiting for its word and a paused plan, with why.
 */
export const planLine = (t: Translate, plans: Plan[], now: DateTime, holds = true): RowLine => {
  const plan = plans.find(one => one.state.status === 'running') ?? plans.find(one => one.state.status === 'paused') ?? plans[0] ?? null;
  if (!plan) return { text: [t('control.rows.planOff'), holds ? t('control.rows.byHand') : null].filter(Boolean).join(' · ') };
  if (plan.state.status === 'paused') {
    const paused = t('control.rows.planPaused', { step: activeStep(plan)?.name ?? plan.name });
    return { text: [paused, pauseReasonOf(t, plan.state.pauseReason)].filter(Boolean).join(' · '), warn: true };
  }
  const going = planLineOf(t, plan, now);
  if (going === null) return { text: t('control.rows.planAtRest', { name: plan.name, status: t(`space.control.status.${plan.state.status}`) }) };

  return { text: going, warn: isWaiting(plan, readingAt(plan.state, now)) };
};

/** What a device drives beside its climate: its own lamp, a fridge's fans, an AIR fan's speed, its smart sockets. */
interface Outputs {
  device: Device;
  light: boolean;
  /** What the lamp last ran at, where it reported. */
  level: OutputLevel | null;
  fans: boolean;
  speed: boolean;
  sockets: SocketRowModel[];
}

/** `carded`: the device's own card stands on the page that asks, which is all an AIR fan's speed is - Ausgänge would only say it again. */
export const outputsOf = (device: Device, table: SocketPage | undefined, level: OutputLevel | null, carded = false): Outputs => ({
  device,
  light: table !== undefined && lightOutputOf(device, table.capabilities, level) !== null,
  level,
  fans: device.type === 'fridge' && device.configuration !== null,
  speed: device.type === 'fan' && device.configuration !== null && !carded,
  sockets: rowsOf(table?.items ?? []),
});

export const hasOutputs = (outputs: Outputs): boolean => outputs.light || outputs.fans || outputs.speed || outputs.sockets.length > 0;

/** "Abluft an", "Pumpe aus gehalten, noch 15 Min": a socket by its name and what it does. */
const socketFact = (t: Translate, row: SocketRowModel, now: DateTime): string =>
  `${socketName(t, row)} ${forcedOf(row) || row.state === 'unknown' ? socketState(t, row, now).replace(' · ', ', ') : t(`devices.socket.${row.state}`)}`;

/** The settings an AIR fan's facts are, in the order `fanFactsOf` says them. */
const FAN_SETTINGS = ['fanMode', 'fixedDay', 'fixedNight'];

/**
 * "Licht 80 % · Abluft an · Befeuchter aus · alle Auto": each output by the
 * rule above, and in amber what is held by hand. A further device's outputs
 * are led by its name. "alle Auto" is said only of a list made of sockets: a
 * lamp reports no hold, so nothing is claimed of one.
 */
export const outputsLine = (
  t: Translate,
  all: Outputs[],
  now: DateTime,
  zone: string | null,
  stand: string | null = null,
  held: ReadonlyMap<string, Held> = new Map(),
  pending: ReadonlyMap<string, PendingSetting> = new Map(),
): RowLine => {
  const sockets = all.flatMap(one => one.sockets);
  let waits = false;
  const facts = all.flatMap((one, index) => {
    const hold = held.get(one.device.id);
    const lamp = t('control.rows.light');
    const set = (name: string, text: string): string => {
      const waiting = index === 0 ? pendingField(pending, one.device, name) : undefined;
      waits ||= waiting !== undefined;
      return waiting ? notTaken(t, text, waiting.savedAt, now, zone) : text;
    };
    const reported = [
      // A light socket follows the lamp and is named "Licht" itself; the output is then said only while it is held.
      ...(hold
        ? [`${lamp} ${heldWords(t, hold, now, zone)}`]
        : one.light && !one.sockets.some(row => isLightRole(row.role))
          ? [one.level ? (one.level.percent > 0 ? `${lamp} ${percentLabel(one.level.percent)}` : t('start.card.lightOff')) : lamp]
          : []),
      ...one.sockets.map(row => socketFact(t, row, now)),
    ];
    const stored = one.fans
      ? ['clipFan', 'innerFans'].flatMap(name => {
          const speed = fieldValue(one.device, name);
          return typeof speed === 'number' ? [set(name, `${t(`tuning.${name}`)} ${percentLabel(speed)}`)] : [];
        })
      : one.speed
        ? fanFactsOf(t, one.device).map((fact, at) => set(FAN_SETTINGS[at], at === 0 ? `${t('control.rows.fan')}: ${fact}` : fact))
        : [];
    const own = [...(index === 0 && stand && reported.length > 0 ? [stand] : []), ...reported, ...stored];
    // A device called what its one output is called - a lamp, a fan - needs no name before it.
    const name = deviceName(one.device, t);
    return index > 0 && own.length > 0 && !own[0].startsWith(name) ? [`${name}: ${own[0]}`, ...own.slice(1)] : own;
  });
  const byHand = all.some(one => held.has(one.device.id)) || sockets.some(row => forcedOf(row));
  const allAuto = !byHand && sockets.length > 0 && !all.some(one => one.light || one.fans || one.speed);

  return { text: [...facts, allAuto ? t('control.rows.allAuto') : null].filter(Boolean).join(' · '), warn: byHand || waits };
};

/**
 * "Standard · auch Gewächshaus, Energiesparen": the mode that runs and what else the page offers, or that the
 * climate preset set it; what is stored for a silent device that still runs another is said as stored (`notTaken`).
 */
export const modeLine = (
  t: Translate,
  device: Device,
  now: DateTime,
  zone: string | null,
  pending: ReadonlyMap<string, PendingSetting> = new Map(),
): RowLine => {
  const running = device.control?.drying ? 'drying' : (device.control?.mode ?? 'standard');
  const mode = modeWord(t, device);
  const held = pendingMode(t, device, pending);
  const what = held ? (held.name === t('operatingMode.label') ? held.value : `${held.name} ${held.value}`) : null;
  const waits = held && what ? notTaken(t, what, held.savedAt, now, zone) : null;
  const others = modesOf(device)
    .filter(one => one !== running)
    .map(one => t(`control.rows.mode.${one}`));
  if (configurationFieldsOf(device.type).energySaving) others.push(t('control.rows.mode.energySaving'));
  const beside =
    running === 'drying' || running === 'germination'
      ? t('operatingMode.byPreset')
      : others.length > 0
        ? t('control.rows.also', { others: others.join(', ') })
        : null;

  return {
    text: (what === mode ? [waits, beside] : [mode, beside, waits]).filter(Boolean).join(' · '),
    warn: held !== null || running !== 'standard',
  };
};
