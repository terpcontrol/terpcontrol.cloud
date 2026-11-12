import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import type { Space } from '@fg2/shared-types/v1';
import { useCameras } from '@/api/cameras';
import { useDevices } from '@/api/devices';
import { useSpaceGrows } from '@/api/grows';
import { useMembers } from '@/api/members';
import { useEndPlace, useSpaces } from '@/api/spaces';
import { editPath } from '@/app/places';
import { useLog } from '@/log/log-context';
import { newPlaceName } from '@/screens/claim/steps';
import { cameraTitle, deviceTitle } from '@/ui/naming';
import { PageHead } from '@/ui/PageHead';
import { LoadFailed, NoLongerHere, Refused, Waiting } from '@/ui/PageState';
import { useMayIn } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { END, NEW_PLACE, NOWHERE, RELEASE, STAY, UNCOUPLE, firstChoices, moveTo, settled, standingIn, stepsOf, withDevice } from './remove-plan';
import styles from './Place.module.css';

/**
 * "Ort entfernen": a place ends, and everything standing in it is sent
 * somewhere of its own first - each device, each camera, each running grow.
 * Nothing is moved until the button is tapped, and the button waits until
 * every grow has been answered: where the plants stand is not guessed.
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

  if (spaces.isPending || devices.isPending || cameras.isPending || grows.isPending) return <Waiting lines={5} />;
  if (!spaces.data || !devices.data || !cameras.data || !grows.data) {
    return (
      <LoadFailed
        retry={() => {
          void spaces.refetch();
          void devices.refetch();
          void cameras.refetch();
          void grows.refetch();
        }}
      />
    );
  }

  const space = spaces.data.items.find(one => one.id === spaceId && one.archivedAt === null) ?? null;
  if (!space || space.kind === 'room') return <NoLongerHere what="space" />;
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

function Removing({
  space,
  elsewhere,
  standing,
  days,
}: {
  space: Space;
  elsewhere: readonly Space[];
  standing: ReturnType<typeof standingIn>;
  days: readonly { growId: string; day: number | null }[];
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tell } = useLog();
  const every = useDevices().data?.items;
  const taken = useSpaces().data?.items.filter(one => one.kind !== 'room' && one.archivedAt === null && one.ownerId === space.ownerId) ?? [];
  const members = useMembers(space.id);
  const end = useEndPlace(space.id);
  const [chosen, setChosen] = useState<Record<string, string>>({});

  const choices = { ...firstChoices(standing, elsewhere), ...chosen };
  const choose = (id: string, value: string) => setChosen(was => ({ ...was, [id]: value }));
  const title = (deviceId: string) => {
    const device = standing.devices.find(one => one.id === deviceId);
    return device ? deviceTitle(device, t, every) : '';
  };
  // People are let go one at a time and by name, never by ending the place they are in.
  const guests = members.data?.items.filter(row => row.spaceId === space.id).length ?? 0;
  const holds = standing.devices.length + standing.paired.length + standing.loose.length + standing.grows.length > 0;
  const ready = settled(standing, choices) && guests === 0 && !end.isPending;

  const remove = () =>
    end.mutate(
      stepsOf(
        standing,
        choices,
        // Named as a claim names the place it makes: "Zelt 2", not after the hardware.
        device => newPlaceName(device.type, taken, t),
        taken.map(one => one.name),
        space.roomId,
      ),
      {
        onSuccess: () => {
          tell({ label: t('place.remove.told', { name: space.name }), undo: null });
          void navigate('/', { replace: true });
        },
      },
    );

  return (
    <section className={`${styles.page} ${styles.reading} ${styles.editing}`}>
      <PageHead
        back={{ to: editPath(space.id), label: t('place.remove.back', { name: space.name }) }}
        title={t('place.remove.title', { name: space.name })}
      />

      {holds ? (
        <section className={styles.block} aria-labelledby="place-holds">
          <h2 id="place-holds" className={styles.blockTitle}>
            {t('place.remove.holds')}
          </h2>
          <div className={ui.group}>
            {standing.devices.map(device => (
              <label key={device.id} className={styles.sent}>
                {title(device.id)}
                <select
                  className={ui.input}
                  value={choices[device.id]}
                  disabled={end.isPending}
                  onChange={event => choose(device.id, event.target.value)}
                >
                  <option value={NEW_PLACE}>{t('place.remove.device.new')}</option>
                  {elsewhere.map(place => (
                    <option key={place.id} value={moveTo(place.id)}>
                      {t('place.remove.device.move', { place: place.name })}
                    </option>
                  ))}
                  <option value={RELEASE}>{t('place.remove.device.release')}</option>
                </select>
              </label>
            ))}
            {standing.paired.map(camera => {
              const carrier = standing.devices.find(device => device.id === camera.deviceId) ?? null;
              return (
                <label key={camera.id} className={styles.sent}>
                  {cameraTitle(camera, carrier, t)}
                  <select
                    className={ui.input}
                    value={choices[camera.id]}
                    disabled={end.isPending}
                    onChange={event => choose(camera.id, event.target.value)}
                  >
                    <option value={STAY}>{t('place.remove.camera.stay', { device: carrier ? title(carrier.id) : '' })}</option>
                    <option value={UNCOUPLE}>{t('place.remove.camera.uncouple')}</option>
                  </select>
                </label>
              );
            })}
            {standing.loose.map(camera => (
              <label key={camera.id} className={styles.sent}>
                {cameraTitle(camera, null, t)}
                <select
                  className={ui.input}
                  value={choices[camera.id]}
                  disabled={end.isPending}
                  onChange={event => choose(camera.id, event.target.value)}
                >
                  {elsewhere.map(place => (
                    <option key={place.id} value={moveTo(place.id)}>
                      {t('place.remove.camera.move', { place: place.name })}
                    </option>
                  ))}
                  <option value={UNCOUPLE}>{t('place.remove.camera.remove')}</option>
                </select>
              </label>
            ))}
            {standing.grows.map(grow => {
              const day = days.find(one => one.growId === grow.growId)?.day ?? null;
              return (
                <label key={grow.growId} className={styles.sent}>
                  {day === null ? grow.name : `${grow.name} · ${t('home.card.dayN', { day })}`}
                  <select
                    className={ui.input}
                    value={choices[grow.growId]}
                    disabled={end.isPending}
                    aria-invalid={choices[grow.growId] === '' || undefined}
                    onChange={event => choose(grow.growId, event.target.value)}
                  >
                    <option value="">{t('place.remove.grow.ask')}</option>
                    {standing.devices
                      .filter(device => choices[device.id] === NEW_PLACE)
                      .map(device => (
                        <option key={device.id} value={withDevice(device.id)}>
                          {t('place.remove.grow.with', { device: title(device.id) })}
                        </option>
                      ))}
                    {elsewhere.map(place => (
                      <option key={place.id} value={moveTo(place.id)}>
                        {t('place.remove.grow.move', { place: place.name })}
                      </option>
                    ))}
                    <option value={NOWHERE}>{t('place.remove.grow.nowhere')}</option>
                    <option value={END}>{t('place.remove.grow.end')}</option>
                  </select>
                </label>
              );
            })}
          </div>
        </section>
      ) : null}

      {standing.grows.length > 0 ? (
        <p className={ui.note}>{t('place.remove.kept', { names: standing.grows.map(grow => grow.name).join(', ') })}</p>
      ) : null}
      {guests > 0 ? (
        <div className={styles.guests} role="status">
          <p className={ui.problem}>{t('place.remove.guests', { count: guests })}</p>
          <Link to={editPath(space.id)} className={ui.button}>
            {t('place.remove.toGuests')}
          </Link>
        </div>
      ) : null}
      <Refused error={end.error} />

      <div className={styles.foot}>
        <button type="button" className={`${ui.button} ${ui.dangerFilled} ${styles.end}`} disabled={!ready} onClick={remove}>
          {end.isPending ? t('place.remove.removing') : t('place.remove.remove', { name: space.name })}
        </button>
        <Link to={editPath(space.id)} className={styles.cancel}>
          {t('place.remove.cancel')}
        </Link>
      </div>
    </section>
  );
}
