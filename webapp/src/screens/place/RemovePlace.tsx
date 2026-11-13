import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import type { Space } from '@fg2/shared-types/v1';
import { useCameras } from '@/api/cameras';
import { useDevices } from '@/api/devices';
import { useSpaceGrows } from '@/api/grows';
import { useMembers } from '@/api/members';
import { useEndPlace, useSpaces, type EndNote } from '@/api/spaces';
import { editPath } from '@/app/places';
import { useLog } from '@/log/log-context';
import { OWN_CLIMATE, newPlaceName } from '@/screens/claim/steps';
import { listed } from '@/screens/notifications/settings';
import { cameraTitle, deviceTitle } from '@/ui/naming';
import { PageHead } from '@/ui/PageHead';
import { LoadFailed, NoLongerHere, Waiting } from '@/ui/PageState';
import { refusalText } from '@/ui/refusal';
import { useMayIn } from '@/ui/session-access';
import { Sheet } from '@/ui/Sheet';
import ui from '@/ui/ui.module.css';
import {
  END,
  NEW_PLACE,
  NOWHERE,
  RELEASE,
  STAY,
  UNCOUPLE,
  choicesOf,
  fatesOf,
  gathered,
  leaderOf,
  moveTo,
  settled,
  standingIn,
  unusedOf,
  withDevice,
  type Fate,
  type Standing,
} from './remove-plan';
import styles from './Place.module.css';

/**
 * "Ort entfernen": a place ends, and everything standing in it is sent
 * somewhere first - the devices together unless told otherwise, each camera,
 * each running grow. The button waits until every grow has been answered -
 * where the plants stand is not guessed - and then asks once, with every line
 * as it will happen; nothing is written before that answer.
 *
 * What was measured and written here stays with the grow that stood here.
 */
export function RemovePlace() {
  const { spaceId = '' } = useParams();
  const spaces = useSpaces();
  const devices = useDevices();
  const cameras = useCameras();
  const grows = useSpaceGrows(spaceId || null);
  const owns = useMayIn(spaceId, 'own');

  if (spaces.isPending) return <Waiting lines={5} />;
  // Asked before anything else is read: a place that has ended, or never was, has nothing to try again for.
  const space = spaces.data?.items.find(one => one.id === spaceId && one.archivedAt === null) ?? null;
  if (spaces.data && (!space || space.kind === 'room')) return <NoLongerHere what="space" />;
  if (devices.isPending || cameras.isPending || grows.isPending) return <Waiting lines={5} />;
  if (!spaces.data || !space || !devices.data || !cameras.data || !grows.data) {
    return <LoadFailed retry={() => [spaces, devices, cameras, grows].forEach(read => void read.refetch())} />;
  }

  // Ending a place is its owner's, and never the last one: that one is Start itself.
  const elsewhere = spaces.data.items.filter(
    one => one.id !== space.id && one.kind !== 'room' && one.archivedAt === null && one.ownerId === space.ownerId,
  );
  if (!owns || elsewhere.length === 0) return <Navigate to={editPath(space.id)} replace />;

  const running = grows.data.items
    .filter(grow => grow.endedAt === null)
    .map(grow => ({ growId: grow.id, name: grow.name, day: grow.summary.dayNumber }));

  return (
    <Removing space={space} elsewhere={elsewhere} standing={standingIn(space.id, devices.data.items, cameras.data.items, running)} days={running} />
  );
}

/** One thing standing here, and the select that says where it goes. */
function Sent({
  label,
  value,
  disabled,
  asked = false,
  onChange,
  children,
}: {
  label: string;
  value: string;
  disabled: boolean;
  asked?: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className={styles.sent}>
      {label}
      <select
        className={ui.input}
        value={value}
        disabled={disabled}
        aria-invalid={(asked && value === '') || undefined}
        onChange={event => onChange(event.target.value)}
      >
        {children}
      </select>
    </label>
  );
}

function Removing({
  space,
  elsewhere,
  standing: here,
  days,
}: {
  space: Space;
  elsewhere: readonly Space[];
  standing: Standing;
  days: readonly { growId: string; day: number | null }[];
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { tell } = useLog();
  const every = useDevices().data?.items;
  const taken = useSpaces().data?.items.filter(one => one.kind !== 'room' && one.archivedAt === null && one.ownerId === space.ownerId) ?? [];
  const members = useMembers(space.id);
  const end = useEndPlace(space.id);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState(false);
  // Whether the answers are the ones the question was answered with: trying those again needs no second question.
  const [agreed, setAgreed] = useState(false);
  // What the first attempt was about and how far the attempts came: the lists read again after one no longer hold
  // what has gone, and the answers given about it would go with it.
  const [attempt, setAttempt] = useState<{ standing: Standing; done: string[]; made: Record<string, Space | null> } | null>(null);

  const standing = attempt?.standing ?? here;
  const made = attempt?.made ?? {};
  const held = new Set((every ?? []).flatMap(device => (device.spaceId && OWN_CLIMATE.includes(device.type) ? [device.spaceId] : [])));
  const choices = choicesOf(standing, elsewhere, chosen, held);
  const leader = leaderOf(standing, choices);
  const names = new Map<string, string>([
    ...standing.devices.map(device => [device.id, deviceTitle(device, t, every)] as const),
    ...[...standing.paired, ...standing.loose].map(
      camera => [camera.id, cameraTitle(camera, standing.devices.find(device => device.id === camera.deviceId) ?? null, t)] as const,
    ),
    ...standing.grows.map(grow => [grow.growId, grow.name] as const),
  ]);
  // Inside a sentence a name is one thing: the dot in "Lüfter · A1B2C3" parts no line, and a toast makes no two facts of it.
  const name = (id: string | null) => (names.get(id ?? '') ?? '').replaceAll(' · ', '\u00a0·\u00a0');
  // Named as a claim names the place it makes: "Zelt 2", not after the hardware.
  const fates = fatesOf(standing, choices, device => newPlaceName(device.type, taken, t), taken, space.roomId, made);
  // A camera with no write of its own went when the device it is with did.
  const gone = new Set(fates.filter(fate => attempt?.done.includes(fate.step ? fate.id : (fate.beside ?? ''))).map(fate => fate.id));
  const open = fates.filter(fate => !gone.has(fate.id));
  const still = <T,>(things: readonly T[], id: (thing: T) => string) => things.filter(thing => !gone.has(id(thing)));

  // People are let go one at a time and by name, never by ending the place they are in.
  const guests = members.data?.items.filter(row => row.spaceId === space.id).length ?? 0;
  const ready = settled(standing, choices) && guests === 0 && !end.isPending;
  const again = agreed && end.isError;
  const sentences = (of: readonly Fate[]) =>
    gathered(of).map(({ how, place, ids }) =>
      t(`place.remove.did.${how}`, { count: ids.length, names: listed(ids.map(name), i18n.language), place }),
    );

  const choose = (id: string, value: string) => {
    setChosen(was => ({ ...was, [id]: value }));
    setAgreed(false);
  };
  const note = (one: EndNote) =>
    setAttempt(was => was && ('done' in one ? { ...was, done: [...was.done, one.done] } : { ...was, made: { ...was.made, [one.made]: one.place } }));
  const remove = () =>
    end.mutate(
      { steps: open.flatMap(fate => fate.step ?? []), drop: unusedOf(made, fates), note },
      {
        onSuccess: () => {
          tell({ label: [t('place.remove.told', { name: space.name }), ...sentences(fates)].join(' '), undo: null });
          void navigate('/', { replace: true });
        },
      },
    );
  const answer = () => {
    setAsking(false);
    setAgreed(true);
    // The defaults are answers from here on: a place made on the way is one more to choose, and must not move them.
    setChosen(choices);
    setAttempt(was => was ?? { standing, done: [], made: {} });
    remove();
  };

  const devices = still(standing.devices, device => device.id);
  const paired = still(standing.paired, camera => camera.id);
  const loose = still(standing.loose, camera => camera.id);
  const grows = still(standing.grows, grow => grow.growId);
  const moves = elsewhere.map(place => (
    <option key={place.id} value={moveTo(place.id)}>
      {t('place.remove.move', { place: place.name })}
    </option>
  ));
  const stays = leader ? <option value={STAY}>{t('place.remove.stay', { device: name(leader.id) })}</option> : null;

  return (
    <section className={`${styles.page} ${styles.reading} ${styles.editing}`}>
      <PageHead
        back={{ to: editPath(space.id), label: t('place.remove.back', { name: space.name }) }}
        title={t('place.remove.title', { name: space.name })}
      />

      {devices.length + paired.length + loose.length + grows.length > 0 ? (
        <section className={styles.block} aria-labelledby="place-holds">
          <h2 id="place-holds" className={styles.blockTitle}>
            {t('place.remove.holds')}
          </h2>
          <div className={ui.group}>
            {devices.map(device => (
              <Sent
                key={device.id}
                label={name(device.id)}
                value={choices[device.id]}
                disabled={end.isPending}
                onChange={value => choose(device.id, value)}
              >
                {/* One given up ahead of the leading device would lead again itself: it has nobody to stay with. */}
                {leader && standing.devices.indexOf(device) > standing.devices.indexOf(leader) ? stays : null}
                <option value={NEW_PLACE}>{t('place.remove.device.new')}</option>
                {moves}
                <option value={RELEASE}>{t('place.remove.device.release')}</option>
              </Sent>
            ))}
            {paired.map(camera => (
              <Sent
                key={camera.id}
                label={name(camera.id)}
                value={choices[camera.id]}
                disabled={end.isPending}
                onChange={value => choose(camera.id, value)}
              >
                <option value={STAY}>{t('place.remove.stay', { device: name(camera.deviceId) })}</option>
                <option value={UNCOUPLE}>{t('place.remove.camera.uncouple')}</option>
              </Sent>
            ))}
            {loose.map(camera => (
              <Sent
                key={camera.id}
                label={name(camera.id)}
                value={choices[camera.id]}
                disabled={end.isPending}
                onChange={value => choose(camera.id, value)}
              >
                {stays}
                {moves}
                <option value={UNCOUPLE}>{t('place.remove.camera.remove')}</option>
              </Sent>
            ))}
            {grows.map(grow => {
              const day = days.find(one => one.growId === grow.growId)?.day ?? null;
              return (
                <Sent
                  key={grow.growId}
                  label={day === null ? grow.name : `${grow.name} · ${t('home.card.dayN', { day })}`}
                  value={choices[grow.growId]}
                  disabled={end.isPending}
                  asked
                  onChange={value => choose(grow.growId, value)}
                >
                  <option value="">{t('place.remove.grow.ask')}</option>
                  {standing.devices
                    .filter(device => choices[device.id] === NEW_PLACE)
                    .map(device => (
                      <option key={device.id} value={withDevice(device.id)}>
                        {t('place.remove.grow.with', { device: name(device.id) })}
                      </option>
                    ))}
                  {elsewhere.map(place => (
                    <option key={place.id} value={moveTo(place.id)}>
                      {t('place.remove.grow.move', { place: place.name })}
                    </option>
                  ))}
                  <option value={NOWHERE}>{t('place.remove.grow.nowhere')}</option>
                  <option value={END}>{t('place.remove.grow.end')}</option>
                </Sent>
              );
            })}
          </div>
        </section>
      ) : null}

      <p className={ui.note}>
        {standing.grows.length > 0
          ? t('place.remove.kept', {
              names: listed(
                standing.grows.map(grow => grow.name),
                i18n.language,
              ),
            })
          : t('place.remove.curves', { name: space.name })}
      </p>
      {guests > 0 ? (
        <div className={styles.guests} role="status">
          <p className={ui.problem}>{t('place.remove.guests', { count: guests })}</p>
          <Link to={editPath(space.id)} className={ui.button}>
            {t('place.remove.toGuests')}
          </Link>
        </div>
      ) : null}
      {end.isError ? (
        <div className={styles.guests} role="alert">
          <p className={ui.problem}>
            {t('place.remove.half.still', { name: space.name })} {refusalText(end.error)}
          </p>
          {gone.size > 0 ? <p>{t('place.remove.half.done', { what: sentences(fates.filter(fate => gone.has(fate.id))).join(' ') })}</p> : null}
          {open.length > 0 ? (
            <p>
              {t('place.remove.half.left', {
                names: listed(
                  open.map(fate => name(fate.id)),
                  i18n.language,
                ),
              })}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className={styles.foot}>
        <button
          type="button"
          className={`${ui.button} ${ui.dangerFilled} ${styles.end}`}
          disabled={!ready}
          onClick={again ? remove : () => setAsking(true)}
        >
          {end.isPending ? t('place.remove.removing') : again ? t('home.retry') : t('place.remove.remove', { name: space.name })}
        </button>
        <Link to={editPath(space.id)} className={styles.cancel}>
          {t('place.remove.cancel')}
        </Link>
      </div>

      {asking ? (
        <Sheet
          title={t('place.remove.ask', { name: space.name })}
          note={t('place.remove.final')}
          onClose={() => setAsking(false)}
          actions={
            <>
              <button type="button" className={`${ui.button} ${ui.dangerFilled} ${styles.end}`} onClick={answer}>
                {t('place.remove.remove', { name: space.name })}
              </button>
              <button type="button" className={ui.button} onClick={() => setAsking(false)}>
                {t('place.remove.cancel')}
              </button>
            </>
          }
        >
          <ul className={styles.will}>
            {open.map(fate => (
              <li key={fate.id}>{t(`place.remove.will.${fate.fate}`, { name: name(fate.id), place: fate.place, beside: name(fate.beside) })}</li>
            ))}
          </ul>
        </Sheet>
      ) : null}
    </section>
  );
}
