import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import {
  MOST_TIMER_WINDOWS,
  PLUG_MODES,
  PLUG_SWITCHING,
  SWITCH_POINT_RANGE,
  switchPointName,
  type PlugSwitching,
  type TimerWindow,
} from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { DAY_SECONDS, FIRMWARE_LIGHTS_OFF, FIRMWARE_LIGHTS_ON } from '@fg2/shared-types/v1-schemas/day-night.js';
import { fieldValue, type FieldValue } from '@/ui/advanced/field-values';
import ui from '@/ui/ui.module.css';
import { UNIT } from '@/ui/units';
import { useNow } from '@/ui/useNow';
import { offsetOf, secondsOf, wallClock } from '@/ui/wall-clock';
import { useZone } from '@/ui/zone';
import { useSettings, type Settings } from '../climate/saved';
import { FigureButton, ValueSheet } from '../climate/ValueSheet';
import { ChoiceSetting, SettingLine, SettingsBlock, SwitchSetting } from './Settings';
import { figureSaid, onOff, pendingOf } from './setting-words';
import { PLUG_READING, RISING } from './own-summary';
import climate from '../climate/Climate.module.css';
import styles from './Own.module.css';

/**
 * A Plantalytix Socket - the plug with a sensor of its own that switches
 * whatever is plugged into it: what it switches by, and the two points it
 * switches at by day and by night or the windows of its timer. Its CO2
 * dosing, its protections and the fan it slows while dosing are under
 * Erweitert on the device's page.
 */

type Half = 'day' | 'night';
type Edge = 'on' | 'off';

const CO2_RANGE = { min: 300, max: 3000, step: 50 };

interface PanelProps {
  device: Device;
  mayManage: boolean;
}

export function PlugPanel({ device, mayManage }: PanelProps) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const settings = useSettings(device);
  const offset = offsetOf(now, zone);
  const mode = String(fieldValue(device, 'plugMode') ?? 'off');
  const dayNight = fieldValue(device, 'dayNight') === true;
  const points = (PLUG_SWITCHING as readonly string[]).includes(mode) ? (mode as PlugSwitching) : mode === 'co2' ? 'co2' : null;
  const split = t(mode === 'co2' ? 'plugSettings.dayOnly' : 'plugSettings.dayNight');
  const options = PLUG_MODES.map(one => ({ value: one, label: t(`plugSettings.mode.${one}`) }));
  const own = { device, settings, mayManage };
  const clock = (value: FieldValue) => (typeof value === 'number' ? wallClock(value, offset) : '');

  return (
    <>
      <SettingsBlock
        title={t('plugSettings.title')}
        error={settings.error}
        pending={pendingOf(device, settings, [
          { name: 'plugMode', label: t('plugSettings.mode.label'), say: value => options.find(option => option.value === value)?.label ?? '' },
          { name: 'dayNight', label: split, say: value => onOff(t, value) },
          { name: 'dayFrom', label: t('plugSettings.dayFrom'), say: clock },
          { name: 'nightFrom', label: t('plugSettings.nightFrom'), say: clock },
        ])}
      >
        <ChoiceSetting {...own} name="plugMode" label={t('plugSettings.mode.label')} help="plugMode" options={options} />
        {points ? <SwitchSetting {...own} name="dayNight" label={split} help="plugDayNight" /> : null}
        {points && dayNight ? (
          <>
            <ClockSetting {...own} name="dayFrom" label={t('plugSettings.dayFrom')} fallback={FIRMWARE_LIGHTS_ON} offset={offset} />
            <ClockSetting {...own} name="nightFrom" label={t('plugSettings.nightFrom')} fallback={FIRMWARE_LIGHTS_OFF} offset={offset} />
          </>
        ) : null}
      </SettingsBlock>
      {points ? <Points {...own} mode={points} halves={points !== 'co2' && dayNight ? ['day', 'night'] : ['day']} /> : null}
      {mode === 'timer' ? <Windows {...own} offset={offset} /> : null}
    </>
  );
}

/** A time of day of the document, on the account's wall clock: the server moves it when the clock changes. */
function ClockSetting({
  device,
  settings,
  mayManage,
  name,
  label,
  fallback,
  offset,
}: PanelProps & { settings: Settings; name: string; label: string; fallback: number; offset: number }) {
  const [open, setOpen] = useState(false);
  const stored = fieldValue(device, name);
  const seconds = typeof stored === 'number' ? stored : fallback;

  return (
    <SettingLine label={label}>
      <FigureButton
        name={label}
        text={wallClock(seconds, offset)}
        pending={settings.held(name) !== undefined}
        onOpen={mayManage ? () => setOpen(true) : null}
      />
      {open ? (
        <ValueSheet
          title={label}
          figures={[{ key: name, label, value: seconds, clock: { offset } }]}
          busy={settings.busy}
          error={settings.error}
          onSave={values => settings.write({ [name]: values[name] }, held => `${label} ${wallClock(held[name], offset)}`)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </SettingLine>
  );
}

/**
 * The two points a mode switches at, by day and - where the night has its own -
 * by night, as the grid the targets stand in. A pair is changed on one sheet:
 * a heater that switches on above where it switches off never settles, so the
 * two are only ever saved the right way round, and moving both is one save.
 */
function Points({
  device,
  settings,
  mayManage,
  mode,
  halves,
}: PanelProps & { settings: Settings; mode: PlugSwitching | 'co2'; halves: readonly Half[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Half | null>(null);
  const metric = PLUG_READING[mode];
  const range = mode === 'co2' ? CO2_RANGE : SWITCH_POINT_RANGE[mode];
  const rising = RISING.includes(mode);
  const nameOf = (half: Half, edge: Edge) => (mode === 'co2' ? (edge === 'on' ? 'co2On' : 'co2Off') : switchPointName(mode, half, edge));
  const edgeLabel = (edge: Edge) => t(`plugSettings.edge.${rising ? 'rising' : 'falling'}.${edge}`);
  const decimals = metric === 'temperature' ? 1 : 0;
  const say = figureSaid(UNIT[metric] ?? '', decimals);
  const pointOf = (half: Half, edge: Edge): number => {
    const stored = fieldValue(device, nameOf(half, edge));
    return typeof stored === 'number' ? stored : mode === 'co2' ? (edge === 'on' ? 600 : 1000) : edge === 'on' ? 25 : 30;
  };
  const halfLabel = (half: Half) => (halves.length > 1 ? t(`plugSettings.${half}`) : t('plugSettings.points'));
  const lines = halves.flatMap(half =>
    (['on', 'off'] as const).map(edge => ({
      name: nameOf(half, edge),
      label: halves.length > 1 ? t('plugSettings.pointName', { edge: edgeLabel(edge), half: halfLabel(half) }) : edgeLabel(edge),
      say,
    })),
  );

  return (
    <SettingsBlock title={t('plugSettings.points')} help="switchPoints" pending={pendingOf(device, settings, lines)}>
      <div
        className={`${ui.stack2} ${climate.grid}`}
        role="table"
        aria-label={t('plugSettings.points')}
        data-single={halves.length === 1 || undefined}
      >
        {halves.length > 1 ? (
          <div role="row" className={climate.gridRow}>
            <span role="columnheader" aria-label={t('targets.table.figure')} />
            {halves.map(half => (
              <span key={half} role="columnheader" className={climate.half}>
                {halfLabel(half)}
              </span>
            ))}
          </div>
        ) : null}
        {(['on', 'off'] as const).map(edge => (
          <div role="row" className={climate.gridRow} key={edge}>
            <span role="rowheader" className={climate.rowLabel}>
              {edgeLabel(edge)}
            </span>
            {halves.map(half => (
              <span role="cell" key={half}>
                <FigureButton
                  name={halves.length > 1 ? t('plugSettings.pointName', { edge: edgeLabel(edge), half: halfLabel(half) }) : edgeLabel(edge)}
                  text={say(pointOf(half, edge))}
                  pending={settings.held(nameOf(half, edge)) !== undefined}
                  onOpen={mayManage ? () => setOpen(half) : null}
                />
              </span>
            ))}
          </div>
        ))}
      </div>
      {open ? (
        <ValueSheet
          key={open}
          title={halfLabel(open)}
          help="switchPoints"
          figures={(['on', 'off'] as const).map(edge => ({
            key: edge,
            label: edgeLabel(edge),
            value: pointOf(open, edge),
            ...range,
            decimals,
            unit: UNIT[metric] ?? '',
          }))}
          busy={settings.busy}
          error={settings.error}
          invalid={values =>
            (rising ? values.on >= values.off : values.on <= values.off) ? t(`plugSettings.crossed.${rising ? 'rising' : 'falling'}`) : null
          }
          onSave={values =>
            settings.write(
              Object.fromEntries(
                (['on', 'off'] as const).flatMap(edge => (values[edge] === pointOf(open, edge) ? [] : [[nameOf(open, edge), values[edge]]])),
              ) as Record<string, number>,
              // An edge that did not move is not in the set: it reads as it stands.
              held =>
                `${halfLabel(open)} ${(['on', 'off'] as const).map(edge => `${edgeLabel(edge)} ${say(held[nameOf(open, edge)] ?? pointOf(open, edge))}`).join(', ')}`,
            )
          }
          onClose={() => setOpen(null)}
        />
      ) : null}
    </SettingsBlock>
  );
}

/**
 * The windows a timer switches the socket on in: from a time of day, for so
 * many minutes, and over midnight where one runs that long. A window has a
 * sheet of its own, which also removes it; the document holds them as one
 * list, so every save writes the list whole.
 */
function Windows({ device, settings, mayManage, offset }: PanelProps & { settings: Settings; offset: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<number | null>(null);
  const windows = (fieldValue(device, 'timerWindows') as TimerWindow[] | null) ?? [];
  const span = (window: TimerWindow) => `${wallClock(window.ontime, offset)}–${wallClock(window.ontime + window.duration * 60, offset)}`;
  const said = (list: FieldValue) => (Array.isArray(list) && list.length > 0 ? list.map(span).join(', ') : t('plugSettings.summary.noWindows'));
  const edited = open === null ? null : (windows[open] ?? nextWindow(windows, offset));
  const put = (next: TimerWindow[], what: string) =>
    settings.write({ timerWindows: next }, held => (held.timerWindows === next ? what : `${t('plugSettings.windows.label')} ${said(windows)}`));

  return (
    <SettingsBlock
      title={t('plugSettings.windows.label')}
      help="timerWindows"
      error={open === null ? settings.error : null}
      pending={pendingOf(device, settings, [{ name: 'timerWindows', label: t('plugSettings.windows.label'), say: said }])}
    >
      {windows.length === 0 ? <p className={climate.note}>{t('plugSettings.windows.none')}</p> : null}
      {windows.map((window, index) => {
        const label = t('plugSettings.windows.one', { number: index + 1 });
        return (
          <SettingLine key={index} label={label}>
            <FigureButton
              name={label}
              text={span(window)}
              pending={settings.held('timerWindows') !== undefined}
              onOpen={mayManage ? () => setOpen(index) : null}
            />
          </SettingLine>
        );
      })}
      {mayManage && windows.length < MOST_TIMER_WINDOWS ? (
        <button type="button" className={`${ui.button} ${styles.act}`} onClick={() => setOpen(windows.length)}>
          {t('plugSettings.windows.add')}
        </button>
      ) : null}
      {open !== null && edited ? (
        <ValueSheet
          key={open}
          title={t('plugSettings.windows.one', { number: open + 1 })}
          help="timerWindows"
          figures={[
            { key: 'ontime', label: t('plugSettings.windows.at'), value: edited.ontime, clock: { offset } },
            {
              key: 'duration',
              label: t('plugSettings.windows.for'),
              value: edited.duration,
              min: 1,
              max: DAY_SECONDS / 60,
              step: 5,
              unit: t('units.min'),
            },
          ]}
          fresh={open >= windows.length}
          busy={settings.busy}
          error={settings.error}
          extra={
            open < windows.length ? (
              <button
                type="button"
                className={`${ui.button} ${ui.danger}`}
                disabled={settings.busy}
                onClick={() =>
                  void put(
                    windows.filter((_one, at) => at !== open),
                    t('plugSettings.windows.removed', { window: span(edited) }),
                  ).then(done => (done ? setOpen(null) : undefined))
                }
              >
                {t('plugSettings.windows.remove')}
              </button>
            ) : null
          }
          onSave={values => {
            const window = { ontime: values.ontime, duration: values.duration };
            return put(
              open < windows.length ? windows.map((one, at) => (at === open ? window : one)) : [...windows, window],
              `${t('plugSettings.windows.one', { number: open + 1 })} ${span(window)}`,
            );
          }}
          onClose={() => setOpen(null)}
        >
          {values => (
            <p className={`mono ${climate.derived}`}>
              {t('plugSettings.windows.ends', { time: wallClock(values.ontime + values.duration * 60, offset) })}
            </p>
          )}
        </ValueSheet>
      ) : null}
    </SettingsBlock>
  );
}

/** A new window starts an hour after the last one ends, or at ten in the morning on the account's clock. */
const nextWindow = (windows: TimerWindow[], offset: number): TimerWindow => {
  const last = windows.at(-1);
  if (!last) return { ontime: secondsOf('10:00', offset) ?? 10 * 3600, duration: 10 };
  return { ontime: (last.ontime + last.duration * 60 + 3600) % DAY_SECONDS, duration: last.duration };
};
