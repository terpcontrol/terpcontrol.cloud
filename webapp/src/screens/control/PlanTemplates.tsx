import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device, Plan, PlanNotify } from '@fg2/shared-types/v1';
import { usePlanTemplates, useSavePlanTemplate } from '@/api/plans';
import { useSession } from '@/api/session';
import { Sheet } from '@/ui/Sheet';
import { Waiting } from '@/ui/PageState';
import { Block } from '@/ui/SheetParts';
import { SwitchRow } from '@/ui/Switch';
import ui from '@/ui/ui.module.css';
import { draftFromTemplate, type PlanDraft } from './plan-edit';
import { offersReadyPlans, READY_PLANS, readyDraft, weeksOf } from './ready-plans';
import { PlanRefusal } from './Refusal';
import styles from './Control.module.css';

/**
 * The plans somebody keeps to start others from.
 *
 * A template is a copy and not a link: it takes the steps as they stand and
 * knows nothing about them afterwards, so changing a plan never changes the
 * template it came from and deleting a template never stops a plan. That is
 * also why the steps lose their ids on the way into a plan - an id is how the
 * plan finds the step it is standing on again, and two plans sharing one would
 * make an edit to either read as an edit to the same step.
 */

/** Keeping the plan that is on the tent now, under a name of its own. */
export function KeepAsTemplateSheet({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const { t } = useTranslation();
  const keep = useSavePlanTemplate();
  const [name, setName] = useState(plan.name);
  const [isPublic, setPublic] = useState(false);

  return (
    <Sheet title={t('space.control.template.keepTitle')} onClose={onClose}>
      <div className={ui.sheetBody}>
        <Block label={t('space.control.template.name')}>
          <input
            className={ui.input}
            value={name}
            aria-label={t('space.control.template.name')}
            autoComplete="off"
            onChange={event => setName(event.target.value)}
          />
          <p className={ui.note}>{t('space.control.template.keepNote', { count: plan.steps.length })}</p>
        </Block>

        <SwitchRow label={t('space.control.template.publish')} note={t('space.control.template.publishNote')} on={isPublic} onChange={setPublic} />

        <PlanRefusal error={keep.error} />

        <button
          type="button"
          className={`${ui.button} ${ui.primary} ${styles.submit}`}
          disabled={keep.isPending || name.trim() === ''}
          onClick={() =>
            keep.mutate({ name: name.trim(), isPublic, steps: plan.steps.map(({ id: _id, ...step }) => step) }, { onSuccess: () => onClose() })
          }
        >
          {keep.isPending ? t('grow.lifecycle.saving') : t('space.control.template.keep')}
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Starting from one. Choosing a template does not write anything: it opens the
 * recipe with those steps in it, so that what the tent will be run by is read
 * before it is saved - and, for a tent that is already running one, so that what
 * the change does to it is said first.
 *
 * A fridge is offered the two ready-made plans first, which is where somebody
 * who has never written a plan starts; what anybody saved follows them.
 */
export function StartFromTemplateSheet({
  device,
  notify,
  onClose,
  onChosen,
}: {
  device: Device;
  notify: PlanNotify;
  onClose: () => void;
  onChosen: (draft: PlanDraft) => void;
}) {
  const { t } = useTranslation();
  const { user } = useSession();
  const templates = usePlanTemplates();
  const items = templates.data?.items ?? [];
  const ready = offersReadyPlans(device);

  return (
    <Sheet title={t('space.control.template.startTitle')} onClose={onClose}>
      <div className={ui.sheetBody}>
        <p className={ui.note}>{t('space.control.template.startNote')}</p>

        {ready ? (
          <Block label={t('readyPlans.label')} help="readyPlans">
            <ul className={styles.templates}>
              {READY_PLANS.map(plan => (
                <li key={plan.id}>
                  <button type="button" className={`${ui.card} ${styles.template}`} onClick={() => onChosen(readyDraft(t, plan, notify))}>
                    <span className={styles.templateName}>{t(`growPresets.plans.${plan.id}.name`)}</span>
                    <span className={styles.templateWhat}>{t(`growPresets.plans.${plan.id}.description`)}</span>
                    <span className={`mono ${styles.templateNote}`}>
                      {[t('space.control.template.steps', { count: plan.steps.length }), t('readyPlans.weeks', { count: weeksOf(plan) })].join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Block>
        ) : null}

        {templates.isPending ? <Waiting lines={2} /> : null}
        {!templates.isPending && items.length === 0 && !ready ? (
          <p className={`${ui.cardDashed} ${ui.note}`}>{t('space.control.template.none')}</p>
        ) : null}
        {ready && items.length > 0 ? <span className="label">{t('readyPlans.saved')}</span> : null}

        <ul className={styles.templates}>
          {items.map(template => (
            <li key={template.id}>
              <button
                type="button"
                className={`${ui.card} ${styles.template}`}
                onClick={() => onChosen(draftFromTemplate(template.steps, template.name, template.id, notify))}
              >
                <span className={styles.templateName}>{template.name}</span>
                <span className={`mono ${styles.templateNote}`}>
                  {[
                    t('space.control.template.steps', { count: template.steps.length }),
                    template.ownerId === user?.id ? t('space.control.template.yours') : t('space.control.template.published'),
                  ].join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <PlanRefusal error={templates.error} />
      </div>
    </Sheet>
  );
}
