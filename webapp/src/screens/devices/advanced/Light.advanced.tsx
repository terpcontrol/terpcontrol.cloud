import { useTranslation } from 'react-i18next';
import { FieldNumber } from '@/ui/advanced/Fields';
import { advancedItem, type DeviceContext } from '@/ui/advanced/item';

/**
 * What a LIGHT does beyond its times and its brightness, which are under
 * Steuerung: how many minutes it fades in after it comes on and out before it
 * goes off, and the temperature at the lamp it starts dimming at to protect
 * itself. The firmware's defaults are sensible, which is why these are here.
 */

function Ramp({ device, mayManage }: DeviceContext) {
  const { t } = useTranslation();

  return (
    <>
      <FieldNumber
        device={device}
        name="sunrise"
        label={t('lightRamp.sunrise')}
        help="advanced.lightRamp"
        unit={t('units.min')}
        disabled={!mayManage}
      />
      <FieldNumber device={device} name="sunset" label={t('lightRamp.sunset')} unit={t('units.min')} disabled={!mayManage} />
    </>
  );
}

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
  advancedItem({ scope: 'device', id: 'light-ramp', order: 20, shows: isLight, Item: Ramp }),
  advancedItem({ scope: 'device', id: 'light-overheat', order: 30, shows: isLight, Item: Overheat }),
];
