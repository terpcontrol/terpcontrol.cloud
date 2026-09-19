import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Plan, PlanNotify } from '@fg2/shared-types/v1';
import { usePlanTemplates, useSavePlanTemplate } from '@/api/plans';
import { useSession } from '@/api/session';
import { Sheet } from '@/log/Sheet';
import { Waiting } from '@/ui/PageState';
import { Block } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { draftFromTemplate, type PlanDraft } from './plan-edit';
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
      <div className={styles.editor}>
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

        <div className={styles.toggle}>
          <span className={styles.toggleText}>
            <span className={styles.toggleLabel}>{t('space.control.template.publish')}</span>
            <span className={ui.note}>{t('space.control.template.publishNote')}</span>
          </span>
          <button
            type="button"
            className={ui.switch}
            role="switch"
            aria-checked={isPublic}
            aria-label={t('space.control.template.publish')}
            onClick={() => setPublic(!isPublic)}
          >
            <span className={ui.knob} aria-hidden />
          </button>
        </div>

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
 */
export function StartFromTemplateSheet({
  notify,
  onClose,
  onChosen,
}: {
  notify: PlanNotify;
  onClose: () => void;
  onChosen: (draft: PlanDraft) => void;
}) {
  const { t } = useTranslation();
  const { user } = useSession();
  const templates = usePlanTemplates();
  const items = templates.data?.items ?? [];

  return (
    <Sheet title={t('space.control.template.startTitle')} onClose={onClose}>
      <div className={styles.editor}>
        <p className={ui.note}>{t('space.control.template.startNote')}</p>

        {templates.isPending ? <Waiting lines={2} /> : null}
        {!templates.isPending && items.length === 0 ? <p className={`${ui.cardDashed} ${ui.note}`}>{t('space.control.template.none')}</p> : null}

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
