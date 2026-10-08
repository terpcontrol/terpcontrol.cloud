import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCamerasAsOpened } from '@/api/cameras';
import { useDevices } from '@/api/devices';
import { LoadFailed, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { BackLink } from '@/ui/BackLink';
import { pairersOf } from './pairers';
import { PairTerpCam } from './PairTerpCam';
import { RtspCamera } from './RtspCamera';
import styles from './AddCamera.module.css';

/**
 * The two ways a camera arrives, which are two different things to explain
 * rather than two shapes of the same form.
 *
 * A Terp Cam is paired at a fridge module or a controller and the cloud hears
 * about it over MQTT, so this screen has nothing to send for one: it says what
 * to do at the hardware and then watches for what turns up. Only a stream
 * camera has a form, because a stream is an address and nobody but the person
 * knows it. A Terp Cam without a device to pair it at is not offered: the cloud
 * reaches a Terp Cam only through the device it is paired at.
 *
 * Which of the two is meant is held here rather than in the address: they are
 * one question with two answers, and a tab is not a place to come back to.
 * They are drawn as chips saying which one is pressed rather than as an ARIA
 * tab strip: a tab strip tells a screen reader to press an arrow key, and the
 * app has no arrow-key handler anywhere to answer that promise.
 */
export function AddCamera() {
  const { t } = useTranslation();
  const mayManage = useMayManage();

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <BackLink to="/devices" label={t('shell.tabs.devices')} />
        <h1>{t('cameras.add.title')}</h1>
      </header>

      {mayManage ? <Ways /> : <p className={`${ui.cardDashed} ${ui.note}`}>{t('cameras.add.demo')}</p>}
    </section>
  );
}

/**
 * The tabs and whichever of the two is open, which is everything that reads
 * an account. It is its own component so that a session which may only look
 * asks for none of it.
 *
 * Two things are owned here rather than by the tab that uses them. The first is
 * which tab opens: pairing at a device is the way in only for somebody who has
 * one to pair at, so an account with none opens on the address form instead,
 * and the choice waits for the device list so that the tab never moves under a
 * finger.
 * The second is the line a newly paired camera is measured against, which has
 * to outlive a tab change: it is the cameras this account had when the *screen*
 * was opened, and looking at the RTSP tab and back is not opening it again.
 */
function Ways() {
  const { t } = useTranslation();
  const devices = useDevices();
  const [chosen, setChosen] = useState<Kind | null>(null);

  const pairers = pairersOf(devices.data?.items ?? []);
  const opened = useCamerasAsOpened(pairers.length > 0);

  if (devices.isPending) return <Waiting lines={4} />;
  if (!devices.data) return <LoadFailed retry={() => void devices.refetch()} />;

  const kind = chosen ?? (pairers.length > 0 ? 'terpcam' : 'rtsp');

  return (
    <>
      {/* The two ways in, as one control: which of them is meant is a choice
          between two, not two buttons that each do something. They say which
          one is pressed rather than being an ARIA tab strip, because the arrow
          keys a tab strip promises are a behaviour nothing else in the app
          has. */}
      <div className={`${ui.segments} ${ui.segmentsFill}`} role="group" aria-label={t('cameras.add.which')}>
        {KINDS.map(one => (
          <button key={one} type="button" className={ui.segment} aria-pressed={one === kind} onClick={() => setChosen(one)}>
            {t(`cameras.add.tab.${one}`)}
          </button>
        ))}
      </div>

      <section className={styles.panel} aria-label={t(`cameras.add.tab.${kind}`)}>
        {kind === 'terpcam' ? <PairTerpCam pairers={pairers} opened={opened} /> : <RtspCamera devices={devices.data.items} />}
      </section>
    </>
  );
}

type Kind = 'terpcam' | 'rtsp';

const KINDS: Kind[] = ['terpcam', 'rtsp'];
