import type { TFunction } from 'i18next';
import { DateTime } from 'luxon';
import type { Camera, GrowListItem, Me, Scheme, ShareLink, UnitPreference } from '@fg2/shared-types/v1';
import { growSchemeLabel, type SchemeSummary } from '@/api/schemes';
import { isAhead } from '@/ui/age';
import type { ThemeChoice } from '@/theme/theme-context';
import { timeOf } from '@/screens/notifications/settings';

/**
 * The line under each door on Me, worked out from what the server answered
 * and from nothing else.
 *
 * A door's line is a sentence about the account as it stands - how many grows
 * are public, which channels are on, what the shelf holds - and it is the one
 * place on Me a person reads a figure. So every figure here is read off a
 * resource the app already has, and what is genuinely empty is said as empty
 * rather than as nought: "no links yet" is an answer, "0 active · 0 expired"
 * is a table with nothing in it. The helpers are pure so that each line can be
 * checked against the shapes it reads without drawing the page.
 */

/** The parts of a line, in the board's spelling: a middle dot between each. */
export const joined = (parts: (string | null)[]): string => parts.filter((part): part is string => part !== null && part !== '').join(' · ');

const shortDate = (instant: string): string => DateTime.fromISO(instant).toLocaleString(DateTime.DATE_MED);

/** "1 public · 2 private · terpcontrol.cloud/@chrisgrows", or that there is nothing to count yet. */
export const publicLine = (t: TFunction, grows: GrowListItem[], me: Me, host: string): string => {
  const own = grows.filter(grow => grow.ownerId === me.id && !grow.isDemo);
  if (own.length === 0) return joined([t('me.door.public.none'), profilePart(t, me, host)]);
  const isPublic = own.filter(grow => grow.visibility === 'public').length;

  return joined([
    t('me.door.public.public', { count: isPublic }),
    t('me.door.public.private', { count: own.length - isPublic }),
    profilePart(t, me, host),
  ]);
};

/** Where the profile is, or that it is off: the address is only worth reading when something answers at it. */
const profilePart = (t: TFunction, me: Me, host: string): string => (me.publicProfile ? `${host}/@${me.handle}` : t('me.door.public.profileOff'));

export const followingLine = (t: TFunction, count: number): string =>
  count === 0 ? t('me.door.following.none') : t('me.door.following.grows', { count });

/**
 * How many links still open something, how many have run out and how many
 * were pulled. A link that was revoked is not "expired", whatever its date
 * says: it was ended by hand, and the person who ended it should find it
 * counted that way.
 */
export const shareLinksLine = (t: TFunction, links: ShareLink[], now: DateTime): string => {
  if (links.length === 0) return t('me.door.shareLinks.none');
  const revoked = links.filter(link => link.revokedAt !== null).length;
  const live = links.filter(link => link.revokedAt === null && (link.expiresAt === null || isAhead(link.expiresAt, now))).length;
  const expired = links.length - revoked - live;

  return joined([
    live > 0 ? t('me.door.shareLinks.active', { count: live }) : null,
    expired > 0 ? t('me.door.shareLinks.expired', { count: expired }) : null,
    revoked > 0 ? t('me.door.shareLinks.revoked', { count: revoked }) : null,
  ]);
};

/**
 * The cameras and their entitlement, with the state word the board sets at
 * the right edge. One camera is named with its own date; several are counted,
 * and the state word then speaks for all of them or says that it cannot.
 */
export const premiumLine = (t: TFunction, cameras: Camera[], now: DateTime): { text: string; aside: string | null } => {
  const owned = cameras.filter(camera => camera.removedAt === null && !camera.isDemo);
  if (owned.length === 0) return { text: t('me.door.premium.none'), aside: null };

  const premium = owned.filter(camera => camera.entitlement.tier === 'premium').length;
  if (owned.length === 1) {
    const [camera] = owned;
    const { validUntil, grant } = camera.entitlement;
    const until = validUntil && grant ? t(`me.door.premium.grant.${grant}`, { date: shortDate(validUntil) }) : t('me.door.premium.noEntitlement');

    return { text: joined([camera.name, until]), aside: stateWord(t, camera, now) };
  }

  return {
    text: joined([t('me.door.premium.cameras', { count: owned.length }), t('me.door.premium.premium', { count: premium })]),
    aside:
      premium === owned.length
        ? t('me.door.premium.state.active')
        : premium === 0
          ? t('me.door.premium.state.free')
          : t('me.door.premium.state.partly'),
  };
};

/** Premium is "active"; a camera whose year has run out is "expired", and one that never had one is "free". */
const stateWord = (t: TFunction, camera: Camera, now: DateTime): string => {
  if (camera.entitlement.tier === 'premium') return t('me.door.premium.state.active');
  const { validUntil } = camera.entitlement;

  return validUntil !== null && !isAhead(validUntil, now) ? t('me.door.premium.state.expired') : t('me.door.premium.state.free');
};

/** The channels that are on, in the order of the cards on the page they lead to, then the quiet hours. */
export const notificationsLine = (t: TFunction, me: Me, now: DateTime): string => {
  const { channels, quietHours, mutedUntil } = me.notifications;
  const on = [
    me.pushSubscribed ? t('notifications.channel.push') : null,
    channels.telegram ? t('notifications.channel.telegram') : null,
    channels.email ? t('notifications.channel.email') : null,
    channels.webhook ? t('notifications.channel.webhook') : null,
  ].filter((name): name is string => name !== null);

  return joined([
    isAhead(mutedUntil, now) ? t('me.door.notifications.muted') : null,
    on.length === 0 ? t('me.door.notifications.none') : on.join(' · '),
    quietHours ? t('me.door.notifications.quiet', { from: timeOf(quietHours.fromMinute), to: timeOf(quietHours.toMinute) }) : null,
  ]);
};

/** How long raw climate is kept, in the words the privacy page's menu uses; the page owns the vocabulary. */
export const retentionLabel = (t: TFunction, climateDays: number | null): string => {
  const known: Record<number, string> = { 90: 'd90', 180: 'd180', 365: 'd365', 730: 'd730' };
  if (climateDays === null) return t('me.privacy.keep.forever');
  const key = known[climateDays];

  return key ? t(`me.privacy.keep.${key}`) : t('me.door.privacy.days', { count: climateDays });
};

export const privacyLine = (t: TFunction, me: Me): string => {
  const { hideWeights, hideCounts } = me.privacy;
  const hidden = hideWeights && hideCounts ? 'both' : hideWeights ? 'weights' : hideCounts ? 'counts' : 'nothing';

  return joined([t(`me.door.privacy.${hidden}`), t('me.door.privacy.retention', { keep: retentionLabel(t, me.retention.climateDays) })]);
};

/** "°C, g, l": the three unit choices as their symbols, in the order the page asks them. */
export const unitsLabel = (t: TFunction, units: UnitPreference): string =>
  [units.temperature, units.weight, units.volume].map(unit => t(`me.appearance.unit.${unit}`)).join(', ');

/** The theme, the units where an account states them, and the language; the demo has no units to state. */
export const appearanceLine = (t: TFunction, theme: ThemeChoice, units: UnitPreference | null, language: string): string =>
  joined([
    t('me.door.appearance.theme', { theme: t(`me.theme.${theme}`) }),
    units ? t('me.door.appearance.units', { units: unitsLabel(t, units) }) : null,
    t('me.door.appearance.language', { language: languageName(t, language) }),
  ]);

/** A language in its own name, which is the one spelling every reader recognises. */
export const languageName = (t: TFunction, language: string): string => {
  const key = `me.appearance.languageNames.${language}`;

  return t(key) === key ? language : t(key);
};

/**
 * Which scheme the grows still running are fed, and how many the shelf holds.
 * One scheme across every running grow is named; more than one is counted,
 * because naming the first would be naming it for the wrong grow.
 */
export const schemesLine = (t: TFunction, grows: GrowListItem[], shipped: SchemeSummary[], own: Scheme[]): string => {
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
export const versionLine = (t: TFunction, version: string, mode: string): string => {
  const key = `me.about.build.${mode}`;

  return t('me.door.about', { version, build: t(key) === key ? mode : t(key) });
};
