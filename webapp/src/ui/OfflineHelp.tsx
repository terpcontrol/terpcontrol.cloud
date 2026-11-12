import { CircleAlert } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { offlineLabel } from '@/ui/age';
import ui from '@/ui/ui.module.css';
import { useZone } from '@/ui/zone';
import styles from '@/ui/OfflineHelp.module.css';

/**
 * What a place gone quiet says instead of a verdict: since when nothing has
 * arrived, and what to try. The figures above it stay, dimmed, because they are
 * the last thing it measured. `about` is what else went quiet with it, where
 * that is not obvious - a camera read through the device, on the camera's page.
 */
export function OfflineHelp({
  since,
  now,
  devicesLink = '/devices',
  about = null,
}: {
  since: string | null;
  now: DateTime;
  devicesLink?: string | null;
  about?: string | null;
}) {
  const zone = useZone();

  return (
    <div className={styles.box} role="status">
      <p className={styles.head}>
        <CircleAlert size={16} strokeWidth={2} aria-hidden />
        {offlineLabel(since, now, zone, true)}
      </p>
      {about ? <p className={styles.lead}>{about}</p> : null}
      <OfflineSteps devicesLink={devicesLink} />
    </div>
  );
}

/**
 * The three things that bring nearly every device back, in the order somebody
 * standing in front of it would try them. Nothing here asks the device for
 * anything: a device that is not heard cannot be told to restart, so the steps
 * are the grower's own, and the link goes where the device itself is described.
 */
export function OfflineSteps({ devicesLink = '/devices' }: { devicesLink?: string | null }) {
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
