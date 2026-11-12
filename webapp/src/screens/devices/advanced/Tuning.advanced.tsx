import { useTranslation } from 'react-i18next';
import { MIN_COMPRESSOR_REST_SECONDS } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import type { Device, SocketPage } from '@fg2/shared-types/v1';
import { useSettings } from '@/screens/control/climate/saved';
import { NumberSetting, SettingsBlock, SwitchSetting } from '@/screens/control/devices/Settings';
import { figureSaid, onOff, pendingOf } from '@/screens/control/devices/setting-words';
import { advancedItem, type DeviceContext } from '@/ui/advanced/item';
import { hasCo2Sensor } from '@/ui/climate-hardware';
import type { HelpTopic } from '@/ui/explain';

/**
 * What a few growers tune about the hardware itself: how slowly the lamp
 * comes up and goes down, whether it stays on through a maintenance window at
 * night, whether CO2 is dosed in the dark, and how long a fridge's compressor
 * rests - its fans are outputs and are set under Steuerung. The settings are
 * the device's own document's, by the names `CONFIGURATION_FIELDS` gives
 * them, so the range a sheet offers is the range the server holds it to, and
 * each is saved and answered as every other setting of the device is.
 *
 * Each is drawn only where the firmware reads it, and only once the device has
 * sent its document: there is nothing to change a figure in before that.
 */

const hasDocument = (device: Device): boolean => device.configuration != null && Object.keys(device.configuration).length > 0;

/** How many minutes a lamp fades in after it comes on, and out before it goes off. */
export function LightRamps({ device, mayManage }: DeviceContext) {
  const { t } = useTranslation();
  const settings = useSettings(device);
  const unit = t('units.min');
  const ramps: { name: string; label: string; help?: HelpTopic; say: ReturnType<typeof figureSaid> }[] = [
    { name: 'sunrise', label: t('tuning.sunrise'), help: 'advanced.lightRamp', say: figureSaid(unit) },
    { name: 'sunset', label: t('tuning.sunset'), say: figureSaid(unit) },
  ];

  return (
    <SettingsBlock pending={pendingOf(device, settings, ramps)}>
      {ramps.map(ramp => (
        <NumberSetting
          key={ramp.name}
          device={device}
          settings={settings}
          mayManage={mayManage}
          name={ramp.name}
          label={ramp.label}
          help={ramp.help}
          unit={unit}
        />
      ))}
    </SettingsBlock>
  );
}

/** One switch of the document, in a group of its own. */
function Toggle({ device, mayManage, name, label, help }: DeviceContext & { name: string; label: string; help: HelpTopic }) {
  const { t } = useTranslation();
  const settings = useSettings(device);

  return (
    <SettingsBlock error={settings.error} pending={pendingOf(device, settings, [{ name, label, say: value => onOff(t, value) }])}>
      <SwitchSetting device={device} settings={settings} mayManage={mayManage} name={name} label={label} help={help} />
    </SettingsBlock>
  );
}

function MaintenanceLight(context: DeviceContext) {
  const { t } = useTranslation();
  return <Toggle {...context} name="maintenanceLight" label={t('tuning.maintenanceLight')} help="advanced.maintenanceLight" />;
}

/**
 * Dosing in the dark as well, for roots in deep water culture. Drawn only where the device doses at all: it measures
 * CO2, and has a valve to open - a fridge carries its own, a tent controller opens one on a smart socket.
 */
function Co2Night(context: DeviceContext) {
  const { t } = useTranslation();
  return <Toggle {...context} name="co2Night" label={t('tuning.co2Night')} help="advanced.co2Night" />;
}

function CompressorRest({ device, mayManage }: DeviceContext) {
  const { t } = useTranslation();
  const settings = useSettings(device);
  const rest = { name: 'compressorRest', label: t('tuning.compressorRest'), say: figureSaid(t('tuning.seconds')) };

  return (
    <SettingsBlock pending={pendingOf(device, settings, [rest])}>
      <NumberSetting
        device={device}
        settings={settings}
        mayManage={mayManage}
        name={rest.name}
        label={rest.label}
        help="advanced.compressorRest"
        unit={t('tuning.seconds')}
        fallback={MIN_COMPRESSOR_REST_SECONDS}
      />
    </SettingsBlock>
  );
}

const dosesCo2 = (device: Device, sockets: SocketPage | undefined): boolean =>
  device.type === 'fridge' || (device.type === 'controller' && (sockets?.items.some(socket => socket.role === 'co2') ?? false));

const fridge = (device: Device): boolean => device.type === 'fridge' && hasDocument(device);

export const items = [
  advancedItem({
    scope: 'device',
    id: 'light-ramps',
    order: 20,
    shows: ({ device }) => (device.type === 'fridge' || device.type === 'controller') && hasDocument(device),
    Item: LightRamps,
  }),
  advancedItem({ scope: 'device', id: 'maintenance-light', order: 30, shows: ({ device }) => fridge(device), Item: MaintenanceLight }),
  advancedItem({
    scope: 'device',
    id: 'co2-night',
    order: 35,
    shows: ({ device, sockets }) => hasDocument(device) && hasCo2Sensor(device) && dosesCo2(device, sockets),
    Item: Co2Night,
  }),
  advancedItem({ scope: 'device', id: 'compressor-rest', order: 50, shows: ({ device }) => fridge(device), Item: CompressorRest }),
];
