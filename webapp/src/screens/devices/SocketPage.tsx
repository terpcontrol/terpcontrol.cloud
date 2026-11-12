import type { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams } from 'react-router';
import type { Device, DeviceCapabilities, SocketOverrideState } from '@fg2/shared-types/v1';
import { useSetOverride, useSocketTables, useTestSocket } from '@/api/devices';
import { useSpaceVerdicts } from '@/api/spaces';
import { backOf, controlPath, devicePath, usePageOfPlace } from '@/app/places';
import { ageLabel, durationLabel, sinceLabel } from '@/ui/age';
import { Facts as FactLine } from '@/ui/Facts';
import { Help } from '@/ui/Help';
import { LivenessPill } from '@/ui/LivenessPill';
import { deviceTitle } from '@/ui/naming';
import { PageHead } from '@/ui/PageHead';
import { LoadFailed, NoLongerHere, Waiting } from '@/ui/PageState';
import { Row, Rows } from '@/ui/Rows';
import { enough, useMayWith } from '@/ui/session-access';
import { Switch } from '@/ui/Switch';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { useZone } from '@/ui/zone';
import { useDevice, useDeviceLiveness } from './device-read';
import { Fact, Facts, Receipt } from './RowParts';
import { isTimed } from './socket-form';
import { RemoveSocketSheet, SocketFormSheet, SocketTimerBlock } from './SocketSheets';
import { forcedOf, socketCycle, socketName, socketState } from './socket-words';
import { DEFAULT_HOLD_SECONDS, HOLD_SECONDS, rowsOf, runsOf, TEST_SECONDS, type SocketRowModel } from './sockets';
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
 * One smart socket, on a page of its own: what it is doing, the switch that
 * forces it the other way, how long a hold lasts, the cycle of a timed role,
 * and what is rarely needed again - where it is reached, and removing it.
 *
 * A socket is a plug: it is on or it is off. A tap forces it the other way for
 * a while; a tap while something is forcing it hands it back to its role.
 * Nothing here pretends a command arrived: the page goes on showing what the
 * device last reported, and what the command answered is said underneath.
 *
 * It leads back to where it was opened from - Steuerung, or the list of the
 * device's sockets.
 */
export function SocketPage() {
  const { deviceId = '', socket = '' } = useParams();
  const found = useDevice(deviceId);
  const tables = useSocketTables(found.device ? [deviceId] : []);
  usePageOfPlace(found.device?.spaceId ?? null);

  if (found.gone) return <NoLongerHere what="device" />;
  if (found.isPending) return <Waiting lines={4} />;
  if (!found.device) return <LoadFailed retry={found.refetch} />;

  const table = tables.tables.get(deviceId);
  if (!table) return tables.isError ? <LoadFailed retry={found.refetch} /> : <Waiting lines={4} />;

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
  const { state } = useLocation();
  const mayManage = enough(useMayWith()(device), 'manage');
  const { heard, liveness, waiting, offline } = useDeviceLiveness(device, now);
  const verdicts = useSpaceVerdicts(device.spaceId ? [device.spaceId] : []);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const title = deviceTitle(device, t, among);
  const back = backOf(state, device.spaceId ? controlPath(device.spaceId) : devicePath(device.id, 'sockets'));

  const head = (name: string) => (
    <PageHead title={name} back={{ to: back, label: t('device.back') }}>
      <LivenessPill liveness={liveness} measuredAt={heard} now={now} waiting={waiting} />
    </PageHead>
  );

  // A socket that left the table - removed, or its device handed over - has no page; the way back is the head's.
  if (!row) {
    return (
      <section className={styles.page}>
        {head(t('devices.socket.isPlug'))}
        <p className={ui.note}>{t('device.socket.gone', { device: title })}</p>
      </section>
    );
  }

  const name = socketName(t, row);
  // Why the device would not hear anything at all, and why this build holds nothing: the first stops strictly more.
  const unheard = offline || waiting ? t('devices.socket.offline') : null;
  const refusal = unheard ?? (capabilities.socketOverride ? null : t('devices.socket.needsFirmware'));
  const runs = runsOf(verdicts.get(device.spaceId ?? ''), row.role);

  return (
    <section className={styles.page}>
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

      <Switching row={row} name={name} deviceId={device.id} mayManage={mayManage} refusal={refusal} unheard={unheard} now={now} />

      {/* What a pump or a timer of one's own repeats: without it the socket stays off. */}
      {mayManage && isTimed(row.role) ? (
        <div className={ui.card}>
          <SocketTimerBlock deviceId={device.id} row={row} capabilities={capabilities} refusal={unheard} />
        </div>
      ) : null}

      <div className={`${ui.card} ${styles.details}`}>
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
          <Row title={t('socketForm.edit.label')} onOpen={() => setEditing(true)} />
          {row.slot >= 0 ? (
            <Row
              title={t('socketForm.remove.label')}
              line={unheard ? t('device.socket.removeWaits') : null}
              waits={unheard !== null}
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
      {removing ? <RemoveSocketSheet deviceId={device.id} row={row} name={name} onClose={() => setRemoving(false)} /> : null}
    </section>
  );
}

/**
 * What the socket is doing and the ways to force it: the switch, where the
 * device says what the socket is doing - the three-way where it does not,
 * because a switch would have to be drawn in a position nobody checked - the
 * lengths a hold can have, the way back to its role and the blink that finds
 * it. A reader who may not manage the device reads the state alone.
 */
function Switching({
  row,
  name,
  deviceId,
  mayManage,
  refusal,
  unheard,
  now,
}: {
  row: SocketRowModel;
  name: string;
  deviceId: string;
  mayManage: boolean;
  /** Why nothing can be held now, or null. */
  refusal: string | null;
  /** Why the device hears no command at all, or null: finding a socket is one every build takes. */
  unheard: string | null;
  now: DateTime;
}) {
  const { t } = useTranslation();
  const override = useSetOverride();
  const test = useTestSocket();
  const forced = forcedOf(row);
  const send = (state: SocketOverrideState, forSeconds: number) => override.mutate({ deviceId, target: row.target, state, forSeconds });
  /** A tap means "the other way" - and, while something is forcing the socket, "let go". */
  const flip = () => (forced ? send('auto', 0) : send(row.state === 'on' ? 'off' : 'on', DEFAULT_HOLD_SECONDS));

  return (
    <div className={`${ui.card} ${styles.card}`}>
      <div className={styles.socketNow}>
        <span className={styles.socketState}>{socketState(t, row, now)}</span>
        {!mayManage ? null : row.state === 'unknown' ? (
          <span className={`${ui.segments} ${styles.threeWay}`} role="group" aria-label={t('devices.socket.force', { name })}>
            {(['auto', 'on', 'off'] as const).map(state => (
              <button
                key={state}
                type="button"
                className={ui.segment}
                aria-pressed={state === (forced ? forced.state : 'auto')}
                disabled={refusal !== null}
                onClick={() => send(state, state === 'auto' ? 0 : DEFAULT_HOLD_SECONDS)}
              >
                {t(`devices.socket.${state}`)}
              </button>
            ))}
          </span>
        ) : (
          <Switch label={t('devices.socket.force', { name })} on={row.state === 'on'} disabled={refusal !== null} onChange={flip} />
        )}
      </div>
      <Receipt result={override.data} error={override.error} pending={override.isPending} />

      {mayManage ? (
        <div className={styles.holds}>
          <span className="label">
            {t('devices.socket.holdFor')}
            <Help topic="socketHold" />
          </span>
          {HOLD_SECONDS.map(seconds => (
            <button
              key={seconds}
              type="button"
              className={ui.chip}
              disabled={refusal !== null}
              aria-label={t(row.state === 'on' ? 'devices.socket.holdOffAria' : 'devices.socket.holdOnAria', {
                name,
                duration: durationLabel(seconds),
              })}
              onClick={() => send(row.state === 'on' ? 'off' : 'on', seconds)}
            >
              {durationLabel(seconds)}
            </button>
          ))}
          {forced ? (
            <button type="button" className={ui.chip} disabled={refusal !== null} onClick={() => send('auto', 0)}>
              {t('devices.socket.backToAuto')}
            </button>
          ) : null}
          {row.slot >= 0 ? (
            // The (i) stays beside the chip it explains, also where the chips wrap.
            <span className={styles.withHelp}>
              <button
                type="button"
                className={ui.chip}
                disabled={unheard !== null}
                onClick={() => test.mutate({ deviceId, slot: row.slot, forSeconds: TEST_SECONDS })}
              >
                {t('devices.socket.findIt')}
              </button>
              <Help topic="findSocket" />
            </span>
          ) : null}
          {/* Why the chips are grey, where the grey chips are. */}
          {refusal ? <p className={ui.note}>{refusal}</p> : null}
        </div>
      ) : null}
      <Receipt result={test.data} error={test.error} pending={test.isPending} />
    </div>
  );
}
