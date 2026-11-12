import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import { deviceName } from '@/ui/naming';
import { Guarded } from '../OwnSettings';
import { FanPanel } from './FanPanel';
import { FridgeFansPanel } from './FridgeFansPanel';

/** What a device drives by a setting of its own, among the outputs: a fridge's fans, an AIR fan's mode and speed. */
export function OwnOutputs({ device, mayManage }: { device: Device; mayManage: boolean }) {
  const { t } = useTranslation();
  if (!device.configuration || (device.type !== 'fridge' && device.type !== 'fan')) return null;
  const Panel = device.type === 'fridge' ? FridgeFansPanel : FanPanel;

  return <Guarded>{own => <Panel device={device} name={deviceName(device, t)} titled={false} mayManage={mayManage} {...own} />}</Guarded>;
}
