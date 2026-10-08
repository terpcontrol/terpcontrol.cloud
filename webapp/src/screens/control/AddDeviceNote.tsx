import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import ui from '@/ui/ui.module.css';
import styles from './Control.module.css';

/** The dashed note of a tab with nothing here to set, and after its sentence the way out: adding a device. */
export function AddDeviceNote({ children }: { children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <p className={`${ui.cardDashed} ${ui.note}`}>
      {children}{' '}
      <Link to="/claim" className={styles.addDevice}>
        {t('space.control.noControllerAdd')}
      </Link>
    </p>
  );
}
