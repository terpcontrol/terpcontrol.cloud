import type { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowListItem, Me, ShareLink, Space } from '@fg2/shared-types/v1';
import { useMe } from '@/api/account';
import { useGrows } from '@/api/grows';
import { useSession } from '@/api/session';
import { useDeleteShareLink, useRevokeShareLink, useShareLinks } from '@/api/sharing';
import { useSpaces } from '@/api/spaces';
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

/** What a link points at, as far as this account can name it, and whether that is a grow with a public page. */
interface Subject {
  name: string;
  isPublic: boolean | null;
}

function Links({ userId }: { userId: string | null }) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const links = useShareLinks();
  const grows = useGrows();
  const spaces = useSpaces();
  const me = useMe();
  const mayManage = useMayManage();
  const [drafting, setDrafting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  if (links.isPending) return <Waiting lines={4} />;
  if (!links.data) return <LoadFailed retry={() => void links.refetch()} />;

  const subjectOf = (link: ShareLink): Subject => {
    if (link.subject.type === 'grow') {
      const grow = grows.data?.items.find(row => row.id === link.subject.id);
      return grow ? { name: grow.name, isPublic: grow.visibility === 'public' } : { name: t('me.shareLinks.gone'), isPublic: null };
    }
    const space = spaces.data?.items.find(row => row.id === link.subject.id);
    return { name: space?.name ?? t('me.shareLinks.gone'), isPublic: null };
  };

  const active = links.data.items.filter(link => !isDead(link, now));
  const dead = links.data.items.filter(link => isDead(link, now));
  const privacy = me.data?.privacy ?? null;
  const opened = links.data.items.find(link => link.id === openId) ?? null;
  const own = <T extends GrowListItem | Space>(rows: T[] | undefined): T[] => (rows ?? []).filter(row => row.ownerId === userId);

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

      <button type="button" className={`${ui.cardDashed} ${styles.new}`} disabled={!mayManage} onClick={() => setDrafting(true)}>
        {t('me.shareLinks.new')}
      </button>

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

  return [subject.name, t(`me.shareLinks.kind.${link.kind}`), days === null ? null : t('me.shareLinks.days', { count: days })]
    .filter(Boolean)
    .join(' · ');
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
 */
const grantParts = (t: Translate, link: ShareLink, subject: Subject, privacy: Me['privacy'] | null, now: DateTime, locale: string): Part[] => {
  const parts: Part[] = [];

  if (link.kind === 'public_page') {
    parts.push(subject.isPublic === false ? { text: t('me.shareLinks.growPrivate'), warn: true } : { text: t('me.shareLinks.permanentLink') });
  } else {
    parts.push({ text: t('me.shareLinks.readOnly') });
  }

  const window = windowOf(t, link, now, locale);
  if (window) parts.push({ text: window });
  if (link.kind === 'view') {
    parts.push({ text: link.expiresAt ? t('me.shareLinks.expires', { date: dayLabel(link.expiresAt, now, locale) }) : t('me.shareLinks.permanent') });
  }

  parts.push({ text: t(link.includeCameras ? 'me.shareLinks.camsOn' : 'me.shareLinks.camsOff') });
  if (privacy?.hideWeights) parts.push({ text: t('me.shareLinks.weightsHidden') });
  if (privacy?.hideCounts) parts.push({ text: t('me.shareLinks.countsHidden') });

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
