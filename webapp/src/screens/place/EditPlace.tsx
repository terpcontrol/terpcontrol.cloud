import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';
import { nameKey } from '@fg2/shared-types/v1-schemas/place-names.js';
import type { Device, Space, SpaceKind, SpaceUpdate } from '@fg2/shared-types/v1';
import { useCameras } from '@/api/cameras';
import { useDevices } from '@/api/devices';
import { useMembers, useRoomsMembers } from '@/api/members';
import { useSavePlace, useSpaces } from '@/api/spaces';
import { cameraPath, devicePath, membersPath, placePath, placesOf, removePath, usePageOfPlace } from '@/app/places';
import { useLog } from '@/log/log-context';
import { DeviceSettingsSheet } from '@/screens/devices/DeviceSettingsSheet';
import { Members } from '@/screens/space/members/Members';
import { inSentence, mentionsOn } from '@/screens/space/members/people';
import { camerasCalled } from '@/ui/camera-name';
import { Help } from '@/ui/Help';
import { cameraTitle, deviceTitle, givenName, PLACE_KINDS, typeName } from '@/ui/naming';
import { PageHead } from '@/ui/PageHead';
import { LoadFailed, NoLongerHere, Refused, Waiting } from '@/ui/PageState';
import { usePlaceDevices } from '@/ui/place-devices';
import { Row, Rows } from '@/ui/Rows';
import { useMayIn, useMayManage } from '@/ui/session-access';
import { Sheet } from '@/ui/Sheet';
import ui from '@/ui/ui.module.css';
import styles from './Place.module.css';

/** The room select's entries that are no room: none, one still to be made, and another name for the one the place stands in. */
const NO_ROOM = 'none';
const NEW_ROOM = 'new';
const RENAME_ROOM = 'rename';

/**
 * "Ort bearbeiten", which the ⋯ beside a place's name opens: what a place is
 * called, what kind it is, the room it stands in, the devices standing in it,
 * who else is let in, and its end. Everything that is done to a place now and
 * then rather than every day is here and nowhere else.
 *
 * It needs the right to manage the place; a member who may only look or log is
 * shown who else is here instead, which is where they leave. The room, the
 * people and the end are the owner's. A room says whom it lets in where it is
 * chosen, the save says who sees the place now and who no longer does, and
 * the save that ends a room with people in it asks first. A room has no page
 * of its own, so the one the place stands in is renamed here as well.
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

/** What a save changes, as the toast names it: the name, the kind, the room by its name. */
interface Stand {
  name: string;
  kind: SpaceKind;
  room: string | null;
}

function Editing({ space, listed }: { space: Space; listed: readonly Space[] }) {
  const { t, i18n } = useTranslation();
  const { tell } = useLog();
  const owns = useMayIn(space.id, 'own');
  const save = useSavePlace(space.id);
  const renameRoom = useSavePlace(space.roomId ?? '');

  const places = placesOf(listed, space.ownerId);
  const rooms = listed.filter(one => one.kind === 'room' && one.ownerId === space.ownerId && one.archivedAt === null);
  const room = rooms.find(one => one.id === space.roomId) ?? null;
  // Whom each room lets in, and this place by itself: what a change of room gives and takes is said before and after it.
  const roomMembers = useRoomsMembers(owns ? rooms.map(one => one.id) : []);
  const members = useMembers(space.id, owns);
  const guests = mentionsOn(members.data, space.id);
  const inRoom = (one: Space | null) => mentionsOn(one ? roomMembers.get(one.id) : undefined, one?.id ?? null);

  const [typed, setTyped] = useState<string | null>(null);
  const [kind, setKind] = useState<SpaceKind | null>(null);
  const [roomChoice, setRoomChoice] = useState<string | null>(null);
  const [roomTyped, setRoomTyped] = useState('');
  const [asking, setAsking] = useState(false);

  const name = (typed ?? space.name).trim().replace(/\s+/g, ' ');
  const chosenKind = kind ?? space.kind;
  const stands = space.roomId ?? NO_ROOM;
  const chosenRoom = roomChoice ?? stands;
  const newRoom = roomTyped.trim().replace(/\s+/g, ' ');
  // Typing the name of a room that exists is choosing it, which the server does too.
  const into =
    chosenRoom === NEW_ROOM
      ? (rooms.find(one => nameKey(one.name) === nameKey(newRoom)) ?? null)
      : (rooms.find(one => one.id === chosenRoom) ?? null);
  const naming = chosenRoom === RENAME_ROOM && room !== null;
  const roomNamed = naming && newRoom !== room.name;
  // Names are unique among an account's rooms as among its places: said before the server refuses it.
  const roomTaken = (roomNamed && rooms.find(one => one.id !== room.id && nameKey(one.name) === nameKey(newRoom))) || null;
  const roomMoves = chosenRoom === NEW_ROOM ? newRoom !== '' && (into === null || into.id !== room?.id) : !naming && chosenRoom !== stands;
  const taken = places.find(one => one.id !== space.id && nameKey(one.name) === nameKey(name)) ?? null;
  const renamed = name !== space.name;
  const placeChanged = renamed || chosenKind !== space.kind || roomMoves;
  const typing = chosenRoom === NEW_ROOM || naming;
  // A room is left only once it is known whom it lets in: the answer comes with the place's own people.
  const ready =
    (placeChanged || roomNamed) &&
    name !== '' &&
    taken === null &&
    roomTaken === null &&
    !(typing && newRoom === '') &&
    !(roomMoves && members.isPending) &&
    !save.isPending &&
    !renameRoom.isPending;
  // A room comes with the second place: one tent has nothing to be grouped with.
  const asksRoom = owns && (places.length > 1 || room !== null);

  const leaves = roomMoves ? mentionsOn(members.data, room?.id ?? null) : new Map<string, string>();
  const joins = roomMoves ? inRoom(into) : new Map<string, string>();
  const only = (some: Map<string, string>, others: Map<string, string>) =>
    [...some].filter(([id]) => !others.has(id) && !guests.has(id)).map(([, mention]) => mention);
  // A room ends when its last place leaves it, and whoever was let into it is let out: that is asked first.
  const endsRoom = roomMoves && room !== null && !places.some(one => one.id !== space.id && one.roomId === room.id) && leaves.size > 0;

  const said = (was: Stand, now: Stand, sees: string[], seesNoMore: string[]) =>
    [
      was.name !== now.name ? t('place.edit.told.named', { was: was.name, name: now.name }) : null,
      // The name stands by itself before the kind and the room, unless the line before has just said it.
      (was.kind !== now.kind || (was.room !== now.room && now.room !== null)) && was.name === now.name ? now.name : null,
      was.kind !== now.kind ? t('place.edit.told.kind', { kind: t(`place.edit.kind.${now.kind}`) }) : null,
      was.room === now.room ? null : now.room ? t('place.edit.told.room', { room: now.room }) : t('place.edit.told.noRoom', { name: now.name }),
      sees.length > 0 ? t('place.edit.told.sees', { count: sees.length, people: inSentence(sees, i18n.language) }) : null,
      seesNoMore.length > 0 ? t('place.edit.told.seesNoMore', { count: seesNoMore.length, people: inSentence(seesNoMore, i18n.language) }) : null,
    ]
      .filter(Boolean)
      .join(' · ');

  const write = async () => {
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
    const [sees, seesNoMore] = [only(joins, leaves), only(leaves, joins)];
    setAsking(false);
    try {
      if (roomNamed) {
        const named = await renameRoom.mutateAsync({ name: newRoom });
        tell({
          label: t('place.edit.told.named', { was: room.name, name: named.name }),
          undo: () => renameRoom.mutateAsync({ name: room.name }),
          undone: t('place.edit.told.named', { was: named.name, name: room.name }),
          from: `room-${room.id}`,
        });
        setRoomChoice(null);
        setRoomTyped('');
      }
      if (!placeChanged) return;
      const saved = await save.mutateAsync(body);
      const was: Stand = { name: space.name, kind: space.kind, room: room?.name ?? null };
      // The room by the name it is stored under, not as it was typed.
      const now: Stand = {
        name: saved.name,
        kind: saved.kind,
        room: roomMoves ? (into?.name ?? (chosenRoom === NEW_ROOM ? newRoom : null)) : was.room,
      };
      tell({
        label: said(was, now, sees, seesNoMore),
        // A room that ended took its people along, and writing the place back would not bring them in again.
        undo: endsRoom ? null : () => save.mutateAsync(back),
        undone: said(now, was, seesNoMore, sees),
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
        className={ui.stack3}
        noValidate
        onSubmit={event => {
          event.preventDefault();
          if (!ready) return;
          if (endsRoom) setAsking(true);
          else void write();
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

        <div className={styles.pair} data-stacked={rooms.some(one => inRoom(one).size > 0) || undefined}>
          <label className={styles.field}>
            {t('place.edit.kindLabel')}
            <select className={ui.input} value={chosenKind} onChange={event => setKind(event.target.value as SpaceKind)}>
              {PLACE_KINDS.map(one => (
                <option key={one} value={one}>
                  {t(`place.edit.kind.${one}`)}
                </option>
              ))}
            </select>
          </label>
          {asksRoom ? (
            <label className={styles.field}>
              {t('place.edit.room')}
              <select
                className={ui.input}
                value={chosenRoom}
                onChange={event => {
                  setRoomChoice(event.target.value);
                  // The field starts on the name there is to change, and empty for one still to be given.
                  setRoomTyped(event.target.value === RENAME_ROOM ? (room?.name ?? '') : '');
                }}
              >
                {rooms.map(one => (
                  <option key={one.id} value={one.id}>
                    {inRoom(one).size > 0 ? t('place.edit.roomWith', { room: one.name, count: inRoom(one).size }) : one.name}
                  </option>
                ))}
                <option value={NEW_ROOM}>{t('place.edit.newRoom')}</option>
                <option value={NO_ROOM}>{t('place.edit.noRoom')}</option>
                {room ? <option value={RENAME_ROOM}>{t('place.edit.renameRoom', { room: room.name })}</option> : null}
              </select>
            </label>
          ) : null}
        </div>
        {asksRoom && typing ? (
          <label className={styles.field}>
            {t('place.edit.newRoomName')}
            {/* Chosen a moment ago, so the keyboard comes up for the one thing left to type. */}
            <input
              className={ui.input}
              value={roomTyped}
              autoComplete="off"
              maxLength={80}
              autoFocus
              aria-invalid={roomTaken !== null || undefined}
              onChange={event => setRoomTyped(event.target.value)}
            />
          </label>
        ) : null}
        {roomTaken ? (
          <p className={ui.problem} role="alert">
            {t('place.edit.roomTaken', { name: roomTaken.name })}
          </p>
        ) : null}
        <Refused error={renameRoom.error ?? save.error} />
      </form>

      <DevicesHere space={space} />

      <section className={`${ui.stack2} ${styles.block}`} aria-labelledby="place-people">
        <h2 className={styles.blockTitle}>
          <span id="place-people">{t('place.edit.people', { name: space.name })}</span>
          <Help topic="memberRole" />
        </h2>
        <Members spaceId={space.id} name={space.name} roomId={space.roomId} />
      </section>

      {owns && places.length > 1 ? (
        <Link to={removePath(space.id)} className={styles.remove}>
          {t('place.edit.remove', { name: space.name })} …
        </Link>
      ) : null}

      {asking && room ? (
        <Sheet
          title={t('place.edit.endRoom.title', { name: space.name, room: room.name })}
          note={t('place.edit.endRoom.final')}
          onClose={() => setAsking(false)}
          actions={
            <>
              <button type="button" className={`${ui.button} ${ui.dangerFilled}`} onClick={() => void write()}>
                {t('place.edit.endRoom.yes', { room: room.name })}
              </button>
              <button type="button" className={ui.button} onClick={() => setAsking(false)}>
                {t('place.edit.endRoom.no')}
              </button>
            </>
          }
        >
          <p className={ui.sheetBody}>
            {t('place.edit.endRoom.says', { count: leaves.size, room: room.name, people: inSentence([...leaves.values()], i18n.language) })}
          </p>
        </Sheet>
      ) : null}
    </section>
  );
}

/**
 * The devices and cameras standing here, each leading to its own page, and the
 * way to bring another: one standing in another place moves by the device's
 * own sheet - which says what goes with it and takes it back - and a new one
 * is added by its code. A device or a Terp Cam nobody named is told from
 * another of its kind within the list it stands in, not within the account.
 */
function DevicesHere({ space }: { space: Space }) {
  const { t } = useTranslation();
  const here = usePlaceDevices(space.id).items;
  const every = useDevices().data?.items;
  const cameras = useCameras(space.id).data?.items.filter(camera => camera.removedAt === null) ?? [];
  const called = camerasCalled(cameras.map(camera => cameraTitle(camera, here.find(device => device.id === camera.deviceId) ?? null, t)));
  const spaces = useSpaces().data?.items ?? [];
  // A device stands only in a place of its owner: only the owner of the place brings one, and only one of their own.
  const owns = useMayIn(space.id, 'own');
  const elsewhere = (every ?? []).filter(device => device.spaceId !== space.id && device.ownerId === space.ownerId);
  const [bringing, setBringing] = useState(false);
  const [moving, setMoving] = useState<Device | null>(null);
  const claim = `/claim?space=${encodeURIComponent(space.id)}`;

  // Somebody who may not bring a device is shown no heading over nothing.
  if (!owns && here.length === 0 && cameras.length === 0) return null;

  return (
    <section className={`${ui.stack2} ${styles.block}`} aria-labelledby="place-devices">
      <h2 id="place-devices" className={styles.blockTitle}>
        {t('place.edit.devices')}
      </h2>
      <Rows>
        {here.map(device => (
          <Row
            key={device.id}
            title={deviceTitle(device, t, here)}
            line={givenName(device) ? typeName(device.type, t) : undefined}
            to={devicePath(device.id)}
          />
        ))}
        {cameras.map((camera, at) => (
          <Row key={camera.id} title={called[at]} line={t('place.edit.camera')} to={cameraPath(camera.id)} />
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
                  title={deviceTitle(device, t, elsewhere)}
                  line={spaces.find(one => one.id === device.spaceId)?.name ?? t('place.edit.nowhere')}
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
