import { useTranslation } from 'react-i18next';
import { OPERATING_MODES } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { FieldChoice } from '@/ui/advanced/Fields';
import { advancedItem, type DeviceContext } from '@/ui/advanced/item';

/**
 * Betriebsart: what a fridge does as a whole while its control is on. Standard
 * is what everything else in the app assumes; temperature only and dark
 * germination are for the few who grow that way, which is why they are here
 * and not under Steuerung. Energy saving belongs to the standard mode and is
 * switched under Steuerung.
 */
function OperatingMode({ device, mayManage }: DeviceContext) {
  const { t } = useTranslation();

  return (
    <FieldChoice
      device={device}
      name="mode"
      label={t('operatingMode.label')}
      help="advanced.operatingMode"
      disabled={!mayManage}
      options={OPERATING_MODES.map(mode => ({ value: mode, label: t(`operatingMode.${mode}`), note: t(`operatingMode.${mode}Note`) }))}
    />
  );
}

export const items = [
  advancedItem({
    scope: 'device',
    id: 'operating-mode',
    order: 10,
    shows: ({ device }) => device.type === 'fridge' && Boolean(device.control),
    Item: OperatingMode,
  }),
];
