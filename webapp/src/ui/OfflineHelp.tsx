import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import ui from '@/ui/ui.module.css';
import styles from '@/ui/OfflineHelp.module.css';

/**
 * A device gone quiet, said where its page would show it at work: since when
 * in the title, one sentence on what that means here, and what to try a tap
 * away. It is the one box for it - on Start, Steuerung, the device's page and
 * the page of a camera read through it - in the amber of something that needs
 * a person, not the red of an alarm: the device goes on regulating.
 */
export function OfflineBox({ title, children, deviceLink = null }: { title: string; children?: ReactNode; deviceLink?: string | null }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <section className={styles.box} role="status">
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
      <button type="button" className={styles.more} aria-expanded={open} onClick={() => setOpen(!open)}>
        {t('offline.help')} ›
      </button>
      {open ? <OfflineSteps devicesLink={deviceLink} /> : null}
    </section>
  );
}

/**
 * The three things that bring nearly every device back, in the order somebody
 * standing in front of it would try them. Nothing here asks the device for
 * anything: a device that is not heard cannot be told to restart, so the steps
 * are the grower's own, and the link goes where the device itself is described.
 */
export function OfflineSteps({ devicesLink = null }: { devicesLink?: string | null }) {
  const { t } = useTranslation();

  return (
    <>
      <p className={styles.lead}>{t('offline.check')}</p>
      <ol className={styles.steps}>
        <li>{t('offline.power')}</li>
        <li>{t('offline.wifi')}</li>
        <li>{t('offline.replug')}</li>
      </ol>
      <p className={`mono ${styles.note}`}>
        {t('offline.keeps')}
        {devicesLink ? (
          <>
            {' '}
            <Link to={devicesLink} className={ui.headLink}>
              {t('offline.device')} ›
            </Link>
          </>
        ) : null}
      </p>
    </>
  );
}
