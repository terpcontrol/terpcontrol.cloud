import { DateTime } from 'luxon';
import type { CardValue, HomeSpaceCard, ValueState } from '@fg2/shared-types/v1';
import { fetchedAt } from '@/api/clock';
import { WORST_FIRST, worstFirst } from '@/screens/alerts/inbox';
import { deviceLiveness, LIVENESS_RANK, valueAge } from '@/ui/age';

/**
 * What the home decides about a card before it is drawn: how alive it is, how
 * much it needs a person, and how it should be ordered among the others. The
 * server decides the age of every value when it answers; a card is drawn for as
 * long as the reader keeps it open, so each verdict is taken through `valueAge`
 * against the moment it is being read at rather than off the card unchanged.
 */

/** A card's liveness: `none` is a place with nothing measuring in it, which shows no dot at all. */
export type Liveness = ValueState | 'none';

/**
 * The best of its values - one live sensor is a live card. A device that has
 * reported nothing yet is offline, not absent.
 *
 * `deviceIds` is null for a reader who was not told what hardware stands here,
 * which is what a shared or public read answers. Then the values are the whole
 * of what is known: some means something is reporting, none means there is
 * nothing to show a dot for.
 */
export const livenessOf = (card: { values: CardValue[]; deviceIds: string[] | null }, now?: DateTime): Liveness => {
  if (card.deviceIds?.length === 0) return 'none';
  if (card.values.length === 0) return card.deviceIds === null ? 'none' : 'offline';
  return card.values.reduce<ValueState>((best, value) => {
    const state = valueAge(value, now);
    return LIVENESS_RANK[state] < LIVENESS_RANK[best] ? state : best;
  }, 'offline');
};

/**
 * The instant a place is judged at. While its refresh is failing (`failedAt`,
 * on this browser's clock) that is the moment of the last answer: the readings
 * go on aging on screen for the app's own reason, and a device heard then is
 * not called offline because this browser lost its connection. The notice
 * beside it says that the page could not be refreshed, and since when.
 */
export const judgedAt = (now: DateTime, failedAt: number | null): DateTime => (failedAt === null ? now : DateTime.fromISO(fetchedAt(failedAt)));

/** A place's liveness through a failing refresh: its readings age as ever, but what was heard at the last answer goes no further than stale. */
export const livenessThrough = (card: Parameters<typeof livenessOf>[0], now: DateTime, failedAt: number | null): Liveness => {
  const aged = livenessOf(card, now);
  return failedAt !== null && aged === 'offline' && livenessOf(card, judgedAt(now, failedAt)) !== 'offline' ? 'stale' : aged;
};

/**
 * Where a place stands whose devices are known and have no value to show:
 * `waiting` for the first one - nothing was ever heard, or a device is there
 * and has not measured yet - or silent since the instant a device was last
 * heard, long enough ago that its values have left the live read. Null for a
 * place that has values, and for one whose devices this reader is not told.
 */
export const silenceOf = (
  values: CardValue[],
  devices: readonly { state: { lastSeenAt: string | null } }[],
  now: DateTime,
): { waiting: true } | { waiting: false; since: string } | null => {
  if (values.length > 0 || devices.length === 0) return null;
  const heard = devices.reduce<string | null>((newest, device) => {
    const at = device.state.lastSeenAt;
    return at && (!newest || at > newest) ? at : newest;
  }, null);

  return heard && deviceLiveness(heard, now) === 'offline' ? { waiting: false, since: heard } : { waiting: true };
};

/** The newest instant on the card, which is what its age reads from. */
export const measuredAtOf = (values: CardValue[]): string | null =>
  values.reduce<string | null>((newest, value) => (value.measuredAt && (!newest || value.measuredAt > newest) ? value.measuredAt : newest), null);

const NOTHING_DUE: ReadonlySet<string> = new Set();

/** How badly a card wants a person: an alarm first - as bad as the one Meldungen would lead with -, then something due, then something offline. */
const attentionOf = (card: HomeSpaceCard, due: boolean): number => {
  const worst = worstFirst(card.openAlerts)[0];
  const offline = livenessOf(card) === 'offline' ? 1 : 0;
  return (worst ? (3 - WORST_FIRST[worst.severity]) * 10 : 0) + (due ? 5 : 0) + offline;
};

/**
 * Stable: two cards that need nothing keep the order the server gave them, which is the order the places were set up
 * in. `due` holds the places with something due for the reader (`duePlaces`): the one list a card's count is read
 * from, so no card moves up for a task its own count does not show.
 */
export const sortedByAttention = <T extends HomeSpaceCard>(cards: T[], due: ReadonlySet<string> = NOTHING_DUE): T[] =>
  cards
    .map((card, index) => ({ card, index, attention: attentionOf(card, card.spaceId !== null && due.has(card.spaceId)) }))
    .sort((a, b) => b.attention - a.attention || a.index - b.index)
    .map(row => row.card);
