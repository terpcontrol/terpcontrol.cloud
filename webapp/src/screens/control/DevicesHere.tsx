import { Camera as CameraIcon } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Camera, Device, PendingSettings } from '@fg2/shared-types/v1';
import { heardAt } from '@fg2/shared-types/v1-schemas/value-age.js';
import { useCameras, useLatestStills } from '@/api/cameras';
import type { Translate } from '@/i18n/i18n';
import { useDeviceLive, useLiveReads, useSocketTables } from '@/api/devices';
import { mediaUrl, THUMBNAIL_WIDTH } from '@/api/session';
import { cameraPath, devicePath, socketPath } from '@/app/places';
import { cameraFreshness } from '@/screens/devices/cameras';
import { DeviceActions, UpdateButton } from '@/screens/devices/DeviceActions';
import { useFirmware } from '@/screens/devices/firmware-builds';
import { socketName, socketState } from '@/screens/devices/socket-words';
import { rowsOf } from '@/screens/devices/sockets';
import { ageLabel, deviceLiveness, offlineLabel, sinceLabel } from '@/ui/age';
import { Facts } from '@/ui/Facts';
import { cameraTitle, deviceName, deviceTitle } from '@/ui/naming';
import { Row, Rows, RowText } from '@/ui/Rows';
import { Sheet } from '@/ui/Sheet';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { offsetOf } from '@/ui/wall-clock';
import { useWideWindow } from '@/ui/wide-window';
import { useZone } from '@/ui/zone';
import { isOutputPath, MODE_PATHS, SAID_ON_CARDS } from './climate/figures';
import { ownFactOf } from './devices/own-summary';
import { standOf } from './rows';
import styles from './Control.module.css';

/**
 * What stands in the place, under its climate: the card of the place's own
 * device with its update, maintenance and restart; a short card for every
 * further device, whose page holds those; a row per camera and per smart
 * socket; and the one way to add another. `devices` come in Steuerung's order.
 */
export function DevicesHere({
  spaceId,
  devices,
  lead,
  mayManage,
  maySetUp,
}: {
  spaceId: string;
  devices: Device[];
  lead: Device | null;
  mayManage: boolean;
  /** Whether the session may add hardware at all: an account of its own, not a guest's and not the demo. */
  maySetUp: boolean;
}) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const [adding, setAdding] = useState(false);
  const wide = useWideWindow();
  const ids = devices.map(device => device.id);
  const reads = useLiveReads(ids);
  const tables = useSocketTables(ids);
  const cameras = (useCameras().data?.items ?? []).filter(camera => camera.spaceId === spaceId && camera.removedAt === null);
  // A camera's picture stands in its row beside the rail only: a phone is not sent a picture it does not draw.
  const stills = useLatestStills(wide ? cameras.map(camera => camera.id) : []);
  const spokeAt = (device: Device) => heardAt(device.state.lastSeenAt, reads.measuredAt.get(device.id) ?? null);

  return (
    <div className={ui.stack3}>
      {devices.map(device => (
        <DeviceCard
          key={device.id}
          device={device}
          among={devices}
          leads={device.id === lead?.id}
          spokeAt={spokeAt(device)}
          mayManage={mayManage}
          now={now}
        />
      ))}

      {cameras.map(camera => {
        const carrier = devices.find(device => device.id === camera.deviceId) ?? null;
        return (
          <Row
            key={camera.id}
            alone
            to={cameraPath(camera.id)}
            lead={wide ? <Thumb stillId={stills.get(camera.id) ?? null} /> : null}
            title={cameraTitle(camera, carrier, t)}
            line={<Facts facts={cameraFacts(t, camera, carrier, carrier ? deviceLiveness(spokeAt(carrier), now) === 'offline' : false, now, zone)} />}
          />
        );
      })}

      {devices.flatMap(device => {
        const stand = standOf(t, spokeAt(device), now, zone);
        return rowsOf(tables.tables.get(device.id)?.items ?? []).map(row => (
          <Row
            key={`${device.id}-${row.key}`}
            alone
            to={socketPath(device.id, row.key)}
            title={t('device.socket.title', { name: socketName(t, row) })}
            line={<Facts facts={[...(stand ? [stand] : []), ...socketState(t, row, now).split(' · ')]} />}
          />
        ));
      })}

      {maySetUp ? (
        <button type="button" className={styles.add} onClick={() => setAdding(true)}>
          + {t('control.add.title')}
        </button>
      ) : null}
      {adding ? (
        <Sheet title={t('control.add.title')} onClose={() => setAdding(false)}>
          <div className={ui.sheetBody}>
            <Rows>
              <Row to="/claim" title={t('control.add.device')} line={t('start.empty.deviceNote')} />
              <Row to="/cameras/add" title={t('control.add.terpCam')} line={t('control.add.terpCamNote')} />
              <Row to="/cameras/add?kind=rtsp" title={t('control.add.camera')} line={t('start.empty.cameraNote')} />
            </Rows>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}

function DeviceCard({
  device,
  among,
  leads,
  spokeAt,
  mayManage,
  now,
}: {
  device: Device;
  among: Device[];
  leads: boolean;
  spokeAt: string | null;
  mayManage: boolean;
  now: DateTime;
}) {
  const { t } = useTranslation();
  const zone = useZone();
  const pending = useDeviceLive(device.id).data?.pending ?? null;
  const liveness = deviceLiveness(spokeAt, now);
  const offline = liveness === 'offline';
  const waiting = spokeAt === null;
  const title = deviceTitle(device, t, among);
  const { running, madeOn } = useFirmware(device, leads);
  const firmware = running ? t('control.device.firmware', { day: madeOn(running) }) : null;
  const says = waiting
    ? t('liveness.waiting')
    : offline
      ? offlineLabel(spokeAt, now, zone)
      : liveness === 'stale'
        ? t('control.device.late', { age: ageLabel(spokeAt, now) })
        : t('home.reading.live');
  // What a device that is not the place's climate is set to, which its own page changes.
  const own = leads ? null : ownFactOf(t, device, offsetOf(now, zone));
  const elsewhere = unsaid(pending, leads);

  return (
    <section className={styles.device} aria-label={title} data-short={!leads || undefined}>
      <div className={styles.deviceHead}>
        <RowText title={title} line={<Facts facts={[says, firmware, own ? `${own.label}: ${own.value}` : null]} />} warn={offline && !waiting} />
        {leads && mayManage ? <UpdateButton device={device} offline={offline} /> : null}
      </div>
      {/* Maintenance, a restart and an update of a further device are on its own page, so the list stays short. */}
      {leads && mayManage ? <DeviceActions device={device} offline={offline || waiting} /> : null}
      {elsewhere > 0 ? (
        <p className={styles.pendingLine} role="status">
          {t('control.pending.more', { count: elsewhere })}
        </p>
      ) : null}
      <Link to={devicePath(device.id)} className={styles.all}>
        {t('control.device.all', { name: deviceName(device, t) })} <span aria-hidden>›</span>
      </Link>
    </section>
  );
}

/**
 * How many settings a silent device has not been handed that nothing else on
 * Steuerung says: the lead's figures and light stand on its cards, its work
 * mode and fans in their rows' lines; everything of another device, and what
 * lives on a device's own page, is counted here.
 */
const unsaid = (pending: PendingSettings | null, leads: boolean): number =>
  (pending?.settings ?? []).filter(
    setting => !leads || !(SAID_ON_CARDS.includes(setting.field) || MODE_PATHS.includes(setting.field) || isOutputPath(setting.field)),
  ).length;

/** "online · letztes Bild 14:31", or that the camera waits for the device it is read through. */
const cameraFacts = (t: Translate, camera: Camera, carrier: Device | null, carrierOffline: boolean, now: DateTime, zone: string | null): string[] => {
  const last = camera.state.lastStillAt
    ? t('camera.picture.last', { time: sinceLabel(camera.state.lastStillAt, now, zone) })
    : t('control.camera.none');
  if (carrier && carrierOffline) return [last, t('camera.pill.waits', { device: deviceName(carrier, t) })];
  const fresh = cameraFreshness(camera, now);
  return [...(fresh === 'live' ? [t('home.reading.live')] : []), last];
};

function Thumb({ stillId }: { stillId: string | null }) {
  const source = stillId ? mediaUrl(stillId, THUMBNAIL_WIDTH.still) : null;

  return source ? (
    <img className={styles.thumb} src={source} alt="" />
  ) : (
    <span className={styles.thumb} aria-hidden>
      <CameraIcon size={16} strokeWidth={1.75} />
    </span>
  );
}
