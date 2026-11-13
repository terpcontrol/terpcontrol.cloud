import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { GrowListItem, Me } from '@fg2/shared-types/v1';
import { useGrows, useUpdateGrow } from '@/api/grows';
import { useShareLinks } from '@/api/sharing';
import { useLog } from '@/log/log-context';
import { appUrl } from '@/ui/clipboard';
import { CopyButton } from '@/ui/CopyButton';
import { factsOf } from '@/ui/fact-text';
import { Facts } from '@/ui/Facts';
import { Help } from '@/ui/Help';
import { LoadFailed, NothingHere, Refused, Waiting } from '@/ui/PageState';
import { Switch } from '@/ui/Switch';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { AccountPage, Row } from '../parts';
import { useSaveAccount } from '../save';
import { isDead } from '../sharing/links';
import { ClimateRow } from './ClimateRow';
import { retentionLabel } from './climate';
import styles from './Privacy.module.css';

/**
 * Ich › Privatsphäre und Profil: what a stranger finds, what other people are
 * shown, and how long anything is kept.
 *
 * The profile and the grows it lists come first: whether `/@handle` answers
 * at all, and which of the account's own grows have a page anybody can open -
 * only its own, because a page is the owner's to open and to take back. Then
 * what is hidden wherever something is shared, and how long the server keeps
 * what it was given. Taking everything away as a file, and leaving, are the
 * account's (Ich › Konto).
 *
 * `PATCH /me` replaces each object it is given rather than merging into it, so
 * every control here sends the whole object it belongs to with one field
 * changed, and the screen holds still while a write is on its way - two changes
 * crossing would each carry the other's old state back.
 *
 * Every promise on the screen is one the install behind it keeps. The two
 * that cannot be read off the account - that no location is stored, and where
 * the servers stand - are said only as far as they are known: the app stores
 * no location anywhere, and the servers are in the EU on the hosted install,
 * which is the one that enforces Premium; a self-hosted one stands wherever
 * its owner put it, and is promised nothing about that here.
 */
export function Privacy() {
  const { t } = useTranslation();
  const now = useNow();
  const { save, error } = useSaveAccount();

  return (
    <AccountPage title={t('me.privacy.title')} demo={t('me.demo')}>
      {(account, held) => {
        const { privacy, handle } = account;
        const hides = (key: 'hideWeights' | 'hideCounts') => (hidden: boolean) =>
          save({ privacy: { ...privacy, [key]: hidden } }, t(`me.saved.${key}.${hidden ? 'on' : 'off'}`), {
            to: now => ({ privacy: { ...now.privacy, [key]: !hidden } }),
            undone: t(`me.saved.${key}.${hidden ? 'off' : 'on'}`),
          });

        return (
          <>
            <Row
              title={t('me.privacy.profile.title')}
              help="publicProfile"
              line={<Facts facts={factsOf(t('me.privacy.profile.line', { handle }))} />}
              below={account.publicProfile ? <Address path={`/@${handle}`} copy={t('me.privacy.profile.copy')} /> : null}
            >
              <Switch
                label={t('me.privacy.profile.title')}
                on={account.publicProfile}
                disabled={held}
                onChange={publicProfile =>
                  save({ publicProfile }, t(`me.saved.profile.${publicProfile ? 'on' : 'off'}`), {
                    to: () => ({ publicProfile: !publicProfile }),
                    undone: t(`me.saved.profile.${publicProfile ? 'off' : 'on'}`),
                  })
                }
              />
            </Row>

            <OwnGrows account={account} held={held} />

            <span className="label">
              {t('me.privacy.sharing')}
              <Help topic="privacyRedaction" />
            </span>
            <Row title={t('me.privacy.weights.title')} line={t('me.privacy.weights.line')}>
              <Switch label={t('me.privacy.weights.title')} on={privacy.hideWeights} disabled={held} onChange={hides('hideWeights')} />
            </Row>
            <Row title={t('me.privacy.counts.title')} line={t('me.privacy.counts.line')}>
              <Switch label={t('me.privacy.counts.title')} on={privacy.hideCounts} disabled={held} onChange={hides('hideCounts')} />
            </Row>

            <span className="label">{t('me.privacy.data')}</span>
            {/* No way back from the toast: a narrower window has thrown readings away, and narrowing a wider one again is the question the menu asks. */}
            <ClimateRow
              retention={account.climateRetention}
              climateDays={account.retention.climateDays}
              disabled={held}
              now={now}
              onChange={climateDays =>
                save(
                  { retention: { climateDays } },
                  t('me.saved.setting', { what: t('me.privacy.climate.title'), value: retentionLabel(t, climateDays) }),
                )
              }
            />
            {/*
              What a free camera's pictures are actually kept for is the install's own
              configuration, so the line states the days this install names and says
              plainly that nothing is deleted where it names none.
            */}
            <Row
              title={t('me.privacy.stills.title')}
              line={
                account.premium.free.stillDays === null
                  ? t('me.privacy.stills.kept')
                  : t('me.privacy.stills.keptDays', { count: account.premium.free.stillDays })
              }
            />

            <Refused error={error} />
            <p className={ui.note}>
              {t('me.privacy.footnote.location')}
              {account.premium.enforced ? ` ${t('me.privacy.footnote.servers')}` : ''}
            </p>
          </>
        );
      }}
    </AccountPage>
  );
}

/** A public address: the link that opens the page, and the copy beside it. */
function Address({ path, copy }: { path: string; copy: string }) {
  return (
    <div className={styles.address}>
      <Link to={path}>{appUrl(path)}</Link>
      <CopyButton value={appUrl(path)} label={copy} />
    </div>
  );
}

/**
 * The account's own grows, each with the switch that gives it a page anybody
 * can open. Under each stands its address, or that it is private, and how
 * many live links open it - so that a grow made private is not read as
 * unreachable while a link still reaches it.
 */
function OwnGrows({ account, held }: { account: Me; held: boolean }) {
  const { t } = useTranslation();
  const now = useNow();
  const grows = useGrows();
  const links = useShareLinks();
  /**
   * How many live links open a grow, which is a second read and lands later.
   * Until it does the answer is not nought: the row says that the count is
   * still coming, or that it could not be read, and only ever states a figure
   * it has. A public-page link is the public address in another form and stops
   * working the moment the grow goes private, so it is counted only on a
   * public grow.
   */
  const linksOpening = (grow: GrowListItem): string | null => {
    if (!links.data) return links.isPending ? t('home.waiting') : t('shell.loadFailed');
    const open = links.data.items.filter(
      link =>
        !isDead(link, now) && link.subject.type === 'grow' && link.subject.id === grow.id && (link.kind === 'view' || grow.visibility === 'public'),
    ).length;

    return open > 0 ? t('me.privacy.links', { count: open }) : null;
  };
  const own = grows.data?.items.filter(grow => grow.ownerId === account.id && !grow.isDemo) ?? [];

  return (
    <>
      <span className="label">
        {t('me.privacy.grows')}
        <Help topic="publicGrow" />
      </span>
      {grows.isPending ? (
        <Waiting lines={2} />
      ) : !grows.data ? (
        <LoadFailed retry={() => void grows.refetch()} />
      ) : own.length === 0 ? (
        <NothingHere>{t('me.privacy.noGrows')}</NothingHere>
      ) : (
        own.map(grow => <GrowRow key={grow.id} grow={grow} links={linksOpening(grow)} held={held} />)
      )}
    </>
  );
}

/**
 * One grow and its switch. The grows list is read again after a change rather
 * than patched, because the list is where this row came from, and a switch
 * that snapped back while the server had agreed would be the worst of both.
 */
function GrowRow({ grow, links, held }: { grow: GrowListItem; links: string | null; held: boolean }) {
  const { t } = useTranslation();
  const { tell } = useLog();
  const update = useUpdateGrow(grow.id);
  const isPublic = grow.visibility === 'public';
  const line = [isPublic ? null : t('me.privacy.private'), links].filter(Boolean).join(' · ') || null;
  const set = (visibility: 'public' | 'private') =>
    update.mutateAsync({ visibility }).then(() => t(`me.saved.grow.${visibility}`, { name: grow.name }));

  return (
    <>
      <Row title={grow.name} line={line} below={isPublic ? <Address path={`/g/${grow.slug}`} copy={t('sharing.copyAddress')} /> : null}>
        <Switch
          label={t('me.privacy.switch', { name: grow.name })}
          on={isPublic}
          disabled={held || update.isPending}
          onChange={on =>
            void set(on ? 'public' : 'private').then(
              label =>
                tell({
                  label,
                  undo: () => set(on ? 'private' : 'public'),
                  undone: t(`me.saved.grow.${on ? 'private' : 'public'}`, { name: grow.name }),
                  from: `grow-public:${grow.id}`,
                }),
              // Said under the row, from the write that was refused.
              () => undefined,
            )
          }
        />
      </Row>
      <Refused error={update.error} />
    </>
  );
}
