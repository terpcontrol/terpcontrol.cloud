import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import type { Device, DeviceCapabilities } from '@fg2/shared-types/v1';
import { useSocketTables, useTestSocket } from '@/api/devices';
import { useSpaceOverview } from '@/api/spaces';
import { backOf, controlPath, devicePath, usePageOfPlace } from '@/app/places';
import { useLog } from '@/log/log-context';
import { ageLabel, sinceLabel } from '@/ui/age';
import { Announce } from '@/ui/Announce';
import { Facts as FactLine } from '@/ui/Facts';
import { LivenessPill } from '@/ui/LivenessPill';
import { deviceTitle } from '@/ui/naming';
import { PageHead } from '@/ui/PageHead';
import { LoadFailed, NoLongerHere, Refused, Waiting } from '@/ui/PageState';
import { Row, Rows } from '@/ui/Rows';
import { enough, useMayWith } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { useZone } from '@/ui/zone';
import { useDevice, useDeviceLiveness } from './device-read';
import { HandHold } from './HandHold';
import { Fact, Facts } from './RowParts';
import { isTimed } from './socket-form';
import { RemoveSocketSheet, SocketFormSheet } from './SocketSheets';
import { forcedOf, socketCycle, socketName, socketState } from './socket-words';
import { rowsOf, runsOf, TEST_SECONDS, type SocketRowModel } from './sockets';
import styles from './DevicePage.module.css';

/** The slot a socket's key names, so a socket whose role was changed is still found. */
const slotOf = (key: string): number | null => {
  const slot = /^socket-(-?\d+)-/.exec(key)?.[1];
  return slot === undefined ? null : Number(slot);
};

const rowOf = (rows: SocketRowModel[], key: string): SocketRowModel | null => {
  const slot = slotOf(key);
  return rows.find(row => row.key === key) ?? (slot !== null && slot >= 0 ? rows.find(row => row.slot === slot) : undefined) ?? null;
};

/**
 * One smart socket, on a page of its own: what it is doing, holding it on or
 * off by hand, finding it in the tent, and what is rarely needed again - where
 * it is reached, the cycle of a timed role, and removing it, which puts the
 * page it was opened from in this one's place.
 *
 * What the socket is doing is the device's last report and nothing else: a
 * command that went out is said as asked until the device reports it.
 */
export function SocketPage() {
  const { t } = useTranslation();
  const { deviceId = '', socket = '' } = useParams();
  const found = useDevice(deviceId);
  const tables = useSocketTables(found.device ? [deviceId] : []);
  usePageOfPlace(found.device?.spaceId ?? null);

  if (found.gone) return <NoLongerHere what="device" />;
  if (found.isPending) return <Waiting lines={4} />;
  if (!found.device) return <LoadFailed title={t('shell.gone.title.socket')} read={found} values />;

  const table = tables.tables.get(deviceId);
  if (!table) return tables.isError ? <LoadFailed read={tables} values /> : <Waiting lines={4} />;

  return <Socket device={found.device} among={found.among} row={rowOf(rowsOf(table.items), socket)} capabilities={table.capabilities} />;
}

function Socket({
  device,
  among,
  row,
  capabilities,
}: {
  device: Device;
  among: Device[] | undefined;
  row: SocketRowModel | null;
  capabilities: DeviceCapabilities;
}) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const navigate = useNavigate();
  const { state } = useLocation();
  const mayManage = enough(useMayWith()(device), 'manage');
  const { heard, liveness, waiting, offline } = useDeviceLiveness(device, now);
  // How often an output came on today is the place's answer: its overview counts it, and Start has read it already.
  const verdict = useSpaceOverview(device.spaceId ?? '').data?.verdict;
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const title = deviceTitle(device, t, among);
  const back = backOf(state, device.spaceId ? controlPath(device.spaceId) : devicePath(device.id));

  const head = (name: string) => (
    <PageHead title={name} back={{ to: back, label: t('device.back') }}>
      <LivenessPill liveness={liveness} measuredAt={heard} now={now} waiting={waiting} />
    </PageHead>
  );

  // A socket that left the table - removed, or its device handed over - has no page: what the address was about, and the way on to its device.
  if (!row) {
    return (
      <section className={`${ui.stack3} ${ui.page}`}>
        {head(t('shell.gone.title.socket'))}
        <p className={ui.note}>{t('device.socket.gone', { device: title })}</p>
        <Row alone to={devicePath(device.id)} title={t('control.device.all', { name: title })} />
      </section>
    );
  }

  const name = socketName(t, row);
  const forced = forcedOf(row);
  // Why the device would not hear anything at all, and why this build holds nothing: the first stops strictly more.
  const unheard = offline || waiting;
  const refusal = unheard ? t('devices.socket.offline') : capabilities.socketOverride ? null : t('devices.socket.needsFirmware');
  const runs = runsOf(verdict, row.role);
  const timed = isTimed(row.role);

  return (
    <section className={`${ui.stack3} ${ui.page}`}>
      {head(row.role ? t('device.socket.title', { name }) : name)}
      <p className={styles.facts}>
        <FactLine
          facts={[
            <Link key="device" to={devicePath(device.id)}>
              {t('devices.via', { name: title })}
            </Link>,
            socketCycle(t, row),
            // What is drawn is the device's last report: once it has gone quiet, the line says as of when.
            offline && heard ? t('device.asOf', { time: sinceLabel(heard, now, zone) }) : null,
          ]}
        />
      </p>

      <div className={`${ui.card} ${styles.card}`}>
        <span className={styles.socketState}>{socketState(t, row, now)}</span>
        {!mayManage ? null : refusal ? (
          <p className={ui.note}>{refusal}</p>
        ) : (
          <HandHold
            name={name}
            deviceId={device.id}
            target={row.target}
            held={forced && forced.state !== 'auto' ? { state: forced.state, until: forced.validUntil } : null}
            help="socketHold"
            now={now}
          />
        )}
      </div>

      <div className={ui.card}>
        <Facts>
          <Fact label={t('devices.socket.slot')} value={row.slot < 0 ? t('devices.socket.byRole') : String(row.slot + 1)} />
          {row.address ? <Fact label={t('devices.socket.address')} value={row.address} /> : null}
          {row.hardwareId ? <Fact label={t('devices.socket.hardwareId')} value={row.hardwareId} /> : null}
          {row.stateChangedAt ? (
            <Fact label={t('devices.socket.changed')} value={t('devices.ago', { age: ageLabel(row.stateChangedAt, now) })} />
          ) : null}
          {runs ? <Fact label={t('devices.socket.runs')} value={t('devices.socket.runsValue', { count: runs.runCount })} /> : null}
        </Facts>
      </div>

      {mayManage ? (
        <Rows>
          {row.slot >= 0 ? <FindRow deviceId={device.id} slot={row.slot} name={name} unheard={unheard} /> : null}
          {/* A pump or a timer of one's own without a cycle stays off, which the row that sets one says. */}
          <Row
            title={t(timed ? 'socketForm.edit.labelTimed' : 'socketForm.edit.label')}
            line={timed && !row.timer ? t('socketForm.timer.missing') : unheard ? t('device.socket.waits') : null}
            warn={timed && !row.timer}
            waits={unheard}
            onOpen={() => setEditing(true)}
          />
          {row.slot >= 0 ? (
            <Row
              title={t('socketForm.remove.label')}
              line={unheard ? t('device.socket.waits') : null}
              waits={unheard}
              onOpen={() => setRemoving(true)}
            />
          ) : null}
        </Rows>
      ) : null}

      {editing ? (
        <SocketFormSheet
          deviceId={device.id}
          deviceName={title}
          capabilities={capabilities}
          socket={row}
          name={name}
          onClose={() => setEditing(false)}
        />
      ) : null}
      {removing ? (
        <RemoveSocketSheet
          deviceId={device.id}
          row={row}
          name={name}
          onClose={() => setRemoving(false)}
          onRemoved={() => void navigate(back, { replace: true })}
        />
      ) : null}
    </section>
  );
}

/**
 * "Finden": the socket comes on for two seconds and goes off again, which is
 * how a person finds out which plug in the tent it is. A command every build
 * takes, so only a device nobody hears makes it wait.
 */
function FindRow({ deviceId, slot, name, unheard }: { deviceId: string; slot: number; name: string; unheard: boolean }) {
  const { t } = useTranslation();
  const { tell } = useLog();
  const test = useTestSocket();
  const missed = test.data?.deviceOnline === false ? t('devices.socket.notListening') : null;

  const find = () => {
    if (test.isPending) return;
    test.mutate(
      { deviceId, slot, forSeconds: TEST_SECONDS },
      { onSuccess: ({ deviceOnline }) => deviceOnline && tell({ label: t('devices.socket.found', { name }), undo: null }) },
    );
  };

  return (
    <>
      <Row
        acts
        title={t('devices.socket.findIt')}
        line={t(unheard ? 'device.socket.waits' : 'devices.socket.findLine')}
        waits={unheard}
        onOpen={find}
      />
      <Refused error={test.error} fallback={t('devices.socket.askFailed')} className={styles.rowSays} />
      {missed ? <p className={`${ui.note} ${styles.rowSays}`}>{missed}</p> : null}
      <Announce text={missed} />
    </>
  );
}
