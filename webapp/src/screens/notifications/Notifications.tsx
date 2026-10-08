import { useTranslation } from 'react-i18next';
import type { Me } from '@fg2/shared-types/v1';
import { Help } from '@/ui/Help';
import { Refused } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { zoneOf } from '@/ui/zone';
import { AccountPage } from '@/screens/me/parts';
import { EmailCard, PushCard, TelegramCard, WebhookCard } from './Channels';
import { NotifyNotice } from './NotifyNotice';
import { useWriteNotifications } from './write';
import { QuietHoursCard } from './QuietHours';
import { RoutingGrid } from './Routing';
import { clockLabel, isMuted } from './settings';
import styles from './Notifications.module.css';

/**
 * Me › Notifications: the channels, the what-goes-where grid and quiet hours.
 *
 * Every channel is off until it is configured, and the screen says so rather
 * than quietly mailing the login address - it offers to, in one tap that names
 * it, while critical alarms reach nobody. Each write is the whole settings
 * object, so while one is on its way every switch on the screen holds still -
 * two changes crossing would each carry the other's old state back. The demo
 * has no account of its own to settle, so it is told that instead of being
 * handed a screen the server will not answer.
 */
export function Notifications() {
  const { t } = useTranslation();
  const now = useNow();
  const mayManage = useMayManage();

  return (
    <AccountPage title={t('notifications.title')} demo={t('notifications.demo')}>
      {(me, held) => (
        <>
          {isMuted(me.notifications.mutedUntil, now) ? <MutedLine me={me} held={held} until={me.notifications.mutedUntil!} /> : null}

          {/* Every "does not reach you" in the app links here, so the fix stands first. */}
          <NotifyNotice />

          <span className="label">{t('notifications.channels')}</span>
          <PushCard me={me} held={held} />
          <TelegramCard me={me} held={held} />
          <EmailCard me={me} held={held} />
          <WebhookCard me={me} held={held} />

          <span className="label">
            {t('notifications.what')}
            <Help topic="routingGrid" />
          </span>
          <RoutingGrid me={me} held={held} />

          <span className="label">
            {t('notifications.quietHours')}
            <Help topic="quietHours" />
          </span>
          <QuietHoursCard me={me} held={held} locked={!mayManage} />
        </>
      )}
    </AccountPage>
  );
}

/**
 * The mute is set from the inbox, where the alarm that prompted it is; here it
 * is only said and taken off, because a screen about where things go has to
 * say when nothing is going anywhere at all.
 */
function MutedLine({ me, held, until }: { me: Me; held: boolean; until: string }) {
  const { t } = useTranslation();
  const now = useNow();
  const { write, error } = useWriteNotifications(me);

  return (
    <div className={styles.muted} role="status">
      <span className={`mono ${styles.mutedText}`}>{t('notifications.muted', { time: clockLabel(until, now, zoneOf(me)) })}</span>
      <button type="button" className={ui.chip} disabled={held} onClick={() => write({ mutedUntil: null })}>
        {t('notifications.unmute')}
      </button>
      <Refused error={error} />
    </div>
  );
}
