import { useTranslation } from 'react-i18next';
import { MIN_COMPRESSOR_REST_SECONDS } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import type { Device, SocketPage } from '@fg2/shared-types/v1';
import { FieldNumber, FieldSwitch } from '@/ui/advanced/Fields';
import { advancedItem, type DeviceContext } from '@/ui/advanced/item';
import { hasCo2Sensor } from '@/ui/climate-hardware';

/**
 * What a few growers tune about the hardware itself, and the app had hidden
 * since the rewrite while the documents went on carrying it: how slowly the lamp
 * comes up and goes down, whether it stays on through a maintenance window at
 * night, how hard a fridge's fans blow, and how long its compressor rests. The
 * fields are the device's own document's, by the names `CONFIGURATION_FIELDS`
 * gives them, so the range a field offers is the range the server holds it to.
 *
 * Each is drawn only where the firmware reads it, and only once the device has
 * sent its document: there is nothing to change a figure in before that.
 */

const hasDocument = (device: Device): boolean => device.configuration != null && Object.keys(device.configuration).length > 0;

/** The lamp of a fridge and of a tent controller ramps over this; a stand-alone lamp keeps its own times. */
function LightRamps({ device, mayManage }: DeviceContext) {
  const { t } = useTranslation();
  const unit = t('units.min');

  return (
    <>
      <FieldNumber device={device} name="sunrise" label={t('tuning.sunrise')} help="advanced.lightRamp" unit={unit} disabled={!mayManage} />
      <FieldNumber device={device} name="sunset" label={t('tuning.sunset')} unit={unit} disabled={!mayManage} />
    </>
  );
}

function MaintenanceLight({ device, mayManage }: DeviceContext) {
  const { t } = useTranslation();

  return (
    <FieldSwitch
      device={device}
      name="maintenanceLight"
      label={t('tuning.maintenanceLight')}
      help="advanced.maintenanceLight"
      disabled={!mayManage}
      note={on => t(on ? 'tuning.maintenanceLightOn' : 'tuning.maintenanceLightOff')}
    />
  );
}

/**
 * Dosing in the dark as well, for roots in deep water culture. Drawn only where the device doses at all: it measures
 * CO2, and has a valve to open - a fridge carries its own, a tent controller opens one on a smart socket.
 */
function Co2Night({ device, mayManage }: DeviceContext) {
  const { t } = useTranslation();

  return (
    <FieldSwitch
      device={device}
      name="co2Night"
      label={t('tuning.co2Night')}
      help="advanced.co2Night"
      disabled={!mayManage}
      note={on => t(on ? 'tuning.co2NightOn' : 'tuning.co2NightOff')}
    />
  );
}

/** The clip fan that moves the leaves, and the inner fans that move the air, at the least they run at. */
function Fans({ device, mayManage }: DeviceContext) {
  const { t } = useTranslation();

  return (
    <>
      <FieldNumber device={device} name="clipFan" label={t('tuning.clipFan')} help="advanced.fans" unit="%" disabled={!mayManage} />
      <FieldNumber device={device} name="innerFans" label={t('tuning.innerFans')} unit="%" disabled={!mayManage} />
    </>
  );
}

function CompressorRest({ device, mayManage }: DeviceContext) {
  const { t } = useTranslation();

  return (
    <FieldNumber
      device={device}
      name="compressorRest"
      label={t('tuning.compressorRest')}
      help="advanced.compressorRest"
      unit={t('tuning.seconds')}
      fallback={MIN_COMPRESSOR_REST_SECONDS}
      disabled={!mayManage}
    />
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
  advancedItem({ scope: 'device', id: 'fans', order: 40, shows: ({ device }) => fridge(device), Item: Fans }),
  advancedItem({ scope: 'device', id: 'compressor-rest', order: 50, shows: ({ device }) => fridge(device), Item: CompressorRest }),
];
