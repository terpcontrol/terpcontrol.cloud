import type { Translate } from '@/i18n/i18n';
import { type DateTime } from 'luxon';
import type { GrowListItem, Me, MyGrowCard, Scheme, ShareLink } from '@fg2/shared-types/v1';
import { growSchemeLabel, type SchemeSummary } from '@/api/schemes';
import { isAhead } from '@/ui/age';
import type { ThemeChoice } from '@/theme/theme-context';
import { isConfigured } from '@/screens/notifications/reach';
import { CHANNELS, timeOf } from '@/screens/notifications/settings';
import { isDead } from './sharing/links';

/**
 * The line under a row of Ich and of "Alle Grows", worked out from what the
 * server answered and from nothing else.
 *
 * A row's line is a sentence about the account as it stands - how many grows
 * are public, which channels are on, what the shelf holds - and it is the one
 * place there a person reads a figure. So every figure here is read off a
 * resource the app already has, and what is genuinely empty is said as empty
 * rather than as nought: "no links yet" is an answer, "0 active · 0 expired"
 * is a table with nothing in it. The helpers are pure so that each line can be
 * checked against the shapes it reads without drawing the page.
 */

export type Read = { data: unknown; isPending: boolean };

/**
 * A door's line once every read it is worked out from has answered. The reads
 * land in any order, so each is named: a line worked out from one still
 * missing would throw and take the page with it. One outstanding says it is
 * loading and one that failed says so, under its own door.
 */
export const lineOnce = (t: Translate, reads: Read[], text: () => string): string =>
  reads.every(read => read.data !== undefined) ? text() : reads.some(read => read.isPending) ? t('home.waiting') : t('shell.loadFailed');

/** The parts of a line, in the board's spelling: a middle dot between each. */
export const joined = (parts: (string | null)[]): string => parts.filter((part): part is string => part !== null && part !== '').join(' · ');

/** "2 laufend · 3 beendet", leaving out a half that holds nothing; or that there are none yet. */
export const growsLine = (t: Translate, grows: MyGrowCard[]): string => {
  const running = grows.filter(grow => grow.endedAt === null).length;
  const finished = grows.length - running;

  return (
    joined([
      running > 0 ? t('me.door.grows.running', { count: running }) : null,
      finished > 0 ? t('me.door.grows.finished', { count: finished }) : null,
    ]) || t('me.door.grows.none')
  );
};

export const followingLine = (t: Translate, count: number): string =>
  count === 0 ? t('me.door.following.none') : t('me.door.following.grows', { count });

/**
 * How many links still open something, how many have run out and how many
 * were pulled. A link that was revoked is not "expired", whatever its date
 * says: it was ended by hand, and the person who ended it should find it
 * counted that way.
 */
export const shareLinksLine = (t: Translate, links: ShareLink[], now: DateTime): string => {
  if (links.length === 0) return t('me.door.shareLinks.none');
  const revoked = links.filter(link => link.revokedAt !== null).length;
  const live = links.filter(link => !isDead(link, now)).length;
  const expired = links.length - revoked - live;

  return joined([
    live > 0 ? t('me.door.shareLinks.active', { count: live }) : null,
    expired > 0 ? t('me.door.shareLinks.expired', { count: expired }) : null,
    revoked > 0 ? t('me.door.shareLinks.revoked', { count: revoked }) : null,
  ]);
};

/** "Push und E-Mail · Ruhezeit 23:00–07:00": the channels that are on, in the order of the cards on the page they lead to, then the quiet hours. */
export const notificationsLine = (t: Translate, me: Me, now: DateTime, language: string): string => {
  const { quietHours, mutedUntil } = me.notifications;
  const on = CHANNELS.filter(channel => isConfigured(me, channel)).map(channel => t(`notifications.channel.${channel}`));

  return joined([
    isAhead(mutedUntil, now) ? t('me.door.notifications.muted') : null,
    on.length === 0 ? t('me.door.notifications.none') : new Intl.ListFormat(language, { type: 'conjunction' }).format(on),
    quietHours ? t('me.door.notifications.quiet', { from: timeOf(quietHours.fromMinute), to: timeOf(quietHours.toMinute) }) : null,
  ]);
};

/** "Deutsch · hell": the language and the theme - what the views show; the units are stored and not shown yet, so they are not said. */
export const appearanceLine = (t: Translate, theme: ThemeChoice, language: string): string =>
  joined([languageName(t, language), t(`me.door.theme.${theme}`)]);

/** Whether the diary is kept, and where the account left that to its own use, that it did. */
export const diaryLine = (t: Translate, me: Me): string =>
  joined([me.preferences.diary == null ? t('me.diary.choice.auto') : null, t(me.layers?.diary === false ? 'me.door.diary.off' : 'me.door.diary.on')]);

/** "Profil privat · kein Grow öffentlich": whether a stranger finds the profile, and how many of the account's own grows one can open. */
export const profileLine = (t: Translate, grows: GrowListItem[], me: Me): string => {
  const open = grows.filter(grow => grow.ownerId === me.id && !grow.isDemo && grow.visibility === 'public').length;

  return joined([
    t(me.publicProfile ? 'me.door.profile.on' : 'me.door.profile.off'),
    open === 0 ? t('me.door.profile.noGrows') : t('me.door.profile.grows', { count: open }),
  ]);
};

/** A language in its own name, which is the one spelling every reader recognises. */
export const languageName = (t: Translate, language: string): string => {
  const key = `me.appearance.languageNames.${language}`;

  return t(key) === key ? language : t(key);
};

/**
 * Which scheme the grows still running are fed, and how many the shelf holds.
 * One scheme across every running grow is named; more than one is counted,
 * because naming the first would be naming it for the wrong grow.
 */
export const schemesLine = (t: Translate, grows: GrowListItem[], shipped: SchemeSummary[], own: Scheme[]): string => {
  const running = grows.filter(grow => grow.endedAt === null && grow.scheme !== null && !grow.isDemo);
  const names = new Map<string, boolean>();
  for (const grow of running) {
    const name = growSchemeLabel(grow.scheme!.origin, shipped, own, t('grow.ownScheme'));
    names.set(name, (names.get(name) ?? false) || grow.scheme!.edited);
  }

  const inUse =
    names.size === 0
      ? t('me.door.schemes.none')
      : names.size === 1
        ? [...names.entries()].map(([name, edited]) => (edited ? t('me.door.schemes.edited', { name }) : name))[0]
        : t('me.door.schemes.several', { count: names.size });

  return joined([inUse, own.length === 0 ? t('me.door.schemes.noOwn') : t('me.door.schemes.own', { count: own.length })]);
};

/** "v0.0.1 · production build": what the bundle knows about itself, which is also the About page's first line. */
export const versionLine = (t: Translate, version: string, mode: string): string => {
  const key = `me.about.build.${mode}`;

  return t('me.door.about', { version, build: t(key) === key ? mode : t(key) });
};
