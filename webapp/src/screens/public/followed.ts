import type { DateTime } from 'luxon';
import type { FollowedGrowCard } from '@fg2/shared-types/v1';
import type { Translate } from '@/i18n/i18n';
import { growDay } from '@/screens/grow/progress';
import { ageLabel } from '@/ui/age';
import { calendarDay } from '@/ui/zone';

/**
 * "Day 42 · Flower · picture 2 h ago": the line under a public grow, which
 * reads one way wherever it is listed - among the diaries somebody follows and
 * on its author's profile. The age is of the newest sign of life where the
 * grow stands, and says which it is (`updatedBy`); a grow nothing has moved
 * since its start has no age beside its day. A finished diary says so and
 * keeps its day number, which is the day it ended on. The end date is read in
 * the zone the caller draws in: the account's on a signed-in screen, the
 * reader's own on a public page.
 */
export const followedMeta = (t: Translate, grow: FollowedGrowCard, now: DateTime, zone: string | null): string =>
  [
    growDay(t, grow),
    grow.stage ? t(`home.stage.${grow.stage}`) : null,
    grow.endedAt ? t('grow.ended', { date: calendarDay(grow.endedAt, zone) }) : null,
    grow.updatedBy === 'start' ? null : t(`publicPage.moved.${grow.updatedBy}`, { age: ageLabel(grow.updatedAt, now) }),
  ]
    .filter(Boolean)
    .join(' · ');
