import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import { SettingRow } from '@/ui/advanced/SettingRow';
import { Refused } from '@/ui/PageState';
import { Switch } from '@/ui/Switch';
import { useChannel } from './update-channel';

/**
 * Whether a device installs new firmware by itself, in the panel where its
 * firmware is read: one switch, on the stable channel. Beta and alpha are the
 * same switch on another channel and stand under Erweitert.
 *
 * A new device is enrolled on stable and starts here switched on. One carried
 * over from the old cloud had no channel that ever worked and stays off - a
 * fix that is released never reaches it until somebody switches it on.
 */
export function AutoUpdate({ device }: { device: Device }) {
  const { t } = useTranslation();
  const update = useChannel(device);
  const channel = update.asked ?? device.firmware.channel;
  const on = channel !== 'manual';

  return (
    <>
      <SettingRow label={t('autoUpdate.label')} help="firmwareChannel" note={t(`autoUpdate.note.${channel}`)} alone>
        <Switch label={t('autoUpdate.label')} on={on} disabled={update.isPending} onChange={next => update.set(next ? 'stable' : 'manual')} />
      </SettingRow>
      <Refused error={update.error} />
    </>
  );
}
