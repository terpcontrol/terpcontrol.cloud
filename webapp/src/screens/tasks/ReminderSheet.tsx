import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowListItem, GrowOrSpaceRef, Reminder, ReminderCreate, ReminderKind, Space } from '@fg2/shared-types/v1';
import { useCreateReminder, useDeleteReminder, useUpdateReminder } from '@/api/reminders';
import { Sheet } from '@/log/Sheet';
import { instantOf } from '@/ui/age';
import { dayOf } from '@/ui/days';
import { Refused } from '@/ui/PageState';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import styles from './Tasks.module.css';

const KINDS: ReminderKind[] = ['water', 'feed', 'chore', 'custom'];

/** The rhythm a new reminder opens on: often enough to be worth a reminder, seldom enough to be edited down rather than up. */
const DEFAULT_EVERY_DAYS = 3;

interface Draft {
  label: string;
  kind: ReminderKind;
  subject: GrowOrSpaceRef | null;
  rhythm: 'every' | 'once';
  everyDays: number;
  /** The day a one-off falls due, as a date field speaks it. */
  onceOn: string;
  forMe: boolean;
  /** The can, for a watering or a feed; empty is a task that asks nothing about the volume. */
  litres: string;
}

interface ReminderSheetProps {
  /** The rhythm being changed, or null for a new one. */
  reminder: Reminder | null;
  grows: GrowListItem[];
  spaces: Space[];
  userId: string;
  onClose: () => void;
}

/**
 * Writing a rhythm: what to do, about which place, how often, and for whom.
 *
 * It is one sheet for making and changing a reminder because those are the
 * same five questions, and the person who has just made one with the wrong
 * rhythm is exactly the person who needs to change it. What a reminder is
 * about cannot be changed afterwards - a rhythm moved to another tent is a
 * different arrangement, decided by whoever manages that tent - so the place
 * is shown fixed when editing, and the server would refuse a change to it
 * anyway.
 *
 * Deleting stops the rhythm and nothing else: the diary lines it produced stay,
 * because what was done does not stop having happened. It asks first, in the
 * place the tap was, because it cannot be taken back.
 */
export function ReminderSheet({ reminder, grows, spaces, userId, onClose }: ReminderSheetProps) {
  const { t } = useTranslation();
  const create = useCreateReminder();
  const update = useUpdateReminder(reminder?.id ?? '');
  const remove = useDeleteReminder(reminder?.id ?? '');
  const [draft, setDraft] = useState<Draft>(() => draftOf(reminder, userId, grows, spaces));
  const [askingDelete, setAskingDelete] = useState(false);

  const change = (over: Partial<Draft>) => setDraft(current => ({ ...current, ...over }));
  const busy = create.isPending || update.isPending || remove.isPending;
  const complete = draft.label.trim().length > 0 && draft.subject !== null && (draft.rhythm === 'every' ? draft.everyDays >= 1 : draft.onceOn !== '');
  const asksForCan = draft.kind === 'water' || draft.kind === 'feed';

  const save = () => {
    const body = bodyOf(draft, userId);
    if (reminder) update.mutate(body, { onSuccess: onClose });
    else create.mutate(body, { onSuccess: onClose });
  };

  return (
    <Sheet title={t(reminder ? 'tasks.sheet.editTitle' : 'tasks.sheet.newTitle')} onClose={onClose}>
      <div className={styles.body}>
        <Block label={t('tasks.sheet.what')}>
          <input
            className={ui.input}
            value={draft.label}
            placeholder={t('tasks.sheet.labelPlaceholder')}
            aria-label={t('tasks.sheet.label')}
            autoComplete="off"
            onChange={event => change({ label: event.target.value })}
          />
          <Choices label={t('tasks.sheet.kind')}>
            {KINDS.map(kind => (
              <Choice key={kind} chosen={draft.kind === kind} onChoose={() => change({ kind })}>
                {t(`tasks.kind.${kind}`)}
              </Choice>
            ))}
          </Choices>
          {asksForCan ? (
            <label className={`${ui.card} ${styles.field}`}>
              <span className={styles.fieldLabel}>{t('tasks.sheet.litres')}</span>
              <input
                className={`mono ${styles.fieldInput} ${styles.number}`}
                type="number"
                min={0}
                step={0.5}
                value={draft.litres}
                onChange={event => change({ litres: event.target.value })}
              />
            </label>
          ) : null}
        </Block>

        <Block label={t('tasks.sheet.about')} aside={reminder ? t('tasks.sheet.aboutFixed') : undefined}>
          {grows.length === 0 && spaces.length === 0 ? (
            <p className={ui.note}>{t('tasks.sheet.nowhere')}</p>
          ) : (
            <Choices label={t('tasks.sheet.about')}>
              {grows.map(grow => (
                <Choice
                  key={grow.id}
                  chosen={isSubject(draft.subject, 'grow', grow.id)}
                  disabled={reminder !== null}
                  onChoose={() => change({ subject: { type: 'grow', id: grow.id } })}
                >
                  {grow.name}
                </Choice>
              ))}
              {spaces.map(space => (
                <Choice
                  key={space.id}
                  chosen={isSubject(draft.subject, 'space', space.id)}
                  disabled={reminder !== null}
                  onChoose={() => change({ subject: { type: 'space', id: space.id } })}
                >
                  {space.name}
                </Choice>
              ))}
            </Choices>
          )}
        </Block>

        <Block label={t('tasks.sheet.rhythm')}>
          <div className={styles.rhythm}>
            <Choices label={t('tasks.sheet.rhythm')}>
              <Choice chosen={draft.rhythm === 'every'} onChoose={() => change({ rhythm: 'every' })}>
                {t('tasks.sheet.every')}
              </Choice>
              <Choice chosen={draft.rhythm === 'once'} onChoose={() => change({ rhythm: 'once' })}>
                {t('tasks.sheet.once')}
              </Choice>
            </Choices>
          </div>
          {draft.rhythm === 'every' ? (
            <label className={`${ui.card} ${styles.field}`}>
              <span className={styles.fieldLabel}>{t('tasks.sheet.everyDays')}</span>
              <input
                className={`mono ${styles.fieldInput} ${styles.number}`}
                type="number"
                min={1}
                step={1}
                value={draft.everyDays}
                onChange={event => change({ everyDays: Math.max(1, Math.floor(Number(event.target.value)) || 1) })}
              />
            </label>
          ) : (
            // Its own date field rather than the sheets' shared one: that one
            // records what has already been done and refuses the future, and
            // a reminder is for nothing else.
            <label className={`${ui.card} ${styles.field}`}>
              <span className={styles.fieldLabel}>{t('tasks.sheet.onceOn')}</span>
              <input
                className={`mono ${styles.fieldInput}`}
                type="date"
                min={dayOf(new Date())}
                value={draft.onceOn}
                onChange={event => change({ onceOn: event.target.value })}
              />
            </label>
          )}
        </Block>

        <Block label={t('tasks.sheet.for')}>
          <Choices label={t('tasks.sheet.for')}>
            <Choice chosen={!draft.forMe} onChoose={() => change({ forMe: false })}>
              {t('tasks.sheet.everyone')}
            </Choice>
            <Choice chosen={draft.forMe} onChoose={() => change({ forMe: true })}>
              {t('tasks.sheet.me')}
            </Choice>
          </Choices>
        </Block>

        <Refused error={create.error ?? update.error} />

        <button type="button" className={`${ui.button} ${ui.primary} ${styles.submit}`} disabled={busy || !complete} onClick={save}>
          {create.isPending || update.isPending ? t('tasks.sheet.saving') : t('tasks.sheet.save')}
        </button>

        {reminder ? (
          <div className={styles.asking}>
            {askingDelete ? (
              <>
                <p className={ui.note}>{t('tasks.sheet.deleteAsk')}</p>
                <Refused error={remove.error} />
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={`${ui.button} ${styles.dangerButton}`}
                    disabled={busy}
                    onClick={() => remove.mutate(undefined, { onSuccess: onClose })}
                  >
                    {t('tasks.sheet.deleteYes')}
                  </button>
                  <button type="button" className={ui.button} onClick={() => setAskingDelete(false)}>
                    {t('tasks.sheet.cancel')}
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className={`${ui.button} ${styles.danger}`} disabled={busy} onClick={() => setAskingDelete(true)}>
                {t('tasks.sheet.delete')}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

const isSubject = (subject: GrowOrSpaceRef | null, type: GrowOrSpaceRef['type'], id: string): boolean =>
  subject !== null && subject.type === type && subject.id === id;

/** The reminder as it stands, or a new one pointed at the first grow - the place most reminders are about - and failing that the first space. */
const draftOf = (reminder: Reminder | null, userId: string, grows: GrowListItem[], spaces: Space[]): Draft => {
  const litres = reminder ? litresIn(reminder.defaults) : null;
  const first: GrowOrSpaceRef | null = grows[0] ? { type: 'grow', id: grows[0].id } : spaces[0] ? { type: 'space', id: spaces[0].id } : null;

  return {
    label: reminder?.label ?? '',
    kind: reminder?.kind ?? 'water',
    subject: reminder?.subject ?? first,
    rhythm: reminder?.onceAt ? 'once' : 'every',
    everyDays: reminder?.everyDays ?? DEFAULT_EVERY_DAYS,
    onceOn: reminder?.onceAt ? dayOf(new Date(reminder.onceAt)) : dayOf(new Date()),
    forMe: reminder?.assigneeId === userId,
    litres: litres === null ? '' : String(litres),
  };
};

const litresIn = (defaults: unknown): number | null => {
  const values = defaults as { litres?: unknown } | null;
  return values && typeof values.litres === 'number' ? values.litres : null;
};

/**
 * What goes on the wire. Exactly one of the two rhythms is set, which is the
 * contract's rule; a one-off falls due at the start of its day in the reader's
 * zone, so it is today's task from the morning on. The can is the entry's
 * default of the same shape the Log sheet writes, so a tick records it the
 * way a tap on the Water tile would.
 */
const bodyOf = (draft: Draft, userId: string): ReminderCreate => {
  const litres = Number(draft.litres);
  const asksForCan = draft.kind === 'water' || draft.kind === 'feed';

  return {
    subject: draft.subject!,
    kind: draft.kind,
    label: draft.label.trim(),
    everyDays: draft.rhythm === 'every' ? draft.everyDays : null,
    onceAt: draft.rhythm === 'once' ? instantOf(DateTime.fromISO(draft.onceOn).startOf('day')) : null,
    assigneeId: draft.forMe ? userId : null,
    defaults: asksForCan && draft.litres !== '' && litres > 0 ? { kind: draft.kind, litres } : null,
  };
};
