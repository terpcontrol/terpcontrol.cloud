import { ChevronLeft } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
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
 * nothing that could fail on somebody's. Only the third has a form, because a
 * stream is an address and nobody but the person knows it.
 *
 * Which of the three is meant is held here rather than in the address: they are
 * one question with three answers, and a tab is not a place to come back to.
 */
export function AddCamera() {
  const { t } = useTranslation();
  const mayManage = useMayManage();
  const [kind, setKind] = useState<Kind>('controller');

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <Link to="/devices" className={styles.back} aria-label={t('shell.tabs.devices')}>
          <ChevronLeft size={22} strokeWidth={1.75} aria-hidden />
        </Link>
        <h1 className={styles.title}>{t('cameras.add.title')}</h1>
      </header>

      {mayManage ? (
        <>
          <div className={styles.tabs} role="tablist" aria-label={t('cameras.add.which')}>
            {KINDS.map(one => (
              <button
                key={one}
                type="button"
                role="tab"
                id={`add-camera-${one}`}
                className={styles.tab}
                aria-selected={one === kind}
                aria-controls="add-camera-panel"
                onClick={() => setKind(one)}
              >
                {t(`cameras.add.tab.${one}`)}
              </button>
            ))}
          </div>

          <div className={styles.panel} id="add-camera-panel" role="tabpanel" aria-labelledby={`add-camera-${kind}`}>
            {kind === 'controller' ? <PairTerpCam /> : null}
            {kind === 'standalone' ? <Standalone /> : null}
            {kind === 'rtsp' ? <RtspCamera /> : null}
          </div>
        </>
      ) : (
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('cameras.add.demo')}</p>
      )}
    </section>
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
    <section className={styles.block}>
      <span className="label">{t('cameras.add.standalone.label')}</span>
      <p className={styles.text}>{t('cameras.add.standalone.text')}</p>
      <p className={`${styles.text} ${styles.coming}`}>{t('cameras.add.standalone.coming')}</p>
    </section>
  );
}
