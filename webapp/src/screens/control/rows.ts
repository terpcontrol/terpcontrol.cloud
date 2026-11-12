import type { DateTime } from 'luxon';
import type { AlarmRule, Device, PendingSetting, Plan, SocketPage } from '@fg2/shared-types/v1';
import type { OutputLevel } from '@/api/devices';
import { configurationFieldsOf } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import type { Translate } from '@/i18n/i18n';
import { isLightRole, lightOutputOf } from '@/screens/devices/lights';
import { socketName, socketState } from '@/screens/devices/socket-words';
import { rowsOf, type SocketRowModel } from '@/screens/devices/sockets';
import { planLineOf } from '@/screens/start/plan-line';
import { fieldValue } from '@/ui/advanced/field-values';
import { ruleTitle } from './alarms/rules';
import { isOutputPath, MODE_PATHS } from './climate/figures';
import { isWaiting, readingAt } from './plan-clock';

/**
 * What the rows under Steuerung's climate say about what is behind them: each
 * a page of its own, and each line the page's state in a few words, so the row
 * is read rather than opened to find out. Amber is for what needs a person.
 */
export interface RowLine {
  text: string;
  warn?: boolean;
}

/** Whether a device has a work mode to choose, which is what the row "Betriebsart" and its page are drawn for. */
export const hasMode = (device: Device): boolean => configurationFieldsOf(device.type).mode !== undefined && Boolean(device.control);

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

/** "aus · Zielwerte stellst du von Hand", or where the plan stands; a step waiting for its word is said in amber. */
export const planLine = (t: Translate, plans: Plan[], now: DateTime): RowLine => {
  const plan = plans.find(one => one.state.status === 'running') ?? plans.find(one => one.state.status === 'paused') ?? plans[0] ?? null;
  if (!plan) return { text: t('control.rows.planOff') };
  const going = planLineOf(t, plan, now);
  if (going === null) return { text: t('control.rows.planAtRest', { name: plan.name, status: t(`space.control.status.${plan.state.status}`) }) };

  return { text: going, warn: plan.state.status === 'paused' || isWaiting(plan, readingAt(plan.state, now)) };
};

/** What a device drives beside its climate: its own lamp, a fridge's fans, an AIR fan's speed, its smart sockets. */
export interface Outputs {
  device: Device;
  light: boolean;
  fans: boolean;
  speed: boolean;
  sockets: SocketRowModel[];
}

export const outputsOf = (device: Device, table: SocketPage | undefined, level: OutputLevel | null): Outputs => ({
  device,
  light: table !== undefined && lightOutputOf(device, table.capabilities, level) !== null,
  fans: device.type === 'fridge' && device.configuration !== null,
  speed: device.type === 'fan' && device.configuration !== null,
  sockets: rowsOf(table?.items ?? []),
});

export const hasOutputs = (outputs: Outputs): boolean => outputs.light || outputs.fans || outputs.speed || outputs.sockets.length > 0;

/**
 * "Licht, Abluft, Befeuchter · alle Auto": what the place's devices drive and
 * whether anything is held by hand. Only a smart socket reports a hold, so
 * "alle Auto" is said only of a list made of sockets; a lamp's hold is never
 * reported back and nothing is claimed about it.
 */
export const outputsLine = (t: Translate, all: Outputs[], now: DateTime, stand: string | null): RowLine => {
  const sockets = all.flatMap(one => one.sockets);
  const names = [
    ...(all.some(one => one.light) && !sockets.some(row => isLightRole(row.role)) ? [t('control.rows.light')] : []),
    ...(all.some(one => one.fans || one.speed) ? [t('control.rows.fans')] : []),
    ...[...new Set(sockets.map(row => t(row.titleKey)))],
  ];
  const held = sockets.filter(row => row.override && row.override.state !== 'auto');
  const state =
    held.length > 0
      ? held.map(row => `${socketName(t, row)} ${socketState(t, row, now)}`).join(', ')
      : sockets.length > 0 && !all.some(one => one.light || one.fans || one.speed)
        ? t('control.rows.allAuto')
        : null;
  const fan = all.find(one => one.speed);
  const mode = fan ? fieldValue(fan.device, 'fanMode') : null;

  return {
    text: [stand, names.join(', '), state ?? (typeof mode === 'string' ? t(`fanSettings.mode.${mode}`) : null)].filter(Boolean).join(' · '),
    warn: held.length > 0,
  };
};

/** "Normal · auch Keimung, Trocknung, Energiesparen": the mode that runs, and what else the page offers. */
export const modeLine = (t: Translate, device: Device): RowLine => {
  const field = configurationFieldsOf(device.type).mode;
  const running = device.control?.drying ? 'drying' : (device.control?.mode ?? 'standard');
  const others = (field?.kind === 'choice' ? field.options : []).filter(mode => mode !== running).map(mode => t(`control.rows.mode.${mode}`));
  if (device.type === 'fridge') others.push(t('control.rows.mode.energySaving'));

  return {
    text: others.length > 0 ? t('control.rows.modeAlso', { mode: modeWord(t, device), others: others.join(', ') }) : modeWord(t, device),
    warn: running !== 'standard',
  };
};

/** "gespeichert um 14:31 · noch nicht am Gerät", for a row whose page holds a setting the device has not been handed. */
export const pendingBehind = (settings: readonly PendingSetting[], row: 'mode' | 'outputs'): PendingSetting | null =>
  settings.find(setting => (row === 'mode' ? MODE_PATHS.includes(setting.field) : isOutputPath(setting.field))) ?? null;
