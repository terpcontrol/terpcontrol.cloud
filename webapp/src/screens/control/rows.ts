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
import { deviceName } from '@/ui/naming';
import { ruleTitle } from './alarms/rules';
import { isOutputPath, MODE_PATHS } from './climate/figures';
import { fanFactsOf } from './devices/own-summary';
import { heldWords } from './held-light';
import { activeStep, isWaiting, readingAt } from './plan-clock';

/** "Stand 13:49" for a device heard last at `spoke` and silent since, which dates whatever is said of it; null while it is heard. */
export const standOf = (t: Translate, spoke: string | null, now: DateTime, zone: string | null): string | null =>
  spoke !== null && deviceLiveness(spoke, now) === 'offline' ? t('control.stand', { time: sinceLabel(spoke, now, zone) }) : null;

/** What a row under Steuerung's climate says of the page behind it, in a few words; amber is for what needs a person. */
export interface RowLine {
  text: string;
  warn?: boolean;
}

/** The work modes a person picks on Betriebsart: the ones no climate preset sets. Germination and drying follow the stage. */
export const modesOf = (device: Device): readonly WorkMode[] => workModesOf(device.type).filter(mode => mode !== 'germination' && mode !== 'drying');

/** Whether Betriebsart has anything to choose for a device: a second mode, or a fridge's energy saving. */
export const hasMode = (device: Device): boolean =>
  Boolean(device.control) && (modesOf(device).length > 1 || configurationFieldsOf(device.type).energySaving !== undefined);

/** "Normal", "Trocknung", "Keimung · dunkel": the mode the device runs. */
const modeWord = (t: Translate, device: Device): string =>
  device.control ? t(`operatingMode.${device.control.drying ? 'drying' : device.control.mode}`) : '';

/** "3 Regeln · alle ruhig", or which rule has raised. */
export const alarmsLine = (t: Translate, rules: AlarmRule[]): RowLine => {
  const on = rules.filter(rule => rule.enabled);
  if (on.length === 0) return { text: t('control.rows.alarmsNone') };
  const count = t('control.rows.alarmsOn', { count: on.length });
  const raised = on.filter(rule => rule.state.triggered);
  if (raised.length === 0) return { text: `${count} · ${t('control.rows.alarmsCalm')}` };

  return {
    text: `${count} · ${raised.length === 1 ? t('control.rows.alarmRaised', { name: ruleTitle(t, raised[0]) }) : t('control.rows.alarmsRaised', { count: raised.length })}`,
    warn: true,
  };
};

/**
 * "aus · Zielwerte stellst du von Hand", or where the plan stands; a step waiting for its word is said in amber, and
 * so is a plan that is paused, with why - it is continued and stopped on the page the row opens.
 */
export const planLine = (t: Translate, plans: Plan[], now: DateTime): RowLine => {
  const plan = plans.find(one => one.state.status === 'running') ?? plans.find(one => one.state.status === 'paused') ?? plans[0] ?? null;
  if (!plan) return { text: t('control.rows.planOff') };
  if (plan.state.status === 'paused') {
    const paused = t('control.rows.planPaused', { step: activeStep(plan)?.name ?? plan.name });
    return { text: [paused, plan.state.pauseReason].filter(Boolean).join(' · '), warn: true };
  }
  const going = planLineOf(t, plan, now);
  if (going === null) return { text: t('control.rows.planAtRest', { name: plan.name, status: t(`space.control.status.${plan.state.status}`) }) };

  return { text: going, warn: isWaiting(plan, readingAt(plan.state, now)) };
};

/** What a device drives beside its climate: its own lamp, a fridge's fans, an AIR fan's speed, its smart sockets. */
export interface Outputs {
  device: Device;
  light: boolean;
  /** What the lamp last ran at, where it reported. */
  level: OutputLevel | null;
  fans: boolean;
  speed: boolean;
  sockets: SocketRowModel[];
}

export const outputsOf = (device: Device, table: SocketPage | undefined, level: OutputLevel | null): Outputs => ({
  device,
  light: table !== undefined && lightOutputOf(device, table.capabilities, level) !== null,
  level,
  fans: device.type === 'fridge' && device.configuration !== null,
  speed: device.type === 'fan' && device.configuration !== null,
  sockets: rowsOf(table?.items ?? []),
});

export const hasOutputs = (outputs: Outputs): boolean => outputs.light || outputs.fans || outputs.speed || outputs.sockets.length > 0;

/** "Abluft an", "Pumpe aus gehalten, noch 15 Min": a socket by its name and what it does. */
const socketFact = (t: Translate, row: SocketRowModel, now: DateTime): string =>
  `${socketName(t, row)} ${forcedOf(row) || row.state === 'unknown' ? socketState(t, row, now).replace(' · ', ', ') : t(`devices.socket.${row.state}`)}`;

/**
 * "Licht 80 % · Abluft an · Befeuchter aus · alle Auto": each output with what
 * it does, as of `stand` once the devices have gone quiet, and in amber what
 * is held by hand. The outputs of a further device are led by its name. "alle
 * Auto" is said only of a list made of sockets: a lamp reports no hold, so
 * nothing is claimed of one somebody else may be holding.
 */
export const outputsLine = (
  t: Translate,
  all: Outputs[],
  now: DateTime,
  zone: string | null,
  stand: string | null = null,
  held: ReadonlyMap<string, Held> = new Map(),
): RowLine => {
  const sockets = all.flatMap(one => one.sockets);
  const facts = all.flatMap((one, index) => {
    const hold = held.get(one.device.id);
    const lamp = t('control.rows.light');
    const fan = one.fans
      ? ['clipFan', 'innerFans'].flatMap(name => {
          const speed = fieldValue(one.device, name);
          return typeof speed === 'number' ? [`${t(`tuning.${name}`)} ${percentLabel(speed)}`] : [];
        })
      : one.speed
        ? fanFactsOf(t, one.device).map((fact, at) => (at === 0 ? `${t('control.rows.fans')}: ${fact}` : fact))
        : [];
    const own = [
      // A light socket follows the lamp and is named "Licht" itself; the output is then said only while it is held.
      ...(hold
        ? [`${lamp} ${heldWords(t, hold, now, zone)}`]
        : one.light && !one.sockets.some(row => isLightRole(row.role))
          ? [one.level ? (one.level.percent > 0 ? `${lamp} ${percentLabel(one.level.percent)}` : t('start.card.lightOff')) : lamp]
          : []),
      ...fan,
      ...one.sockets.map(row => socketFact(t, row, now)),
    ];
    // A device called what its one output is called - a lamp, a fan - needs no name before it.
    const name = deviceName(one.device, t);
    return index > 0 && own.length > 0 && !own[0].startsWith(name) ? [`${name}: ${own[0]}`, ...own.slice(1)] : own;
  });
  const byHand = all.some(one => held.has(one.device.id)) || sockets.some(row => forcedOf(row));
  const allAuto = !byHand && sockets.length > 0 && !all.some(one => one.light || one.fans || one.speed);

  return { text: [stand, ...facts, allAuto ? t('control.rows.allAuto') : null].filter(Boolean).join(' · '), warn: byHand };
};

/** "Standard · auch Gewächshaus, Energiesparen": the mode that runs and what else the page offers - or that the climate preset set it. */
export const modeLine = (t: Translate, device: Device): RowLine => {
  const running = device.control?.drying ? 'drying' : (device.control?.mode ?? 'standard');
  if (running === 'drying' || running === 'germination') return { text: `${modeWord(t, device)} · ${t('operatingMode.byPreset')}`, warn: true };
  const others = modesOf(device)
    .filter(mode => mode !== running)
    .map(mode => t(`control.rows.mode.${mode}`));
  if (configurationFieldsOf(device.type).energySaving) others.push(t('control.rows.mode.energySaving'));

  return {
    text: others.length > 0 ? t('control.rows.modeAlso', { mode: modeWord(t, device), others: others.join(', ') }) : modeWord(t, device),
    warn: running !== 'standard',
  };
};

/** "gespeichert um 14:31 · noch nicht am Gerät", for a row whose page holds a setting the device has not been handed. */
export const pendingBehind = (settings: readonly PendingSetting[], row: 'mode' | 'outputs'): PendingSetting | null =>
  settings.find(setting => (row === 'mode' ? MODE_PATHS.includes(setting.field) : isOutputPath(setting.field))) ?? null;
