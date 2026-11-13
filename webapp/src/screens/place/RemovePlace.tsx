import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import type { Device, MembershipPage, Space } from '@fg2/shared-types/v1';
import { OWN_CLIMATE_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { useCameras } from '@/api/cameras';
import { useDevices } from '@/api/devices';
import { useSpaceGrows } from '@/api/grows';
import { useMembers } from '@/api/members';
import { useReminders } from '@/api/reminders';
import { useEndPlace, useSpaces, type EndNote } from '@/api/spaces';
import { editPath, leaveUnderSheet, placesOf } from '@/app/places';
import { useLog } from '@/log/log-context';
import { newPlaceName } from '@/screens/claim/steps';
import { inSentence, mentionsOn } from '@/screens/space/members/people';
import { camerasCalled } from '@/ui/camera-name';
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
  kept,
  leaderOf,
  moveTo,
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
 * as it will happen and everybody who then no longer sees the place - its
 * guests and the members of its room, which ends where this was its last
 * place; nothing is written before that answer, and nobody has to be let go
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
  const reminders = useReminders();
  const owns = useMayIn(spaceId, 'own');

  if (spaces.isPending) return <Waiting lines={5} />;
  // Asked before anything else is read: a place that has ended, or never was, has nothing to try again for.
  const space = spaces.data?.items.find(one => one.id === spaceId && one.archivedAt === null) ?? null;
  if (spaces.data && (!space || space.kind === 'room')) return <NoLongerHere what="space" />;
  // Ending a place is its owner's.
  if (space && !owns) return <Navigate to={editPath(space.id)} replace />;
  const reads = [spaces, devices, cameras, grows, members, reminders];
  if (reads.some(read => read.isPending)) return <Waiting lines={5} />;
  if (!spaces.data || !space || !devices.data || !cameras.data || !grows.data || !members.data || !reminders.data) {
    return <LoadFailed retry={() => reads.forEach(read => void read.refetch())} />;
  }

  const places = placesOf(spaces.data.items, space.ownerId);
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
          alive={new Set([...devices.data.items, ...cameras.data.items.filter(camera => camera.removedAt === null), ...running].map(one => one.id))}
          letIn={members.data}
          reminders={reminders.data.items.filter(one => one.subject.type === 'space' && one.subject.id === space.id).length}
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

/**
 * `places` are the owner's, this one among them; `every` device of the account says which of them hold a climate
 * already, `alive` what the account still holds at all, and `reminders` how many name this place and no grow.
 */
type Ending = { space: Space; places: Space[]; every: Device[]; here: Standing; alive: Set<string>; letIn: MembershipPage; reminders: number };

function Removing({ space, places: listed, every, here, alive, letIn, reminders }: Ending) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { tell } = useLog();
  const end = useEndPlace(space.id);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState(false);
  const [agreed, setAgreed] = useState<string[]>([]);
  // What the attempts were about and how far they came: each thing settled with the place it now stands in, and
  // each place made for a device. No list read since decides what an answer is still owed for - a camera went along
  // with its device, and a device that was given up is in none.
  const [asked, setAsked] = useState<Standing | null>(null);
  const [done, setDone] = useState<Record<string, string | null>>({});
  const [made, setMade] = useState<Record<string, Space | null>>({});

  const standing = asked ? kept(here, asked, id => id in done || alive.has(id)) : here;
  // A place an attempt made is one of the owner's, whether or not the lists were read since.
  const places = [...listed, ...Object.values(made).flatMap(one => (one && listed.every(place => place.id !== one.id) ? [one] : []))];
  const elsewhere = places.filter(one => one.id !== space.id);
  const held = new Set(every.flatMap(device => (device.spaceId && OWN_CLIMATE_TYPES.includes(device.type) ? [device.spaceId] : [])));
  const choices = choicesOf(standing, elsewhere, chosen, held, done);
  const leader = leaderOf(standing, choices);
  const guests = mentionsOn(letIn, space.id);
  const roomMembers = mentionsOn(letIn, space.roomId);
  // Whoever sees the place, through it or through its room: a room that goes on still loses this place.
  const everyone = new Map([...guests, ...roomMembers]);
  const cameras = [...standing.paired, ...standing.loose];
  // A camera nobody named is "Terp Cam"; what is printed on it tells two of them apart, and only then.
  const called = camerasCalled(cameras.map(camera => cameraTitle(camera, standing.devices.find(device => device.id === camera.deviceId) ?? null, t)));
  // A place is named as a claim names the one it makes: "Zelt 2", not after the hardware.
  const fates = fatesOf(standing, choices, device => newPlaceName(device.type, places, t), places, space, made, {
    reminders,
    guests: guests.size,
    everyone: everyone.size,
    room: letIn.room?.name ?? '',
    members: roomMembers.size,
  });
  const names = new Map<string, string>([
    // A device nobody named is its kind, told from another of its kind among those standing here.
    ...standing.devices.map(device => [device.id, deviceTitle(device, t, [...standing.devices])] as const),
    ...cameras.map((camera, at) => [camera.id, called[at]] as const),
    ...standing.grows.map(grow => [grow.id, grow.name] as const),
    // Where the room ends, its members are named with it; where it goes on, with the guests who lose the place.
    [GUESTS, inSentence([...(fates.some(fate => fate.id === MEMBERS) ? guests : everyone).values()], i18n.language)],
    [MEMBERS, inSentence([...roomMembers.values()], i18n.language)],
  ]);
  // Inside a sentence a name is one thing: the dot in "Terp Cam · A1B2" parts no line, and a toast makes no two facts of it.
  const name = (id: string | null) => (names.get(id ?? '') ?? '').replaceAll(' · ', '\u00a0·\u00a0');
  // A camera with no write of its own went when the device it is with did.
  const gone = new Set(fates.filter(fate => (fate.step ? fate.id : (fate.beside ?? '')) in done).map(fate => fate.id));
  const open = fates.filter(fate => !gone.has(fate.id));
  const left = open.filter(fate => fate.what !== 'ends').map(fate => name(fate.id));

  const ready = standing.grows.every(grow => choices[grow.id] !== '') && !end.isPending;
  // The same answers again need no second question - whatever the lists read since changed about them does.
  const again = end.isError && open.every(fate => agreed.includes(agreedTo(fate)));
  const sentences = (of: readonly Fate[]) =>
    gathered(of).map(({ how, place, ids, count }) => t(`place.remove.did.${how}`, { count, names: inSentence(ids.map(name), i18n.language), place }));

  const note = (one: EndNote) =>
    'done' in one ? setDone(was => ({ ...was, [one.done]: one.at })) : setMade(was => ({ ...was, [one.made]: one.place }));
  const remove = () => {
    setAsked(standing);
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
    setAgreed(open.map(agreedTo));
    // The defaults are answers from here on: a place made on the way is one more to choose, and must not move them.
    setChosen(choices);
    // The question is left before anything is written, so the Start that follows takes the page's own entry of
    // the history, and Back from it finds no page of a place that is gone.
    leaveUnderSheet(() => {
      setAsking(false);
      remove();
    });
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
  const option = (value: string, label: string) => (
    <option key={value} value={value}>
      {label}
    </option>
  );
  const moves = elsewhere.map(place => option(moveTo(place.id), t('place.remove.move', { place: place.name })));
  // Nothing stays or goes with a device that has left already: it goes to where that one now stands.
  const stays = (id?: string | null) => (!id || id in done ? null : option(STAY, t('place.remove.stay', { device: name(id) })));
  const rows = [
    ...standing.devices.map((device, at) =>
      sent(device.id, [
        // One given up ahead of the leading device would lead again itself: it has nobody to stay with.
        leader && at > standing.devices.indexOf(leader) ? stays(leader.id) : null,
        option(NEW_PLACE, t('place.remove.device.new')),
        moves,
        option(RELEASE, t('place.remove.device.release')),
      ]),
    ),
    ...standing.paired.map(camera => sent(camera.id, [stays(camera.deviceId), option(UNCOUPLE, t('place.remove.camera.uncouple'))])),
    ...standing.loose.map(camera => sent(camera.id, [stays(leader?.id), moves, option(UNCOUPLE, t('place.remove.camera.remove'))])),
    ...standing.grows.map(grow =>
      sent(
        grow.id,
        [
          option('', t('place.remove.grow.ask')),
          standing.devices
            .filter(device => choices[device.id] === NEW_PLACE && !(device.id in done))
            .map(device => option(withDevice(device.id), t('place.remove.grow.with', { device: name(device.id) }))),
          // The answer to where the plants stand is the place by its name.
          elsewhere.map(place => option(moveTo(place.id), place.name)),
          option(NOWHERE, t('place.remove.grow.nowhere')),
          option(END, t('place.remove.grow.end')),
        ],
        grow.day === null ? grow.name : `${grow.name} · ${t('home.card.dayN', { day: grow.day })}`,
      ),
    ),
  ].filter(Boolean);
  const grown = standing.grows.map(grow => grow.name);

  return (
    <>
      {rows.length > 0 ? (
        <section className={`${ui.stack2} ${styles.block}`} aria-labelledby="place-holds">
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
