import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDevicePlan, usePlanTransition } from '@/api/plans';
import type { Device } from '@fg2/shared-types/v1';
import { useLog } from '@/log/log-context';
import { SettingRow } from '@/ui/advanced/SettingRow';
import { Asking } from '@/ui/Asking';
import ui from '@/ui/ui.module.css';
import { isGoing } from './plan-clock';
import { PlanRefusal } from './Refusal';
import styles from './ContinuePlan.module.css';

/**
 * Going on with the plan at a step of one's own choosing: back to a step that
 * ended too soon, or into the middle of a recipe for a grow that is already
 * flowering. Rare, and without it there is no way out of either - the plan
 * screen skips forward one step at a time and starts at the first.
 *
 * The step chosen starts from nought, the way the engine starts any step, so
 * the question says so before it is sent, as every move of a plan asks (`Asking`); a plan that was paused or put away
 * runs again, because going on with a step is not pausing at it. It stands
 * under the plan it moves, draws nothing for a device without steps, and is
 * answered by the toast.
 */
export function ContinuePlan({ device }: { device: Device }) {
  const { t } = useTranslation();
  const { tell } = useLog();
  const plan = useDevicePlan(device.id);
  const move = usePlanTransition(device.id);
  const [chosen, setChosen] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const steps = plan.data?.steps ?? [];
  if (steps.length === 0) return null;

  const going = plan.data ? isGoing(plan.data.state) : false;
  const standing = going ? (plan.data?.state.activeStepIndex ?? null) : null;
  const pick = chosen ?? steps[standing === null ? 0 : Math.min(standing + 1, steps.length - 1)].id;
  const index = steps.findIndex(step => step.id === pick);
  const step = steps[index];
  const label = (number: number, name: string) => t('continuePlan.step', { number, name });

  return (
    <>
      <SettingRow label={t('continuePlan.label')} help="advanced.continuePlan" wide alone>
        <div className={styles.row}>
          <select
            className={`${ui.input} ${styles.select}`}
            value={pick}
            aria-label={t('continuePlan.which')}
            disabled={move.isPending}
            onChange={event => {
              setChosen(event.target.value);
              setAsking(false);
            }}
          >
            {steps.map((one, number) => (
              <option key={one.id} value={one.id}>
                {label(number + 1, one.name)}
                {number === standing ? ` · ${t('continuePlan.now')}` : ''}
              </option>
            ))}
          </select>
          <button type="button" className={ui.button} disabled={move.isPending} onClick={() => setAsking(true)}>
            {t('continuePlan.go')}
          </button>
        </div>
      </SettingRow>

      {asking && step ? (
        <Asking
          note={t(going ? 'continuePlan.ask' : 'continuePlan.askAtRest', { step: label(index + 1, step.name), plan: plan.data?.name ?? '' })}
          yes={t('continuePlan.yes', { number: index + 1 })}
          busy={move.isPending}
          onYes={() =>
            move.mutate(
              { kind: 'goto', stepId: step.id },
              {
                onSuccess: () => {
                  setAsking(false);
                  setChosen(null);
                  tell({ label: t('continuePlan.done', { number: index + 1, name: step.name }), undo: null, from: `plan-${device.id}` });
                },
              },
            )
          }
          onCancel={() => setAsking(false)}
        />
      ) : null}
      <PlanRefusal error={move.error} onRefresh={() => void plan.refetch()} />
    </>
  );
}
