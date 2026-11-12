import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { session, useSession } from '@/api/session';
import { useLeave } from '@/ui/leave';
import ui from '@/ui/ui.module.css';
import { Door, PlaceDoors } from './AddPlace';
import styles from './Start.module.css';

/**
 * Start before an account has anything: "Womit fängst du an?" and the three
 * ways in - a device, a grow without one, a look at the demo - with the way
 * for somebody who was invited under them. Nothing is asked about who the
 * person is.
 *
 * The demo is a session of its own: opening it means leaving this one, so it
 * asks first. A demo nobody has filled lands here too and is told what it
 * found, with the one thing it can still do.
 */
export function EmptyStart() {
  const { t } = useTranslation();
  const { user } = useSession();
  const navigate = useNavigate();
  const [demo, setDemo] = useState<'idle' | 'asking' | 'opening' | 'failed'>('idle');

  if (user?.isDemo === true) return <NothingInTheDemo />;

  const open = async () => {
    setDemo('opening');
    try {
      await session.openDemo();
      await navigate('/', { replace: true });
    } catch {
      setDemo('failed');
    }
  };

  return (
    <section className={`${styles.page} ${styles.empty}`} data-single>
      <h1>{t('start.empty.title')}</h1>
      <PlaceDoors />
      <Door title={t('start.empty.demo')} note={t('start.empty.demoNote')} onClick={() => setDemo('asking')} />
      {demo === 'asking' ? (
        <div className={styles.pair}>
          <button type="button" className={styles.go} data-tone="brand" onClick={() => void open()}>
            {t('home.demo.confirm')}
          </button>
          <button type="button" className={styles.wide} onClick={() => setDemo('idle')}>
            {t('home.demo.stay')}
          </button>
        </div>
      ) : null}
      {demo === 'opening' ? <p className={ui.note}>{t('home.demo.opening')}</p> : null}
      {demo === 'failed' ? (
        <p className={ui.problem} role="alert">
          {t('home.demo.failed')}
        </p>
      ) : null}
      <Link to="/join" className={styles.invited}>
        {t('start.empty.invited')} ›
      </Link>
    </section>
  );
}

/** Signing out first rather than a link to the form: a session that exists is sent straight back off the sign-in page. */
function NothingInTheDemo() {
  const { t } = useTranslation();
  const { leaving, leave } = useLeave('/sign-in');

  return (
    <section className={`${styles.page} ${styles.empty}`} data-single>
      <h1>{t('home.demoEmpty.title')}</h1>
      <p className={styles.cardText}>{t('home.demoEmpty.text')}</p>
      <button type="button" className={styles.wide} disabled={leaving} onClick={() => void leave()}>
        {t('home.demoEmpty.signIn')}
      </button>
    </section>
  );
}
