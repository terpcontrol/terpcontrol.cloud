import { useTranslation } from 'react-i18next';
import type { Invite } from '@fg2/shared-types/v1';
import { useNow } from '@/ui/useNow';
import { dayLabel } from './invites';

/**
 * What a link is worth, read off the row the server answered and off nothing
 * else: the role it lets somebody in with, the day it stops or the fact that
 * it never does, how often it has been redeemed, and that it can be taken back.
 *
 * It is the one line under a code on the Members tab and under the code on the
 * sheet, so it is one component: the board's terms line is a description of
 * the link drawn above it, and two places wording that description apart would
 * sooner or later describe two different links.
 */
export function InviteTerms({ invite, className = '' }: { invite: Invite; className?: string }) {
  const { t, i18n } = useTranslation();
  const now = useNow();

  const parts = [
    t('space.members.links.role', { role: t(`space.members.role.${invite.role}`) }),
    invite.expiresAt === null
      ? t('space.members.links.never')
      : t('space.members.links.until', { date: dayLabel(invite.expiresAt, now, i18n.language) }),
    t('space.members.links.used', { count: invite.state.useCount }),
    t('space.members.links.revokeAnyTime'),
  ];

  return <span className={`mono ${className}`}>{parts.join(' · ')}</span>;
}
