import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useShape } from '@/app/shell/shape';
import { DeviceList } from './DeviceList';
import styles from './Devices.module.css';

/**
 * Gerät, or Geräte once there is more than one: every controller, every camera
 * and every smart socket this account has. A link about one place opens that
 * place's devices.
 *
 * Nothing is added from here. A device arrives through the claim flow, which is
 * four steps long and a screen of its own, so the list carries the way in
 * rather than a field that would be the first of those steps and none of the
 * rest.
 */
export function Devices() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const { devices } = useShape();

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>{t(devices > 1 ? 'shell.tabs.devices' : 'shell.tabs.device')}</h1>
      </header>

      <DeviceList opened={params.get('space')} />
    </section>
  );
}
