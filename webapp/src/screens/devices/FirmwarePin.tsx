import { useTranslation } from 'react-i18next';
import type { Device, DeviceFirmware } from '@fg2/shared-types/v1';
import { useDevices, useUpdateDevice } from '@/api/devices';
import { Sheet } from '@/ui/Sheet';
import { deviceTitle } from '@/ui/naming';
import { Answered, SheetAnswer } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { buildName } from './firmware-builds';
import sheet from './Maintenance.module.css';

/**
 * Putting a device on one build, asked first because the device restarts with
 * it: the pin is how the server tells a device to install, and it stays on
 * that build until another is installed or its updates are switched on again.
 */
export function PinSheet({ device, build, onClose }: { device: Device; build: DeviceFirmware; onClose: () => void }) {
  const { t } = useTranslation();
  const devices = useDevices();
  const pin = useUpdateDevice(device.id);
  const name = deviceTitle(device, t, devices.data?.items);

  return (
    <Sheet
      title={t('firmwarePin.title', { name })}
      onClose={onClose}
      actions={
        <SheetAnswer done={pin.isSuccess} error={pin.error} onClose={onClose}>
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            disabled={pin.isPending}
            onClick={() => pin.mutate({ firmware: { channel: 'manual', targetId: build.id } })}
          >
            {t('firmwarePin.yes')}
          </button>
        </SheetAnswer>
      }
    >
      <div className={sheet.body}>
        {pin.isSuccess ? (
          <Answered>{t('firmwarePin.sent', { name, build: buildName(build) })}</Answered>
        ) : (
          <>
            <p>{t('firmwarePin.what', { name, build: buildName(build) })}</p>
            <p className={ui.note}>{t('firmwarePin.restart')}</p>
          </>
        )}
      </div>
    </Sheet>
  );
}
