import { useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Me, NotificationChannel, TelegramLink, WebhookMethod } from '@fg2/shared-types/v1';
import { useMe, useSubscribePush, useTelegramLink, useUnsubscribePush } from '@/api/account';
import { ApiError } from '@/api/problem';
import { Refused } from '@/ui/PageState';
import { Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { clock, zoneOf } from '@/ui/zone';
import { useNow } from '@/ui/useNow';
import { forgetId, pushKey, pushSupported, rememberedId, rememberId, subscribe, usePushSubscription } from './push';
import { ChannelCard } from './parts';
import { useWriteNotifications } from './write';
import { headersOf, headersText } from '@/ui/headers';
import { categoriesOn, hostOf, listed } from './settings';
import styles from './Notifications.module.css';

/**
 * The four channels, each a card with its switch.
 *
 * A channel that is null is off, and there is no fallback: the login address
 * is never mailed to unless it is entered here. Two of the four need the
 * install's half as well as the person's - a push key, a bot - and a card
 * whose install has none says so in place of offering a switch that could
 * never send.
 */

interface CardProps {
  me: Me;
  /** Whether nothing on this screen may be moved: the demo, or a write on its way. */
  held: boolean;
}

const METHODS: WebhookMethod[] = ['GET', 'POST', 'PUT'];

/** The line under a card that is on: what the grid sends its way. */
function Carries({ me, channel }: { me: Me; channel: NotificationChannel }) {
  const { t, i18n } = useTranslation();
  const categories = categoriesOn(me.notifications.routing, channel);

  if (categories.length === 0) return <>{t('notifications.nothingRouted')}</>;
  return (
    <>
      {listed(
        categories.map(category => t(`notifications.short.${category}`)),
        i18n.language,
      )}
    </>
  );
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
function EditActions({ save, cancel, onCancel }: { save: boolean; cancel: string; onCancel: () => void }) {
  const { t } = useTranslation();

  return (
    <div className={styles.actions}>
      <button type="submit" className={`${ui.button} ${ui.primary}`} disabled={!save}>
        {t('notifications.save')}
      </button>
      <button type="button" className={ui.button} onClick={onCancel}>
        {cancel}
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

  const cannot = !me.pushPublicKey ? 'noKey' : !pushSupported() ? 'unsupported' : null;
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
    <ChannelCard
      title={t('notifications.channel.push')}
      line={
        cannot ? (
          t(`notifications.push.${cannot}`)
        ) : on ? (
          <>
            {t('notifications.push.thisBrowser')} · <Carries me={me} channel="push" />
          </>
        ) : me.pushSubscribed ? (
          <>
            {t('notifications.push.otherDevice')} · <Carries me={me} channel="push" />
          </>
        ) : (
          `${t('notifications.off')} · ${t('notifications.push.notSubscribed')}`
        )
      }
      on={on}
      disabled={held || cannot !== null || asking || subscription.isPending}
      onToggle={() => void (on ? switchOff() : switchOn())}
    >
      {asking ? <p className={ui.note}>{t('notifications.push.asking')}</p> : null}
      {fault && 'key' in fault ? (
        <p className={ui.problem} role="alert">
          {t(`notifications.push.${fault.key}`)}
        </p>
      ) : null}
      {fault && 'error' in fault ? <Refused error={fault.error} /> : null}
    </ChannelCard>
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
  // When the link runs out is a clock time like every other the app draws, so
  // it is the account's hour in the account's 24-hour shape rather than the
  // locale's, which put an "AM" on this line alone.
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
    <ChannelCard
      title={t('notifications.channel.telegram')}
      line={
        cannot
          ? t('notifications.telegram.noBot')
          : linked
            ? t('notifications.telegram.linked', { date: DateTime.fromISO(linked.linkedAt).toLocaleString(DateTime.DATE_MED) })
            : waiting
              ? t('notifications.telegram.waiting')
              : `${t('notifications.off')} · ${t('notifications.telegram.notLinked')}`
      }
      on={on}
      disabled={held || cannot || link.isPending}
      onToggle={toggle}
    >
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
        <div className={styles.asking}>
          <p className={ui.note}>{t('notifications.telegram.ask')}</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={`${ui.button} ${styles.dangerButton}`}
              disabled={held}
              onClick={() => {
                setAsking(false);
                setOffered(null);
                write({ channels: { ...me.notifications.channels, telegram: null } });
              }}
            >
              {t('notifications.telegram.unlink')}
            </button>
            <button type="button" className={ui.button} onClick={() => setAsking(false)}>
              {t('notifications.cancel')}
            </button>
          </div>
        </div>
      ) : null}
      <Refused error={link.error ?? error} />
    </ChannelCard>
  );
}

/**
 * An address, entered here on purpose. At rest the card is the address and the
 * switch; the field is opened by the chip, and switching on with no address
 * yet opens it too: the switch reads as on, and the line under it says what is
 * still missing before anything is sent.
 */
export function EmailCard({ me, held }: CardProps) {
  const { t } = useTranslation();
  const { write, error, pending } = useWriteNotifications(me);
  const address = me.notifications.channels.email;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(address ?? '');

  const on = address !== null || editing;
  const changed = draft.trim() !== (address ?? '');

  const open = () => {
    setDraft(address ?? '');
    setEditing(true);
  };

  const toggle = () => {
    if (address !== null) {
      setEditing(false);
      write({ channels: { ...me.notifications.channels, email: null } });
      return;
    }
    if (editing) {
      setEditing(false);
      return;
    }
    open();
  };

  return (
    <ChannelCard
      title={t('notifications.channel.email')}
      line={
        address ? (
          <>
            {address} · <Carries me={me} channel="email" />
          </>
        ) : editing ? (
          t('notifications.email.addressNeeded')
        ) : (
          `${t('notifications.off')} · ${t('notifications.notConfigured')}`
        )
      }
      on={on}
      disabled={held}
      onToggle={toggle}
      action={address !== null && !editing ? <EditChip disabled={held} onOpen={open} /> : null}
    >
      {editing ? (
        <form
          className={styles.fields}
          onSubmit={event => {
            event.preventDefault();
            if (!draft.trim()) return;
            setEditing(false);
            write({ channels: { ...me.notifications.channels, email: draft.trim() } });
          }}
        >
          <label className={styles.field}>
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
          <EditActions
            save={!held && !pending && changed && draft.trim() !== ''}
            cancel={t('notifications.cancel')}
            onCancel={() => setEditing(false)}
          />
        </form>
      ) : null}
      <Refused error={error} />
    </ChannelCard>
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
      write({ channels: { ...me.notifications.channels, webhook: null } });
      return;
    }
    if (editing) {
      setEditing(false);
      return;
    }
    open();
  };

  return (
    <ChannelCard
      title={t('notifications.channel.webhook')}
      line={
        webhook
          ? `${hostOf(webhook.url)} · ${t('notifications.webhook.json')}`
          : editing
            ? t('notifications.webhook.urlNeeded')
            : `${t('notifications.off')} · ${t('notifications.notConfigured')}`
      }
      on={on}
      disabled={held}
      onToggle={toggle}
      action={webhook !== null && !editing ? <EditChip disabled={held} onOpen={open} /> : null}
    >
      {editing ? (
        <form
          className={styles.fields}
          onSubmit={event => {
            event.preventDefault();
            if (!draft.url) return;
            setEditing(false);
            write({ channels: { ...me.notifications.channels, webhook: draft } });
          }}
        >
          <label className={styles.field}>
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
          <div className={styles.field}>
            <span className="label">{t('notifications.webhook.method')}</span>
            <Choices label={t('notifications.webhook.method')}>
              {METHODS.map(one => (
                <Choice key={one} chosen={method === one} disabled={held} onChoose={() => setMethod(one)}>
                  {one}
                </Choice>
              ))}
            </Choices>
          </div>
          <label className={styles.field}>
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
          <EditActions
            save={!held && !pending && changed && draft.url !== ''}
            cancel={t('notifications.cancel')}
            onCancel={() => setEditing(false)}
          />
        </form>
      ) : null}
      <Refused error={error} />
    </ChannelCard>
  );
}
