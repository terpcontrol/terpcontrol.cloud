import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import type { Device, MembershipPage, Space } from '@fg2/shared-types/v1';
import { OWN_CLIMATE_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { useCameras } from '@/api/cameras';
import { useDevices } from '@/api/devices';
import { useSpaceGrows } from '@/api/grows';
import { useMembers } from '@/api/members';
import { useEndPlace, useSpaces, type EndNote } from '@/api/spaces';
import { editPath } from '@/app/places';
import { useLog } from '@/log/log-context';
import { newPlaceName } from '@/screens/claim/steps';
import { inSentence, mentionsOn } from '@/screens/space/members/people';
import { cameraCalled } from '@/ui/camera-name';
import { cameraTitle, deviceTitle } from '@/ui/naming';
import { PageHead } from '@/ui/PageHead';
import { LoadFailed, NoLongerHere, Waiting } from '@/ui/PageState';
import { refusalText } from '@/ui/refusal';
import { useMayIn } from '@/ui/session-access';
import { Sheet } from '@/ui/Sheet';
import ui from '@/ui/ui.module.css';
import {
  END,
  GUESTS,
  MEMBERS,
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
  standingIn,
  unusedOf,
  withDevice,
  withSettled,
  type Fate,
  type Standing,
} from './remove-plan';
import styles from './Place.module.css';

/**
 * "Ort entfernen": a place ends, and everything standing in it is sent
 * somewhere first - the devices together unless told otherwise, each camera,
 * each running grow. The button waits until every grow has been answered -
 * where the plants stand is not guessed - and then asks once, with every line
 * as it will happen and everybody who then no longer sees the place or its
 * room; nothing is written before that answer, and nobody has to be let go
 * first.
 *
 * What was measured and written here stays with the grow that stood here.
 */
export function RemovePlace() {
  const { spaceId = '' } = useParams();
  const { t } = useTranslation();
  const spaces = useSpaces();
  const devices = useDevices();
  const cameras = useCameras();
  const grows = useSpaceGrows(spaceId || null);
  const members = useMembers(spaceId);
  const owns = useMayIn(spaceId, 'own');

  if (spaces.isPending) return <Waiting lines={5} />;
  // Asked before anything else is read: a place that has ended, or never was, has nothing to try again for.
  const space = spaces.data?.items.find(one => one.id === spaceId && one.archivedAt === null) ?? null;
  if (spaces.data && (!space || space.kind === 'room')) return <NoLongerHere what="space" />;
  // Ending a place is its owner's.
  if (space && !owns) return <Navigate to={editPath(space.id)} replace />;
  if (devices.isPending || cameras.isPending || grows.isPending || members.isPending) return <Waiting lines={5} />;
  if (!spaces.data || !space || !devices.data || !cameras.data || !grows.data || !members.data) {
    return <LoadFailed retry={() => [spaces, devices, cameras, grows, members].forEach(read => void read.refetch())} />;
  }

  const places = spaces.data.items.filter(one => one.kind !== 'room' && one.archivedAt === null && one.ownerId === space.ownerId);
  const back = { to: editPath(space.id), label: t('place.remove.back', { name: space.name }) };
  const running = grows.data.items.filter(grow => grow.endedAt === null).map(grow => ({ id: grow.id, name: grow.name, day: grow.summary.dayNumber }));

  return (
    <section className={`${styles.page} ${styles.reading} ${styles.editing}`}>
      <PageHead back={back} title={t('place.remove.title', { name: space.name })} />
      {places.length > 1 ? (
        <Removing
          space={space}
          places={places}
          every={devices.data.items}
          here={standingIn(space.id, devices.data.items, cameras.data.items, running)}
          letIn={members.data}
        />
      ) : (
        // Never the last one: that one is Start itself, which the page says rather than leading away without a word.
        <div className={styles.said}>
          <p>{t('place.remove.last', { name: space.name })}</p>
          <Link to={back.to} className={ui.button}>
            {back.label}
          </Link>
        </div>
      )}
    </section>
  );
}

/** What the question was answered with, one fate at a time: the thing, where it goes, and how many it is about. */
const agreedTo = (fate: Fate): string => [fate.id, fate.place ?? fate.fate, fate.count].join(' ');

/** `places` are the owner's, this one among them; `every` device of the account says which of them hold a climate already. */
type Ending = { space: Space; places: readonly Space[]; every: readonly Device[]; here: Standing; letIn: MembershipPage };

function Removing({ space, places, every, here, letIn }: Ending) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { tell } = useLog();
  const end = useEndPlace(space.id);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState(false);
  const [agreed, setAgreed] = useState<string[]>([]);
  // What the last attempt was about and how far the attempts came: what one of them sent away is in no list read
  // since, and what stays or goes with it has to find it still.
  const [attempt, setAttempt] = useState<{ standing: Standing; done: string[]; made: Record<string, Space | null> } | null>(null);

  const standing = attempt ? withSettled(here, attempt.standing, attempt.done) : here;
  const made = attempt?.made ?? {};
  const elsewhere = places.filter(one => one.id !== space.id);
  const held = new Set(every.flatMap(device => (device.spaceId && OWN_CLIMATE_TYPES.includes(device.type) ? [device.spaceId] : [])));
  const choices = choicesOf(standing, elsewhere, chosen, held);
  const leader = leaderOf(standing, choices);
  const guests = [...mentionsOn(letIn, space.id).values()];
  const roomMembers = [...mentionsOn(letIn, space.roomId).values()];
  const cameras = [...standing.paired, ...standing.loose].map(
    camera => [camera.id, cameraTitle(camera, standing.devices.find(device => device.id === camera.deviceId) ?? null, t)] as const,
  );
  // A camera nobody named is "Terp Cam"; what is printed on it tells two of them apart, and only then.
  const oneUnnamed = cameras.filter(([, title]) => cameraCalled(title, true) !== title).length < 2;
  const names = new Map<string, string>([
    // A device nobody named is its kind, told from another of its kind among those standing here.
    ...standing.devices.map(device => [device.id, deviceTitle(device, t, [...standing.devices])] as const),
    ...cameras.map(([id, title]) => [id, cameraCalled(title, oneUnnamed)] as const),
    ...standing.grows.map(grow => [grow.id, grow.name] as const),
    [GUESTS, inSentence(guests, i18n.language)],
    [MEMBERS, inSentence(roomMembers, i18n.language)],
  ]);
  // Inside a sentence a name is one thing: the dot in "Terp Cam · A1B2" parts no line, and a toast makes no two facts of it.
  const name = (id: string | null) => (names.get(id ?? '') ?? '').replaceAll(' · ', '\u00a0·\u00a0');
  // A place is named as a claim names the one it makes: "Zelt 2", not after the hardware.
  const fates = fatesOf(standing, choices, device => newPlaceName(device.type, places, t), places, space, made, {
    guests: guests.length,
    room: letIn.room?.name ?? '',
    members: roomMembers.length,
  });
  // A camera with no write of its own went when the device it is with did.
  const gone = new Set(fates.filter(fate => attempt?.done.includes(fate.step ? fate.id : (fate.beside ?? ''))).map(fate => fate.id));
  const open = fates.filter(fate => !gone.has(fate.id));
  const left = open.filter(fate => fate.what !== 'people').map(fate => name(fate.id));

  const ready = standing.grows.every(grow => choices[grow.id] !== '') && !end.isPending;
  // The same answers again need no second question - whatever the lists read since changed about them does.
  const again = end.isError && open.every(fate => agreed.includes(agreedTo(fate)));
  const sentences = (of: readonly Fate[]) =>
    gathered(of).map(({ how, place, ids, count }) => t(`place.remove.did.${how}`, { count, names: inSentence(ids.map(name), i18n.language), place }));

  const note = (one: EndNote) =>
    setAttempt(was => was && ('done' in one ? { ...was, done: [...was.done, one.done] } : { ...was, made: { ...was.made, [one.made]: one.place } }));
  const remove = () => {
    setAttempt(was => ({ standing, done: was?.done ?? [], made: was?.made ?? {} }));
    end.mutate(
      { steps: open.flatMap(fate => fate.step ?? []), drop: unusedOf(made, fates), note },
      {
        onSuccess: () => {
          tell({ label: [t('place.remove.told', { name: space.name }), ...sentences(fates)].join(' '), undo: null });
          void navigate('/', { replace: true });
        },
      },
    );
  };
  const answer = () => {
    setAsking(false);
    setAgreed(open.map(agreedTo));
    // The defaults are answers from here on: a place made on the way is one more to choose, and must not move them.
    setChosen(choices);
    remove();
  };

  /** One thing standing here, and the select that says where it goes; a grow is the one that starts unanswered. */
  const sent = (id: string, options: ReactNode, label = name(id)) =>
    gone.has(id) ? null : (
      <label key={id} className={styles.sent}>
        {label}
        <select
          className={ui.input}
          value={choices[id]}
          disabled={end.isPending}
          aria-invalid={choices[id] === '' || undefined}
          onChange={event => setChosen(was => ({ ...was, [id]: event.target.value }))}
        >
          {options}
        </select>
      </label>
    );
  const into = (words: 'place.remove.move' | 'place.remove.grow.move') =>
    elsewhere.map(place => (
      <option key={place.id} value={moveTo(place.id)}>
        {t(words, { place: place.name })}
      </option>
    ));
  const moves = into('place.remove.move');
  const stays = leader ? <option value={STAY}>{t('place.remove.stay', { device: name(leader.id) })}</option> : null;
  const rows = [
    ...standing.devices.map(device =>
      sent(
        device.id,
        <>
          {/* One given up ahead of the leading device would lead again itself: it has nobody to stay with. */}
          {leader && standing.devices.indexOf(device) > standing.devices.indexOf(leader) ? stays : null}
          <option value={NEW_PLACE}>{t('place.remove.device.new')}</option>
          {moves}
          <option value={RELEASE}>{t('place.remove.device.release')}</option>
        </>,
      ),
    ),
    ...standing.paired.map(camera =>
      sent(
        camera.id,
        <>
          <option value={STAY}>{t('place.remove.stay', { device: name(camera.deviceId) })}</option>
          <option value={UNCOUPLE}>{t('place.remove.camera.uncouple')}</option>
        </>,
      ),
    ),
    ...standing.loose.map(camera =>
      sent(
        camera.id,
        <>
          {stays}
          {moves}
          <option value={UNCOUPLE}>{t('place.remove.camera.remove')}</option>
        </>,
      ),
    ),
    ...standing.grows.map(grow =>
      sent(
        grow.id,
        <>
          <option value="">{t('place.remove.grow.ask')}</option>
          {standing.devices
            .filter(device => choices[device.id] === NEW_PLACE)
            .map(device => (
              <option key={device.id} value={withDevice(device.id)}>
                {t('place.remove.grow.with', { device: name(device.id) })}
              </option>
            ))}
          {into('place.remove.grow.move')}
          <option value={NOWHERE}>{t('place.remove.grow.nowhere')}</option>
          <option value={END}>{t('place.remove.grow.end')}</option>
        </>,
        grow.day === null ? grow.name : `${grow.name} · ${t('home.card.dayN', { day: grow.day })}`,
      ),
    ),
  ].filter(Boolean);
  const grown = standing.grows.map(grow => grow.name);

  return (
    <>
      {rows.length > 0 ? (
        <section className={styles.block} aria-labelledby="place-holds">
          <h2 id="place-holds" className={styles.blockTitle}>
            {t('place.remove.holds')}
          </h2>
          <div className={ui.group}>{rows}</div>
        </section>
      ) : null}

      <p className={ui.note}>
        {grown.length > 0 ? t('place.remove.kept', { names: inSentence(grown, i18n.language) }) : t('place.remove.curves', { name: space.name })}
      </p>
      {end.isError ? (
        <div className={styles.said} role="alert">
          <p className={ui.problem}>
            {t('place.remove.half.still', { name: space.name })} {refusalText(end.error)}
          </p>
          {gone.size > 0 ? <p>{t('place.remove.half.done', { what: sentences(fates.filter(fate => gone.has(fate.id))).join(' ') })}</p> : null}
          {left.length > 0 ? <p>{t('place.remove.half.left', { names: inSentence(left, i18n.language) })}</p> : null}
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
              <li key={fate.id}>
                {t(`place.remove.will.${fate.fate}`, { count: fate.count, name: name(fate.id), place: fate.place, beside: name(fate.beside) })}
              </li>
            ))}
          </ul>
        </Sheet>
      ) : null}
    </>
  );
}
