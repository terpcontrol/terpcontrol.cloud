import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDevicePlan, usePlanTransition } from '@/api/plans';
import { SettingRow } from '@/ui/advanced/SettingRow';
import { advancedItem, type DeviceContext } from '@/ui/advanced/item';
import ui from '@/ui/ui.module.css';
import { isGoing } from '../../control/plan-clock';
import { PlanRefusal } from '../../control/Refusal';
import styles from './ContinuePlan.module.css';

/**
 * Going on with the plan at a step of one's own choosing: back to a step that
 * ended too soon, or into the middle of a recipe for a grow that is already
 * flowering. Rare, and without it there is no way out of either - the plan
 * screen skips forward one step at a time and starts at the first.
 *
 * The step chosen starts from nought, the way the engine starts any step, so
 * the question says so before it is sent; a plan that was paused or put away
 * runs again, because going on with a step is not pausing at it.
 */
function ContinuePlan({ device, mayManage }: DeviceContext) {
  const { t } = useTranslation();
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
      <SettingRow label={t('continuePlan.label')} help="advanced.continuePlan" wide>
        <div className={styles.row}>
          <select
            className={`${ui.input} ${styles.select}`}
            value={pick}
            aria-label={t('continuePlan.which')}
            disabled={!mayManage || move.isPending}
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
          <button type="button" className={ui.chip} disabled={!mayManage || move.isPending} onClick={() => setAsking(true)}>
            {t('continuePlan.go')}
          </button>
        </div>
      </SettingRow>

      {asking && step ? (
        <div className={`${ui.cardDashed} ${styles.ask}`} role="alertdialog" aria-label={t('continuePlan.label')}>
          <p className={ui.note}>
            {t(going ? 'continuePlan.ask' : 'continuePlan.askAtRest', { step: label(index + 1, step.name), plan: plan.data?.name ?? '' })}
          </p>
          <div className={styles.row}>
            <button
              type="button"
              className={`${ui.button} ${ui.primary}`}
              disabled={move.isPending}
              onClick={() =>
                move.mutate(
                  { kind: 'goto', stepId: step.id },
                  {
                    onSuccess: () => {
                      setAsking(false);
                      setChosen(null);
                    },
                  },
                )
              }
            >
              {t('continuePlan.yes', { number: index + 1 })}
            </button>
            <button type="button" className={ui.button} onClick={() => setAsking(false)}>
              {t('grow.lifecycle.cancel')}
            </button>
          </div>
        </div>
      ) : null}
      {move.isSuccess && !asking ? (
        <p className={`${ui.note} ${styles.done}`} role="status">
          {t('continuePlan.done', {
            step: label((plan.data?.state.activeStepIndex ?? 0) + 1, steps[plan.data?.state.activeStepIndex ?? 0]?.name ?? ''),
          })}
        </p>
      ) : null}
      <PlanRefusal error={move.error} onRefresh={() => void plan.refetch()} />
    </>
  );
}

export const items = [
  advancedItem({
    scope: 'device',
    id: 'continue-plan',
    order: 60,
    // The plan is read by the item: a device without one, or a person who may
    // only look, is offered nothing, and the row draws nothing until it knows.
    shows: ({ device, mayManage }) => mayManage && (device.type === 'fridge' || device.type === 'controller'),
    Item: ContinuePlan,
  }),
];
