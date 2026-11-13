import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device, DeviceUpdate, Space } from '@fg2/shared-types/v1';
import { SOCKET_HOST_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { useCameras } from '@/api/cameras';
import { useDevices, useSocketTables, useUpdateDevice } from '@/api/devices';
import { useCreateSpace, useSpaces } from '@/api/spaces';
import { useSession } from '@/api/session';
import { placesOf } from '@/app/places';
import { useLog } from '@/log/log-context';
import { cameraCalled } from '@/ui/camera-name';
import { Facts } from '@/ui/Facts';
import { cameraTitle, deviceTitle, givenName, placeKindOf, standingWith } from '@/ui/naming';
import { Refused } from '@/ui/PageState';
import { Sheet } from '@/ui/Sheet';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import styles from './Devices.module.css';

/** The chip that stands for a place still to be made. */
const NEW = 'new';

/**
 * What a device is called, and which place it stands in: one sheet with one
 * button, before which nothing is written. A place chip only chooses; the
 * sheet then says what goes with the device - the camera it answers for, its
 * smart sockets - and the button says "Umziehen". The toast says what was
 * done, with the way to take it back, and taking it back says what holds again.
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

  // Told from another of its kind where one stands beside it, as its card is: in the place it leaves, and in the one it comes to.
  const title = deviceTitle(device, t, standingWith(device, devices.data?.items));
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

  // A Terp Cam nobody named needs what is printed on it only to be told from a second one going along.
  const cams = (cameras.data?.items ?? []).filter(camera => camera.deviceId === device.id && camera.removedAt === null);
  const along = [
    ...cams.map(camera => t('devices.settings.withCamera', { name: cameraCalled(cameraTitle(camera, device, t), cams.length < 2) })),
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
      const name = deviceTitle(after, t, standingWith(after, devices.data?.items));
      const back: DeviceUpdate = { ...(renamed ? { name: device.name } : {}), ...(to ? { spaceId: device.spaceId } : {}) };

      // The place it stands in now is named by itself, with the device after it; none is said in a sentence of its own.
      const said = (was: string, now: string, place: string | null) =>
        [
          renamed ? t('devices.settings.told.named', { was, name: now }) : null,
          !to ? null : place ? t('devices.settings.told.moved', { name: now, place }) : t('devices.settings.told.nowhere', { name: now }),
          to && along.length > 0 ? t('devices.settings.told.with', { what: along.join(', ') }) : null,
        ]
          .filter(Boolean)
          .join(' · ');
      tell({
        label: said(title, name, to?.name ?? null),
        undo: fresh ? null : () => write.mutateAsync(back),
        undone: said(name, title, here?.name ?? null),
        from: `device-${device.id}`,
      });
      onClose();
    } catch {
      // Said in the sheet, from the write that refused.
    }
  };

  return (
    <Sheet
      title={t(mine ? 'devices.settings.open' : 'devices.settings.rename')}
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
            <Choices label={t('devices.settings.place')}>
              {placesOf(listed, device.ownerId).map(space => (
                <Choice key={space.id} chosen={space.id === (chosen ?? device.spaceId)} disabled={busy} onChoose={() => setChosen(space.id)}>
                  {space.name}
                </Choice>
              ))}
              <Choice chosen={chosen === NEW} disabled={busy} onChoose={() => setChosen(NEW)}>
                + {t('devices.settings.newPlace')}
              </Choice>
            </Choices>
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
