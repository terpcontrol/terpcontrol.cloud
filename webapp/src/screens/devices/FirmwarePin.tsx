import { useTranslation } from 'react-i18next';
import type { Device, DeviceFirmware } from '@fg2/shared-types/v1';
import { useDevices, useUpdateDevice } from '@/api/devices';
import { useLog } from '@/log/log-context';
import { Sheet } from '@/ui/Sheet';
import { deviceTitle, standingWith } from '@/ui/naming';
import { SheetAnswer } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { buildName } from './firmware-builds';
import sheet from './Maintenance.module.css';

/**
 * Putting a device on one build, asked first because the device restarts with
 * it: the pin is how the server tells a device to install, and it stays on
 * that build until another is installed or its updates are switched on again.
 * The toast says that the build was asked for - whether it took is the
 * firmware card's to say, once the device reports what it runs.
 */
export function PinSheet({ device, build, onClose }: { device: Device; build: DeviceFirmware; onClose: () => void }) {
  const { t } = useTranslation();
  const { tell } = useLog();
  const devices = useDevices();
  const pin = useUpdateDevice(device.id);
  const name = deviceTitle(device, t, standingWith(device, devices.data?.items));

  const install = async () => {
    try {
      await pin.mutateAsync({ firmware: { channel: 'manual', targetId: build.id } });
      tell({ label: t('firmwarePin.sent', { name, build: buildName(build) }), undo: null, from: `firmware-${device.id}` });
      onClose();
    } catch {
      // Said over the button, from the write that refused.
    }
  };

  return (
    <Sheet
      title={t('firmwarePin.title', { name })}
      onClose={onClose}
      actions={
        <SheetAnswer done={false} error={pin.error} onClose={onClose}>
          <button type="button" className={`${ui.button} ${ui.primary}`} disabled={pin.isPending} onClick={() => void install()}>
            {t('firmwarePin.yes')}
          </button>
        </SheetAnswer>
      }
    >
      <div className={sheet.body}>
        <p>{t('firmwarePin.what', { name, build: buildName(build) })}</p>
        <p className={ui.note}>{t('firmwarePin.restart')}</p>
      </div>
    </Sheet>
  );
}
