import { useTranslation } from 'react-i18next';
import { DeviceList } from './DeviceList';
import styles from './Devices.module.css';

/**
 * The fourth tab: every controller, every camera and every smart socket this
 * account has. The tent page carries the same list narrowed to one place.
 *
 * Nothing is added from here. A device arrives through the claim flow, which is
 * four steps long and a screen of its own, so the list carries the way in
 * rather than a field that would be the first of those steps and none of the
 * rest.
 */
export function Devices() {
  const { t } = useTranslation();

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>{t('shell.tabs.devices')}</h1>
      </header>

      <DeviceList />
    </section>
  );
}
