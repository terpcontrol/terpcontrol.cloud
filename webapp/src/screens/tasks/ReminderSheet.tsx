import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowListItem, GrowOrSpaceRef, Reminder, ReminderCreate, ReminderKind, Space } from '@fg2/shared-types/v1';
import { Link } from 'react-router';
import { useMe } from '@/api/account';
import { serverNow } from '@/api/clock';
import { channelsLabel, isConfigured } from '@/screens/notifications/reach';
import { useCreateReminder, useDeleteReminder, useUpdateReminder } from '@/api/reminders';
import { useLog, type Told } from '@/log/log-context';
import { Asking } from '@/ui/Asking';
import { Sheet } from '@/ui/Sheet';
import { dayEdgeInstant, dayOf, startOfDayOn } from '@/ui/days';
import { Refused } from '@/ui/PageState';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { useZone } from '@/ui/zone';
import { litresOf } from './tasks';
import styles from './Tasks.module.css';

const KINDS: ReminderKind[] = ['water', 'feed', 'chore', 'custom'];

/** The rhythm a new reminder opens on: often enough to be worth a reminder, seldom enough to be edited down rather than up. */
const DEFAULT_EVERY_DAYS = 3;

/**
 * Whose the reminder is. "Somebody else" is not a choice that can be made here
 * - the handles of the other people in a place do not travel with a reminder
 * yet - but it is a state a reminder can be in, and it has to survive being
 * edited by somebody who only came to change the rhythm.
 */
type ForWhom = 'everyone' | 'me' | 'other';

interface Draft {
  label: string;
  kind: ReminderKind;
  subject: GrowOrSpaceRef | null;
  rhythm: 'every' | 'once';
  everyDays: number;
  /**
   * The day a one-off falls due as a date field speaks it, or null while
   * nobody has picked one and the day is still the one the reminder already
   * falls on. It is left unanswered rather than filled in when the sheet opens
   * because which day that is depends on the account's zone, and the account
   * has not always answered by the time a sheet draws.
   */
  onceOn: string | null;
  forWhom: ForWhom;
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
 * different arrangement, decided by whoever manages that tent - so the block
 * says so while it is still open to be answered and shows the place fixed once
 * it is not, and the server would refuse a change to it anyway.
 *
 * Deleting stops the rhythm and nothing else: the diary lines it produced stay,
 * because what was done does not stop having happened. It asks first, in the
 * place the tap was, because it cannot be taken back: a rhythm made again
 * would count from that day, not from its last tick.
 *
 * Every write is answered by a toast that names the reminder. A change is
 * taken back by writing what stood before, a new one by deleting it.
 */
export function ReminderSheet({ reminder, grows, spaces, userId, onClose }: ReminderSheetProps) {
  const { t } = useTranslation();
  const { tell } = useLog();
  const create = useCreateReminder();
  const update = useUpdateReminder();
  const remove = useDeleteReminder();
  const [draft, setDraft] = useState<Draft>(() => draftOf(reminder, userId));
  const zone = useZone();
  const [askingDelete, setAskingDelete] = useState(false);

  // The day the sheet is talking about: the one that was picked, or the one the
  // reminder already falls on, read where the account is. Both of the days this
  // field draws are read in that one zone - the value and the floor under it -
  // because a floor read on another calendar refuses the very day the field is
  // showing.
  const onceOn = draft.onceOn ?? dayOf(dueOn(reminder), zone);
  const change = (over: Partial<Draft>) => setDraft(current => ({ ...current, ...over }));
  const busy = create.isPending || update.isPending || remove.isPending;
  const complete = draft.label.trim().length > 0 && draft.subject !== null && (draft.rhythm === 'every' ? draft.everyDays >= 1 : onceOn !== '');
  const asksForCan = draft.kind === 'water' || draft.kind === 'feed';

  const told = (what: 'created' | 'changed' | 'deleted', label: string, undo: Told['undo']) => {
    tell({ label: t(`tasks.told.${what}`, { label }), undo });
    onClose();
  };
  const save = () => {
    const body = bodyOf(draft, onceOn, userId, reminder?.assigneeId ?? null, zone);
    if (!reminder) return create.mutate(body, { onSuccess: made => told('created', made.label, () => remove.mutateAsync(made.id)) });
    const { id, kind, label, everyDays, onceAt, assigneeId, defaults } = reminder;
    const before = { id, kind, label, everyDays, onceAt, assigneeId, defaults };
    update.mutate({ id, ...body }, { onSuccess: () => told('changed', body.label, () => update.mutateAsync(before)) });
  };

  return (
    <Sheet title={t(reminder ? 'tasks.sheet.editTitle' : 'tasks.sheet.newTitle')} onClose={onClose}>
      <div className={ui.sheetBody}>
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

        <Block label={t('tasks.sheet.about')} aside={<span className="mono">{t('tasks.sheet.aboutFixed')}</span>}>
          {grows.length === 0 && spaces.length === 0 ? <p className={ui.note}>{t('tasks.sheet.nowhere')}</p> : null}
          <Group
            label={t('tasks.sheet.grows')}
            type="grow"
            items={grows}
            chosen={draft.subject}
            fixed={reminder !== null}
            onChoose={subject => change({ subject })}
          />
          <Group
            label={t('tasks.sheet.places')}
            type="space"
            items={spaces}
            chosen={draft.subject}
            fixed={reminder !== null}
            onChoose={subject => change({ subject })}
          />
        </Block>

        <Block label={t('tasks.sheet.rhythm')} help="rhythmEvery">
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
            // Its own date field rather than the sheets' shared one, which
            // refuses the future. The floor is today where the account is: a
            // reminder falls due at the start of its day in the account's zone.
            <label className={`${ui.card} ${styles.field}`}>
              <span className={styles.fieldLabel}>{t('tasks.sheet.onceOn')}</span>
              <input
                className={`mono ${styles.fieldInput}`}
                type="date"
                min={dayOf(serverNow().toJSDate(), zone)}
                value={onceOn}
                onChange={event => change({ onceOn: event.target.value })}
              />
            </label>
          )}
        </Block>

        <Block label={t('tasks.sheet.for')} help="taskFor">
          <Choices label={t('tasks.sheet.for')}>
            <Choice chosen={draft.forWhom === 'everyone'} onChoose={() => change({ forWhom: 'everyone' })}>
              {t('tasks.sheet.everyone')}
            </Choice>
            <Choice chosen={draft.forWhom === 'me'} onChoose={() => change({ forWhom: 'me' })}>
              {t('tasks.sheet.me')}
            </Choice>
            {/* Shown only for a reminder that already is somebody else's, so that
                editing the rhythm of one does not quietly take it off them. */}
            {reminder && reminder.assigneeId !== null && reminder.assigneeId !== userId ? (
              <Choice chosen={draft.forWhom === 'other'} disabled onChoose={() => change({ forWhom: 'other' })}>
                {t('tasks.sheet.somebodyElse')}
              </Choice>
            ) : null}
          </Choices>
          <Reaches />
        </Block>

        <Refused error={create.error ?? update.error} />

        <button type="button" className={`${ui.button} ${ui.primary} ${styles.submit}`} disabled={busy || !complete} onClick={save}>
          {create.isPending || update.isPending ? t('tasks.sheet.saving') : t('tasks.sheet.save')}
        </button>

        {reminder ? (
          <div className={styles.asking}>
            {askingDelete ? (
              <Asking
                note={t('tasks.sheet.deleteAsk')}
                yes={t('tasks.sheet.deleteYes')}
                danger
                busy={busy}
                onYes={() => remove.mutate(reminder.id, { onSuccess: () => told('deleted', reminder.label, null) })}
                onCancel={() => setAskingDelete(false)}
              >
                <Refused error={remove.error} />
              </Asking>
            ) : (
              <button type="button" className={`${ui.button} ${ui.danger}`} disabled={busy} onClick={() => setAskingDelete(true)}>
                {t('tasks.sheet.delete')}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

/**
 * One kind of thing a reminder can be about, under its own heading. A grow and
 * the tent it stands in are different arrangements, and a single row of chips
 * mixing the two reads as one list of names with no way to tell which is which.
 */
function Group({
  label,
  type,
  items,
  chosen,
  fixed,
  onChoose,
}: {
  label: string;
  type: GrowOrSpaceRef['type'];
  items: { id: string; name: string }[];
  chosen: GrowOrSpaceRef | null;
  /** True once the reminder exists: what it is about is settled and the server would refuse a change to it. */
  fixed: boolean;
  onChoose: (subject: GrowOrSpaceRef) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className={styles.subgroup}>
      <span className={styles.subLabel}>{label}</span>
      <Choices label={label}>
        {items.map(item => (
          <Choice key={item.id} chosen={isSubject(chosen, type, item.id)} disabled={fixed} onChoose={() => onChoose({ type, id: item.id })}>
            {item.name}
          </Choice>
        ))}
      </Choices>
    </div>
  );
}

const isSubject = (subject: GrowOrSpaceRef | null, type: GrowOrSpaceRef['type'], id: string): boolean =>
  subject !== null && subject.type === type && subject.id === id;

/**
 * The reminder as it stands, or an empty one.
 *
 * A new reminder is about nothing until somebody says what it is about. What it
 * is about is the one field that cannot be changed afterwards, so a place
 * filled in by the screen would be a decision the screen made and nobody could
 * undo; Save waits for it instead.
 */
const draftOf = (reminder: Reminder | null, userId: string): Draft => {
  const litres = litresOf(reminder?.defaults);

  return {
    label: reminder?.label ?? '',
    kind: reminder?.kind ?? 'water',
    subject: reminder?.subject ?? null,
    rhythm: reminder?.onceAt ? 'once' : 'every',
    everyDays: reminder?.everyDays ?? DEFAULT_EVERY_DAYS,
    onceOn: null,
    forWhom: !reminder || reminder.assigneeId === null ? 'everyone' : reminder.assigneeId === userId ? 'me' : 'other',
    litres: litres === null ? '' : String(litres),
  };
};

/**
 * The instant the day field is showing before anybody has touched it: the one
 * the reminder already falls due at, or now for a reminder that does not exist
 * yet.
 *
 * Which day that instant is read as is the caller's to say, and it says the
 * account's: the stored instant is the start of a day there and `bodyOf`
 * writes it back as one, so a Save that changed nothing must not move it.
 */
const dueOn = (reminder: Reminder | null): Date => (reminder?.onceAt ? new Date(reminder.onceAt) : serverNow().toJSDate());

/**
 * What goes on the wire. Exactly one of the two rhythms is set, which is the
 * contract's rule; a one-off falls due at the start of its day in the account's
 * zone, the one the task list sorts what is waiting into days by, so it is
 * today's task from the morning on. The can is the entry's default of the
 * shape the Log sheet writes, so a tick records it the way a tap on the Water
 * tile would.
 *
 * A reminder that is somebody else's is sent back with that person still on it:
 * whoever is editing it can only have come to change something else.
 */
const bodyOf = (draft: Draft, onceOn: string, userId: string, assigneeId: string | null, zone: string | null): ReminderCreate => {
  const litres = Number(draft.litres);
  const asksForCan = draft.kind === 'water' || draft.kind === 'feed';

  return {
    subject: draft.subject!,
    kind: draft.kind,
    label: draft.label.trim(),
    everyDays: draft.rhythm === 'every' ? draft.everyDays : null,
    onceAt: draft.rhythm === 'once' ? dayEdgeInstant(onceOn, startOfDayOn, zone) : null,
    assigneeId: draft.forWhom === 'me' ? userId : draft.forWhom === 'other' ? assigneeId : null,
    defaults: asksForCan && draft.litres !== '' && litres > 0 ? { kind: draft.kind, litres } : null,
  };
};

/**
 * Where the reminder will reach whoever it is for, said where it is set:
 * "bekommt Bescheid, wenn sie fällig wird" promised a message that, with no
 * channel routed, went nowhere.
 */
function Reaches() {
  const { t } = useTranslation();
  const me = useMe();
  const account = me.data;
  if (!account?.notifications) return null;

  const routed = (account.notifications.routing.tasks ?? []).filter(channel => isConfigured(account, channel));
  return routed.length > 0 ? (
    <p className={ui.note}>
      {t('tasks.sheet.reaches', {
        channels: channelsLabel(
          t,
          routed.map(channel => ({ channel, configured: true })),
        ),
      })}
    </p>
  ) : (
    <p className={ui.note}>
      <Link to="/me/notifications" className={ui.headLink}>
        {t('tasks.sheet.reachesNobody')} ›
      </Link>
    </p>
  );
}
