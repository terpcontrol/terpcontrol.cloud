import type { DateTime } from 'luxon';
import type { FollowedGrowCard } from '@fg2/shared-types/v1';
import type { Translate } from '@/i18n/i18n';
import { ageLabel } from '@/ui/age';
import { calendarDay } from '@/ui/zone';

/**
 * "Day 42 · Flower · 2 h ago": the line under a public grow, which reads one
 * way wherever it is listed - among the diaries somebody follows and on its
 * author's profile. A finished diary says so and keeps its day number, which
 * is the day it ended on; the age beside it dates the last line rather than
 * the end. The end date is read in the zone the caller draws in: the
 * account's on a signed-in screen, the reader's own on a public page.
 */
export const followedMeta = (t: Translate, grow: FollowedGrowCard, now: DateTime, zone: string | null): string =>
  [
    grow.dayNumber !== null ? t('home.card.dayN', { day: grow.dayNumber }) : null,
    grow.stage ? t(`home.stage.${grow.stage}`) : null,
    grow.endedAt ? t('grow.ended', { date: calendarDay(grow.endedAt, zone) }) : null,
    t('home.card.ago', { age: ageLabel(grow.updatedAt, now) }),
  ]
    .filter(Boolean)
    .join(' · ');
