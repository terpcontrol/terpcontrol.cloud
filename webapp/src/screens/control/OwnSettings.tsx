import { useCallback, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import { useDevices } from '@/api/devices';
import { fieldValue } from '@/ui/advanced/field-values';
import { awaitingClimate, statesTargets } from '@/ui/climate-hardware';
import { deviceName, deviceTitle } from '@/ui/naming';
import { enough, useMayWith } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { Climate } from './climate/Climate';
import { LightPanel } from './devices/LightPanel';
import type { OwnPanelProps } from './devices/OwnPanel';
import { PlugPanel } from './devices/PlugPanel';
import { LeaveGuard, type Unsaved } from './targets/LeaveGuard';

/**
 * What one device is set to that is its own: the light and the targets of a
 * controller, a fridge or an AIR fan, the switching of a Plantalytix Socket,
 * the window of a LIGHT. Steuerung draws it for the device that is the
 * place's climate, a device's own page for every other one.
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

  if (device.type === 'plug' || device.type === 'light') {
    const Panel = device.type === 'plug' ? PlugPanel : LightPanel;
    return <Guarded>{own => <Panel device={device} name={deviceName(device, t)} titled={false} mayManage={mayManage} {...own} />}</Guarded>;
  }

  if (!statesTargets(configuration)) return null;
  // At a fixed speed an AIR fan follows no target, and none is offered: its speed is among the outputs.
  if (device.type === 'fan' && fieldValue(device, 'fanMode') === 'fixed')
    return <p className={`${ui.cardDashed} ${ui.note}`}>{t('fanSettings.fixedTargets')}</p>;

  return <Climate device={device} stored={configuration} mayManage={mayManage} />;
}

/**
 * The panels that keep a Save of their own - a socket's switching, a lamp's
 * window, the fans among the outputs - with the question that is asked before
 * figures nobody saved are left behind. The climate's figures need none: each
 * is written by its own sheet.
 */
export function Guarded({ children }: { children: (own: Pick<OwnPanelProps, 'report' | 'asking'>) => ReactNode }) {
  const [unsaved, setUnsaved] = useState<ReadonlyMap<string, Unsaved>>(new Map());
  const [asking, setAsking] = useState(false);
  const report = useCallback((id: string, entry: Unsaved | null) => {
    setUnsaved(current => {
      if (entry === null && !current.has(id)) return current;
      const next = new Map(current);
      if (entry) next.set(id, entry);
      else next.delete(id);
      return next;
    });
  }, []);

  return (
    <>
      {children({ report, asking })}
      <LeaveGuard unsaved={unsaved} onAsking={setAsking} />
    </>
  );
}
