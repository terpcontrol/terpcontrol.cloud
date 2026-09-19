import { CameraOff, Clock } from 'lucide-react';
import { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import type { SharedResolution } from '@fg2/shared-types/v1';
import { sharedPicture, useSharedLink } from '@/api/public';
import { ApiError } from '@/api/problem';
import { ageLabel } from '@/ui/age';
import { LoadFailed, Waiting } from '@/ui/PageState';
import { useNow } from '@/ui/useNow';
import { Diary } from './Diary';
import { Nothing } from './Nothing';
import { PublicShell } from './PublicShell';
import { SharedSpace } from './SharedSpace';
import { windowIsCurrent } from './window';
import styles from './Public.module.css';

/**
 * `/shared/{token}`: a diary or a tent, read through a key somebody was handed.
 *
 * The token is the reader's whole proof and the server never hands back the
 * link behind it - not who made it, not how often it has been opened - so this
 * screen knows exactly what it shows: a window, whether pictures are part of
 * it, and the thing itself. What the reader is inside is said plainly at the
 * top, because a diary that stops three weeks short is otherwise a diary that
 * looks abandoned.
 */
export function SharedRoute() {
  const { token = '' } = useParams();
  const now = useNow();
  const link = useSharedLink(token);

  if (link.isPending) {
    return (
      <PublicShell>
        <Waiting lines={4} />
      </PublicShell>
    );
  }

  if (!link.data) {
    return (
      <PublicShell>
        {link.error instanceof ApiError && link.error.status === 404 ? (
          <Nothing titleKey="publicPage.deadLink.title" bodyKey="publicPage.deadLink.body" />
        ) : (
          <LoadFailed retry={() => void link.refetch()} />
        )}
      </PublicShell>
    );
  }

  const { subject } = link.data;
  const banner = <WindowBanner resolution={link.data} now={now} />;
  const picture = sharedPicture(token);

  return subject.type === 'grow' ? (
    <PublicShell title={subject.grow.name}>
      <Diary page={subject.grow} picture={picture} now={now} banner={banner} />
    </PublicShell>
  ) : (
    <PublicShell title={subject.space.name}>
      <SharedSpace space={subject.space} picture={picture} now={now} banner={banner} />
    </PublicShell>
  );
}

/**
 * The window, in words. An open end is clamped to the instant the server
 * answered, so it is also how current the page is: where that instant is no
 * longer now, the banner dims with the rest of the page and says how old what
 * is under it is.
 */
function WindowBanner({ resolution, now }: { resolution: SharedResolution; now: DateTime }) {
  const { t } = useTranslation();
  const { startsAt, endsAt } = resolution.range;
  const current = windowIsCurrent(endsAt, now);
  const day = (at: string) => DateTime.fromISO(at).toFormat('d LLL yyyy');

  const window =
    startsAt === null
      ? endsAt === null || current
        ? t('publicPage.window.all')
        : t('publicPage.window.until', { to: day(endsAt) })
      : endsAt === null || current
        ? t('publicPage.window.since', { from: day(startsAt) })
        : t('publicPage.window.between', { from: day(startsAt), to: day(endsAt) });

  return (
    <aside className={styles.banner} data-age={current ? undefined : 'stale'}>
      <p className={`mono ${styles.bannerLine}`}>
        <Clock size={13} strokeWidth={1.75} aria-hidden />
        {window}
        {endsAt !== null && !current ? ` · ${t('publicPage.asOf', { age: ageLabel(endsAt, now) })}` : ''}
      </p>
      {resolution.includeCameras ? null : (
        <p className={`mono ${styles.bannerLine}`}>
          <CameraOff size={13} strokeWidth={1.75} aria-hidden />
          {t('publicPage.noCameras')}
        </p>
      )}
      {resolution.expiresAt ? <p className={`mono ${styles.bannerLine}`}>{t('publicPage.expires', { date: day(resolution.expiresAt) })}</p> : null}
    </aside>
  );
}
