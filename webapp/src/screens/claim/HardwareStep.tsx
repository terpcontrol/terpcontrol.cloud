import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Device, SocketPage } from '@fg2/shared-types/v1';
import ui from '@/ui/ui.module.css';
import { camCoupled, cameraSaid } from './steps';
import styles from './Claim.module.css';

/**
 * The fourth step, for a fridge module or a controller: the smart sockets it
 * has found, and the camera that answers through it. An AIR fan and a Smart
 * Socket pair a camera but no sockets, so for them it is the camera alone.
 *
 * Nothing is paired here. A Terp Control socket is the device's own search over
 * the network, started at the device; a Tasmota socket is paired by its address
 * from the device's panel once the device is in use. A Terp Cam is the device's
 * own handshake too, but the app has a screen that walks somebody through it
 * and then watches for the camera to turn up, and that screen is the honest
 * thing to send a grower to from here. So the step says what the device is
 * already reporting - a camera as "Terp Cam" and whether it is coupled, never
 * by a piece of its id - and links the one thing the app walks through while
 * no camera is coupled; where a socket is paired stands behind the help button
 * beside the step's title. It is the one step that can honestly be skipped,
 * because a device with nothing plugged into it still measures.
 */
export function HardwareStep({ device, sockets, camOnly = false }: { device: Device | null; sockets: SocketPage | undefined; camOnly?: boolean }) {
  const { t } = useTranslation();
  const rows = sockets?.items ?? [];

  return (
    <>
      <ul className={`${ui.effects} ${styles.reported}`}>
        {camOnly ? null : (
          <li>
            <span className="label">{t('claim.hardware.sockets')}</span>
            <span className={styles.reportedValue}>
              {!sockets
                ? t('claim.hardware.notReported')
                : rows.length === 0
                  ? t('claim.hardware.noSockets')
                  : rows.map(socket => t(`devices.role.${socket.role}`, { defaultValue: socket.role })).join(' · ')}
            </span>
          </li>
        )}
        <li>
          <span className="label">{t('claim.hardware.cam')}</span>
          <span className={styles.reportedValue}>{cameraSaid(device, t)}</span>
        </li>
      </ul>

      {/* A device carries one camera: once one answers through it, there is nothing left to couple. */}
      {camCoupled(device) ? null : (
        <Link className={`${ui.button} ${styles.aside}`} to="/cameras/add">
          {t('claim.hardware.pairTheCam')}
          <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
        </Link>
      )}
    </>
  );
}
