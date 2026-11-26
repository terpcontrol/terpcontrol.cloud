import { BellOff, Check, Mail } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Me, NotificationCategory } from '@fg2/shared-types/v1';
import { useMe, useUpdateMe } from '@/api/account';
import { useReminders } from '@/api/reminders';
import { instantOf } from '@/ui/age';
import { Help } from '@/ui/Help';
import { Refused } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import { Facts } from '@/ui/Facts';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { useCallingRows } from './calling';
import { alarmsReach, callsReach, channelsLabel, LATER_DAYS, mailAddressOf, mailSaid, putAway, reachedBy } from './reach';
import { inWords } from './settings';
import { useWriteNotifications } from './write';
import styles from './NotifyNotice.module.css';

const SETTINGS = '/me/notifications';

/**
 * That nothing reaches this account when something goes wrong, said where it
 * will be read, with the one tap that fixes it.
 *
 * A new account has no channel at all, so every alarm - the device-offline one
 * the cloud keeps included - is raised for nobody. The fix offered is mail to
 * the address the account signs in with, named beside the button, because that
 * channel needs nothing installed. What it is about is what can call on the
 * account (`useCallingRows`): a device's alarms, and without a device the
 * reminders of a diary and a camera's warning that it stopped. It is drawn only
 * once the account has answered and only to somebody who has one to change.
 *
 * `later` is the notice over the readings: compact, two rows, with "Later",
 * which puts it away for a week on every browser of the account. Where
 * somebody came to fix exactly this - the notification settings - there is no
 * "Later", nothing put away is honoured, and no link to the page they are on.
 */
export function NotifyNotice({ later = false }: { later?: boolean }) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const mayManage = useMayManage();
  const me = useMe(false, mayManage);
  const putOff = useUpdateMe();
  const calling = useCallingRows();
  // Over the readings, a diary's reminders call on nobody until there is one: a new account was told on its first
  // day that due tasks would not reach it. Where somebody came to set this up, the row stays.
  const asked = later && calling.includes('tasks');
  const reminders = useReminders(asked);
  const rows = asked && reminders.data?.items.length === 0 ? calling.filter(row => row !== 'tasks') : calling;
  const [done, setDone] = useState(false);
  const titleId = useId();

  if (!mayManage || !me.data || rows.length === 0 || (asked && reminders.isPending)) return null;
  // What the tap did is said while it holds: mail switched off again brings the notice back.
  if (callsReach(me.data, rows)) return done ? <Done me={me.data} /> : null;
  if (later && (putOff.isPending || putOff.isSuccess || putAway(me.data, now))) return null;

  const account = me.data;
  const askLater = () => putOff.mutate({ preferences: { notifyLaterUntil: instantOf(now.plus({ days: LATER_DAYS })) } });

  return (
    <section className={styles.notice} aria-labelledby={titleId} data-compact={later || undefined}>
      <div className={styles.head}>
        <p className={styles.title} id={titleId}>
          <BellOff size={16} strokeWidth={2} aria-hidden />
          <span>{rows.includes('alerts') ? t('notify.title') : t('notify.titleRows', { what: inWords(t, i18n.language, rows) })}</span>
          <Help topic="emailAlarms" />
        </p>
        {later ? (
          <button type="button" className={`${ui.headLink} ${styles.later}`} onClick={askLater}>
            {t('notify.later')}
          </button>
        ) : null}
      </div>
      <EmailAlarmsOffer me={account} rows={rows} others={later} compact={later} onDone={() => setDone(true)} />
      <Refused error={putOff.error} />
    </section>
  );
}

/** What holds, said in the place it was asked about, with the way to change it. */
function Said({ className, role, children }: { className: string; role?: 'status'; children: string }) {
  const { t } = useTranslation();

  return (
    <p className={className} role={role}>
      <Check size={16} strokeWidth={2} aria-hidden />
      <span className={styles.doneText}>{children}</span>
      <Link to={SETTINGS} className={ui.headLink}>
        {t('notify.change')} ›
      </Link>
    </p>
  );
}

/**
 * The last question of adding a device: how its alarms will reach anybody. An
 * account that is already reached is told how, and one that is not is offered
 * the same tap the notice offers.
 */
export function NotifyStep({ me }: { me: Me | undefined }) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);

  if (!me) return null;
  if (done) return <Done me={me} />;
  if (alarmsReach(me)) return <Said className={styles.reached}>{t('notify.reaches', { channels: channelsLabel(t, reachedBy(me)) })}</Said>;

  return <EmailAlarmsOffer me={me} others onDone={() => setDone(true)} />;
}

/**
 * The tap itself: the button, the address it will write to and the way to the
 * other channels. Used wherever an alarm reaches nobody and the fix can be
 * offered in place - the notice, the claim step, a rule's sheet.
 */
export function EmailAlarmsOffer({
  me,
  rows,
  others = true,
  compact = false,
  onDone,
}: {
  me: Me;
  /** The rows of the grid the tap routes; the critical alarms where nothing says otherwise. */
  rows?: NotificationCategory[];
  /** Whether the line carries the link to the other channels, which the notification settings page is itself. */
  others?: boolean;
  /** One row rather than two: "Per E-Mail" with the address beside it, in the room the notice has on Start. */
  compact?: boolean;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const { mailOn, error, pending } = useWriteNotifications(me);

  return (
    <div className={`${ui.stack1} ${styles.offer}`} data-compact={compact || undefined}>
      <div className={styles.actions}>
        <button type="button" className={`${ui.button} ${styles.button}`} disabled={pending} onClick={() => mailOn(rows, onDone)}>
          <Mail size={16} strokeWidth={1.75} aria-hidden />
          {t(pending ? 'notify.sending' : compact ? 'notify.emailShort' : 'notify.email')}
        </button>
      </div>
      <p className={styles.address}>
        {/* The address and the way to the other channels as two facts, so no line ends on the dot between them. */}
        <Facts
          facts={[
            <span key="to" className={styles.to}>
              {t('notify.to', { email: mailAddressOf(me) })}
            </span>,
            others ? (
              <Link key="other" to={SETTINGS} className={ui.headLink}>
                {t('notify.other')} ›
              </Link>
            ) : null,
          ]}
        />
      </p>
      <Refused error={error} />
    </div>
  );
}

/** What the tap did, in the place it was tapped - while mail is on, in the words its toast and its card say. */
function Done({ me }: { me: Me }) {
  const { t, i18n } = useTranslation();

  return me.notifications.channels.email === null ? null : (
    <Said className={styles.done} role="status">
      {mailSaid(t, i18n.language, me)}
    </Said>
  );
}
