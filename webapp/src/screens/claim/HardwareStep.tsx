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
 * Nothing is paired here, and the two halves are not paired in the same place
 * either, which is what this step used to get wrong. A socket is the
 * controller's own search over the network: the app never pairs one, has no
 * route it calls to, and cannot give one a role - what it can do is show the
 * table the controller reports and switch what is in it. A Terp Cam is the
 * controller's own handshake too, but the app has a screen that walks somebody
 * through it and then watches for the camera to turn up, and that screen is the
 * only honest thing to send a grower to from here.
 *
 * So the step says what the device is already reporting, links the one thing
 * the app can help with, and says plainly that the other one happens at the
 * hardware. It sent both to a tent's Devices tab before, which pairs neither: a
 * socket has no control there at all, and the camera chip is deliberately drawn
 * only on the account-wide list. It is still the one step that can honestly be
 * skipped, because a controller with nothing plugged into it still measures.
 */
export function HardwareStep({ device, sockets }: { device: Device | null; sockets: SocketPage | undefined }) {
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

      <p className={ui.note}>{t('claim.hardware.socketsAtTheDevice')}</p>

      <Link className={`${ui.button} ${styles.aside}`} to="/cameras/add">
        {t('claim.hardware.pairTheCam')}
        <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
      </Link>

      <p className={ui.note}>{t('claim.hardware.bothCanWait')}</p>
    </>
  );
}
