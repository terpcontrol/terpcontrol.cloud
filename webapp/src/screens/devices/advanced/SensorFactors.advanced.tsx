import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeviceSettings } from '@fg2/shared-types/v1';
import { DEVICE_SETTING_RANGES } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { useUpdateDevice } from '@/api/devices';
import { useLog } from '@/log/log-context';
import { FigureButton, ValueSheet, type SheetValues } from '@/screens/control/climate/ValueSheet';
import { SettingLine, SettingsBlock } from '@/screens/control/devices/Settings';
import { advancedItem, type DeviceContext } from '@/ui/advanced/item';
import type { HelpTopic } from '@/ui/explain';
import { decimalFigure, unbroken } from '@/ui/figures';
import { Choice, Choices } from '@/ui/SheetParts';

/**
 * The two figures the cloud works a reading out with rather than the device:
 * how much warmer or cooler than the air a leaf is taken to be, which VPD
 * comes from wherever no leaf sensor measures it, and the factor that turns a
 * light sensor's lux into PPFD. They change what is shown and never what is
 * regulated, which is why they are here and not under Steuerung - and why a
 * silent device has nothing of them to take over.
 *
 * They are the device's own settings (`Device.settings`), written whole with
 * the one that changed, and held to `DEVICE_SETTING_RANGES` on both ends.
 */

type Name = keyof typeof DEVICE_SETTING_RANGES;

/**
 * The hardware whose VPD Start and the targets draw: a fridge and a
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

/** One of the factors on its line, changed on the value sheet and saved with the others as they are. */
function Factor({
  device,
  mayManage,
  name,
  label,
  help,
  say,
  decimals,
  step = DEVICE_SETTING_RANGES[name].step,
  unit,
  children,
}: Pick<DeviceContext, 'device' | 'mayManage'> & {
  name: Name;
  label: string;
  help?: HelpTopic;
  say: (value: number) => string;
  decimals: number;
  step?: number;
  unit?: string;
  children?: (values: SheetValues, set: (key: string, value: number) => void) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const { tell } = useLog();
  const update = useUpdateDevice(device.id);
  const [open, setOpen] = useState(false);
  const stored = device.settings[name];
  const save = async (next: number): Promise<boolean> => {
    const before: DeviceSettings = device.settings;
    try {
      await update.mutateAsync({ settings: { ...before, [name]: next } });
      const saved = (value: number) => t('control.saved.now', { what: `${label} ${say(value)}` });
      tell({ label: saved(next), undo: () => update.mutateAsync({ settings: before }), undone: saved(stored) });
      return true;
    } catch {
      // Said in the sheet that asked, from the write that was refused.
      return false;
    }
  };

  return (
    <SettingLine label={label} help={help}>
      <FigureButton name={label} text={unbroken(say(stored))} pending={false} onOpen={mayManage ? () => setOpen(true) : null} />
      {open ? (
        <ValueSheet
          title={label}
          figures={[
            { key: name, label, value: stored, min: DEVICE_SETTING_RANGES[name].min, max: DEVICE_SETTING_RANGES[name].max, step, decimals, unit },
          ]}
          busy={update.isPending}
          error={update.error}
          onSave={values => save(values[name])}
          onClose={() => setOpen(false)}
        >
          {children}
        </ValueSheet>
      ) : null}
    </SettingLine>
  );
}

function LeafOffsets({ device, mayManage }: DeviceContext) {
  const { t } = useTranslation();
  const say = (value: number) => t('sensorFactors.offset', { value: `${value > 0 ? '+' : ''}${decimalFigure(value, 1).replace('-', '−')}` });
  const shared = { device, mayManage, say, decimals: 1, unit: t('targets.unit.temperature') };

  return (
    <SettingsBlock>
      <Factor {...shared} name="vpdLeafOffsetDay" label={t('sensorFactors.day')} help="advanced.leafOffset" />
      <Factor {...shared} name="vpdLeafOffsetNight" label={t('sensorFactors.night')} />
    </SettingsBlock>
  );
}

/** The factor, stepped or typed on its sheet, or taken there from the lamp it is known for. */
function LuxFactor({ device, mayManage }: DeviceContext) {
  const { t } = useTranslation();

  return (
    <SettingsBlock>
      <Factor
        device={device}
        mayManage={mayManage}
        name="ppfdLuxFactor"
        label={t('sensorFactors.lux')}
        help="advanced.ppfdFactor"
        say={factorFigure}
        decimals={4}
        step={0.0005}
      >
        {(values, set) => (
          <Choices label={t('sensorFactors.lamps')}>
            {LAMPS.map(lamp => (
              <Choice key={lamp.key} chosen={values.ppfdLuxFactor === lamp.factor} onChoose={() => set('ppfdLuxFactor', lamp.factor)}>
                {t(`sensorFactors.lamp.${lamp.key}`, { factor: factorFigure(lamp.factor) })}
              </Choice>
            ))}
          </Choices>
        )}
      </Factor>
    </SettingsBlock>
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
