import { useTranslation } from 'react-i18next';
import { refusalCode } from '@/api/plans';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import styles from './Control.module.css';

/**
 * Why the server would not take a move, said as something to do about it.
 *
 * The plan is the one thing in the app that moves on its own: the engine walks
 * it every twenty seconds, so between the read this screen is drawing and the
 * tap on Confirm the step may have been confirmed by somebody else, run out, or
 * been stopped. Every one of those comes back as a refusal, and every one of
 * them means the same thing to the person in front of the tent - that what is
 * on the screen is behind what the plan is doing - so they are answered with
 * the way out rather than with the sentence the server wrote for any client.
 *
 * Anything this screen has nothing better to say about keeps the server's own
 * sentence, which is written for a person to read.
 */

/** A refusal that means the screen is out of date, and is put right by reading the plan again. */
const STALE = ['nothing_to_confirm', 'plan_not_running', 'plan_already_running', 'plan_not_found'];

const SPOKEN = [...STALE, 'plan_has_no_steps', 'invalid_duration', 'duplicate_step_id', 'plan_template_name_taken'];

export function PlanRefusal({ error, onRefresh }: { error: unknown; onRefresh?: () => void }) {
  const { t } = useTranslation();
  const code = refusalCode(error);

  if (!error) return null;
  if (code === null || !SPOKEN.includes(code)) return <Refused error={error} />;

  return (
    <div className={styles.refusal} role="alert">
      <p className={ui.problem}>{t(`space.control.refused.${code}`)}</p>
      {onRefresh && STALE.includes(code) ? (
        <button type="button" className={ui.button} onClick={onRefresh}>
          {t('space.control.refused.refresh')}
        </button>
      ) : null}
    </div>
  );
}
