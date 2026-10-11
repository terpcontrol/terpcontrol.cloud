import { useTranslation } from 'react-i18next';
import { configurationFieldsOf } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { Block } from '@/ui/SheetParts';
import { useFieldsDraft } from './fields-draft';
import { OwnPanel, type OwnPanelProps } from './OwnPanel';
import { TargetRow } from './TargetRow';

/**
 * A fridge's fans, under its targets: the clip fan outside that moves the
 * leaves, and the inner fans that move the air in the cabinet. They are set as
 * often as the climate is - lower for seedlings, quieter at night - so they
 * stand where the climate is changed rather than only under Erweitert.
 */

const FIELDS = ['clipFan', 'innerFans'];

export function FridgeFansPanel(props: OwnPanelProps) {
  const { t } = useTranslation();
  const draft = useFieldsDraft(props.device, FIELDS);
  const fields = configurationFieldsOf(props.device.type);

  const speed = (field: string, label: string) => {
    const spec = fields[field];
    if (spec?.kind !== 'number') return null;
    return (
      <TargetRow
        id={`fridge-fan-${props.device.id}-${field}`}
        label={label}
        name={label}
        value={draft.value<number>(field, spec.max)}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        unit={t('targets.unit.percent')}
        disabled={!props.mayManage}
        onChange={value => draft.set(field, value)}
      />
    );
  };

  return (
    <OwnPanel {...props} draft={draft} saysReadOnly={false}>
      <Block grouped label={t('targets.fans')} help="advanced.fans">
        {speed('clipFan', t('tuning.clipFan'))}
        {speed('innerFans', t('tuning.innerFans'))}
      </Block>
    </OwnPanel>
  );
}
