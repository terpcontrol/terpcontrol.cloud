import { useTranslation } from 'react-i18next';
import ui from '@/ui/ui.module.css';

/** The yes of a repair to a grow's story - a phase or a placement put right or taken back - beside the way back; while it is written it says so. */
export function RepairAnswer(props: { yes: string; danger?: boolean; busy: boolean; disabled?: boolean; onYes: () => void; onDone: () => void }) {
  const { t } = useTranslation();

  return (
    <div className={ui.wrap}>
      <button
        type="button"
        className={`${ui.button} ${props.danger ? ui.dangerFilled : ui.primary}`}
        disabled={props.busy || props.disabled}
        onClick={props.onYes}
      >
        {props.busy ? t('grow.lifecycle.saving') : props.yes}
      </button>
      <button type="button" className={ui.button} onClick={props.onDone}>
        {t('grow.lifecycle.cancel')}
      </button>
    </div>
  );
}
