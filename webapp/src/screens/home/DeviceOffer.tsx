import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useUpdateMe } from '@/api/account';
import { Help } from '@/ui/Help';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import styles from './DiaryOffer.module.css';

/**
 * Hardware, offered to somebody who keeps a diary without any: one grey line
 * under the diary rather than a box over it. It used to be the first thing
 * under the place's name - "Kein Sensor · Gerät hinzufügen" above the grow -
 * and led straight into the claim, as if the diary were a stand-in for a
 * device. It leads to the Gerät tab, where a controller and a camera are both
 * offered, and "Nein danke" is kept with the account so it is not offered on
 * the next phone either.
 */
export function DeviceOffer() {
  const { t } = useTranslation();
  const decline = useUpdateMe();

  return (
    <div className={styles.offer}>
      <p className={`${styles.line} ${ui.dots}`}>
        <Link to="/devices" className={styles.start}>
          {t('home.device.offer')} ›
        </Link>
        <span className={ui.dot}>
          {' · '}
          <button
            type="button"
            className={styles.decline}
            disabled={decline.isPending}
            onClick={() => decline.mutate({ preferences: { deviceOfferDeclined: true } })}
          >
            {t('home.diary.decline')}
          </button>{' '}
          <Help topic="deviceOffer" />
        </span>
      </p>
      <Refused error={decline.error} />
    </div>
  );
}
