import { useTranslation } from 'react-i18next';
import type { Me } from '@fg2/shared-types/v1';
import { useMe, useUpdatingMe } from '@/api/account';
import { useSession } from '@/api/session';
import { LoadFailed, Refused, RefreshFailed, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { MePage } from '@/screens/me/parts';
import { EmailCard, PushCard, TelegramCard, WebhookCard } from './Channels';
import { useWriteNotifications } from './write';
import { QuietHoursCard } from './QuietHours';
import { RoutingGrid } from './Routing';
import { clockLabel, isMuted } from './settings';
import styles from './Notifications.module.css';

/**
 * Me › Notifications: the channels, the what-goes-where grid and quiet hours.
 *
 * Every channel is off until it is configured, and the screen says so rather
 * than quietly mailing the login address. Each write is the whole settings
 * object, so while one is on its way every switch on the screen holds still -
 * two changes crossing would each carry the other's old state back. The demo
 * has no account of its own to settle, so it is told that instead of being
 * handed a screen the server will not answer.
 */
export function Notifications() {
  const { t } = useTranslation();
  const now = useNow();
  const { user } = useSession();
  const isDemo = user?.isDemo === true;
  const me = useMe(false, !isDemo);
  const mayManage = useMayManage();
  const updating = useUpdatingMe();

  const title = t('notifications.title');

  if (isDemo) {
    return (
      <MePage title={title}>
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('notifications.demo')}</p>
      </MePage>
    );
  }

  if (me.isPending) {
    return (
      <MePage title={title}>
        <Waiting lines={4} />
      </MePage>
    );
  }

  if (!me.data) {
    return (
      <MePage title={title}>
        <LoadFailed retry={() => void me.refetch()} />
      </MePage>
    );
  }

  const held = !mayManage || updating;

  return (
    <MePage title={title}>
      <RefreshFailed failedAt={me.isError ? me.dataUpdatedAt : null} now={now} />

      {isMuted(me.data.notifications.mutedUntil, now) ? <MutedLine me={me.data} held={held} until={me.data.notifications.mutedUntil!} /> : null}

      <span className="label">{t('notifications.channels')}</span>
      <PushCard me={me.data} held={held} />
      <TelegramCard me={me.data} held={held} />
      <EmailCard me={me.data} held={held} />
      <WebhookCard me={me.data} held={held} />

      <span className="label">{t('notifications.what')}</span>
      <RoutingGrid me={me.data} held={held} />

      <span className="label">{t('notifications.quietHours')}</span>
      <QuietHoursCard me={me.data} held={held} locked={!mayManage} />
    </MePage>
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
      <span className={`mono ${styles.mutedText}`}>{t('notifications.muted', { time: clockLabel(until, now) })}</span>
      <button type="button" className={ui.chip} disabled={held} onClick={() => write({ mutedUntil: null })}>
        {t('notifications.unmute')}
      </button>
      <Refused error={error} />
    </div>
  );
}
