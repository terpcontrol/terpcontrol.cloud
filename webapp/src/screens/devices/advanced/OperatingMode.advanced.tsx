import { useTranslation } from 'react-i18next';
import { configurationFieldsOf } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { FieldChoice } from '@/ui/advanced/Fields';
import { advancedItem, type DeviceContext } from '@/ui/advanced/item';

/**
 * Betriebsart: what a fridge or a tent controller does as a whole while its
 * control is on. Standard is what everything else in the app assumes; dark
 * germination is a stage as well and is usually reached from one, and the
 * temperature-only mode is a fridge's for the few who grow that way, which is
 * why they are here and not under Steuerung. Energy saving belongs to a fridge's
 * standard mode and is switched under Steuerung.
 */
function OperatingMode({ device, mayManage }: DeviceContext) {
  const { t } = useTranslation();
  const field = configurationFieldsOf(device.type).mode;
  const modes = field?.kind === 'choice' ? field.options : [];

  return (
    <FieldChoice
      device={device}
      name="mode"
      label={t('operatingMode.label')}
      help="advanced.operatingMode"
      disabled={!mayManage}
      options={modes.map(mode => ({ value: mode, label: t(`operatingMode.${mode}`), note: t(`operatingMode.${mode}Note`) }))}
      // Germination darkens the device and the greenhouse mode stops holding its humidity: a tap in bloom
      // would cost a night of light, so either is asked first. Back to the standard is written at once.
      ask={mode =>
        mode === 'standard'
          ? null
          : {
              question: t('operatingMode.ask', { mode: t(`operatingMode.${mode}`), what: t(`operatingMode.${mode}Note`) }),
              yes: t('operatingMode.yes', { mode: t(`operatingMode.${mode}`) }),
            }
      }
    />
  );
}

export const items = [
  advancedItem({
    scope: 'device',
    id: 'operating-mode',
    order: 10,
    shows: ({ device }) => configurationFieldsOf(device.type).mode !== undefined && Boolean(device.control),
    Item: OperatingMode,
  }),
];
