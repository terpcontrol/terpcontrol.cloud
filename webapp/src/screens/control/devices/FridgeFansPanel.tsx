import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import { useSettings } from '../climate/saved';
import { NumberSetting, SettingsBlock } from './Settings';
import { figureSaid, pendingOf } from './setting-words';

/**
 * A fridge's fans, among its outputs: the clip fan outside that moves the
 * leaves, and the inner fans that move the air in the cabinet. They are set
 * as often as the climate is, so they stand under Steuerung, not Erweitert.
 */
export function FridgeFansPanel({ device, mayManage }: { device: Device; mayManage: boolean }) {
  const { t } = useTranslation();
  const settings = useSettings(device);
  const unit = t('targets.unit.percent');
  const fans = [
    { name: 'clipFan', label: t('tuning.clipFan'), say: figureSaid(unit) },
    { name: 'innerFans', label: t('tuning.innerFans'), say: figureSaid(unit) },
  ];

  return (
    <SettingsBlock title={t('targets.fans')} help="advanced.fans" pending={pendingOf(device, settings, fans)}>
      {fans.map(fan => (
        <NumberSetting key={fan.name} device={device} settings={settings} mayManage={mayManage} name={fan.name} label={fan.label} unit={unit} />
      ))}
    </SettingsBlock>
  );
}
