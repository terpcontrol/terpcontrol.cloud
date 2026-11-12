import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device, DeviceUpdate, Space } from '@fg2/shared-types/v1';
import { SOCKET_HOST_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { useCameras } from '@/api/cameras';
import { useDevices, useSocketTables, useUpdateDevice } from '@/api/devices';
import { useCreateSpace, useSpaces } from '@/api/spaces';
import { useSession } from '@/api/session';
import { useLog } from '@/log/log-context';
import { Facts } from '@/ui/Facts';
import { cameraTitle, deviceTitle, givenName, placeKindOf } from '@/ui/naming';
import { Refused } from '@/ui/PageState';
import { Sheet } from '@/ui/Sheet';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { placesFor } from './moving';
import styles from './Devices.module.css';

/** The chip that stands for a place still to be made. */
const NEW = 'new';

/**
 * What a device is called, and which place it stands in: one sheet with one
 * button, before which nothing is written. A place chip only chooses; the
 * sheet then says what goes with the device - the camera it answers for, its
 * smart sockets - and the button says "Umziehen". The toast says what was
 * done, with the way to take it back.
 *
 * A claim leaves the type's key as the name, which no screen shows, so an
 * unnamed device starts empty with the name every screen does show as the
 * placeholder; emptied, a device goes back to that.
 *
 * A place that does not exist yet is named here as well: taking one device
 * out of a place it shares means standing it somewhere of its own. It is made
 * in the room the device leaves, and a move into it is not offered to be
 * taken back - the place would stay behind empty.
 */
export function DeviceSettingsSheet({ device, to = null, onClose }: { device: Device; to?: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { tell } = useLog();
  const { user } = useSession();
  const write = useUpdateDevice(device.id);
  const create = useCreateSpace();
  const spaces = useSpaces();
  const devices = useDevices();
  const cameras = useCameras(device.spaceId ?? undefined);
  const tables = useSocketTables(SOCKET_HOST_TYPES.includes(device.type) ? [device.id] : []);
  const [typed, setTyped] = useState<string | null>(null);
  // Opened from a place that wants the device: that place is chosen, and nothing is written before the button.
  const [chosen, setChosen] = useState<string | null>(to);
  const [placeName, setPlaceName] = useState('');
  /** The place a first try made before the move was refused, so a second try makes no second one. */
  const [made, setMade] = useState<Space | null>(null);

  const among = devices.data?.items;
  const title = deviceTitle(device, t, among);
  const stored = givenName(device);
  const wanted = (typed ?? stored ?? '').trim() || null;
  const renamed = wanted !== stored;
  const listed = spaces.data?.items ?? [];
  const here = listed.find(space => space.id === device.spaceId) ?? null;
  // Only a room this account can see is one a new place can be made in.
  const roomId = here?.roomId && listed.some(space => space.id === here.roomId) ? here.roomId : null;
  // A device stands only in a place of its owner, so only its owner is asked where: somebody who manages the
  // place it stands in renames it and no more.
  const mine = user !== null && device.ownerId === user.id;
  const moving = mine && chosen !== null && chosen !== device.spaceId;
  const busy = write.isPending || create.isPending;

  const along = [
    ...(cameras.data?.items ?? [])
      .filter(camera => camera.deviceId === device.id && camera.removedAt === null)
      .map(camera => t('devices.settings.withCamera', { name: cameraTitle(camera, device, t) })),
    ...[tables.tables.get(device.id)?.items.length ?? 0].filter(count => count > 0).map(count => t('devices.settings.withSockets', { count })),
  ];

  const save = async () => {
    try {
      const fresh = chosen === NEW;
      const to = !moving
        ? null
        : fresh
          ? (made ?? (await create.mutateAsync({ kind: placeKindOf(device.type), name: placeName.trim(), ...(roomId ? { roomId } : {}) })))
          : (listed.find(space => space.id === chosen) ?? null);
      if (fresh && to) setMade(to);
      const body: DeviceUpdate = { ...(renamed ? { name: wanted } : {}), ...(to ? { spaceId: to.id } : {}) };
      const after = await write.mutateAsync(body);
      const name = deviceTitle(after, t, among);
      const back: DeviceUpdate = { ...(renamed ? { name: device.name } : {}), ...(to ? { spaceId: device.spaceId } : {}) };

      tell({
        label: [
          renamed ? t('devices.settings.told.named', { was: title, name }) : null,
          to ? t('devices.settings.told.moved', { name, place: to.name }) : null,
          to && along.length > 0 ? t('devices.settings.told.with', { what: along.join(', ') }) : null,
        ]
          .filter(Boolean)
          .join(' · '),
        undo: fresh ? null : () => write.mutateAsync(back),
        from: `device-${device.id}`,
      });
      onClose();
    } catch {
      // Said in the sheet, from the write that refused.
    }
  };

  return (
    <Sheet
      title={t('devices.settings.open')}
      onClose={onClose}
      actions={
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={busy || !(renamed || moving) || (chosen === NEW && placeName.trim() === '')}
          onClick={() => void save()}
        >
          {t(moving ? (busy ? 'devices.settings.moving' : 'devices.settings.move') : busy ? 'devices.settings.saving' : 'devices.settings.save')}
        </button>
      }
    >
      <div className={ui.sheetBody}>
        <Block label={t('devices.settings.name')} help="deviceName">
          <input
            className={ui.input}
            value={typed ?? stored ?? ''}
            aria-label={t('devices.settings.name')}
            placeholder={title}
            autoComplete="off"
            onChange={event => setTyped(event.target.value)}
          />
        </Block>

        {mine ? (
          <Block label={t('devices.settings.place')} help="deviceMove">
            <div className={styles.places}>
              <Choices label={t('devices.settings.place')}>
                {placesFor(listed)
                  .filter(space => space.ownerId === device.ownerId)
                  .map(space => (
                    <Choice key={space.id} chosen={space.id === (chosen ?? device.spaceId)} disabled={busy} onChoose={() => setChosen(space.id)}>
                      {space.name}
                    </Choice>
                  ))}
                <Choice chosen={chosen === NEW} disabled={busy} onChoose={() => setChosen(NEW)}>
                  + {t('devices.settings.newPlace')}
                </Choice>
              </Choices>
            </div>
            {chosen === NEW ? (
              <input
                className={ui.input}
                value={placeName}
                aria-label={t('devices.settings.newPlaceName')}
                placeholder={t('devices.settings.newPlaceName')}
                autoComplete="off"
                onChange={event => {
                  setPlaceName(event.target.value);
                  setMade(null);
                }}
              />
            ) : null}
            {moving && along.length > 0 ? (
              <p className={styles.along}>
                <Facts facts={[`${t('devices.settings.with')} ${along[0]}`, ...along.slice(1)]} />
              </p>
            ) : null}
          </Block>
        ) : null}

        <Refused error={create.error ?? write.error} />
      </div>
    </Sheet>
  );
}
