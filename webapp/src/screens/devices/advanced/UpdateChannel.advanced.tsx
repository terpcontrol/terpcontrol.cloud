import { useTranslation } from 'react-i18next';
import type { FirmwareChannel } from '@fg2/shared-types/v1';
import { SettingRow } from '@/ui/advanced/SettingRow';
import { advancedItem, type DeviceContext } from '@/ui/advanced/item';
import { Refused } from '@/ui/PageState';
import { Choice, Choices } from '@/ui/SheetParts';
import { useChannel } from '../update-channel';

/** The channels a device can take its updates from; `manual` is the switch in the panel being off. */
const CHANNELS: readonly Exclude<FirmwareChannel, 'manual'>[] = ['stable', 'beta', 'alpha'];

/**
 * Which releases a device installs by itself: the stable ones the panel's
 * switch stands for, or the test releases too, for somebody who wants a fix
 * before everybody else. Choosing one switches automatic updates on.
 */
function UpdateChannel({ device, mayManage }: DeviceContext) {
  const { t } = useTranslation();
  const update = useChannel(device);
  const channel = update.asked ?? device.firmware.channel;

  return (
    <>
      <SettingRow label={t('updateChannel.label')} help="advanced.updateChannel" note={t(`updateChannel.note.${channel}`)} wide>
        <Choices label={t('updateChannel.label')}>
          {CHANNELS.map(one => (
            <Choice
              key={one}
              chosen={one === channel}
              disabled={!mayManage || update.isPending}
              onChoose={() => (one === channel ? undefined : update.set(one))}
            >
              {t(`updateChannel.${one}`)}
            </Choice>
          ))}
        </Choices>
      </SettingRow>
      <Refused error={update.error} />
    </>
  );
}

export const items = [
  advancedItem({
    scope: 'device',
    id: 'update-channel',
    order: 900,
    shows: ({ device, mayManage }) => mayManage && !device.isDemo,
    Item: UpdateChannel,
  }),
];
