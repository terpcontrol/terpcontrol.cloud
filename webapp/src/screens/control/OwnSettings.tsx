import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import { useDevices } from '@/api/devices';
import { fieldValue } from '@/ui/advanced/field-values';
import { awaitingClimate, statesTargets } from '@/ui/climate-hardware';
import { deviceTitle } from '@/ui/naming';
import { enough, useMayWith } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { Climate } from './climate/Climate';
import { FanPanel } from './devices/FanPanel';
import { LightPanel } from './devices/LightPanel';
import { PlugPanel } from './devices/PlugPanel';

/**
 * What one device is set to that is its own: the light and the targets of a
 * controller or a fridge, an AIR fan's own control with the targets it
 * follows, the switching of a Plantalytix Socket, the window of a LIGHT.
 * Steuerung draws it for the device that is the place's climate, a device's
 * own page for every other one. All of them are built from the same parts
 * and saved the same way: nothing here is a draft.
 *
 * What may be done is asked of the device rather than of the screen: the same
 * reader owns one tent and only reads the next. A device whose document has
 * not arrived is waited for by name - nothing here stands in for settings it
 * has never sent.
 */
export function OwnSettings({ device }: { device: Device }) {
  const { t } = useTranslation();
  const mayManage = enough(useMayWith()(device), 'manage');
  const all = useDevices();
  const configuration = device.configuration;

  if (configuration === null) {
    const key = awaitingClimate(device) ? 'targets.waiting' : device.type === 'plug' || device.type === 'light' ? 'ownPanel.waiting' : null;
    return key ? <p className={`${ui.cardDashed} ${ui.note}`}>{t(key, { device: deviceTitle(device, t, all.data?.items) })}</p> : null;
  }

  if (device.type === 'plug') return <PlugPanel device={device} mayManage={mayManage} />;
  if (device.type === 'light') return <LightPanel device={device} mayManage={mayManage} />;
  if (!statesTargets(configuration)) return null;
  if (device.type !== 'fan') return <Climate device={device} stored={configuration} mayManage={mayManage} />;

  return (
    <>
      <FanPanel device={device} mayManage={mayManage} />
      {/* At a fixed speed an AIR fan follows no target, and none is offered. */}
      {fieldValue(device, 'fanMode') === 'fixed' ? null : <Climate device={device} stored={configuration} mayManage={mayManage} />}
    </>
  );
}
