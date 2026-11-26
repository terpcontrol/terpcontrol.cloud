import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { Device, Space } from '@fg2/shared-types/v1';
import { useCamerasAsOpened } from '@/api/cameras';
import { useDevices } from '@/api/devices';
import { useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { placesFor } from '@/app/places';
import { LoadFailed, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { BackLink } from '@/ui/BackLink';
import { pairersOf } from './pairers';
import { PairTerpCam } from './PairTerpCam';
import { NewPlace, RtspCamera } from './RtspCamera';
import styles from './AddCamera.module.css';

/**
 * The two ways a camera arrives. A Terp Cam is paired at a fridge module or a
 * controller and the cloud hears about it over MQTT, so this screen has
 * nothing to send for one: it says what to do at the hardware and watches for
 * what turns up. Only a stream camera has a form. A Terp Cam without a device
 * to pair it at is not offered: the cloud reaches one only through that device.
 *
 * The two are drawn as chips saying which one is pressed rather than as an
 * ARIA tab strip: a tab strip promises arrow keys, which nothing in the app
 * answers.
 */
export function AddCamera() {
  const { t } = useTranslation();
  const mayManage = useMayManage();

  return (
    <section className={`${ui.stack4} ${ui.page} ${styles.page}`}>
      <header className={ui.row2}>
        <BackLink to="/control" label={t('shell.tabs.control')} />
        <h1>{t('cameras.add.title')}</h1>
      </header>

      {mayManage ? <Ways /> : <p className={`${ui.cardDashed} ${ui.note}`}>{t('cameras.add.demo')}</p>}
    </section>
  );
}

/**
 * The tabs and whichever of the two is open, which is everything that reads
 * an account - its own component so that a session which may only look asks
 * for none of it.
 *
 * Which tab opens is decided here: pairing at a device only for somebody who
 * has one, else the address form, and the choice waits for the device list so
 * that the tab never moves under a finger; `?kind=rtsp` opens on the form. So
 * is the line a newly paired camera is measured against: the cameras this
 * account had when the screen was opened, which outlives a tab change.
 *
 * A camera goes into a place of the reader's own making, and is paired at a
 * device of theirs: a guest who sees only the places he was let into is told
 * that he needs one of his own first, and offered it, rather than the steps
 * of pairing at a device he may not touch.
 */
function Ways() {
  const { t } = useTranslation();
  const { user } = useSession();
  const devices = useDevices();
  const spaces = useSpaces();
  const [chosen, setChosen] = useState<Kind | null>(null);
  const asked = useSearchParams()[0].get('kind');

  const mine = placesFor(spaces.data?.items ?? []);
  const pairers = pairersOf((devices.data?.items ?? []).filter(device => isMine(device, user?.id, mine)));
  const opened = useCamerasAsOpened(pairers.length > 0);

  if (devices.isPending || spaces.isPending) return <Waiting lines={4} />;
  if (!devices.data) return <LoadFailed retry={() => void devices.refetch()} />;
  if (mine.length === 0 && (spaces.data?.items ?? []).some(space => space.kind !== 'room' && space.archivedAt === null)) {
    return <NewPlace note={t('cameras.add.noOwnPlace')} onMade={() => undefined} />;
  }

  const kind = chosen ?? (pairers.length > 0 && asked !== 'rtsp' ? 'terpcam' : 'rtsp');

  return (
    <>
      <div className={`${ui.segments} ${ui.segmentsFill}`} role="group" aria-label={t('cameras.add.which')}>
        {KINDS.map(one => (
          <button key={one} type="button" className={ui.segment} aria-pressed={one === kind} onClick={() => setChosen(one)}>
            {t(`cameras.add.tab.${one}`)}
          </button>
        ))}
      </div>

      <section className={ui.stack4} aria-label={t(`cameras.add.tab.${kind}`)}>
        {kind === 'terpcam' ? <PairTerpCam pairers={pairers} opened={opened} /> : <RtspCamera devices={devices.data.items} />}
      </section>
    </>
  );
}

type Kind = 'terpcam' | 'rtsp';

/** A device the reader may pair a camera at: one of theirs standing nowhere, or one in a place they may manage. */
const isMine = (device: Device, userId: string | undefined, places: Space[]): boolean =>
  device.spaceId === null ? device.ownerId === userId : places.some(space => space.id === device.spaceId);

const KINDS: Kind[] = ['terpcam', 'rtsp'];
