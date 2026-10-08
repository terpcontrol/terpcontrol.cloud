import { useTranslation } from 'react-i18next';
import { SOCKET_HOST_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { useDevices } from '@/api/devices';
import { advancedItem, type DeviceContext } from '@/ui/advanced/item';
import { deviceTitle } from '@/ui/naming';
import { PairSocketRow } from '../SocketSheets';

/**
 * The first smart socket of a controller or a fridge that has none yet, paired
 * by its address. Once it has one, the pairing stands under the list of its
 * sockets instead, where the next one is looked for.
 */
function PairSocket({ device, sockets }: DeviceContext) {
  const { t } = useTranslation();
  const devices = useDevices();
  if (!sockets) return null;

  return <PairSocketRow deviceId={device.id} deviceName={deviceTitle(device, t, devices.data?.items)} capabilities={sockets.capabilities} />;
}

export const items = [
  advancedItem({
    scope: 'device',
    id: 'pair-socket',
    order: 50,
    shows: ({ device, mayManage, sockets }) =>
      mayManage && !device.isDemo && SOCKET_HOST_TYPES.includes(device.type) && sockets !== undefined && sockets.items.length === 0,
    Item: PairSocket,
  }),
];
