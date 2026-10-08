import { useTranslation } from 'react-i18next';
import { FieldNumber } from '@/ui/advanced/Fields';
import { advancedItem, type DeviceContext } from '@/ui/advanced/item';
import { LightRamps } from './Tuning.advanced';

/**
 * What a LIGHT does beyond its times and its brightness, which are under
 * Steuerung: how many minutes it fades in after it comes on and out before it
 * goes off, and the temperature at the lamp it starts dimming at to protect
 * itself. The firmware's defaults are sensible, which is why these are here.
 */

function Overheat({ device, mayManage }: DeviceContext) {
  const { t } = useTranslation();

  return (
    <FieldNumber
      device={device}
      name="overheatAt"
      label={t('lightOverheat.label')}
      help="advanced.lightOverheat"
      unit={t('targets.unit.temperature')}
      note={t('lightOverheat.note')}
      disabled={!mayManage}
    />
  );
}

const isLight = ({ device }: DeviceContext) => device.type === 'light' && Boolean(device.configuration) && !device.isDemo;

export const items = [
  advancedItem({ scope: 'device', id: 'light-ramp', order: 20, shows: isLight, Item: LightRamps }),
  advancedItem({ scope: 'device', id: 'light-overheat', order: 30, shows: isLight, Item: Overheat }),
];
