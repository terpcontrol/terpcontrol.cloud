import type { CameraTransport, CameraUpdate } from '@fg2/shared-types/v1';
import { useUpdateCamera } from '@/api/cameras';
import { advancedItem, type CameraContext } from '@/ui/advanced/item';
import { Refused } from '@/ui/PageState';
import { CarrierRow, TransportRow, TunnelRow } from '../StreamOptions';
import { carrierOf } from '../stream';

/**
 * How a stream camera is reached, which almost nobody changes: pulled through
 * a device standing where it looks - the default, and the only way to an
 * address on a home network - or opened by the cloud itself, and read over
 * TCP or some other way. Each writes on the tap, and the poller tries the
 * camera again at once, so "Jetzt ein Bild" says straight away whether it
 * helped.
 *
 * What is shown while a write is on its way is what was asked for.
 */
function Tunnel({ camera, devices, mayManage }: CameraContext) {
  const update = useUpdateCamera(camera.id);
  const asked: CameraUpdate | undefined = update.isPending ? update.variables : undefined;
  const on = asked?.tunnel ?? camera.tunnel;
  const carrier = carrierOf({ deviceId: asked?.deviceId ?? camera.deviceId }, devices);
  if (!carrier) return null;

  // UDP does not pass through a tunnel, so a stream turned to one is read over TCP from then on.
  const through = (deviceId: string): CameraUpdate => ({ tunnel: true, deviceId, ...(camera.transport === 'udp' ? { transport: null } : {}) });

  return (
    <>
      <TunnelRow
        on={on}
        carrier={carrier}
        disabled={!mayManage || update.isPending}
        onChange={next => update.mutate(next ? through(carrier.id) : { tunnel: false })}
      />
      {on && devices.length > 1 ? (
        <CarrierRow devices={devices} chosen={carrier.id} disabled={!mayManage || update.isPending} onChoose={id => update.mutate(through(id))} />
      ) : null}
      <Refused error={update.error} />
    </>
  );
}

function Transport({ camera, mayManage }: CameraContext) {
  const update = useUpdateCamera(camera.id);
  const asked = update.isPending ? update.variables?.transport : undefined;
  const value: CameraTransport = asked ?? camera.transport ?? 'tcp';

  return (
    <>
      <TransportRow
        value={value}
        tunnel={camera.tunnel}
        disabled={!mayManage || update.isPending}
        onChange={next => update.mutate({ transport: next })}
      />
      <Refused error={update.error} />
    </>
  );
}

export const items = [
  advancedItem({
    scope: 'camera',
    id: 'camera-tunnel',
    order: 10,
    shows: ({ camera, devices, mayManage }) => camera.kind === 'rtsp' && mayManage && devices.length > 0,
    Item: Tunnel,
  }),
  advancedItem({
    scope: 'camera',
    id: 'camera-transport',
    order: 20,
    shows: ({ camera, mayManage }) => camera.kind === 'rtsp' && mayManage,
    Item: Transport,
  }),
];
