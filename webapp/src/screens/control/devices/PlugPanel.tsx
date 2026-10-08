import { X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import {
  MOST_TIMER_WINDOWS,
  PLUG_MODES,
  PLUG_SWITCHING,
  SWITCH_POINT_RANGE,
  switchPointName,
  type PlugMode,
  type PlugSwitching,
  type TimerWindow,
} from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { DAY_SECONDS, FIRMWARE_LIGHTS_OFF, FIRMWARE_LIGHTS_ON } from '@fg2/shared-types/v1-schemas/day-night.js';
import { Help } from '@/ui/Help';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import { Switch } from '@/ui/Switch';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { offsetOf, secondsOf, wallClock } from '@/ui/wall-clock';
import { useZone } from '@/ui/zone';
import type { Unsaved } from '../targets/LeaveGuard';
import { TargetRow } from '../targets/TargetRow';
import { TimeInput } from '../TimeInput';
import { useFieldsDraft, type FieldsDraft } from './fields-draft';
import { OwnPanel, TimeRow } from './OwnPanel';
import styles from './Own.module.css';

/**
 * A stand-alone smart socket: the plug with a sensor of its own that switches
 * whatever is plugged into it. For its owner this is the device's main
 * setting, so it stands under Steuerung where a controller's targets do -
 * what the socket switches by, the two points it switches at by day and by
 * night, or the windows of its timer.
 *
 * Its CO2 dosing, its protections and the fan it slows while dosing are under
 * Erweitert in the device's panel; every key of its document the panel does
 * not show is kept, because only what was changed is sent.
 */

const DEFAULT_WINDOW: TimerWindow = { ontime: 10 * 3600, duration: 10 };

/** Which way a mode switches: on below its point and off above it, or the other way round. */
const RISING: readonly string[] = ['heater', 'humidify', 'co2'];

/** The reading a mode's points are figures of. */
const UNIT: Record<PlugSwitching | 'co2', 'temperature' | 'humidity' | 'co2'> = {
  heater: 'temperature',
  cooler: 'temperature',
  humidify: 'humidity',
  dehumidify: 'humidity',
  co2: 'co2',
};

const CO2_RANGE = { min: 300, max: 3000, step: 50 };

const FIELDS = [
  'plugMode',
  'dayNight',
  'dayFrom',
  'nightFrom',
  'co2On',
  'co2Off',
  'timerWindows',
  ...PLUG_SWITCHING.flatMap(mode =>
    (['day', 'night'] as const).flatMap(when => (['on', 'off'] as const).map(edge => switchPointName(mode, when, edge))),
  ),
];

export function PlugPanel(props: {
  device: Device;
  name: string;
  titled: boolean;
  mayManage: boolean;
  report: (deviceId: string, entry: Unsaved | null) => void;
  asking: boolean;
}) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const draft = useFieldsDraft(props.device, FIELDS);
  const mode = draft.value<string>('plugMode', 'off') as PlugMode;
  const dayNight = draft.value<boolean>('dayNight', false);
  const readOnly = !props.mayManage;
  const offset = offsetOf(now, zone);

  const switching = (PLUG_SWITCHING as readonly string[]).includes(mode) ? (mode as PlugSwitching) : null;
  const crossed = pointsCrossed(draft, mode, dayNight);
  const windows = draft.value<TimerWindow[]>('timerWindows', []);
  const windowsFit = windows.every(window => window.duration >= 1 && window.duration <= DAY_SECONDS / 60);

  return (
    <OwnPanel
      {...props}
      draft={draft}
      invalid={
        crossed ? t(`plugSettings.crossed.${RISING.includes(mode) ? 'rising' : 'falling'}`) : windowsFit ? null : t('plugSettings.windows.bad')
      }
    >
      <Block label={t('plugSettings.mode.label')} help="plugMode">
        <Choices label={t('plugSettings.mode.label')}>
          {PLUG_MODES.map(one => (
            <Choice key={one} chosen={one === mode} disabled={readOnly} onChoose={() => draft.set('plugMode', one)}>
              {t(`plugSettings.mode.${one}`)}
            </Choice>
          ))}
        </Choices>
        <p className={`${ui.note} ${styles.note}`}>{t(`plugSettings.modeNote.${mode}`)}</p>
      </Block>

      {switching || mode === 'co2' ? (
        <section className={`${ui.card} ${styles.switchRow}`}>
          <span className={styles.switchLabel}>
            {t(mode === 'co2' ? 'plugSettings.dayOnly' : 'plugSettings.dayNight')}
            <Help topic="plugDayNight" />
          </span>
          <Switch
            label={t(mode === 'co2' ? 'plugSettings.dayOnly' : 'plugSettings.dayNight')}
            on={dayNight}
            disabled={readOnly}
            onChange={on => draft.set('dayNight', on)}
          />
          <p className={`${ui.note} ${styles.switchNote}`}>
            {t(
              mode === 'co2'
                ? dayNight
                  ? 'plugSettings.dayOnlyOn'
                  : 'plugSettings.dayOnlyOff'
                : dayNight
                  ? 'plugSettings.dayNightOn'
                  : 'plugSettings.dayNightOff',
            )}
          </p>
        </section>
      ) : null}

      {(switching || mode === 'co2') && dayNight ? (
        <Block grouped label={t('plugSettings.dayLabel')}>
          <TimeRow
            id={`plug-${props.device.id}-day`}
            label={t('plugSettings.dayFrom')}
            seconds={draft.value<number>('dayFrom', FIRMWARE_LIGHTS_ON)}
            offset={offset}
            disabled={readOnly}
            onChange={seconds => draft.set('dayFrom', seconds)}
          />
          <TimeRow
            id={`plug-${props.device.id}-night`}
            label={t('plugSettings.nightFrom')}
            seconds={draft.value<number>('nightFrom', FIRMWARE_LIGHTS_OFF)}
            offset={offset}
            disabled={readOnly}
            onChange={seconds => draft.set('nightFrom', seconds)}
          />
        </Block>
      ) : null}

      {switching ? (
        <>
          <Points draft={draft} device={props.device} mode={switching} when="day" titled={dayNight} disabled={readOnly} />
          {dayNight ? <Points draft={draft} device={props.device} mode={switching} when="night" titled disabled={readOnly} /> : null}
        </>
      ) : null}

      {mode === 'co2' ? <Points draft={draft} device={props.device} mode="co2" when="day" titled={false} disabled={readOnly} /> : null}

      {mode === 'timer' ? <Windows draft={draft} deviceId={props.device.id} offset={offset} disabled={readOnly} /> : null}
    </OwnPanel>
  );
}

/** The figure a point stands at in the draft, or the firmware's default. */
const pointOf = (draft: FieldsDraft, mode: PlugSwitching | 'co2', when: 'day' | 'night', edge: 'on' | 'off'): number =>
  mode === 'co2'
    ? draft.value<number>(edge === 'on' ? 'co2On' : 'co2Off', edge === 'on' ? 600 : 1000)
    : draft.value<number>(switchPointName(mode, when, edge), edge === 'on' ? 25 : 30);

/**
 * Whether a pair of points stands the wrong way round. A heater that switches
 * on above where it switches off never settles - it would be on and off with
 * every reading - so a draft like that is not saved.
 */
const pointsCrossed = (draft: FieldsDraft, mode: string, dayNight: boolean): boolean => {
  const switching = (PLUG_SWITCHING as readonly string[]).includes(mode) ? (mode as PlugSwitching) : mode === 'co2' ? 'co2' : null;
  if (!switching) return false;

  const whens: ('day' | 'night')[] = switching !== 'co2' && dayNight ? ['day', 'night'] : ['day'];
  return whens.some(when => {
    const on = pointOf(draft, switching, when, 'on');
    const off = pointOf(draft, switching, when, 'off');
    return RISING.includes(switching) ? on >= off : on <= off;
  });
};

function Points({
  draft,
  device,
  mode,
  when,
  titled,
  disabled,
}: {
  draft: FieldsDraft;
  device: Device;
  mode: PlugSwitching | 'co2';
  when: 'day' | 'night';
  /** Whether the block says which half of the day it is for: only where the night has points of its own. */
  titled: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const unit = UNIT[mode];
  const range = mode === 'co2' ? CO2_RANGE : SWITCH_POINT_RANGE[mode];
  const field = (edge: 'on' | 'off') => (mode === 'co2' ? (edge === 'on' ? 'co2On' : 'co2Off') : switchPointName(mode, when, edge));
  const label = titled ? t(`plugSettings.${when}`) : t('plugSettings.points');

  return (
    <Block grouped label={label} help="switchPoints">
      {(['on', 'off'] as const).map(edge => (
        <TargetRow
          key={edge}
          id={`plug-${device.id}-${mode}-${when}-${edge}`}
          label={t(`plugSettings.edge.${RISING.includes(mode) ? 'rising' : 'falling'}.${edge}`)}
          name={t('plugSettings.pointName', { edge: t(`plugSettings.edge.${RISING.includes(mode) ? 'rising' : 'falling'}.${edge}`), half: label })}
          value={pointOf(draft, mode, when, edge)}
          min={range.min}
          max={range.max}
          step={range.step}
          unit={t(`targets.unit.${unit}`)}
          disabled={disabled}
          onChange={value => draft.set(field(edge), value)}
        />
      ))}
    </Block>
  );
}

/**
 * The windows a timer switches the socket on in: from a time of day, for so
 * many minutes, and over midnight where one runs that long.
 */
function Windows({ draft, deviceId, offset, disabled }: { draft: FieldsDraft; deviceId: string; offset: number; disabled: boolean }) {
  const { t } = useTranslation();
  const windows = draft.value<TimerWindow[]>('timerWindows', []);
  const put = (next: TimerWindow[]) => draft.set('timerWindows', next);

  return (
    <Block grouped label={t('plugSettings.windows.label')} help="timerWindows">
      {windows.length === 0 ? <p className={`${ui.note} ${styles.empty}`}>{t('plugSettings.windows.none')}</p> : null}
      {windows.map((window, index) => (
        <WindowRow
          key={index}
          id={`plug-${deviceId}-window-${index}`}
          number={index + 1}
          window={window}
          offset={offset}
          disabled={disabled}
          onChange={next => put(windows.map((one, at) => (at === index ? next : one)))}
          onRemove={() => put(windows.filter((_one, at) => at !== index))}
        />
      ))}
      {disabled ? null : (
        <div className={styles.windowAdd}>
          <button
            type="button"
            className={ui.chip}
            disabled={windows.length >= MOST_TIMER_WINDOWS}
            onClick={() => put([...windows, nextWindow(windows, offset)])}
          >
            {t('plugSettings.windows.add')}
          </button>
          {windows.length >= MOST_TIMER_WINDOWS ? (
            <span className={ui.note}>{t('plugSettings.windows.most', { count: MOST_TIMER_WINDOWS })}</span>
          ) : null}
        </div>
      )}
    </Block>
  );
}

/** A new window starts an hour after the last one ends, or at ten in the morning on the account's clock. */
const nextWindow = (windows: TimerWindow[], offset: number): TimerWindow => {
  const last = windows.at(-1);
  if (!last) return { ...DEFAULT_WINDOW, ontime: secondsOf('10:00', offset) ?? DEFAULT_WINDOW.ontime };
  return { ontime: (last.ontime + last.duration * 60 + 3600) % DAY_SECONDS, duration: last.duration };
};

function WindowRow({
  id,
  number,
  window,
  offset,
  disabled,
  onChange,
  onRemove,
}: {
  id: string;
  number: number;
  window: TimerWindow;
  offset: number;
  disabled: boolean;
  onChange: (window: TimerWindow) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [minutes, setMinutes] = useState<string | null>(null);
  const ends = wallClock(window.ontime + window.duration * 60, offset);

  return (
    <div className={styles.window}>
      <label className={styles.windowPart}>
        <span className={styles.windowWord}>{t('plugSettings.windows.at')}</span>
        <TimeInput
          id={id}
          className={`mono ${ui.input} ${styles.windowTime}`}
          aria-label={t('plugSettings.windows.atLabel', { number })}
          seconds={window.ontime}
          offset={offset}
          disabled={disabled}
          onChange={ontime => onChange({ ...window, ontime })}
        />
      </label>
      <label className={styles.windowPart}>
        <span className={styles.windowWord}>{t('plugSettings.windows.for')}</span>
        <input
          className={`mono ${ui.input} ${styles.windowMinutes}`}
          inputMode="numeric"
          aria-label={t('plugSettings.windows.forLabel', { number })}
          value={minutes ?? String(window.duration)}
          disabled={disabled}
          onChange={event => {
            setMinutes(event.target.value);
            const value = Number(event.target.value);
            if (Number.isInteger(value) && value > 0) onChange({ ...window, duration: value });
          }}
          onBlur={() => setMinutes(null)}
        />
        <span className={styles.windowWord}>{t('plugSettings.windows.minutes')}</span>
      </label>
      <span className={`mono ${styles.windowEnds}`}>{t('plugSettings.windows.ends', { time: ends })}</span>
      {disabled ? null : (
        <button type="button" className={styles.windowRemove} aria-label={t('plugSettings.windows.remove', { number })} onClick={onRemove}>
          <X size={16} strokeWidth={1.75} aria-hidden />
        </button>
      )}
    </div>
  );
}
