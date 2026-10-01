import { BellOff, Check, Mail } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Me } from '@fg2/shared-types/v1';
import { useMailAlarms, useMe, useUpdateMe } from '@/api/account';
import { channelsLabel } from '@/screens/control/alarms/rules';
import { instantOf } from '@/ui/age';
import { Help } from '@/ui/Help';
import { Refused } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { alarmsReach, LATER_DAYS, mailAddressOf, putAway, reachedBy } from './reach';
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
 */
export function NotifyNotice({ later = false }: { later?: boolean }) {
  const { t } = useTranslation();
  const now = useNow();
  const mayManage = useMayManage();
  const me = useMe(false, mayManage);
  const putOff = useUpdateMe();
  const [done, setDone] = useState<string | null>(null);
  const titleId = useId();

  if (!mayManage || !me.data) return null;
  if (done) return <Done address={done} />;
  if (alarmsReach(me.data)) return null;
  if (later && (putOff.isPending || putOff.isSuccess || putAway(me.data, now))) return null;

  const account = me.data;
  const askLater = () => putOff.mutate({ preferences: { ...account.preferences, notifyLaterUntil: instantOf(now.plus({ days: LATER_DAYS })) } });

  return (
    <section className={styles.notice} aria-labelledby={titleId}>
      <p className={styles.title} id={titleId}>
        <BellOff size={16} strokeWidth={2} aria-hidden />
        <span>{t('notify.title')}</span>
        <Help topic="emailAlarms" />
      </p>
      <EmailAlarmsOffer me={account} others={later} onDone={setDone}>
        {later ? (
          <button type="button" className={`${ui.headLink} ${styles.later}`} onClick={askLater}>
            {t('notify.later')}
          </button>
        ) : null}
      </EmailAlarmsOffer>
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
  others = true,
  primary = false,
  onDone,
  children,
}: {
  me: Me;
  /** Whether the line carries the link to the other channels, which the notification settings page is itself. */
  others?: boolean;
  /** Whether the tap is the one green action where it stands; inside a sheet or a flow that already has one, it is not. */
  primary?: boolean;
  onDone?: (address: string) => void;
  /** What stands beside the button, such as "Later". */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const mail = useMailAlarms();
  const address = mailAddressOf(me);

  return (
    <div className={styles.offer}>
      <div className={styles.actions}>
        <button
          type="button"
          className={`${ui.button} ${primary ? ui.primary : ''} ${styles.button}`}
          disabled={mail.isPending}
          onClick={() => mail.mutate(undefined, { onSuccess: () => onDone?.(address) })}
        >
          <Mail size={16} strokeWidth={1.75} aria-hidden />
          {t(mail.isPending ? 'notify.sending' : 'notify.email')}
        </button>
        {children}
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
function Done({ address }: { address: string }) {
  const { t } = useTranslation();

  return (
    <p className={styles.done} role="status">
      <Check size={16} strokeWidth={2} aria-hidden />
      <span className={styles.doneText}>{t('notify.done', { email: address })}</span>
      <Link to={SETTINGS} className={ui.headLink}>
        {t('notify.change')} ›
      </Link>
    </p>
  );
}
