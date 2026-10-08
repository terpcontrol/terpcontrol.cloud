import { BellOff, Check, Mail } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Me, NotificationCategory } from '@fg2/shared-types/v1';
import { useMailAlarms, useMe, useUpdateMe } from '@/api/account';
import { instantOf } from '@/ui/age';
import { Help } from '@/ui/Help';
import { Refused } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { rowsInWords, useCallingRows } from './calling';
import { alarmsReach, callsReach, channelsLabel, LATER_DAYS, mailAddressOf, putAway, reachedBy } from './reach';
import styles from './NotifyNotice.module.css';

const SETTINGS = '/me/notifications';

/**
 * That nothing reaches this account when something goes wrong, said where it
 * will be read, with the one tap that fixes it.
 *
 * A new account has no channel at all, so every alarm - the device-offline one
 * the cloud keeps included - is raised for nobody, and the grower believes
 * they are watched over. The fix offered is mail to the address they sign in
 * with, named on the button's line, because that is the one channel that needs
 * nothing installed; the other ways are a link away. It is drawn only once the
 * account has answered and only to somebody who has an account to change.
 *
 * `later` offers "Later", which puts the notice away for a week on every
 * browser of the account. Where somebody came to fix exactly this - the
 * notification settings - there is no "Later", nothing put away is honoured,
 * and there is no link to the page they are already on.
 *
 * Over the readings it is drawn compact, two rows: what is wrong with "Later"
 * at its end, then the tap with the address it writes to beside it. The
 * notice is there for the first screen of a cockpit, and at three rows it took
 * the room of a whole tile from it.
 *
 * What it is about is what can call on the account: a device's alarms, and
 * without a device the reminders of a diary and a camera's warning that it
 * stopped - the one thing that calls on somebody who keeps a diary without
 * hardware was never mentioned, and the tap left it where it was.
 */
export function NotifyNotice({ later = false }: { later?: boolean }) {
  const { t } = useTranslation();
  const now = useNow();
  const mayManage = useMayManage();
  const me = useMe(false, mayManage);
  const putOff = useUpdateMe();
  const rows = useCallingRows();
  const [done, setDone] = useState<string | null>(null);
  const titleId = useId();

  if (!mayManage || !me.data || rows.length === 0) return null;
  if (done) return <Done address={done} rows={rows} />;
  if (callsReach(me.data, rows)) return null;
  if (later && (putOff.isPending || putOff.isSuccess || putAway(me.data, now))) return null;

  const account = me.data;
  const askLater = () => putOff.mutate({ preferences: { notifyLaterUntil: instantOf(now.plus({ days: LATER_DAYS })) } });

  return (
    <section className={styles.notice} aria-labelledby={titleId} data-compact={later || undefined}>
      <div className={styles.head}>
        <p className={styles.title} id={titleId}>
          <BellOff size={16} strokeWidth={2} aria-hidden />
          <span>{rows.includes('alerts') ? t('notify.title') : t('notify.titleRows', { what: rowsInWords(t, rows) })}</span>
          <Help topic="emailAlarms" />
        </p>
        {later ? (
          <button type="button" className={`${ui.headLink} ${styles.later}`} onClick={askLater}>
            {t('notify.later')}
          </button>
        ) : null}
      </div>
      <EmailAlarmsOffer me={account} rows={rows} others={later} compact={later} onDone={setDone} />
      <Refused error={putOff.error} />
    </section>
  );
}

/**
 * The last question of adding a device: how its alarms will reach anybody. An
 * account that is already reached is told how, and one that is not is offered
 * the same tap the notice offers.
 */
export function NotifyStep({ me }: { me: Me | undefined }) {
  const { t } = useTranslation();
  const [done, setDone] = useState<string | null>(null);

  if (!me) return null;
  if (done) return <Done address={done} />;
  if (alarmsReach(me)) {
    return (
      <p className={styles.reached}>
        <Check size={16} strokeWidth={2} aria-hidden />
        <span className={styles.doneText}>{t('notify.reaches', { channels: channelsLabel(t, reachedBy(me)) })}</span>
        <Link to={SETTINGS} className={ui.headLink}>
          {t('notify.change')} ›
        </Link>
      </p>
    );
  }

  return <EmailAlarmsOffer me={me} others onDone={setDone} />;
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
  /**
   * One row rather than two: "Per E-Mail" with the address it goes to beside
   * it, which reads as the one sentence it is - "Per E-Mail an …" - in the
   * room the notice has over a cockpit's readings.
   */
  compact?: boolean;
  onDone?: (address: string) => void;
}) {
  const { t } = useTranslation();
  const mail = useMailAlarms();
  const address = mailAddressOf(me);

  return (
    <div className={styles.offer} data-compact={compact || undefined}>
      <div className={styles.actions}>
        <button
          type="button"
          className={`${ui.button} ${styles.button}`}
          disabled={mail.isPending}
          onClick={() => mail.mutate(rows, { onSuccess: () => onDone?.(address) })}
        >
          <Mail size={16} strokeWidth={1.75} aria-hidden />
          {t(mail.isPending ? 'notify.sending' : compact ? 'notify.emailShort' : 'notify.email')}
        </button>
      </div>
      <p className={styles.address}>
        <span className={`mono ${styles.to}`}>{t('notify.to', { email: address })}</span>
        {others ? (
          <>
            {' · '}
            <Link to={SETTINGS} className={ui.headLink}>
              {t('notify.other')} ›
            </Link>
          </>
        ) : null}
      </p>
      <Refused error={mail.error} />
    </div>
  );
}

/** What the tap did, in the place it was tapped, and the way to change it. */
function Done({ address, rows }: { address: string; rows?: NotificationCategory[] }) {
  const { t } = useTranslation();
  const said =
    rows && !(rows.length === 1 && rows[0] === 'alerts')
      ? t('notify.doneRows', { what: rowsInWords(t, rows), email: address })
      : t('notify.done', { email: address });

  return (
    <p className={styles.done} role="status">
      <Check size={16} strokeWidth={2} aria-hidden />
      <span className={styles.doneText}>{said}</span>
      <Link to={SETTINGS} className={ui.headLink}>
        {t('notify.change')} ›
      </Link>
    </p>
  );
}
