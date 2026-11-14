import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import type { Invite } from '@fg2/shared-types/v1';
import { Facts } from '@/ui/Facts';
import { useNow } from '@/ui/useNow';
import { dayLabel, shownAddress } from './invites';
import styles from './Invite.module.css';

/**
 * What a link is worth, read off the row the server answered and off nothing
 * else: the role it lets somebody in with, the day it stops or the fact that
 * it never does, how often it has been redeemed, and that it can be taken back.
 *
 * It is the one line under a code in the list of who sees a place and under
 * the code on the sheet, so it is one component: the terms line is a
 * description of the link drawn above it, and two places wording that
 * description apart would sooner or later describe two different links.
 */
export function InviteTerms({ invite, into, className = '' }: { invite: Invite; into?: string; className?: string }) {
  const { t, i18n } = useTranslation();
  const now = useNow();

  const parts = [
    // What it lets into, by its name, where a place's links stand beside its room's.
    ...(into ? [into] : []),
    t('space.members.links.role', { role: t(`space.members.role.${invite.role}`) }),
    invite.expiresAt === null
      ? t('space.members.links.never')
      : t('space.members.links.until', { date: dayLabel(invite.expiresAt, now, i18n.language) }),
    t('space.members.links.used', { count: invite.state.useCount }),
    t('space.members.links.revokeAnyTime'),
  ];

  return <Facts facts={parts} className={className} />;
}

/** The link in the app's face, broken only after a slash: never inside the code a person types or reads out. */
export function InviteAddress({ code }: { code: string }) {
  return (
    <code className={styles.address}>
      {shownAddress(code)
        .split('/')
        .map((part, at) => (
          <Fragment key={at}>
            {at > 0 ? (
              <>
                /<wbr />
              </>
            ) : null}
            {part}
          </Fragment>
        ))}
    </code>
  );
}
