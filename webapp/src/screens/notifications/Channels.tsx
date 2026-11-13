import { useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Me, NotificationCategory, NotificationChannel, TelegramLink, WebhookMethod } from '@fg2/shared-types/v1';
import { useMe, useSubscribePush, useTelegramLink, useUnsubscribePush } from '@/api/account';
import { ApiError } from '@/api/problem';
import { isIos, isStandalone } from '@/app/install';
import { INSTALL_ANCHOR } from '@/screens/me/appearance/InstallRow';
import { Asking } from '@/ui/Asking';
import { Facts } from '@/ui/Facts';
import { Refused } from '@/ui/PageState';
import { Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { calendarDay, clock, zoneOf } from '@/ui/zone';
import { useNow } from '@/ui/useNow';
import { forgetId, pushKey, pushSupported, rememberedId, rememberId, subscribe, usePushSubscription } from './push';
import { Row } from '@/screens/me/parts';
import parts from '@/screens/me/parts.module.css';
import { Switch } from '@/ui/Switch';
import { useWriteNotifications } from './write';
import { headersOf, headersText } from '@/ui/headers';
import { useCallingRows } from './calling';
import { categoriesOn, hostOf, inWords, WEBHOOK_METHODS } from './settings';
import styles from './Notifications.module.css';

/**
 * The four channels, each a card with its switch.
 *
 * A channel that is null is off, and there is no fallback: the login address
 * is never mailed to unless its switch here or the notice's tap asks for it.
 * Two of the four need the install's half as well as the person's - a push
 * key, a bot - and a card whose install has none says so in place of offering
 * a switch that could never send.
 */

interface CardProps {
  me: Me;
  /** Whether nothing on this screen may be moved: the demo, or a write on its way. */
  held: boolean;
}

/** The rows whose Telegram messages take a reply into the diary. */
const REPLYABLE: NotificationCategory[] = ['alerts', 'warnings', 'tasks'];

/** The line under a card that is on: what the grid sends its way. */
function Carries({ me, channel }: { me: Me; channel: NotificationChannel }) {
  const { t, i18n } = useTranslation();
  const rows = categoriesOn(me.notifications.routing, channel);

  return <>{rows.length > 0 ? inWords(t, i18n.language, rows, false) : t('notifications.nothingRouted')}</>;
}

/** The chip that opens a card's fields, drawn only while they are closed. */
function EditChip({ disabled, onOpen }: { disabled: boolean; onOpen: () => void }) {
  const { t } = useTranslation();

  return (
    <button type="button" className={ui.chip} disabled={disabled} onClick={onOpen}>
      {t('notifications.edit')}
    </button>
  );
}

/** Save what was typed, or leave it as it was. Drawn only while a card is being edited. */
function EditActions({ save, onCancel }: { save: boolean; onCancel: () => void }) {
  const { t } = useTranslation();

  return (
    <div className={ui.wrap}>
      <button type="submit" className={`${ui.button} ${ui.primary}`} disabled={!save}>
        {t('notifications.save')}
      </button>
      <button type="button" className={ui.button} onClick={onCancel}>
        {t('notifications.cancel')}
      </button>
    </div>
  );
}

/**
 * This browser. The switch is what the browser holds, not what the account
 * says: a subscription lives in the service worker of the browser it was made
 * in, so the same account on another phone starts this card switched off. The
 * line says the difference, because a person who subscribed on their phone and
 * is now looking at their laptop is not somebody nothing is pushed to.
 */
export function PushCard({ me, held }: CardProps) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const subscription = usePushSubscription();
  const add = useSubscribePush();
  const remove = useUnsubscribePush();
  const [fault, setFault] = useState<{ key: string } | { error: unknown } | null>(null);
  const [asking, setAsking] = useState(false);

  // Safari on an iPhone pushes only to the app on the home screen: there it is not the browser that cannot but
  // the place it was opened from - which is said, with the way to the other one.
  const cannot = !me.pushPublicKey ? 'noKey' : !pushSupported() ? (isIos() && !isStandalone() ? 'iosInstall' : 'unsupported') : null;
  const on = subscription.data != null;

  const switchOn = async () => {
    setFault(null);
    setAsking(true);
    try {
      const made = await subscribe(me.pushPublicKey!);
      if (!made) {
        setFault({ key: 'denied' });
        return;
      }
      const { endpoint, keys } = made.toJSON();
      const row = await add.mutateAsync({ endpoint: endpoint!, keys: { p256dh: keys!.p256dh!, auth: keys!.auth! } });
      rememberId(row.endpoint, row.id);
    } catch (error) {
      setFault(error instanceof ApiError ? { error } : { key: 'unsupported' });
    } finally {
      setAsking(false);
      await client.invalidateQueries({ queryKey: pushKey });
    }
  };

  const switchOff = async () => {
    const have = subscription.data;
    if (!have) return;
    setFault(null);
    setAsking(true);
    try {
      const id = rememberedId(have.endpoint);
      // A row the server has already lost is as gone as one it removes now.
      if (id) await remove.mutateAsync(id).catch(error => (error instanceof ApiError && error.status === 404 ? undefined : Promise.reject(error)));
      await have.unsubscribe();
      forgetId(have.endpoint);
    } catch (error) {
      setFault({ error });
    } finally {
      setAsking(false);
      await client.invalidateQueries({ queryKey: pushKey });
    }
  };

  return (
    <Row
      title={t('notifications.channel.push')}
      line={
        cannot === 'iosInstall' ? (
          <>
            {t('notifications.push.iosInstall')}{' '}
            <Link to={`/me/appearance#${INSTALL_ANCHOR}`} className={ui.headLink}>
              {t('notifications.push.iosHow')} ›
            </Link>
          </>
        ) : cannot ? (
          t(`notifications.push.${cannot}`)
        ) : on || me.pushSubscribed ? (
          <Facts facts={[t(`notifications.push.${on ? 'thisBrowser' : 'otherDevice'}`), <Carries me={me} channel="push" />]} />
        ) : (
          <Facts facts={[t('notifications.off'), t('notifications.push.notSubscribed')]} />
        )
      }
      below={
        <>
          {asking ? <p className={ui.note}>{t('notifications.push.asking')}</p> : null}
          {fault && 'key' in fault ? (
            <p className={ui.problem} role="alert">
              {t(`notifications.push.${fault.key}`)}
            </p>
          ) : null}
          {fault && 'error' in fault ? <Refused error={fault.error} /> : null}
        </>
      }
    >
      <Switch
        label={t('notifications.channel.push')}
        on={on}
        disabled={held || cannot !== null || asking || subscription.isPending}
        onChange={() => void (on ? switchOff() : switchOn())}
      />
    </Row>
  );
}

/**
 * A chat with the install's bot. Linking happens in Telegram: the switch asks
 * the server for a link, the person opens it there, and this card reads the
 * account again every few seconds until the chat shows up on it or the link
 * runs out. Unlinking is the one write here, and it asks first, because the
 * way back is opening a new link in the other app.
 */
export function TelegramCard({ me, held }: CardProps) {
  const { t } = useTranslation();
  // When the link runs out is a clock time like every other: the account's hour in its 24-hour shape, not the locale's.
  const zone = zoneOf(me);
  const { write, error } = useWriteNotifications(me);
  const link = useTelegramLink();
  const [offered, setOffered] = useState<TelegramLink | null>(null);
  const [asking, setAsking] = useState(false);
  const now = useNow();

  const linked = me.notifications.channels.telegram;
  // A link is over when the chat is on the account, and over when its time is up.
  const ran = offered !== null && DateTime.fromISO(offered.validUntil) <= now;
  const waiting = offered !== null && !linked && !ran;
  useMe(waiting ? 5000 : false);

  const on = linked !== null || waiting;
  const cannot = !me.telegramAvailable;
  // A reply becomes a diary line only under a message about an alarm or a task;
  // the plan's questions and the weekly recap are about nothing a line can hang on.
  const answerable = categoriesOn(me.notifications.routing, 'telegram').some(category => REPLYABLE.includes(category));

  const toggle = () => {
    if (linked) {
      setAsking(!asking);
      return;
    }
    if (waiting) {
      setOffered(null);
      return;
    }
    link.mutate(undefined, { onSuccess: setOffered });
  };

  return (
    <Row
      title={t('notifications.channel.telegram')}
      line={
        cannot ? (
          t('notifications.telegram.noBot')
        ) : linked ? (
          <Facts
            facts={[
              t('notifications.telegram.linked', { date: calendarDay(linked.linkedAt, zone) }),
              <Carries me={me} channel="telegram" />,
              answerable ? t('notifications.telegram.replies') : null,
            ]}
          />
        ) : waiting ? (
          t('notifications.telegram.waiting')
        ) : (
          <Facts facts={[t('notifications.off'), t('notifications.telegram.notLinked')]} />
        )
      }
      below={
        <>
          {offered && waiting ? (
            <p className={styles.linkLine}>
              <a className={`${ui.button} ${ui.primary}`} href={offered.url} target="_blank" rel="noreferrer">
                {t('notifications.telegram.open')}
              </a>
              <span className={`mono ${ui.note}`}>{t('notifications.telegram.validUntil', { time: clock(offered.validUntil, zone) })}</span>
            </p>
          ) : null}
          {ran && !linked ? <p className={ui.note}>{t('notifications.telegram.expired')}</p> : null}
          {asking && linked ? (
            <Asking
              note={t('notifications.telegram.ask')}
              yes={t('notifications.telegram.unlink')}
              danger
              busy={held}
              onYes={() => {
                setAsking(false);
                setOffered(null);
                write({ channels: { ...me.notifications.channels, telegram: null } }, t('notifications.told.unlinked'));
              }}
              onCancel={() => setAsking(false)}
            />
          ) : null}
          <Refused error={link.error ?? error} />
        </>
      }
    >
      <Switch label={t('notifications.channel.telegram')} on={on} disabled={held || cannot || link.isPending} onChange={toggle} />
    </Row>
  );
}

/**
 * An address. The switch does what the notice's tap does (`mailOn`): mail
 * to the address the account signs in with, carrying what can call on the
 * account, so e-mail is switched on one way and an address that is sent
 * nothing does not exist. At rest the card is the address and the switch; the
 * chip opens the field for another address, and nothing of it is written until
 * Save confirms it.
 */
export function EmailCard({ me, held }: CardProps) {
  const { t } = useTranslation();
  const { write, mailOn, error, pending } = useWriteNotifications(me);
  const rows = useCallingRows();
  const address = me.notifications.channels.email;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const typed = draft.trim();

  const toggle = () => {
    setEditing(false);
    if (address === null) mailOn(rows.length > 0 ? rows : undefined);
    else write({ channels: { ...me.notifications.channels, email: null } }, t('notifications.told.off', { what: t('notifications.channel.email') }));
  };

  return (
    <Row
      title={t('notifications.channel.email')}
      line={<Facts facts={address ? [address, <Carries me={me} channel="email" />] : [t('notifications.off'), t('notifications.notConfigured')]} />}
      below={
        <>
          {editing ? (
            <form
              className={parts.fields}
              onSubmit={event => {
                event.preventDefault();
                if (!typed) return;
                setEditing(false);
                write({ channels: { ...me.notifications.channels, email: typed } }, t('notifications.told.email', { address: typed }));
              }}
            >
              <label className={parts.field}>
                <span className="label">{t('notifications.email.address')}</span>
                <input
                  className={ui.input}
                  type="email"
                  autoComplete="email"
                  value={draft}
                  disabled={held}
                  onChange={event => setDraft(event.target.value)}
                />
              </label>
              <EditActions save={!held && !pending && typed !== '' && typed !== address} onCancel={() => setEditing(false)} />
            </form>
          ) : null}
          <Refused error={error} />
        </>
      }
    >
      {address !== null && !editing ? (
        <EditChip
          disabled={held}
          onOpen={() => {
            setDraft(address);
            setEditing(true);
          }}
        />
      ) : null}
      <Switch label={t('notifications.channel.email')} on={address !== null} disabled={held} onChange={toggle} />
    </Row>
  );
}

/**
 * A webhook: a URL of the person's own, the method, and headers as lines. The
 * target and the headers are secrets the server hands only to their owner, so
 * the card names the host and nothing more until the chip opens the fields.
 */
export function WebhookCard({ me, held }: CardProps) {
  const { t } = useTranslation();
  const { write, error, pending } = useWriteNotifications(me);
  const webhook = me.notifications.channels.webhook;
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(webhook?.url ?? '');
  const [method, setMethod] = useState<WebhookMethod>(webhook?.method ?? 'POST');
  const [headers, setHeaders] = useState(webhook ? headersText(webhook.headers) : '');

  const on = webhook !== null || editing;
  const draft = { url: url.trim(), method, headers: headersOf(headers) };
  const changed = JSON.stringify(draft) !== JSON.stringify(webhook);

  const open = () => {
    setUrl(webhook?.url ?? '');
    setMethod(webhook?.method ?? 'POST');
    setHeaders(webhook ? headersText(webhook.headers) : '');
    setEditing(true);
  };

  const toggle = () => {
    if (webhook !== null) {
      setEditing(false);
      write({ channels: { ...me.notifications.channels, webhook: null } }, t('notifications.told.off', { what: t('notifications.channel.webhook') }));
      return;
    }
    if (editing) {
      setEditing(false);
      return;
    }
    open();
  };

  return (
    <Row
      title={t('notifications.channel.webhook')}
      line={
        editing && !webhook ? (
          t('notifications.webhook.urlNeeded')
        ) : (
          <Facts
            facts={webhook ? [hostOf(webhook.url), t('notifications.webhook.json')] : [t('notifications.off'), t('notifications.notConfigured')]}
          />
        )
      }
      below={
        <>
          {editing ? (
            <form
              className={parts.fields}
              onSubmit={event => {
                event.preventDefault();
                if (!draft.url) return;
                setEditing(false);
                write({ channels: { ...me.notifications.channels, webhook: draft } }, t('notifications.told.webhook', { host: hostOf(draft.url) }));
              }}
            >
              <label className={parts.field}>
                <span className="label">{t('notifications.webhook.url')}</span>
                <input
                  className={`mono ${ui.input}`}
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  value={url}
                  disabled={held}
                  onChange={event => setUrl(event.target.value)}
                />
              </label>
              <div className={parts.field}>
                <span className="label">{t('notifications.webhook.method')}</span>
                <Choices label={t('notifications.webhook.method')}>
                  {WEBHOOK_METHODS.map(one => (
                    <Choice key={one} chosen={method === one} disabled={held} onChoose={() => setMethod(one)}>
                      {one}
                    </Choice>
                  ))}
                </Choices>
              </div>
              <label className={parts.field}>
                <span className="label">{t('notifications.webhook.headers')}</span>
                <textarea
                  className={`mono ${ui.input} ${styles.text}`}
                  rows={3}
                  value={headers}
                  disabled={held}
                  placeholder={t('notifications.webhook.headersHint')}
                  onChange={event => setHeaders(event.target.value)}
                />
              </label>
              <EditActions save={!held && !pending && changed && draft.url !== ''} onCancel={() => setEditing(false)} />
            </form>
          ) : null}
          <Refused error={error} />
        </>
      }
    >
      {webhook !== null && !editing ? <EditChip disabled={held} onOpen={open} /> : null}
      <Switch label={t('notifications.channel.webhook')} on={on} disabled={held} onChange={toggle} />
    </Row>
  );
}
