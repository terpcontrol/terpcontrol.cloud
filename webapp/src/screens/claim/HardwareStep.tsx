import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Device, SocketPage } from '@fg2/shared-types/v1';
import ui from '@/ui/ui.module.css';
import { cameraName } from './steps';
import styles from './Claim.module.css';

/**
 * The fourth step: the smart sockets the controller has found, and the camera
 * that answers through it.
 *
 * Nothing is paired here. Pairing a socket is the controller's own search and
 * pairing a Terp Cam is the controller's own handshake, both of which live on
 * the tent's Devices tab and both of which take a minute of standing next to
 * the hardware - so this step says what the device is already reporting and
 * where the rest of it is done. It is the one step that can honestly be
 * skipped, because a controller with nothing plugged into it still measures.
 */
export function HardwareStep({ device, sockets, spaceId }: { device: Device | null; sockets: SocketPage | undefined; spaceId: string | null }) {
  const { t } = useTranslation();
  const rows = sockets?.items ?? [];

  return (
    <>
      <ul className={styles.reported}>
        <li>
          <span className="label">{t('claim.hardware.sockets')}</span>
          <span className={`mono ${styles.reportedValue}`}>
            {!sockets
              ? t('claim.hardware.notReported')
              : rows.length === 0
                ? t('claim.hardware.noSockets')
                : rows.map(socket => t(`devices.role.${socket.role}`, { defaultValue: socket.role })).join(' · ')}
          </span>
        </li>
        <li>
          <span className="label">{t('claim.hardware.cam')}</span>
          <span className={`mono ${styles.reportedValue}`}>{cameraName(device, t)}</span>
        </li>
      </ul>

      {spaceId ? (
        <Link className={`${ui.button} ${styles.aside}`} to={`/spaces/${spaceId}/devices`}>
          {t('claim.hardware.pairThere')}
          <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
        </Link>
      ) : null}

      <p className={ui.note}>{t('claim.hardware.bothCanWait')}</p>
    </>
  );
}
