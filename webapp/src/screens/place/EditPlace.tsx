import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';
import { nameKey } from '@fg2/shared-types/v1-schemas/place-names.js';
import type { Device, Space, SpaceKind, SpaceUpdate } from '@fg2/shared-types/v1';
import { useCameras } from '@/api/cameras';
import { useDevices } from '@/api/devices';
import { useSavePlace, useSpaces } from '@/api/spaces';
import { cameraPath, devicePath, membersPath, placePath, removePath, usePageOfPlace } from '@/app/places';
import { useLog } from '@/log/log-context';
import { DeviceSettingsSheet } from '@/screens/devices/DeviceSettingsSheet';
import { Members } from '@/screens/space/members/Members';
import { cameraTitle, deviceTitle, givenName, typeName } from '@/ui/naming';
import { PageHead } from '@/ui/PageHead';
import { LoadFailed, NoLongerHere, Refused, Waiting } from '@/ui/PageState';
import { usePlaceDevices } from '@/ui/place-devices';
import { Row, Rows } from '@/ui/Rows';
import { useMayIn, useMayManage } from '@/ui/session-access';
import { Sheet } from '@/ui/Sheet';
import ui from '@/ui/ui.module.css';
import styles from './Place.module.css';

/** The kinds a place is; a room is none of them - it is the field below. */
const KINDS: readonly SpaceKind[] = ['tent', 'fridge', 'balcony', 'other'];

/** The room select's two entries that are no room. */
const NO_ROOM = 'none';
const NEW_ROOM = 'new';

/**
 * "Ort bearbeiten", which the ⋯ beside a place's name opens: what a place is
 * called, what kind it is, the room it stands in, the devices standing in it,
 * who else is let in, and its end. Everything that is done to a place now and
 * then rather than every day is here and nowhere else.
 *
 * It needs the right to manage the place; a member who may only look or log is
 * shown who else is here instead, which is where they leave. The room, the
 * people and the end are the owner's.
 */
export function EditPlace() {
  const { spaceId = '' } = useParams();
  const spaces = useSpaces();
  const mayManage = useMayManage(spaceId);
  usePageOfPlace(spaceId || null);

  if (spaces.isPending) return <Waiting lines={5} />;
  if (!spaces.data) return <LoadFailed retry={() => void spaces.refetch()} />;

  const space = spaces.data.items.find(one => one.id === spaceId && one.archivedAt === null) ?? null;
  // A room is a field of the places in it and has no page of its own.
  if (!space || space.kind === 'room') return <NoLongerHere what="space" />;
  if (!mayManage) return <Navigate to={membersPath(space.id)} replace />;

  return <Editing space={space} listed={spaces.data.items} />;
}

function Editing({ space, listed }: { space: Space; listed: readonly Space[] }) {
  const { t } = useTranslation();
  const { tell } = useLog();
  const owns = useMayIn(space.id, 'own');
  const save = useSavePlace(space.id);

  const own = listed.filter(one => one.ownerId === space.ownerId && one.archivedAt === null);
  const places = own.filter(one => one.kind !== 'room');
  const rooms = own.filter(one => one.kind === 'room');
  const room = rooms.find(one => one.id === space.roomId) ?? null;

  const [typed, setTyped] = useState<string | null>(null);
  const [kind, setKind] = useState<SpaceKind | null>(null);
  const [roomChoice, setRoomChoice] = useState<string | null>(null);
  const [roomTyped, setRoomTyped] = useState('');

  const name = (typed ?? space.name).trim().replace(/\s+/g, ' ');
  const chosenKind = kind ?? space.kind;
  const stands = space.roomId ?? NO_ROOM;
  const chosenRoom = roomChoice ?? stands;
  const newRoom = roomTyped.trim().replace(/\s+/g, ' ');
  // Typing the name of a room that exists is choosing it, which the server does too.
  const roomMoves = chosenRoom === NEW_ROOM ? newRoom !== '' && nameKey(newRoom) !== nameKey(room?.name ?? '') : chosenRoom !== stands;
  const taken = places.find(one => one.id !== space.id && nameKey(one.name) === nameKey(name)) ?? null;
  const renamed = name !== space.name;
  const changed = renamed || chosenKind !== space.kind || roomMoves;
  const ready = changed && name !== '' && taken === null && !(chosenRoom === NEW_ROOM && newRoom === '') && !save.isPending;
  // A room comes with the second place: one tent has nothing to be grouped with.
  const asksRoom = owns && (places.length > 1 || room !== null);

  const submit = async () => {
    if (!ready) return;
    const body: SpaceUpdate = {
      ...(renamed ? { name } : {}),
      ...(chosenKind !== space.kind ? { kind: chosenKind } : {}),
      ...(!roomMoves ? {} : chosenRoom === NEW_ROOM ? { roomName: newRoom } : { roomId: chosenRoom === NO_ROOM ? null : chosenRoom }),
    };
    // What takes it back, by the room's name: the room it left may have ended with its last place.
    const back: SpaceUpdate = {
      ...(renamed ? { name: space.name } : {}),
      ...(chosenKind !== space.kind ? { kind: space.kind } : {}),
      ...(!roomMoves ? {} : room ? { roomName: room.name } : { roomId: null }),
    };
    try {
      const saved = await save.mutateAsync(body);
      const into = roomMoves ? (chosenRoom === NEW_ROOM ? newRoom : (rooms.find(one => one.id === chosenRoom)?.name ?? null)) : null;
      tell({
        label: [
          renamed ? t('place.edit.told.named', { was: space.name, name: saved.name }) : null,
          chosenKind !== space.kind ? t('place.edit.told.kind', { name: saved.name, kind: t(`place.edit.kind.${saved.kind}`) }) : null,
          !roomMoves ? null : into ? t('place.edit.told.room', { name: saved.name, room: into }) : t('place.edit.told.noRoom', { name: saved.name }),
        ]
          .filter(Boolean)
          .join(' · '),
        undo: () => save.mutateAsync(back),
        from: `place-${space.id}`,
      });
      setTyped(null);
      setKind(null);
      setRoomChoice(null);
      setRoomTyped('');
    } catch {
      // Said on the page, from the write that was refused.
    }
  };

  return (
    <section className={`${styles.page} ${styles.reading} ${styles.editing}`}>
      <PageHead
        back={{ to: placePath(space.id), label: t('place.backTo', { name: space.name }) }}
        title={t('place.edit.title', { name: space.name })}
      >
        <button type="submit" form="place-edit" className={`${ui.button} ${ui.primary} ${styles.save}`} disabled={!ready}>
          {save.isPending ? t('place.edit.saving') : t('place.edit.save')}
        </button>
      </PageHead>

      {/* Its own form: the people below have fields of their own, and one form does not stand in another. */}
      <form
        id="place-edit"
        className={styles.fields}
        noValidate
        onSubmit={event => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className={styles.field}>
          {t('place.edit.name')}
          <input
            className={ui.input}
            value={typed ?? space.name}
            autoComplete="off"
            maxLength={80}
            aria-invalid={taken !== null || undefined}
            aria-describedby={taken ? 'place-name-taken' : undefined}
            onChange={event => setTyped(event.target.value)}
          />
        </label>
        {taken ? (
          <p id="place-name-taken" className={ui.problem} role="alert">
            {t('place.edit.taken', { name: taken.name })}
          </p>
        ) : null}

        <div className={styles.pair}>
          <label className={styles.field}>
            {t('place.edit.kindLabel')}
            <select className={ui.input} value={chosenKind} onChange={event => setKind(event.target.value as SpaceKind)}>
              {KINDS.map(one => (
                <option key={one} value={one}>
                  {t(`place.edit.kind.${one}`)}
                </option>
              ))}
            </select>
          </label>
          {asksRoom ? (
            <label className={styles.field}>
              {t('place.edit.room')}
              <select className={ui.input} value={chosenRoom} onChange={event => setRoomChoice(event.target.value)}>
                {rooms.map(one => (
                  <option key={one.id} value={one.id}>
                    {one.name}
                  </option>
                ))}
                <option value={NEW_ROOM}>{t('place.edit.newRoom')}</option>
                <option value={NO_ROOM}>{t('place.edit.noRoom')}</option>
              </select>
            </label>
          ) : null}
        </div>
        {asksRoom && chosenRoom === NEW_ROOM ? (
          <label className={styles.field}>
            {t('place.edit.newRoomName')}
            {/* Chosen a moment ago, so the keyboard comes up for the one thing left to type. */}
            <input
              className={ui.input}
              value={roomTyped}
              autoComplete="off"
              maxLength={80}
              autoFocus
              onChange={event => setRoomTyped(event.target.value)}
            />
          </label>
        ) : null}
        <Refused error={save.error} />
      </form>

      <DevicesHere space={space} />

      <section className={styles.block} aria-labelledby="place-people">
        <h2 id="place-people" className={styles.blockTitle}>
          {t('place.edit.people', { name: space.name })}
        </h2>
        <People space={space} room={owns ? room : null} />
      </section>

      {owns && places.length > 1 ? (
        <Link to={removePath(space.id)} className={styles.remove}>
          {t('place.edit.remove', { name: space.name })} …
        </Link>
      ) : null}
    </section>
  );
}

/**
 * Who is let in, and what an invitation is for: this place alone, or the room
 * it stands in with every place in it. The list, the links and the roles are
 * those of whichever the select names.
 */
function People({ space, room }: { space: Space; room: Space | null }) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<'place' | 'room'>('place');
  const shown = scope === 'room' && room ? room : space;

  return (
    <Members
      key={shown.id}
      spaceId={shown.id}
      name={shown.name}
      kind={shown.kind}
      roomId={shown.roomId}
      scope={
        room ? (
          <label className={styles.scope}>
            <span className={styles.scopeText}>
              {t('place.edit.scope')}
              <span className={styles.scopeNote}>{t('place.edit.scopeNote', { name: space.name, room: room.name })}</span>
            </span>
            <select
              className={`${ui.input} ${styles.scopeSelect}`}
              value={scope}
              onChange={event => setScope(event.target.value as 'place' | 'room')}
            >
              <option value="place">{space.name}</option>
              <option value="room">{room.name}</option>
            </select>
          </label>
        ) : null
      }
    />
  );
}

/**
 * The devices and cameras standing here, each leading to its own page, and the
 * way to bring another: one standing in another place moves by the device's
 * own sheet - which says what goes with it and takes it back - and a new one
 * is added by its code.
 */
function DevicesHere({ space }: { space: Space }) {
  const { t } = useTranslation();
  const here = usePlaceDevices(space.id).items;
  const every = useDevices().data?.items;
  const cameras = useCameras(space.id).data?.items.filter(camera => camera.removedAt === null) ?? [];
  const spaces = useSpaces().data?.items ?? [];
  // A device stands only in a place of its owner: only the owner of the place brings one, and only one of their own.
  const owns = useMayIn(space.id, 'own');
  const elsewhere = (every ?? []).filter(device => device.spaceId !== space.id && device.ownerId === space.ownerId);
  const [bringing, setBringing] = useState(false);
  const [moving, setMoving] = useState<Device | null>(null);
  const claim = `/claim?space=${encodeURIComponent(space.id)}`;

  return (
    <section className={styles.block} aria-labelledby="place-devices">
      <h2 id="place-devices" className={styles.blockTitle}>
        {t('place.edit.devices')}
      </h2>
      <Rows>
        {here.map(device => (
          <Row
            key={device.id}
            title={deviceTitle(device, t, every)}
            line={givenName(device) ? typeName(device.type, t) : undefined}
            to={devicePath(device.id)}
          />
        ))}
        {cameras.map(camera => (
          <Row
            key={camera.id}
            title={cameraTitle(camera, here.find(device => device.id === camera.deviceId) ?? null, t)}
            line={t('place.edit.camera')}
            to={cameraPath(camera.id)}
          />
        ))}
        {!owns ? null : elsewhere.length > 0 ? (
          <button type="button" className={styles.add} onClick={() => setBringing(true)}>
            + {t('place.edit.bring')}
          </button>
        ) : (
          <Link to={claim} className={styles.add}>
            + {t('place.edit.bring')}
          </Link>
        )}
      </Rows>
      {bringing ? (
        <Sheet title={t('place.edit.bringTitle', { name: space.name })} onClose={() => setBringing(false)}>
          <div className={ui.sheetBody}>
            <Rows>
              {elsewhere.map(device => (
                <Row
                  key={device.id}
                  title={deviceTitle(device, t, every)}
                  line={t('place.edit.standsIn', { place: spaces.find(one => one.id === device.spaceId)?.name ?? t('place.edit.nowhere') })}
                  onOpen={() => {
                    setBringing(false);
                    setMoving(device);
                  }}
                />
              ))}
              <Row title={t('place.edit.claim')} to={claim} />
            </Rows>
          </div>
        </Sheet>
      ) : null}
      {moving ? <DeviceSettingsSheet device={moving} to={space.id} onClose={() => setMoving(null)} /> : null}
    </section>
  );
}
