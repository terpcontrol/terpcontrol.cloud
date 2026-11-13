import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAccountMe } from '@/api/account';
import { useCameras } from '@/api/cameras';
import { useGrows, useMyGrows } from '@/api/grows';
import { useDiaryLayer } from '@/api/layers';
import { useSession } from '@/api/session';
import { ALL_GROWS } from '@/app/places';
import { useLeave } from '@/ui/leave';
import { ownsCamera } from '@/screens/devices/cameras';
import { useTheme } from '@/theme/theme-context';
import { PageHead } from '@/ui/PageHead';
import { Row, Rows } from '@/ui/Rows';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { appearanceLine, diaryLine, growsLine, lineOnce, notificationsLine, profileLine, type Read } from './me/doors';
import styles from './Me.module.css';

/**
 * Ich, where the head's avatar leads: who is signed in and one row per
 * subject of the account, each opening its page. A row says under its title
 * what the page behind it holds today, read from the server and never
 * guessed (`lineOnce`). The screens of whoever runs the install are behind
 * "Verwaltung", drawn for an administrator alone.
 *
 * What belongs to growing stands with the grows, under Grow › "Alle Grows";
 * an account that has grows and keeps no diary has no Grow in its bar, so
 * here is its way to them. The demo has no account, so it is shown the rows
 * that work without one and told why the others are missing.
 */
export function Me() {
  const { user } = useSession();

  return user !== null && !user.isDemo ? <AccountRows /> : <Frame note />;
}

/** The head, who is signed in, the rows, and signing out. The demo's rows are the two that work without an account, with the note saying so. */
function Frame({ children, note = false }: { children?: ReactNode; note?: boolean }) {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const { leaving, leave } = useLeave('/sign-in');
  const { choice } = useTheme();

  return (
    <section className={`${ui.stack3} ${styles.page}`}>
      <PageHead back={{ to: '/', label: t('me.back') }} title={t('me.title')} />
      <p className={styles.handle}>@{user?.handle ?? '?'}</p>

      <Rows>
        {children ?? [
          <Row
            key="appearance"
            to="/me/appearance"
            title={t('me.appearance.title')}
            line={appearanceLine(t, choice, i18n.resolvedLanguage ?? i18n.language)}
          />,
          <Row key="about" to="/me/about" title={t('me.about.title')} />,
        ]}
      </Rows>
      {note ? <p className={`${ui.cardDashed} ${ui.note}`}>{t('me.demo')}</p> : null}

      <button type="button" className={`${ui.button} ${styles.signOut}`} disabled={leaving} onClick={() => void leave()}>
        {t('me.signOut')}
      </button>
    </section>
  );
}

/** The rows of an account, each line read from what the server answers about it. */
function AccountRows() {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const now = useNow();
  const { choice } = useTheme();
  const me = useAccountMe();
  const grows = useGrows();
  const mine = useMyGrows();
  const ownCameras = useCameras().data?.items.filter(camera => camera.ownerId === user?.id) ?? [];
  const diary = useDiaryLayer();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const line = (reads: Read[], text: () => string) => lineOnce(t, reads, text);

  return (
    <Frame>
      <Row to="/me/notifications" title={t('notifications.title')} line={line([me], () => notificationsLine(t, me.data!, now, language))} />
      <Row to="/me/account" title={t('me.account.title')} line={t('me.door.account')} />
      <Row to="/me/appearance" title={t('me.appearance.title')} line={appearanceLine(t, choice, language)} />
      <Row to="/me/diary" title={t('me.diary.title')} line={line([me], () => diaryLine(t, me.data!))} />
      {!diary && (mine.data?.items.length ?? 0) > 0 ? <Row to={ALL_GROWS} title={t('grow.all.pill')} line={growsLine(t, mine.data!.items)} /> : null}
      <Row to="/me/privacy" title={t('me.privacy.title')} line={line([grows, me], () => profileLine(t, grows.data!.items, me.data!))} />
      {/* Premium is what a camera can do beyond its free tier, so it is a row only for an account that has one of its own - a host's is the host's. */}
      {ownsCamera(ownCameras) ? <Row to="/me/premium" title={t('me.premium.title')} /> : null}
      <Row to="/me/about" title={t('me.about.title')} />
      {user?.isAdmin ? (
        <Row
          to="/admin/fleet"
          title={t('admin.section')}
          line={t('me.door.admin')}
          tag={<span className={styles.tag}>{t('me.door.adminOnly')}</span>}
        />
      ) : null}
    </Frame>
  );
}
