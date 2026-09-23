import type { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowListItem, ShareLink, Space } from '@fg2/shared-types/v1';
import { useMe } from '@/api/account';
import { useEveryGrow } from '@/api/grows';
import { useSession } from '@/api/session';
import { useDeleteShareLink, useRevokeShareLink, useShareLinks } from '@/api/sharing';
import { useEverySpace } from '@/api/spaces';
import { Sheet } from '@/log/Sheet';
import { ageLabel } from '@/ui/age';
import { CopyButton } from '@/ui/CopyButton';
import { LoadFailed, Refused, RefreshFailed, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { dayLabel, isDead, lifetimeDays, linkAddress } from './links';
import { NewLinkSheet } from './NewLinkSheet';
import { Page, SectionHead } from './Page';
import styles from './sharing.module.css';

/**
 * Me › Share links: every address this account has handed out, and what each
 * one lets through.
 *
 * A card says two things about a link: what it is about and of which kind, in
 * words, and then in mono exactly what it grants - for how long, whether the
 * cameras are part of it, what the privacy settings strip, and how often it
 * has been opened. Every figure on that line is the server's: a link that has
 * run out says the day it ran out rather than how long ago that was, and the
 * only question asked of this browser's clock is which of the two labels a
 * card sorts under.
 *
 * A link that has stopped keeps its card, dimmed, because it is still a fact
 * about what was sent out; what it no longer gets is the Copy beside it.
 */
export function ShareLinks() {
  const { t } = useTranslation();
  const { user } = useSession();
  const title = t('me.shareLinks.title');

  if (user?.isDemo) {
    return (
      <Page title={title}>
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('me.shareLinks.demo')}</p>
      </Page>
    );
  }

  return (
    <Page title={title}>
      <Links userId={user?.id ?? null} />
    </Page>
  );
}

/**
 * What a link points at, as far as this account can name it.
 *
 * The three states are kept apart because two of them used to be one. A subject
 * the lists have not reached is not a subject that has been deleted, and this
 * is the screen whose whole job is telling somebody what they have sent out: a
 * live key titled "no longer here" is a key nobody revokes, while it goes on
 * handing the tent out. So `gone` is said only after both lists have been read
 * to their last page and the subject was in neither; until then the card says
 * that the name is still coming, or that it could not be read, and the grant
 * line states nothing about a grow whose visibility nobody has answered.
 */
type Subject = { known: 'named'; name: string; isPublic: boolean | null } | { known: 'unread'; word: string } | { known: 'gone' };

/**
 * What a shared view strips, which is the account's own privacy setting and so
 * its own read. Until that read answers, the grant line says that rather than
 * listing nothing: a line with no "weights hidden" on it is read as a link that
 * hides nothing, which is a claim this screen cannot make before it knows.
 */
type Stripping = { known: true; hideWeights: boolean; hideCounts: boolean } | { known: false; word: string };

function Links({ userId }: { userId: string | null }) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const links = useShareLinks();
  const grows = useEveryGrow();
  const spaces = useEverySpace();
  const me = useMe();
  const mayManage = useMayManage();
  const [drafting, setDrafting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  if (links.isPending) return <Waiting lines={4} />;
  if (!links.data) return <LoadFailed retry={() => void links.refetch()} />;

  /** The word for a list that has not been read: it is loading, or it failed, or the cursor outran the cap - never that what it holds is not there. */
  const unread = (list: { isPending: boolean }): Subject => ({ known: 'unread', word: list.isPending ? t('home.waiting') : t('shell.loadFailed') });

  const subjectOf = (link: ShareLink): Subject => {
    if (link.subject.type === 'grow') {
      if (!grows.data) return unread(grows);
      const grow = grows.data.items.find(row => row.id === link.subject.id);
      if (grow) return { known: 'named', name: grow.name, isPublic: grow.visibility === 'public' };

      return grows.data.complete ? { known: 'gone' } : { known: 'unread', word: t('shell.loadFailed') };
    }

    if (!spaces.data) return unread(spaces);
    const space = spaces.data.items.find(row => row.id === link.subject.id);
    if (space) return { known: 'named', name: space.name, isPublic: null };

    return spaces.data.complete ? { known: 'gone' } : { known: 'unread', word: t('shell.loadFailed') };
  };

  const active = links.data.items.filter(link => !isDead(link, now));
  const dead = links.data.items.filter(link => isDead(link, now));
  const privacy: Stripping = me.data
    ? { known: true, hideWeights: me.data.privacy.hideWeights, hideCounts: me.data.privacy.hideCounts }
    : { known: false, word: me.isPending ? t('home.waiting') : t('shell.loadFailed') };
  const opened = links.data.items.find(link => link.id === openId) ?? null;
  const own = <T extends GrowListItem | Space>(rows: T[] | undefined): T[] => (rows ?? []).filter(row => row.ownerId === userId);
  /**
   * Whether there is anything of this account's own to hand out. Only once
   * both lists have answered: a list still on its way is not an account with
   * nothing in it, and a link is made onto what somebody owns, so a tent
   * somebody else let them into is not a subject either.
   */
  const nothingToShare = Boolean(grows.data && spaces.data && own(grows.data.items).length + own(spaces.data.items).length === 0);

  const describe = (link: ShareLink) => {
    const subject = subjectOf(link);
    return {
      title: titleOf(t, link, subject),
      parts: isDead(link, now) ? deadParts(t, link, now, i18n.language) : grantParts(t, link, subject, privacy, now, i18n.language),
    };
  };

  return (
    <>
      <RefreshFailed failedAt={links.isError ? links.dataUpdatedAt : null} now={now} />

      <SectionHead label={t('me.shareLinks.active')} count={active.length} />
      {active.length === 0 ? (
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('me.shareLinks.none')}</p>
      ) : (
        <ul className={styles.cards} aria-label={t('me.shareLinks.active')}>
          {active.map(link => (
            <LinkCard key={link.id} link={link} {...describe(link)} onOpen={() => setOpenId(link.id)} />
          ))}
        </ul>
      )}

      {dead.length > 0 ? (
        <>
          <SectionHead label={t('me.shareLinks.dead')} count={dead.length} />
          <ul className={styles.cards} aria-label={t('me.shareLinks.dead')}>
            {dead.map(link => (
              <LinkCard key={link.id} link={link} dead {...describe(link)} onOpen={() => setOpenId(link.id)} />
            ))}
          </ul>
        </>
      ) : null}

      <p className={`${ui.note} ${styles.closing}`}>{t('me.shareLinks.closing')}</p>

      {/* A picker built from half a list offers half the tents, so the sheet
          waits for both lists rather than opening onto what happened to
          arrive - and where both have arrived empty there is nothing to hand
          out at all. An account in that state was given the card, four
          choices and a refusal at the last step; it is now told why there is
          no card, once both lists have actually answered. Two accounts in five
          of the restored database own neither a tent nor a grow. */}
      {nothingToShare ? (
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('me.shareLinks.noSubjects')}</p>
      ) : (
        <button
          type="button"
          className={`${ui.cardDashed} ${styles.new}`}
          disabled={!mayManage || !grows.data || !spaces.data}
          onClick={() => setDrafting(true)}
        >
          {t('me.shareLinks.new')}
        </button>
      )}

      {drafting ? <NewLinkSheet grows={own(grows.data?.items)} spaces={own(spaces.data?.items)} onClose={() => setDrafting(false)} /> : null}
      {opened ? <LinkSheet link={opened} {...describe(opened)} dead={isDead(opened, now)} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

/** One piece of the mono line; the one that is a warning is coloured as one. */
interface Part {
  text: string;
  warn?: boolean;
}

function Line({ parts }: { parts: Part[] }) {
  return (
    <>
      {parts.map((part, index) => (
        <span key={index} className={part.warn ? styles.warn : undefined}>
          {index > 0 ? ' · ' : ''}
          {part.text}
        </span>
      ))}
    </>
  );
}

function LinkCard({ link, title, parts, dead, onOpen }: { link: ShareLink; title: string; parts: Part[]; dead?: boolean; onOpen: () => void }) {
  const { t } = useTranslation();

  return (
    <li className={`${ui.card} ${styles.card}`} data-dead={dead ? '' : undefined}>
      <button type="button" className={styles.cardText} onClick={onOpen}>
        <span className={styles.cardTitle}>{title}</span>
        <span className={`mono ${styles.cardLine}`}>
          <Line parts={parts} />
        </span>
      </button>
      {dead ? null : (
        <div className={styles.cardControl}>
          <CopyButton value={linkAddress(link)} label={t('sharing.copyLink')} />
        </div>
      )}
    </li>
  );
}

/**
 * The link's own sheet: its address in full, and the one thing that can still
 * be done to it. A live link is revoked, which keeps its card and dates it; a
 * link that has already stopped is forgotten, which takes the card away. The
 * address of a dead one is not shown, because it leads nowhere and an address
 * on a screen is an address somebody copies.
 */
function LinkSheet({ link, title, parts, dead, onClose }: { link: ShareLink; title: string; parts: Part[]; dead: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const revoke = useRevokeShareLink();
  const remove = useDeleteShareLink();
  const address = linkAddress(link);

  return (
    <Sheet
      title={title}
      onClose={onClose}
      actions={
        <div className={styles.actions}>
          {dead ? (
            <button
              type="button"
              className={`${ui.button} ${styles.end}`}
              disabled={remove.isPending}
              onClick={() => remove.mutate(link.id, { onSuccess: onClose })}
            >
              {t('sharing.forget')}
            </button>
          ) : (
            <button
              type="button"
              className={`${ui.button} ${styles.end}`}
              disabled={revoke.isPending}
              onClick={() => revoke.mutate(link.id, { onSuccess: onClose })}
            >
              {t('sharing.revoke')}
            </button>
          )}
          <button type="button" className={ui.button} onClick={onClose}>
            {t('sharing.cancel')}
          </button>
        </div>
      }
    >
      <div className={styles.sheetBody}>
        {dead ? null : (
          <div>
            <span className="label">{t('me.shareLinks.address')}</span>
            <div className={styles.addressRow}>
              <code className={`mono ${styles.address}`}>{address}</code>
              <CopyButton value={address} label={t('sharing.copyLink')} />
            </div>
          </div>
        )}
        <p className={`mono ${styles.cardLine}`}>
          <Line parts={parts} />
        </p>
        <p className={styles.sentence}>{t(dead ? 'me.shareLinks.forgetNote' : 'me.shareLinks.revokeNote')}</p>
        <Refused error={revoke.error ?? remove.error} />
      </div>
    </Sheet>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "Tent 1 · timeline · 7 days": what it is about, of which kind, and for how long it was made. */
const titleOf = (t: Translate, link: ShareLink, subject: Subject): string => {
  const days = link.kind === 'view' ? lifetimeDays(link) : null;
  const name = subject.known === 'named' ? subject.name : subject.known === 'gone' ? t('me.shareLinks.gone') : subject.word;

  return [name, t(`me.shareLinks.kind.${link.kind}`), days === null ? null : t('me.shareLinks.days', { count: days })].filter(Boolean).join(' · ');
};

/** The link's window, in the words the grow's share sheet uses, where it has one. */
const windowOf = (t: Translate, link: ShareLink, now: DateTime, locale: string): string | null => {
  const { startsAt, endsAt } = link.range;
  if (startsAt === null && endsAt === null) return null;
  if (startsAt === null) return t('sharing.window.until', { to: dayLabel(endsAt!, now, locale) });
  if (endsAt === null) return t('sharing.window.since', { from: dayLabel(startsAt, now, locale) });
  return t('sharing.window.between', { from: dayLabel(startsAt, now, locale), to: dayLabel(endsAt, now, locale) });
};

/** "41 opens · last 2 h ago", or that nobody has opened it, which is a fact and not a zero. */
const opensOf = (t: Translate, link: ShareLink, now: DateTime): Part[] => {
  if (link.state.openCount === 0) return [{ text: t('me.shareLinks.notOpened') }];
  const parts = [{ text: t('me.shareLinks.opens', { count: link.state.openCount }) }];
  if (link.state.lastOpenedAt) parts.push({ text: t('sharing.lastOpened', { age: ageLabel(link.state.lastOpenedAt, now) }) });
  return parts;
};

/**
 * What a live link grants. A public-page link onto a grow that has since gone
 * private is the one case said in the warning colour: making the grow private
 * is what takes such a link back, so the card says the link no longer opens
 * rather than calling it permanent - it is not revoked and would work again if
 * the grow were published again, which is exactly what the words have to carry.
 *
 * Both of those sentences are about a grow whose visibility somebody answered.
 * Where the grow has not been named, neither is said: the title already carries
 * that its name is still coming, and "the grow's permanent link" would promise
 * that a link opens something nobody has looked up yet.
 */
const grantParts = (t: Translate, link: ShareLink, subject: Subject, privacy: Stripping, now: DateTime, locale: string): Part[] => {
  const parts: Part[] = [];

  if (link.kind === 'public_page') {
    if (subject.known === 'named') {
      parts.push(subject.isPublic === false ? { text: t('me.shareLinks.growPrivate'), warn: true } : { text: t('me.shareLinks.permanentLink') });
    }
  } else {
    parts.push({ text: t('me.shareLinks.readOnly') });
  }

  const window = windowOf(t, link, now, locale);
  if (window) parts.push({ text: window });
  if (link.kind === 'view') {
    parts.push({ text: link.expiresAt ? t('me.shareLinks.expires', { date: dayLabel(link.expiresAt, now, locale) }) : t('me.shareLinks.permanent') });
  }

  parts.push({ text: t(link.includeCameras ? 'me.shareLinks.camsOn' : 'me.shareLinks.camsOff') });
  if (!privacy.known) {
    parts.push({ text: privacy.word });
  } else {
    if (privacy.hideWeights) parts.push({ text: t('me.shareLinks.weightsHidden') });
    if (privacy.hideCounts) parts.push({ text: t('me.shareLinks.countsHidden') });
  }

  return [...parts, ...opensOf(t, link, now)];
};

/** Which of the two ends a dead link met, on which day, and whether anybody read it while it lived. */
const deadParts = (t: Translate, link: ShareLink, now: DateTime, locale: string): Part[] => [
  {
    text: link.revokedAt
      ? t('me.shareLinks.revoked', { date: dayLabel(link.revokedAt, now, locale) })
      : t('me.shareLinks.expired', { date: dayLabel(link.expiresAt!, now, locale) }),
  },
  ...opensOf(t, link, now),
];
