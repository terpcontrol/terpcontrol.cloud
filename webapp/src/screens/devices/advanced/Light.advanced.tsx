import { useTranslation } from 'react-i18next';
import { useSettings } from '@/screens/control/climate/saved';
import { NumberSetting, SettingsBlock } from '@/screens/control/devices/Settings';
import { figureSaid, pendingOf } from '@/screens/control/devices/setting-words';
import { advancedItem, type DeviceContext } from '@/ui/advanced/item';
import { LightRamps } from './Tuning.advanced';

/**
 * What a LIGHT does beyond its times and its brightness, which are under
 * Steuerung: how many minutes it fades in and out, and the temperature at the
 * lamp it starts dimming at to protect itself.
 */

function Overheat({ device, mayManage }: DeviceContext) {
  const { t } = useTranslation();
  const settings = useSettings(device);
  const unit = t('targets.unit.temperature');
  const limit = { name: 'overheatAt', label: t('lightOverheat.label'), say: figureSaid(unit) };

  return (
    <SettingsBlock pending={pendingOf(device, settings, [limit])}>
      <NumberSetting
        device={device}
        settings={settings}
        mayManage={mayManage}
        name={limit.name}
        label={limit.label}
        help="advanced.lightOverheat"
        unit={unit}
      />
    </SettingsBlock>
  );
}

const isLight = ({ device }: DeviceContext) => device.type === 'light' && Boolean(device.configuration) && !device.isDemo;

export const items = [
  advancedItem({ scope: 'device', id: 'light-ramp', order: 20, shows: isLight, Item: LightRamps }),
  advancedItem({ scope: 'device', id: 'light-overheat', order: 30, shows: isLight, Item: Overheat }),
];
