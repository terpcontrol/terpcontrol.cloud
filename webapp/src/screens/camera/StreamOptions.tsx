import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CameraTransport, Device } from '@fg2/shared-types/v1';
import { deviceName } from '@/screens/devices/naming';
import { SettingRow } from '@/ui/advanced/SettingRow';
import { Choice, Choices } from '@/ui/SheetParts';
import { Switch } from '@/ui/Switch';
import ui from '@/ui/ui.module.css';
import advanced from '@/ui/advanced/Advanced.module.css';
import { transportsFor } from './stream';

/**
 * The fine settings of a stream camera, drawn the same in the form that adds
 * one and in the Erweitert section of its page: whether it is pulled through a
 * device standing where it looks, which device, and how ffmpeg reads it. None
 * of them writes anything itself - the form holds what is chosen until the
 * camera is made, and the page writes it on the tap.
 */

/** Pulled through the device, or opened by the cloud itself - which only a camera reachable from the internet answers. */
export function TunnelRow({
  on,
  carrier,
  disabled,
  onChange,
}: {
  on: boolean;
  carrier: Device;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  const label = t('camera.stream.tunnel');

  return (
    <SettingRow
      label={label}
      help="advanced.cameraTunnel"
      note={t(on ? 'camera.stream.tunnelOn' : 'camera.stream.tunnelOff', { device: deviceName(carrier, t) })}
    >
      <Switch label={label} on={on} disabled={disabled} onChange={onChange} />
    </SettingRow>
  );
}

/** Which of the devices standing there carries the stream, where there is more than one to choose from. */
export function CarrierRow({
  devices,
  chosen,
  disabled,
  onChoose,
}: {
  devices: Device[];
  chosen: string;
  disabled?: boolean;
  onChoose: (id: string) => void;
}) {
  const { t } = useTranslation();
  const label = t('camera.stream.throughWhich');

  return (
    <SettingRow label={label} wide>
      <Choices label={label}>
        {devices.map(device => (
          <Choice key={device.id} chosen={device.id === chosen} disabled={disabled} onChoose={() => onChoose(device.id)}>
            {deviceName(device, t)}
          </Choice>
        ))}
      </Choices>
    </SettingRow>
  );
}

/** How ffmpeg reads the stream; TCP unless the camera answers some other way. */
export function TransportRow({
  value,
  tunnel,
  disabled,
  onChange,
}: {
  value: CameraTransport;
  tunnel: boolean;
  disabled?: boolean;
  onChange: (next: CameraTransport) => void;
}) {
  const { t } = useTranslation();
  const label = t('camera.stream.transport');

  return (
    <SettingRow label={label} help="advanced.cameraTransport" note={t(`camera.stream.transportNote.${value}`)} wide>
      <Choices label={label}>
        {transportsFor(tunnel).map(one => (
          <Choice key={one} chosen={one === value} disabled={disabled} onChoose={() => onChange(one)}>
            {t(`camera.stream.transports.${one}`)}
          </Choice>
        ))}
      </Choices>
    </SettingRow>
  );
}

/**
 * The folded Erweitert of the form that adds a camera, drawn as the sections
 * the registry fills are drawn: the form holds its own state, so its rows are
 * passed in rather than found.
 */
export function StreamFold({ children }: { children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <details className={advanced.section}>
      <summary className="label">{t('advanced.title')}</summary>
      <p className={`${ui.note} ${advanced.lead}`}>{t('camera.stream.lead')}</p>
      <div className={advanced.items}>{children}</div>
    </details>
  );
}
