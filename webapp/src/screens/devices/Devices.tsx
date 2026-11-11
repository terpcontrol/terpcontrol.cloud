import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { DeviceList } from './DeviceList';
import styles from './Devices.module.css';

/**
 * Geräte: every controller, every camera and every smart socket this account
 * has, reached from Steuerung. A link about one place opens that place's
 * devices.
 *
 * Nothing is added from here. A device arrives through the claim flow, which is
 * four steps long and a screen of its own, so the list carries the way in
 * rather than a field that would be the first of those steps and none of the
 * rest.
 */
export function Devices() {
  const { t } = useTranslation();
  const [params] = useSearchParams();

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <h1>{t('devices.title')}</h1>
      </header>

      <DeviceList opened={params.get('space')} />
    </section>
  );
}
