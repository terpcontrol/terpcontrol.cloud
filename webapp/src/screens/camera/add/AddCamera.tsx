import { ChevronLeft } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCamerasAsOpened } from '@/api/cameras';
import { useDevices } from '@/api/devices';
import { LoadFailed, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { controllersOf } from './controllers';
import { PairTerpCam } from './PairTerpCam';
import { RtspCamera } from './RtspCamera';
import styles from './AddCamera.module.css';

/**
 * The three ways a camera arrives, which are three different things to explain
 * rather than three shapes of the same form.
 *
 * A Terp Cam is paired at the controller and the cloud hears about it over
 * MQTT, so this screen has nothing to send for one: it says what to do at the
 * hardware and then watches for what turns up. A standalone Terp Cam is the
 * same camera without a controller to pair it, and that flow is unproven
 * against a camera on a desk, so the tab says what it will do and offers
 * nothing that could fail on somebody's - drawn in the dashed card the app
 * gives every "not here yet", so that the tab has the shape its two siblings
 * get from the controls inside them. Only the third has a form, because a
 * stream is an address and nobody but the person knows it.
 *
 * Which of the three is meant is held here rather than in the address: they are
 * one question with three answers, and a tab is not a place to come back to.
 * They are drawn as three chips saying which one is pressed rather than as an
 * ARIA tab strip: a tab strip tells a screen reader to press an arrow key, and
 * the app has no arrow-key handler anywhere to answer that promise.
 */
export function AddCamera() {
  const { t } = useTranslation();
  const mayManage = useMayManage();

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <Link to="/devices" className={styles.back} aria-label={t('shell.tabs.devices')}>
          <ChevronLeft size={22} strokeWidth={1.75} aria-hidden />
        </Link>
        <h1 className={styles.title}>{t('cameras.add.title')}</h1>
      </header>

      {mayManage ? <Ways /> : <p className={`${ui.cardDashed} ${ui.note}`}>{t('cameras.add.demo')}</p>}
    </section>
  );
}

/**
 * The tabs and whichever of the three is open, which is everything that reads
 * an account. It is its own component so that a session which may only look
 * asks for none of it.
 *
 * Two things are owned here rather than by the tab that uses them. The first is
 * which tab opens: pairing at a controller is the way in only for somebody who
 * has one, so an account with none opens on the address form instead, and the
 * choice waits for the device list so that the tab never moves under a finger.
 * The second is the line a newly paired camera is measured against, which has
 * to outlive a tab change: it is the cameras this account had when the *screen*
 * was opened, and looking at the RTSP tab and back is not opening it again.
 */
function Ways() {
  const { t } = useTranslation();
  const devices = useDevices();
  const [chosen, setChosen] = useState<Kind | null>(null);

  const controllers = controllersOf(devices.data?.items ?? []);
  const opened = useCamerasAsOpened(controllers.length > 0);

  if (devices.isPending) return <Waiting lines={4} />;
  if (!devices.data) return <LoadFailed retry={() => void devices.refetch()} />;

  const kind = chosen ?? (controllers.length > 0 ? 'controller' : 'rtsp');

  return (
    <>
      <div className={styles.tabs} role="group" aria-label={t('cameras.add.which')}>
        {KINDS.map(one => (
          <button key={one} type="button" className={styles.tab} aria-pressed={one === kind} onClick={() => setChosen(one)}>
            {t(`cameras.add.tab.${one}`)}
          </button>
        ))}
      </div>

      <section className={styles.panel} aria-label={t(`cameras.add.tab.${kind}`)}>
        {kind === 'controller' ? <PairTerpCam controllers={controllers} opened={opened} /> : null}
        {kind === 'standalone' ? <Standalone /> : null}
        {kind === 'rtsp' ? <RtspCamera devices={devices.data.items} /> : null}
      </section>
    </>
  );
}

type Kind = 'controller' | 'standalone' | 'rtsp';

const KINDS: Kind[] = ['controller', 'standalone', 'rtsp'];

/**
 * What a standalone Terp Cam will be, and that it is not here yet. It is the
 * one tab with no control on it at all: everything it would offer runs against
 * a stranger's camera, and a button that fails on the hardware in front of
 * somebody is worse than a sentence saying to wait.
 */
function Standalone() {
  const { t } = useTranslation();

  return (
    <section className={`${ui.cardDashed} ${styles.block}`}>
      <span className="label">{t('cameras.add.standalone.label')}</span>
      <p className={styles.text}>{t('cameras.add.standalone.text')}</p>
      <p className={`${styles.text} ${styles.coming}`}>{t('cameras.add.standalone.coming')}</p>
    </section>
  );
}
