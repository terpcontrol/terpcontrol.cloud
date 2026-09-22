import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { GrowListItem } from '@fg2/shared-types/v1';
import { useMe } from '@/api/account';
import { useGrows, useUpdateGrow } from '@/api/grows';
import { useSession } from '@/api/session';
import { useShareLinks } from '@/api/sharing';
import { appUrl } from '@/ui/clipboard';
import { CopyButton } from '@/ui/CopyButton';
import { LoadFailed, Refused, RefreshFailed, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { Row, Switch } from '../privacy/parts';
import { isDead } from './links';
import { Page, SectionHead } from './Page';
import styles from './sharing.module.css';

/**
 * Me › Public grows and profile: which of this account's grows have a page
 * anybody can open, and the address the profile lists them at.
 *
 * Only the grows this account owns are here, because a page is the owner's to
 * open and to take back; a grow somebody else lets you log in is theirs to
 * publish. The profile's own switch lives on the privacy screen with the other
 * things that decide what leaves the account, so this page names the address
 * and points there rather than growing a second switch that could disagree
 * with the first.
 *
 * Under each grow stands its address, or that it is private, and how many live
 * links open it - so that a grow made private is not read as unreachable while
 * a link still reaches it.
 */
export function PublicGrows() {
  const { t } = useTranslation();
  const { user } = useSession();
  const title = t('me.public.title');

  if (user?.isDemo) {
    return (
      <Page title={title}>
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('me.public.demo')}</p>
      </Page>
    );
  }

  return (
    <Page title={title}>
      <Grows userId={user?.id ?? null} />
    </Page>
  );
}

function Grows({ userId }: { userId: string | null }) {
  const { t } = useTranslation();
  const now = useNow();
  const grows = useGrows();
  const me = useMe();
  const links = useShareLinks();
  const mayManage = useMayManage();

  if (grows.isPending || me.isPending) return <Waiting lines={4} />;
  if (!grows.data || !me.data) {
    return (
      <LoadFailed
        retry={() => {
          void grows.refetch();
          void me.refetch();
        }}
      />
    );
  }

  const own = grows.data.items.filter(grow => grow.ownerId === userId);
  const publicCount = own.filter(grow => grow.visibility === 'public').length;
  const live = (links.data?.items ?? []).filter(link => !isDead(link, now));
  const profile = appUrl(`/@${me.data.handle}`);

  return (
    <>
      <RefreshFailed failedAt={grows.isError ? grows.dataUpdatedAt : null} now={now} />

      <SectionHead label={t('me.public.profile')} />
      <Row title={`@${me.data.handle}`} line={me.data.publicProfile ? <span className="mono">{profile}</span> : t('me.public.profileOff')}>
        {me.data.publicProfile ? <CopyButton value={profile} label={t('me.public.copyProfile')} /> : null}
        <Link to="/me/privacy" className={ui.chip}>
          {t('me.privacy.title')} ›
        </Link>
      </Row>

      <SectionHead
        label={t('me.public.grows')}
        count={`${t('me.public.publicCount', { count: publicCount })} · ${t('me.public.privateCount', { count: own.length - publicCount })}`}
      />
      {own.length === 0 ? (
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('me.public.none')}</p>
      ) : (
        own.map(grow => (
          <GrowRow
            key={grow.id}
            grow={grow}
            // Only the links that actually open the grow are counted. A
            // public-page link is the public address in another form and stops
            // working the moment the grow goes private, so counting it on a
            // private grow would tell somebody their grow was still being read
            // when it is not.
            links={
              live.filter(
                link => link.subject.type === 'grow' && link.subject.id === grow.id && (link.kind === 'view' || grow.visibility === 'public'),
              ).length
            }
            held={!mayManage}
          />
        ))
      )}

      <p className={`${ui.note} ${styles.closing}`}>{t('me.public.stranger')}</p>
    </>
  );
}

/**
 * One grow and its switch. The grows list is read again after a change rather
 * than patched, because the list is where this row came from, and a switch
 * that snapped back while the server had agreed would be the worst of both.
 */
function GrowRow({ grow, links, held }: { grow: GrowListItem; links: number; held: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const update = useUpdateGrow(grow.id);
  const isPublic = grow.visibility === 'public';
  const line = [isPublic ? appUrl(`/g/${grow.slug}`) : t('me.public.private'), links > 0 ? t('me.public.links', { count: links }) : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <Row title={grow.name} line={<span className="mono">{line}</span>}>
        <Switch
          name={t('me.public.switch', { name: grow.name })}
          on={isPublic}
          disabled={held || update.isPending}
          onToggle={() =>
            update.mutate(
              { visibility: isPublic ? 'private' : 'public' },
              { onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['grows'] }) },
            )
          }
        />
      </Row>
      <Refused error={update.error} />
    </>
  );
}
