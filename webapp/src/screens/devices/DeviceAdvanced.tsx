import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Device, SocketPage } from '@fg2/shared-types/v1';
import { SOCKET_HOST_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { devicesPath } from '@/app/places';
import { useSession } from '@/api/session';
import { AdvancedSection } from '@/ui/advanced/Advanced';
import { itemsFor } from '@/ui/advanced/registry';
import { enough, useMayWith } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';

/**
 * What the targets page offers itself, and is left out of a device's Erweitert
 * drawn under it: germination in the dark is one of its climates, together with
 * what germination does about the humidity, and the same choice twice on one
 * page would be two buttons of one name doing it two ways.
 */
const BESIDE_TARGETS = ['operating-mode'];

/**
 * A device's Erweitert, wherever its settings are reached from: its own panel
 * under Geräte, and the targets under Steuerung, where somebody who came from
 * Start to change a value looks for the rest of what the device is set to. One
 * section in both, so the two never offer different things - except what the
 * targets page has itself, and the section there says where the rest of that is.
 *
 * What may be done is asked of the device rather than of the screen, as the
 * device list does: the same reader owns one tent and only reads the next.
 * What a build takes is said only of a type that drives sockets at all.
 */
export function DeviceAdvanced({
  device,
  sockets,
  offline,
  title,
  besideTargets = false,
}: {
  device: Device;
  sockets: SocketPage | undefined;
  offline: boolean;
  /** Where one page draws the sections of several devices, which of them this one is. */
  title?: string;
  /** Drawn under the targets, which offer a part of it themselves. */
  besideTargets?: boolean;
}) {
  const { t } = useTranslation();
  const may = useMayWith()(device);
  const { user } = useSession();
  const context = {
    device,
    mayManage: enough(may, 'manage'),
    offline,
    mayOwn: enough(may, 'own'),
    isAdmin: user?.isAdmin === true,
    sockets: SOCKET_HOST_TYPES.includes(device.type) ? sockets : undefined,
  };
  // A fridge's temperature-only mode has no chip among the targets, so where
  // the mode is left out the section says where it is set.
  const elsewhere = besideTargets && itemsFor('device', context).some(item => BESIDE_TARGETS.includes(item.id));

  return (
    <AdvancedSection
      scope="device"
      title={title}
      context={context}
      except={besideTargets ? BESIDE_TARGETS : []}
      footer={
        elsewhere ? (
          <p className={ui.note}>
            <Link to={devicesPath(device.spaceId)} className={ui.headLink}>
              {t('advanced.operatingModeAtDevice')} ›
            </Link>
          </p>
        ) : null
      }
    />
  );
}
