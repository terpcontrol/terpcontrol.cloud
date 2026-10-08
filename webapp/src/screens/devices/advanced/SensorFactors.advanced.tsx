import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device, DeviceSettings } from '@fg2/shared-types/v1';
import { DEVICE_SETTING_RANGES } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { useUpdateDevice } from '@/api/devices';
import { SettingRow } from '@/ui/advanced/SettingRow';
import { advancedItem, type DeviceContext } from '@/ui/advanced/item';
import type { HelpTopic } from '@/ui/explain';
import { decimalFigure, typedFigure } from '@/ui/figures';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import styles from './SensorFactors.module.css';

/**
 * The two figures the cloud works a reading out with rather than the device:
 * how much warmer or cooler than the air a leaf is taken to be, which VPD
 * comes from wherever no leaf sensor measures it, and the factor that turns a
 * light sensor's lux into PPFD. They change what is shown and never what is
 * regulated, which is why they are here and not under Steuerung.
 *
 * They are the device's own settings (`Device.settings`), written whole with
 * the one that changed, and held to `DEVICE_SETTING_RANGES` on both ends.
 */

type Name = keyof typeof DEVICE_SETTING_RANGES;

/**
 * The hardware whose VPD the cockpit tiles and the targets draw: a fridge and a
 * tent controller. A plug, a fan and a lamp measure the air too, but where they
 * stand beside one of those their VPD is not the one anybody reads.
 */
const CLIMATE = ['fridge', 'controller'];

/** The lamps the factor is known for, the figure a grower would otherwise have to look up. */
const LAMPS = [
  { key: 'led', factor: 0.015 },
  { key: 'hps', factor: 0.0122 },
] as const;

/** A factor as exactly as it is known, without the noughts four decimals would pad it with. */
const factorFigure = (value: number): string => decimalFigure(value, 4).replace(/0+$/, '');

const fits = (name: Name, value: number): boolean =>
  Number.isFinite(value) && value >= DEVICE_SETTING_RANGES[name].min && value <= DEVICE_SETTING_RANGES[name].max;

/** The write, and what is shown while it is on its way: the figure asked for rather than the one it replaces. */
const useSetting = (device: Device) => {
  const update = useUpdateDevice(device.id);
  const asked = update.isPending ? update.variables?.settings : undefined;
  const value = (name: Name): number => (asked ?? device.settings)[name];
  const save = (name: Name, next: number, onSaved?: () => void) =>
    update.mutate({ settings: { ...device.settings, [name]: next } as DeviceSettings }, { onSuccess: onSaved });

  return { value, save, pending: update.isPending, error: update.error };
};

/**
 * A leaf's offset, a half degree at a tap: a phone's number pad has no minus,
 * and the figure is nearly always a small negative one. It is saved once it
 * has moved, so that three taps are one write rather than three.
 */
function Offset({ device, name, label, help, disabled }: { device: Device; name: Name; label: string; help?: HelpTopic; disabled: boolean }) {
  const { t } = useTranslation();
  const setting = useSetting(device);
  const [moved, setMoved] = useState<number | null>(null);
  const { min, max, step } = DEVICE_SETTING_RANGES[name];
  const shown = moved ?? setting.value(name);
  const by = (delta: number) => setMoved(Math.min(max, Math.max(min, Math.round((shown + delta) / step) * step)));
  const off = disabled || setting.pending;

  return (
    <>
      <SettingRow label={label} help={help}>
        <button
          type="button"
          className={`${ui.chip} ${styles.step}`}
          aria-label={t('sensorFactors.colder', { label })}
          disabled={off || shown <= min}
          onClick={() => by(-step)}
        >
          <Minus size={14} strokeWidth={2} aria-hidden />
        </button>
        <span className={`mono ${styles.figure}`} aria-live="polite">
          {t('sensorFactors.offset', { value: `${shown > 0 ? '+' : ''}${decimalFigure(shown, 1).replace('-', '−')}` })}
        </span>
        <button
          type="button"
          className={`${ui.chip} ${styles.step}`}
          aria-label={t('sensorFactors.warmer', { label })}
          disabled={off || shown >= max}
          onClick={() => by(step)}
        >
          <Plus size={14} strokeWidth={2} aria-hidden />
        </button>
        {moved !== null && moved !== setting.value(name) ? (
          <button type="button" className={ui.chip} disabled={off} onClick={() => setting.save(name, moved, () => setMoved(null))}>
            {t('advanced.save')}
          </button>
        ) : null}
      </SettingRow>
      <Refused error={setting.error} />
    </>
  );
}

function LeafOffsets({ device, mayManage }: DeviceContext) {
  const { t } = useTranslation();
  const leafSensor = device.state?.hardware?.leaf_temp === 'on';

  return (
    <>
      <Offset device={device} name="vpdLeafOffsetDay" label={t('sensorFactors.day')} help="advanced.leafOffset" disabled={!mayManage} />
      <Offset device={device} name="vpdLeafOffsetNight" label={t('sensorFactors.night')} disabled={!mayManage} />
      {leafSensor ? <p className={`${ui.note} ${styles.aside}`}>{t('sensorFactors.measured')}</p> : null}
    </>
  );
}

/** The factor, typed or taken from the lamp it is known for. */
function LuxFactor({ device, mayManage }: DeviceContext) {
  const { t } = useTranslation();
  const setting = useSetting(device);
  const [typed, setTyped] = useState<string | null>(null);
  const stored = setting.value('ppfdLuxFactor');
  const shown = typed ?? factorFigure(stored);
  const wanted = typedFigure(shown) ?? Number.NaN;
  const off = !mayManage || setting.pending;
  const { min, max } = DEVICE_SETTING_RANGES.ppfdLuxFactor;

  return (
    <>
      <SettingRow
        label={t('sensorFactors.lux')}
        help="advanced.ppfdFactor"
        wide
        note={
          typed !== null && !fits('ppfdLuxFactor', wanted) ? t('sensorFactors.luxRange', { min: factorFigure(min), max: factorFigure(max) }) : null
        }
      >
        <div className={styles.lux}>
          {LAMPS.map(lamp => (
            <button
              key={lamp.key}
              type="button"
              className={ui.chip}
              data-chosen={stored === lamp.factor || undefined}
              aria-pressed={stored === lamp.factor}
              disabled={off}
              onClick={() => (stored === lamp.factor ? undefined : setting.save('ppfdLuxFactor', lamp.factor, () => setTyped(null)))}
            >
              {t(`sensorFactors.lamp.${lamp.key}`, { factor: factorFigure(lamp.factor) })}
            </button>
          ))}
          <span className={styles.own}>
            <input
              className={`${ui.input} ${styles.factor}`}
              inputMode="decimal"
              value={shown}
              aria-label={t('sensorFactors.lux')}
              disabled={off}
              onChange={event => setTyped(event.target.value)}
            />
            {typed !== null && wanted !== stored ? (
              <button
                type="button"
                className={ui.chip}
                disabled={off || !fits('ppfdLuxFactor', wanted)}
                onClick={() => setting.save('ppfdLuxFactor', wanted, () => setTyped(null))}
              >
                {t('advanced.save')}
              </button>
            ) : null}
          </span>
        </div>
      </SettingRow>
      <Refused error={setting.error} />
    </>
  );
}

export const items = [
  advancedItem({
    scope: 'device',
    id: 'leaf-offsets',
    order: 70,
    shows: ({ device }) => CLIMATE.includes(device.type) && device.settings != null,
    Item: LeafOffsets,
  }),
  // Only a device whose light sensor reports lux has a PPFD to calibrate.
  advancedItem({
    scope: 'device',
    id: 'lux-factor',
    order: 80,
    shows: ({ device }) => device.state?.hardware?.ppfd === 'on' && device.settings != null,
    Item: LuxFactor,
  }),
];
