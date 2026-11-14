import { useTranslation } from 'react-i18next';
import { Answer } from '@/ui/Asking';
import ui from '@/ui/ui.module.css';

/** The yes of a repair to a grow's story - a phase or a placement put right or taken back - beside the way back; while it is written it says so. */
export function RepairAnswer(props: { yes: string; danger?: boolean; busy: boolean; disabled?: boolean; onYes: () => void; onDone: () => void }) {
  const { t } = useTranslation();

  return (
    <div className={ui.wrap}>
      <Answer
        yes={props.busy ? t('grow.lifecycle.saving') : props.yes}
        danger={props.danger}
        disabled={props.busy || props.disabled}
        onYes={props.onYes}
        onCancel={props.onDone}
      />
    </div>
  );
}
