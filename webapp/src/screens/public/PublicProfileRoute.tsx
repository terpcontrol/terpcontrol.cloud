import { Leaf } from 'lucide-react';
import { DateTime } from 'luxon';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import type { FollowedGrowCard, PublicUserPage } from '@fg2/shared-types/v1';
import { PUBLIC_WIDTH, publicPicture, usePublicUser } from '@/api/public';
import { ApiError } from '@/api/problem';
import { session, useSession } from '@/api/session';
import { ageLabel } from '@/ui/age';
import { LoadFailed, Waiting } from '@/ui/PageState';
import { useNow } from '@/ui/useNow';
import { FollowButton } from './FollowButton';
import { Nothing } from './Nothing';
import { Photo } from '@/ui/Photo';
import { PublicShell } from './PublicShell';
import styles from './Public.module.css';

/**
 * `/@{handle}`: everything one person has published.
 *
 * React Router reads a parameter only where a colon follows a slash, so the `@`
 * cannot be a prefix inside the segment. The whole first segment is matched
 * instead and the sign is taken off here; a segment that carries no `@` is an
 * address this app has nothing at, which is what it then says.
 */
export function PublicProfileRoute() {
  const { handle: segment = '' } = useParams();

  if (!segment.startsWith('@')) {
    return (
      <PublicShell>
        <Nothing titleKey="publicPage.noPage.title" bodyKey="publicPage.noPage.body" />
      </PublicShell>
    );
  }

  return <Profile handle={segment.slice(1)} />;
}

function Profile({ handle }: { handle: string }) {
  const now = useNow();
  const page = usePublicUser(handle);

  // A public address is outside the session gate, so nothing else here has
  // restored the stored session; without it every reader is a stranger and the
  // Follow button on somebody else's diary is drawn for nobody.
  useEffect(() => {
    void session.restore();
  }, []);

  if (page.isPending) {
    return (
      <PublicShell>
        <Waiting lines={3} />
      </PublicShell>
    );
  }

  if (!page.data) {
    return (
      <PublicShell>
        {page.error instanceof ApiError && page.error.status === 404 ? (
          <Nothing titleKey="publicPage.noProfile.title" bodyKey="publicPage.noProfile.body" />
        ) : (
          <LoadFailed retry={() => void page.refetch()} />
        )}
      </PublicShell>
    );
  }

  return (
    <PublicShell title={`@${page.data.author.handle}`}>
      <Diaries page={page.data} now={now} />
    </PublicShell>
  );
}

function Diaries({ page, now }: { page: PublicUserPage; now: DateTime }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const { author, grows } = page;
  const own = user?.handle === author.handle;

  // There is no route that serves a picture of a person: what a public page may
  // let out is decided per grow, and the author's own picture is let out with
  // theirs. With nothing published there is nothing to draw it through either,
  // which is exactly the profile that has no diaries on it.
  const avatar = author.avatarMediaId && grows[0] ? publicPicture(grows[0].slug)(author.avatarMediaId, PUBLIC_WIDTH.avatar) : null;

  return (
    <section className={styles.profile}>
      <header className={styles.profileHead}>
        <Photo src={avatar} alt="" className={styles.profileAvatar} fallback={author.handle.slice(0, 2).toUpperCase()} />
        <div className={styles.profileText}>
          <h1 className={styles.title}>@{author.handle}</h1>
          {author.bio ? <p className={styles.description}>{author.bio}</p> : null}
          <p className={`mono ${styles.facts}`}>{t('publicPage.diaryCount', { count: grows.length })}</p>
        </div>
      </header>

      {grows.length === 0 ? (
        <p className={styles.quiet}>{t('publicPage.noDiaries')}</p>
      ) : (
        <ul className={styles.cards}>
          {grows.map(grow => (
            <DiaryCard key={grow.growId} grow={grow} now={now} own={own} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The same card the home screen draws for a diary somebody follows: a public grow reads one way wherever it is listed. */
function DiaryCard({ grow, now, own }: { grow: FollowedGrowCard; now: DateTime; own: boolean }) {
  const { t } = useTranslation();
  const cover = grow.coverMediaId ? publicPicture(grow.slug)(grow.coverMediaId, PUBLIC_WIDTH.card) : null;

  return (
    <li className={styles.card}>
      <Link to={`/g/${grow.slug}`} className={styles.cardLink}>
        <Photo src={cover} alt="" className={styles.cardCover} fallback={<Leaf size={22} strokeWidth={1.5} aria-hidden />} />
        <span className={styles.cardText}>
          <span className={styles.cardTitle}>{grow.name}</span>
          <span className={`mono ${styles.cardMeta}`}>
            {[
              grow.dayNumber !== null ? t('home.card.dayN', { day: grow.dayNumber }) : null,
              grow.stage ? t(`home.stage.${grow.stage}`) : null,
              // The card of a finished diary says so, as its own page does one
              // click away. The day number stays: it is the day the grow ended
              // on, and the age beside it dates the last line rather than the
              // end.
              grow.endedAt ? t('grow.ended', { date: DateTime.fromISO(grow.endedAt).toFormat('d LLL yyyy') }) : null,
              t('home.card.ago', { age: ageLabel(grow.updatedAt, now) }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
      </Link>
      {own ? null : <FollowButton growId={grow.growId} />}
    </li>
  );
}
